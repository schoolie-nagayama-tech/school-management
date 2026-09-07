/**
 * 「これまでの引継ぎをまとめる」— 進行表に溜まった引継ぎを、時系列のまま1回1行に畳む。
 *
 * 正典: docs/ai-features-integration-plan.md
 *
 * ★「整える」ではなく「束ねる」。本番の引継ぎは直近90日で 6,245件中 5,931件（95%）が
 *   書かれていて、平均46字、中身も具体的（「式は立てれますが、方程式の計算ミスが多いです
 *   （特に分数）」）。講師はすでにちゃんと書いている。文章の質は問題ではない。
 *   問題は、次にその生徒を教える人が20回分を通して読めないこと。だから畳むほうに寄せる。
 *
 * ★1つの文にまとめない。「計算ミスが多い」と1文にすると、それが半年前からなのか
 *   先週からなのかが消える。指導を変えるかどうかは「いつからそうなったか」で決まるので、
 *   時系列を潰した時点でこの機能の値打ちが無くなる。
 *
 * ★1回1行・40字。読む場面は授業の直前で、スクロールさせたら読まれない。
 *   40字を超える行はパーサで捨てる（切り詰めない。途中で切れた文は誤読の元）。
 */

/** AIに渡す1回ぶんの引継ぎ。古い順に並べて渡す */
export interface HandoverEntry {
  /** 授業日（YYYY-MM-DD）。★これがそのまま出力の突き合わせキーになる */
  date: string;
  /** 記入した講師名。苗字だけにするのは画面側 */
  teacher: string;
  /** 引継ぎ本文 */
  text: string;
  homeworkNotDone: boolean;
  tardy: boolean;
}

/** 経緯の1行 */
export interface DigestLine {
  date: string;
  line: string;
  /**
   * その回を書いた講師。
   * ★パーサはここを埋めない。AIには「名前を書くな」と言ってあり、出力の名前は信じない。
   *   埋めるのは、実際に渡した回を知っているサーバー側（route）。
   */
  teacher?: string;
}

export interface HandoverDigest {
  /** 渡した回を時系列のまま畳んだもの */
  timeline: DigestLine[];
  /** ずっとある課題 */
  ongoing: string[];
  /** 次に気をつけること */
  nextCare: string[];
}

/** 1行の上限。★超えたら捨てる（切り詰めない） */
export const MAX_LINE_LENGTH = 40;
/** 「ずっとある課題」「次に気をつけること」の件数上限。並べすぎると結局読まれない */
export const MAX_POINTS = 3;
/** 材料にする回数の上限。1回45字として900字ぶん、これ以上は読む側が追えない */
export const MAX_ENTRIES = 20;

export function digestSystemPrompt(): string {
  return [
    'あなたは学習塾の進行表に書かれた引継ぎを読む係です。',
    '次にこの生徒を教える講師が、授業の直前に30秒で読めるように畳みます。',
    '',
    '■ いちばん大事なこと',
    '- ★時系列のまま畳む。渡された回を1回1行にするだけで、まとめて1つの文にしない。',
    '  「いつからそうなったか」が消えると、この要約は役に立たなくなります。',
    '- ★書かれていないことを足さない。原因の推測・励まし・一般論・指導方針の提案は書かない。',
    '  引継ぎに書いてある事実だけを短くします。',
    '- ★日付は渡されたものだけを使う。渡していない日付を作らない。順番も変えない。',
    '',
    '■ timeline（経緯）',
    '- 渡された回を、渡された順のまま1件ずつ。date は渡された日付をそのまま写す。',
    '- line は1行40字まで。その回にあったことを短く言い切る。',
    '- 引継ぎが長くても、要点だけ残して1行にする。複数の話が入っているときは大事なほうを採る。',
    '- ★人の名前は書かない（講師名は誰が書いたかの手がかりに渡しているだけで、要約には要らない）。',
    '',
    '■ ongoing（ずっとある課題）',
    '- 複数の回にまたがって繰り返し出てくることだけ。3つまで、各40字まで。',
    '- 1回しか出てこないことは入れない。無ければ空の配列。',
    '',
    '■ nextCare（次に気をつけること）',
    '- 直近の回に書かれていて、次の授業で効くことだけ。3つまで、各40字まで。',
    '- ★新しい指導方針を考えない。引継ぎに「次回〜」と書かれていることを写すのが基本。',
    '- 無ければ空の配列。',
    '',
    '出力はJSONだけ。前置きは書かない:',
    '{"timeline":[{"date":"2026-09-04","line":"方程式の計算ミス。特に分数"}],' +
      '"ongoing":["分数の計算でつまずく"],"nextCare":["宿題の分数だけ確認する"]}',
  ].join('\n');
}

