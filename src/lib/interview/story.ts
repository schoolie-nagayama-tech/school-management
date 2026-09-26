/**
 * 面談の「筋」と「受講の枠」（画面に依存しない純粋関数）。
 *
 * 教室長の言葉（2026-09-25）:
 *   「面談って目標までの道筋を示してやるわけよ。いまは課題に対しての答えを1つずつ出してるけど、
 *    つながりやストーリーがないから全体のまとまりがない。…読んだらこの面談はポジティブに臨めるのか、
 *    それとも塾としてしっかり対策をしないといけないのかわかる」
 *
 * - 受講の枠: 通常授業・今期の講習・テスト対策を1か所にまとめる（台本の一番上）
 * - 見立て: 内申・模試・定期テスト・宿題・遅刻の上下から、面談の空気を3つに決める。
 *   ★AIに決めさせない。同じ材料なら毎回同じ見立てになり、根拠（札）をたどれるようにするため。
 *   AIはこの見立てを受け取り、「今日いちばん言いたいこと」と道筋、各場面の文をその向きにそろえる。
 * - 0点は未入力として扱う（treatZeroScoresAsMissing の注記）。
 *
 * 正典: docs/interview-workspace-layout-2026-09.md「面談の筋（2026-09-25）」
 */
import type { AssessmentWithScores } from '@/types/database';
import type { ScheduleRegularPattern } from '@/types/schedule';
import { DAY_OF_WEEK_LABELS } from '@/types/schedule';
import {
  KOUSHU_STATUS_LABEL,
  komaBySubjectText,
  type KoushuSeasonBucket,
  type TestPrepProposalForInterview,
} from '@/app/interview/interview.shared';

/* ============================================================
 * 0点＝未入力
 * ========================================================== */

/**
 * 成績の 0 を「未入力」（null）に置き換える。
 *
 * ★本番の定期テストには 0 点が保存されている（直近120日で約50件）。美術のテストが無かった回など、
 *   何か入れないと入力画面の未入力アラートが出るので 0 を入れている（教室長・2026-09-25）。
 *   そのまま使うと前回比が −77 のように出て、見立ても「大きく下がった」と数えてしまう。
 * ★面談の画面（表・台本・AIへ渡す材料・見立て）でだけ使う。保存されている値は変えない
 *  （成績の入力画面・アラートは別の決まりで動いている）。
 * ★本当に 0 点を取ったケースも未入力になるが、面談の材料としては実害より誤読のほうが大きい。
 */
export function treatZeroScoresAsMissing(
  assessments: AssessmentWithScores[]
): AssessmentWithScores[] {
  return assessments.map((a) =>
    a.scores.some((s) => s.value === 0)
      ? { ...a, scores: a.scores.map((s) => (s.value === 0 ? { ...s, value: null } : s)) }
      : a
  );
}

/* ============================================================
 * 受講の枠
 * ========================================================== */

export interface EnrollmentView {
  /** 通常授業。「数学・英語（週2・火木）」。通塾日程が無ければ null */
  regular: string | null;
  /** 今期の講習。見出し（「冬期 2026」）・科目とコマ・状態。今期の提案書が無ければ null */
  koushu: { season: string; body: string; status: string } | null;
  /** 直近のテスト対策（公開済みの提案書1件）。無ければ null */
  testPrep: { exam: string; body: string; zoukoma: string | null } | null;
}

/** 今日有効な通常期の通塾日程だけ（講習期のパターン・過去や未来の版を除く） */
function activeRegularPatterns(
  patterns: readonly ScheduleRegularPattern[],
  today: string
): ScheduleRegularPattern[] {
  return patterns.filter(
    (p) =>
      p.is_active &&
      p.period_type === 'regular' &&
      p.effective_from <= today &&
      (p.effective_until == null || p.effective_until >= today)
  );
}

/** 曜日と時限（「月1限」）。時限が分からなければ曜日だけ */
function slotLabel(p: ScheduleRegularPattern): string {
  const day = DAY_OF_WEEK_LABELS[p.day_of_week] ?? '?';
  const n = p.time_slot?.slot_number;
  return n != null ? `${day}${n}限` : day;
}

/**
 * 通常授業を1行に。科目ごとに、いつ受けているかを添える（「英語（月1限・木2限）・数学（木3限）」）。
 * ★2026-09-27 教室長「英語(月1限)みたいな書き方にして」。以前は「英語・数学（週2・火木）」で、
 *   どの科目を何曜に受けているかが読めなかった。
 * 並びは曜日→時限の早い順。科目の付いていない枠は「科目未登録（火2限）」として残す（枠があることは事実なので）。
 */
