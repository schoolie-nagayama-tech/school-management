/**
 * 「保護者との連絡」— AIが作った文の日付・曜日・時刻・金額などを、送る前に機械で確かめる。
 *
 * 正典: docs/parent-message-ai-plan.md §5.3
 *
 * ★なぜ要るか。プロンプトで「箇条書きに無い日付・金額を作らない」と禁じているが、
 *   禁じるだけでは守られたかどうかが分からない。Gmail の AI 作文でもいちばん重い事故は
 *   「名前・場所・時刻がすべて違っていた」で、しかも Gmail は確かめる仕組みを持たず利用者任せだった。
 *   保護者向けの文で日付や曜日を間違えると、そのまま来塾日の行き違いになる。
 *
 * ★AIは呼ばない。正規表現で拾って、メモ（箇条書き）とやりとりの本文に同じ表記があるかを見るだけ。
 *   AIにAIを確かめさせると、同じ思い込みで同じ間違いを通す。
 *
 * ★直さない。並べて見せるだけ。直すのは教室長で、ここは「どこを見ればいいか」を指す係。
 *   曜日だけはカレンダーで計算できるので「本当は何曜か」まで出す。
 */

/** mismatch=本文が事実と食い違う（赤）／missing=メモにもやりとりにも無い表記（黄）／ok=確かめられた */
export type FactLevel = 'mismatch' | 'missing' | 'ok';

export interface FactItem {
  level: FactLevel;
  /** 本文に出てきた表記（例: '9月17日（水）'） */
  label: string;
  /** 何がおかしいか。ok のときは省く */
  detail?: string;
}

export interface PointCoverage {
  /** 箇条書きの1行（先頭の「・」は外してある） */
  line: string;
  /** その行の中身が本文に入ったか */
  included: boolean;
}

export interface FactCheckResult {
  items: FactItem[];
  coverage: PointCoverage[];
}

const WEEKDAYS = '日月火水木金土';

/**
 * 表記ゆれを揃える。★本文とメモを同じ形に直してから比べる。
 *   教室長は「9/15」「９月１５日」「p.48」と書き、AIは「9月15日」「48ページ」と書くので、
 *   揃えずに比べると、正しい日付まで「メモに無い」と出てしまう（誤報が多いと誰も見なくなる）。
 */
export function normalizeForCheck(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/／/g, '/')
    .replace(/：/g, ':')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[〜～]/g, '~')
    .replace(/，/g, ',');
}

/**
 * 月日だけの日付に年を当てる。★今日にいちばん近い年を選ぶ。
 *   12月に「1月5日」と書けば翌年の1月5日のことで、今年の1月5日ではない。
 */
export function inferYear(month: number, day: number, today: Date): number {
  const y = today.getFullYear();
  let best = y;
  let bestDiff = Infinity;
  for (const cand of [y - 1, y, y + 1]) {
    const diff = Math.abs(new Date(cand, month - 1, day).getTime() - today.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = cand;
    }
  }
  return best;
}

interface FoundDate {
  month: number | null;
  day: number;
  weekday: string | null;
  raw: string;
}

/**
 * 日付を拾う。「9月15日（火）と17日（木）」の2つ目のように月が省かれたものは、
 * 直前の月を引き継ぐ（日本語の書き方として普通なので、拾わないと確かめ漏れになる）。
 */
function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  let carryMonth: number | null = null;
  const re =
    /(?:(\d{1,2})月(\d{1,2})日|(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])|(?<![\d月])(\d{1,2})日)(?:\s*\(([日月火水木金土])(?:曜日?)?\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let month: number | null;
    let day: number;
    if (m[1]) {
      month = Number(m[1]);
      day = Number(m[2]);
    } else if (m[3]) {
      month = Number(m[3]);
      day = Number(m[4]);
    } else {
      month = carryMonth;
      day = Number(m[5]);
    }
    if (month !== null) carryMonth = month;
    out.push({ month, day, weekday: m[6] ?? null, raw: m[0] });
  }
  return out;
}

/** 時刻を 'H:MM' に揃えて拾う（18:00・18時・18時30分・18時半） */
function findTimes(text: string): { key: string; raw: string }[] {
  const out: { key: string; raw: string }[] = [];
  for (const m of Array.from(text.matchAll(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g))) {
    out.push({ key: `${Number(m[1])}:${m[2]}`, raw: m[0] });
  }
  for (const m of Array.from(text.matchAll(/(?<!\d)(\d{1,2})時(?:(\d{1,2})分|(半))?/g))) {
    const min = m[3] ? '30' : m[2] ? m[2].padStart(2, '0') : '00';
    out.push({ key: `${Number(m[1])}:${min}`, raw: m[0] });
  }
  return out;
}

/** 金額をカンマ抜きで拾う */
function findMoney(text: string): { key: string; raw: string }[] {
  return Array.from(text.matchAll(/(\d[\d,]*)円/g)).map((m) => ({
    key: m[1].replace(/,/g, ''),
    raw: m[0],
  }));
}

/**
 * 回数・コマ数・ページなど、単位の付いた数字を拾う。
 * ★時刻の「30分」は時刻として別に見るので、「時」の直後の数字は拾わない。
 */