/**
 * 材料の並べ方。★古い順のまま渡す（並べ替えない）。
 *
 * 引継ぎ本文は改行を含むことがあるので、1件1行に潰してから渡す。
 * 行が崩れると「どこまでが1回ぶんか」が読めなくなり、日付とずれた要約が返る。
 */
export function digestUserText(entries: readonly HandoverEntry[]): string {
  const lines = entries.map((e) => {
    const marks: string[] = [];
    if (e.homeworkNotDone) marks.push('（宿題未提出）');
    if (e.tardy) marks.push('（遅刻）');
    const body = e.text.replace(/\s+/g, ' ').trim();
    const teacher = e.teacher.trim();
    return `${e.date.replace(/-/g, '/')} ${teacher}: ${body}${marks.join('')}`;
  });

  return [`【引継ぎ（古い順・${entries.length}回）】`, ...lines].join('\n');
}

/** 見出し1件ぶんの文字列を検める。長すぎるもの・空のものは捨てる */
function takePoints(raw: unknown): string[] {
  const rows = Array.isArray(raw) ? (raw as unknown[]) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (out.length >= MAX_POINTS) break;
    if (typeof row !== 'string') continue;
    const text = row.trim();
    if (!text) continue;
    // ★長い行は捨てる。切り詰めると文の途中で切れて意味が変わる
    if (text.length > MAX_LINE_LENGTH) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/**
 * AIの生の出力を、画面に出してよい形にする。★出力を信じない。
 *
 * - 渡していない日付は捨てる（作り話をされたら気づけないので、突き合わせで落とす）
 * - 渡した順に並べ直す（順番を入れ替えられると経緯として読めない）
 * - 同じ日付を渡した回数より多くは採らない（同じ日に2コマ入ることがあるので、単純な重複排除にしない）
 * - 40字を超える行は捨てる
 * - 読めない出力なら timeline が空になり、呼び出し側が「作れなかった」に倒す
 */
export function parseDigestResult(raw: unknown, sentDates: readonly string[]): HandoverDigest {
  const empty: HandoverDigest = { timeline: [], ongoing: [], nextCare: [] };
  if (!raw || typeof raw !== 'object') return empty;

  const obj = raw as { timeline?: unknown; ongoing?: unknown; nextCare?: unknown };
  const rows = Array.isArray(obj.timeline) ? (obj.timeline as unknown[]) : [];

  // 渡した日付ごとの「あと何行まで採ってよいか」。同じ日に2コマあれば2行まで許す
  const remaining = new Map<string, number>();
  // 並べ直すときの順番。同じ日付なら最初に渡した位置に寄せる
  const order = new Map<string, number>();
  sentDates.forEach((d, i) => {
    remaining.set(d, (remaining.get(d) ?? 0) + 1);
    if (!order.has(d)) order.set(d, i);
  });

  const picked: DigestLine[] = [];
  for (const row of rows) {
    if (picked.length >= sentDates.length) break;
    if (!row || typeof row !== 'object') continue;
    const r = row as { date?: unknown; line?: unknown };
    if (typeof r.date !== 'string' || typeof r.line !== 'string') continue;

    const date = r.date.trim();
    const left = remaining.get(date) ?? 0;
    // ★渡していない日付。作られたものなので捨てる
    if (left <= 0) continue;

    const line = r.line.trim();
    if (!line) continue;
    if (line.length > MAX_LINE_LENGTH) continue;

    remaining.set(date, left - 1);
    picked.push({ date, line });
  }

  // ★渡した順に並べ直す。Array.prototype.sort は安定なので、同じ日付の中の順は保たれる
  picked.sort((a, b) => (order.get(a.date) ?? 0) - (order.get(b.date) ?? 0));

  // ★経緯が1行も残らなかったら、ほかも出さない（何を根拠にした課題か分からなくなる）
  if (picked.length === 0) return empty;

  return {
    timeline: picked,
    ongoing: takePoints(obj.ongoing),
    nextCare: takePoints(obj.nextCare),
  };
}