export function formatRegularEnrollment(
  patterns: readonly ScheduleRegularPattern[],
  subjectNames: Record<string, string>,
  today: string
): string | null {
  const active = activeRegularPatterns(patterns, today).sort(
    (a, b) =>
      a.day_of_week - b.day_of_week ||
      (a.time_slot?.slot_number ?? 0) - (b.time_slot?.slot_number ?? 0)
  );
  if (active.length === 0) return null;
  const slotsBySubject = new Map<string, string[]>();
  for (const p of active) {
    const names = (p.subject_ids ?? []).map((id) => subjectNames[id]).filter(Boolean);
    for (const name of names.length > 0 ? names : ['科目未登録']) {
      const list = slotsBySubject.get(name) ?? [];
      const label = slotLabel(p);
      if (!list.includes(label)) list.push(label);
      slotsBySubject.set(name, list);
    }
  }
  return Array.from(slotsBySubject.entries())
    .map(([name, slots]) => `${name}（${slots.join('・')}）`)
    .join('・');
}

/** 定期テストの科目コードの束（旧コードと中学コード）。社会は中学コードで3分野に分かれる */
const TEST_SUBJECT_FAMILIES: ReadonlyArray<{ re: RegExp; label: string; codes: string[] }> = [
  { re: /英/, label: '英', codes: ['english', 'jhs_english'] },
  { re: /数|算/, label: '数', codes: ['math', 'jhs_math'] },
  { re: /国/, label: '国', codes: ['japanese', 'jhs_japanese'] },
  { re: /理/, label: '理', codes: ['science', 'jhs_science'] },
  {
    re: /社|地理|歴史|公民/,
    label: '社',
    codes: ['social', 'jhs_social_geo', 'jhs_social_history', 'jhs_social_civics'],
  },
];

/**
 * 塾で受けている科目（今日有効な通常期の通塾日程）を、定期テストの科目コードに直す。
 * ★見立ての「定期テスト」の札はこの科目だけで上下を見る（2026-09-27 教室長
 *   「定期テストの点数UPだけど受講科目かどうかで変わるからね」）。受けていない科目の上下は、
 *   塾の成果として話す材料にならない。
 * 科目名から推すのは、授業の科目（subjects）と成績の科目コードが別の表で、対応を持っていないため。
 */
export function takenTestSubjects(
  patterns: readonly ScheduleRegularPattern[],
  subjectNames: Record<string, string>,
  today: string
): { codes: Set<string>; label: string } {
  const codes = new Set<string>();
  const labels: string[] = [];
  const names = activeRegularPatterns(patterns, today).flatMap((p) =>
    (p.subject_ids ?? []).map((id) => subjectNames[id]).filter(Boolean)
  );
  for (const fam of TEST_SUBJECT_FAMILIES) {
    if (!names.some((n) => fam.re.test(n))) continue;
    fam.codes.forEach((c) => codes.add(c));
    labels.push(fam.label);
  }
  return { codes, label: labels.join('・') };
}

/* ============================================================
 * 見立て
 * ========================================================== */

export type StoryTone = 'tailwind' | 'mixed' | 'rebuild';

export const STORY_TONE_LABEL: Record<StoryTone, string> = {
  tailwind: '追い風',
  mixed: '踏ん張りどころ',
  rebuild: '立て直し',
};

/** 見立てごとの話し方（画面の見立ての横・AIへの指示の両方で使う） */
export const STORY_TONE_HOW: Record<StoryTone, string> = {
  tailwind: '認めて、上を狙う話をする',
  mixed: '良いところを伸ばし、崩れたところを1つに絞って手を打つ',
  rebuild: '原因と、塾がする対策を先に話す。講習はその対策の一部として出す',
};

export type SignalDirection = 'up' | 'down' | 'flat';

/** 見立ての根拠の札1枚 */
export interface StorySignal {
  key: 'naishin' | 'mock' | 'test' | 'homework' | 'tardy';
  /** 札の文（「内申 9科 35→38」「宿題 未提出 5日（前月1日）」） */
  text: string;
  /** ★「良くなった」を up とする（宿題の未提出が減ったら up） */
  direction: SignalDirection;
}

export interface StoryToneResult {
  /** 札が2枚未満なら null（材料が少なすぎて見立てを決めない） */
  tone: StoryTone | null;
  signals: StorySignal[];
}

/** 定期テストの「5科」に数える科目（旧コードと中学コードの両方） */
const CORE_TEST_SUBJECTS = new Set([
  'english',
  'math',
  'japanese',
  'social',
  'science',
  'jhs_english',
  'jhs_math',
  'jhs_japanese',
  'jhs_science',
  'jhs_social_geo',
  'jhs_social_history',
  'jhs_social_civics',
]);