function findCounted(text: string): { nums: string[]; raw: string }[] {
  const out: { nums: string[]; raw: string }[] = [];
  const re =
    /(?<![\d時:])(\d+)(?:~(\d+))?(回|コマ|分|点|問|枚|ページ|人|名|週|か月|ヶ月|日間|教科|科目)/g;
  for (const m of Array.from(text.matchAll(re))) {
    out.push({ nums: m[2] ? [m[1], m[2]] : [m[1]], raw: m[0] });
  }
  return out;
}

/**
 * 「〇〇先生」を拾う。★保護者向けには講師名を出さない決まり（CLAUDE.md・保護者ポータル）。
 *   学校の先生・担任の先生のような一般の言い方は拾わない。
 */
function findTeacherNames(text: string): string[] {
  const out: string[] = [];
  for (const m of Array.from(text.matchAll(/([一-龥ァ-ヶー]{1,6})先生/g))) {
    if (/^(学校|担任|塾|各|教科|担当|講師|塾長|教室長)$/.test(m[1])) continue;
    out.push(m[0]);
  }
  return out;
}

/** 箇条書きを1行ずつにする。先頭の記号は外す */
export function splitPoints(points: string): string[] {
  return points
    .split('\n')
    .map((l) => l.replace(/^[\s　・\-*●◦•]+/, '').trim())
    .filter(Boolean);
}

/**
 * 本文を確かめる。
 *
 * @param body       返信欄に入っている文（教室長が手で直した後でもよい）
 * @param points     教室長が書いた箇条書き
 * @param threadTexts そのスレッドのメッセージ本文（保護者が書いた日付・時刻もここにある）
 * @param today      年と曜日を決めるための基準日
 */
export function checkParentMessageFacts(params: {
  body: string;
  points: string;
  threadTexts: readonly string[];
  today: Date;
}): FactCheckResult {
  const body = normalizeForCheck(params.body);
  const pool = normalizeForCheck([params.points, ...params.threadTexts].join('\n'));

  const items: FactItem[] = [];
  const seen = new Set<string>();
  const push = (item: FactItem) => {
    if (seen.has(item.label)) return;
    seen.add(item.label);
    items.push(item);
  };

  // ── 日付と曜日
  const poolDates = findDates(pool);
  const poolDateKeys = new Set(
    poolDates.filter((d) => d.month !== null).map((d) => `${d.month}/${d.day}`)
  );
  const poolDays = new Set(poolDates.map((d) => d.day));
  for (const d of findDates(body)) {
    const label = d.month !== null ? `${d.month}月${d.day}日` : `${d.day}日`;
    const shown = d.weekday ? `${label}（${d.weekday}）` : label;
    if (d.month !== null) {
      const year = inferYear(d.month, d.day, params.today);
      const date = new Date(year, d.month - 1, d.day);
      if (date.getMonth() !== d.month - 1 || date.getDate() !== d.day) {
        push({ level: 'mismatch', label: shown, detail: 'この日付はカレンダーにありません' });
        continue;
      }
      const actual = WEEKDAYS[date.getDay()];
      if (d.weekday && d.weekday !== actual) {
        push({ level: 'mismatch', label: shown, detail: `${label}は${actual}曜日です` });
        continue;
      }
      if (!poolDateKeys.has(`${d.month}/${d.day}`)) {
        push({ level: 'missing', label: shown, detail: 'メモにもやりとりにもありません' });
        continue;
      }
      push({ level: 'ok', label: shown });
    } else if (!poolDays.has(d.day)) {
      push({ level: 'missing', label: shown, detail: 'メモにもやりとりにもありません' });
    } else {
      push({ level: 'ok', label: shown });
    }
  }

  // ── 時刻
  const poolTimes = new Set(findTimes(pool).map((t) => t.key));
  for (const t of findTimes(body)) {
    push(
      poolTimes.has(t.key)
        ? { level: 'ok', label: t.raw }
        : { level: 'missing', label: t.raw, detail: 'メモにもやりとりにもありません' }
    );
  }

  // ── 金額
  const poolMoney = new Set(findMoney(pool).map((m) => m.key));
  for (const m of findMoney(body)) {
    push(
      poolMoney.has(m.key)
        ? { level: 'ok', label: m.raw }
        : { level: 'missing', label: m.raw, detail: 'メモにもやりとりにもありません' }
    );
  }

  // ── 回数・ページなど（★数字がメモかやりとりのどこかにあれば良しとする。単位の言い換えが多いため）
  const poolNums = new Set(pool.match(/\d+/g) ?? []);
  for (const c of findCounted(body)) {
    const ok = c.nums.every((n) => poolNums.has(n));
    push(
      ok
        ? { level: 'ok', label: c.raw }
        : { level: 'missing', label: c.raw, detail: 'メモにもやりとりにもありません' }
    );
  }

  // ── 講師名
  for (const name of findTeacherNames(body)) {
    push({ level: 'mismatch', label: name, detail: '保護者向けの文には講師名を出しません' });
  }

  // ── 箇条書きの各行が本文に入ったか
  // ★語の半分以上が本文にあれば「入った」とみなす。AIは言い換えるので、全部一致は求めない
  const coverage = splitPoints(params.points).map((line) => {
    const tokens = normalizeForCheck(line).match(/\d+|[一-龥ァ-ヶー]{2,}/g) ?? [];
    if (tokens.length === 0) return { line, included: true };
    const hits = tokens.filter((t) => body.includes(t)).length;
    return { line, included: hits / tokens.length >= 0.5 };
  });

  return { items, coverage };
}