/** 内申の9科（旧コード）。中学の新コードは実技を含めて jhs_ で始まるものすべて */
function isNaishinSubject(subject: string): boolean {
  return (
    [
      'english',
      'math',
      'japanese',
      'social',
      'science',
      'music',
      'art',
      'tech_home',
      'pe',
    ].includes(subject) || subject.startsWith('jhs_')
  );
}

/**
 * 直近2件の同じ科目どうしの合計を比べる。★片方にしか無い科目（未入力・0点を未入力にしたもの）は
 * 両方から外す。美術のテストが無かった回と有った回を足し算で比べると、それだけで大きく動いて見える。
 */
function compareLatestTwo(
  list: AssessmentWithScores[],
  pick: (subject: string) => boolean
): { prev: number; curr: number } | null {
  if (list.length < 2) return null;
  const [curr, prev] = list;
  const val = (a: AssessmentWithScores) => {
    const m = new Map<string, number>();
    for (const s of a.scores) if (pick(s.subject) && s.value != null) m.set(s.subject, s.value);
    return m;
  };
  const c = val(curr);
  const p = val(prev);
  const common = Array.from(c.keys()).filter((k) => p.has(k));
  if (common.length === 0) return null;
  return {
    prev: common.reduce((sum, k) => sum + (p.get(k) as number), 0),
    curr: common.reduce((sum, k) => sum + (c.get(k) as number), 0),
  };
}

function directionOf(diff: number, flatWithin: number): SignalDirection {
  if (diff > flatWithin) return 'up';
  if (diff < -flatWithin) return 'down';
  return 'flat';
}

const ARROW: Record<SignalDirection, string> = { up: '↑', down: '↓', flat: '→' };

/** 宿題・遅刻の月（DisciplineMonth と同じ形の必要な分だけ） */
export interface DisciplineMonthLike {
  label: string;
  lessonDays: number;
  homeworkMissedDays: number;
  tardyDays: number;
}

/**
 * 見立てを決める。
 * - 札: 内申（直近2回の9科合計）・模試（直近2回の5科偏差値）・定期テスト（直近2回の5科合計）・
 *   宿題と遅刻（授業のあった直近2か月の日数）。材料が無い札は出さない。
 * - 動いていない幅: 内申±0・偏差値±1・定期テスト±5点・宿題と遅刻は±0日。
 * - 見立て: 下がった札が無く上がった札が2枚以上 → 追い風／
 *   内申と模試の両方が下がった、または下がった札が2枚以上で上がった札が無い → 立て直し／それ以外 → 踏ん張りどころ。
 *   ★内申と模試は入試に直結するので、この2つが揃って下がっていれば他が良くても立て直しにする。
 * ★assessments は新しい順・0点を未入力にしたもの（treatZeroScoresAsMissing 済み）を渡す。
 */
export function computeStoryTone(
  assessments: AssessmentWithScores[],
  /** 新しい月が先頭（computeDisciplineMonthly の戻り） */
  disciplineMonths: readonly DisciplineMonthLike[],
  /** 塾で受けている科目（takenTestSubjects）。無ければ定期テストは5科で比べる */
  taken?: { codes: Set<string>; label: string } | null
): StoryToneResult {
  const signals: StorySignal[] = [];

  const naishin = compareLatestTwo(
    assessments.filter((a) => a.category === 'report_card'),
    isNaishinSubject
  );
  if (naishin) {
    const d = directionOf(naishin.curr - naishin.prev, 0);
    signals.push({
      key: 'naishin',
      text: `内申（9科） ${naishin.prev}→${naishin.curr} ${ARROW[d]}`,
      direction: d,
    });
  }

  const mocks = assessments.filter(
    (a) => a.category === 'mock' && a.scores.some((s) => s.subject === 'hensa_5' && s.value != null)
  );
  if (mocks.length >= 2) {
    const h = (a: AssessmentWithScores) =>
      a.scores.find((s) => s.subject === 'hensa_5')?.value as number;
    const d = directionOf(h(mocks[0]) - h(mocks[1]), 1);
    signals.push({
      key: 'mock',
      text: `模試 偏差値 ${h(mocks[1])}→${h(mocks[0])} ${ARROW[d]}`,
      direction: d,
    });
  }

  // ★受講科目が分かれば、その科目だけで比べる（takenTestSubjects の注記）。
  //   分からない（通塾日程が無い・科目名から当てられない）ときは5科で比べる
  const takenCodes = taken && taken.codes.size > 0 ? taken.codes : null;
  const test = compareLatestTwo(
    assessments.filter((a) => a.category === 'regular_test'),
    (s) => CORE_TEST_SUBJECTS.has(s) && (!takenCodes || takenCodes.has(s))
  );
  if (test) {
    const diff = test.curr - test.prev;
    const d = directionOf(diff, 5);
    const head = takenCodes && taken ? `定期テスト（${taken.label}）` : '定期テスト';
    signals.push({
      key: 'test',
      text: `${head} ${diff >= 0 ? '+' : '−'}${Math.abs(diff)}点 ${ARROW[d]}`,
      direction: d,
    });
  }

  // 授業のあった直近2か月（今月が0日なら先月と先々月）
  const months = disciplineMonths.filter((m) => m.lessonDays > 0).slice(0, 2);
  if (months.length === 2) {
    const [curr, prev] = months;
    const hw = curr.homeworkMissedDays - prev.homeworkMissedDays;
    // ★未提出は「減ったら良い」。札の向きは良し悪しで持つ
    const hwDir: SignalDirection = hw < 0 ? 'up' : hw > 0 ? 'down' : 'flat';
    signals.push({
      key: 'homework',
      text: `宿題 未提出 ${curr.homeworkMissedDays}日（前月${prev.homeworkMissedDays}日）`,
      direction: hwDir,
    });
    const td = curr.tardyDays - prev.tardyDays;
    const tdDir: SignalDirection = td < 0 ? 'up' : td > 0 ? 'down' : 'flat';
    signals.push({
      key: 'tardy',
      text: `遅刻 ${curr.tardyDays}日（前月${prev.tardyDays}日）`,
      direction: tdDir,
    });
  }

  if (signals.length < 2) return { tone: null, signals };

  const ups = signals.filter((s) => s.direction === 'up').length;
  const downs = signals.filter((s) => s.direction === 'down').length;
  const naishinDown = signals.some((s) => s.key === 'naishin' && s.direction === 'down');
  const mockDown = signals.some((s) => s.key === 'mock' && s.direction === 'down');

  let tone: StoryTone;
  if ((naishinDown && mockDown) || (downs >= 2 && ups === 0)) tone = 'rebuild';
  else if (downs === 0 && ups >= 2) tone = 'tailwind';
  else tone = 'mixed';
  return { tone, signals };
}

/**
 * AIへ渡す見立ての1行（briefUserText の【見立て】）。
 * ★札の数字はAIに渡してよい（AIは数字を書かないが、判断の材料にはする）。
 */
export function storyToneLine(result: StoryToneResult): string | null {
  if (!result.tone) return null;
  return `${STORY_TONE_LABEL[result.tone]}（${result.signals.map((s) => s.text).join('／')}）―― ${
    STORY_TONE_HOW[result.tone]
  }`;
}

/* ============================================================
 * 受講の枠（講習・テスト対策を足して1つにまとめる）
 * ========================================================== */

/** 今期の講習の行。★科目とコマは提案書（seasonal_proposals）の期のまとめ。今期が無ければ null */
export function formatKoushuEnrollment(
  bucket: KoushuSeasonBucket | undefined,
  seasonHeading: string
): EnrollmentView['koushu'] {
  if (!bucket) return null;
  return {
    season: seasonHeading,
    body: komaBySubjectText(bucket.komaBySubject) ?? `${bucket.totalKoma}コマ`,
    status: KOUSHU_STATUS_LABEL[bucket.status],
  };
}

/**
 * 直近のテスト対策の行（公開済みの提案書のうち先頭＝いちばん新しい1件）。
 * ★コマを割り当てた科目だけを「受講した科目」とする（buildTestPrepLines と同じ決まり）。
 *   どの科目にもコマが無い提案書は、科目名だけを並べる。
 */
export function formatTestPrepEnrollment(
  proposals: readonly TestPrepProposalForInterview[]
): EnrollmentView['testPrep'] {
  const p = proposals[0];
  if (!p) return null;
  const withKoma = p.subjects.filter((s) => s.koma > 0);
  const body =
    withKoma.length > 0
      ? `${withKoma.map((s) => `${s.name} ${s.koma}`).join('・')}コマ`
      : p.subjects.map((s) => s.name).join('・') || '科目未登録';
  const zoukoma =
    p.zoukoma.status === 'applied'
      ? `増コマ ${p.zoukoma.koma}`
      : p.zoukoma.status === 'none'
        ? '増コマ申込なし'
        : null;
  return { exam: p.examName ?? p.title, body, zoukoma };
}
