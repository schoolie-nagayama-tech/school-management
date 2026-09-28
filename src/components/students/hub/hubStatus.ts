/**
 * 生徒ハブ「今の状態」の6指標の組み立て。画面から切り離した純粋関数。
 *
 * 正典: docs/student-hub-plan.md §3 ／ 見た目: public/student-hub-mock.html の「今の状態」
 *
 * ★数え方は下のセクション（成績・進行表・宿題・遅刻・面談）や面談画面（進行表の LIVE・講習の受講の枠）と同じ関数に任せる。
 *   ここで別の数え方をすると、上の指標と下の表で数字が食い違う（成績サマリが4か所で
 *   別実装になって見え方がずれている事故を繰り返さない。docs/student-hub-plan.md §2）。
 * ★値が無いときは value=null（画面は「—」）にし、sub に短い理由を書く。空欄にも「0回」の羅列にもしない。
 */
import type { AssessmentWithScores, StudentInterview } from '@/types/database';
import {
  ASSESSMENT_NAME_LABELS,
  GRADE_LABELS,
  INTERVIEW_TYPE_LABELS,
  SEASON_LABELS,
  SUBJECT_LABELS,
} from '@/types/database';
import type { ScheduleEntry } from '@/types/schedule';
import type { DisciplineSessionRow } from '@/lib/api/progress-sessions';
import type { TextbookProgressData } from '@/app/interview/ProgressPanel';
import {
  computeDisciplineMonthly,
  computeScoreSummary,
  daysSince,
  komaBySubjectText,
  pickLiveTextbookDetails,
  type KoushuSeasonBucket,
} from '@/app/interview/interview.shared';
import { normalizePersonName } from '@/lib/utils/personName';
import { toDateStr } from './hubSummary';

/** 指標1つ分。value=null は「値が無い」（画面は「—」） */
export interface HubStatusMetric {
  value: string | null;
  /** 値の下に出す補足（1行ずつ）。値が無いときは理由 */
  sub: string[];
  /** 対応が要るときだけ 'warning'。ほかは中立（赤は「注意すること」のアラートが担う） */
  tone: 'neutral' | 'warning';
  /** 値が数字でなく文（「冬期講習」など）のとき true。大きい等幅ではなく一段小さい本文書体で出す */
  textValue?: boolean;
  /**
   * 値の代わりに出す行（進行表の科目ごとの行）。あるときは value を出さず、行を一段小さい文字で並べる。
   * ★行ごとに色を持つのは、停滞している科目の行だけを黄にするため（全体を黄にすると、どれが止まっているか分からない）
   */
  rows?: HubStatusRow[];
  /** sub の下に、少し間を空けて出す別の話題の行（直近のテストの模試の行） */
  secondary?: string[];
}

/** 進行表の1行。note は行末に小さく添える（「停滞 27日」） */
export interface HubStatusRow {
  text: string;
  note: string | null;
  tone: 'neutral' | 'warning';
}

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function none(reason: string): HubStatusMetric {
  return { value: null, sub: [reason], tone: 'neutral' };
}

/* ============================================================
 * 次回授業
 * ========================================================== */

/**
 * 次回授業を選ぶ。今日以降で最初の授業。
 *
 * - 取消（cancelled）・振替元（transferred_out＝振替で別の日へ動いた元のコマ）は、その日に授業が無いので除く。
 *   ★振替先（transferred_in）は実際に授業がある日なので残す。
 * - 今日の授業で開始時刻を過ぎたものは「次回」ではないので除く。開始時刻が分からない今日のコマは残す
 *   （判定できないものを消すより、出しておくほうが安全）。
 * - 並びは日付 → 開始時刻。
 */
export function pickNextLesson(entries: ScheduleEntry[], now: Date): ScheduleEntry | null {
  const today = toDateStr(now);
  const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
    2,
    '0'
  )}`;
  const candidates = entries.filter((e) => {
    if (e.status === 'cancelled' || e.status === 'transferred_out') return false;
    if (e.entry_date < today) return false;
    if (e.entry_date === today) {
      const start = e.time_slot?.start_time?.slice(0, 5);
      if (start && start <= nowTime) return false;
    }
    return true;
  });
  candidates.sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    const sa = a.time_slot?.start_time ?? '99:99';
    const sb = b.time_slot?.start_time ?? '99:99';
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
  return candidates[0] ?? null;
}

/**
 * 次回授業の指標。値は「9/30(火) 19:00」、下に「数学・田中」。
 * 講師名は座席表の担当（schedule_entries.teacher_id）。教室長以上の画面なので出す。
 */
export function buildNextLessonMetric(
  entries: ScheduleEntry[],
  now: Date,
  subjectNames: ReadonlyMap<string, string>,
  rangeDays: number
): HubStatusMetric {
  const next = pickNextLesson(entries, now);
  if (!next) return none(`${rangeDays}日先まで予定なし`);
  const [, m, d] = next.entry_date.split('-').map(Number);
  const dow = DAY_LABELS[new Date(`${next.entry_date}T00:00:00`).getDay()] ?? '';
  const start = next.time_slot?.start_time?.slice(0, 5);
  const value = `${m}/${d}(${dow})${start ? ` ${start}` : ''}`;
  const subjects = (next.subject_ids ?? [])
    .map((id) => subjectNames.get(id))
    .filter((n): n is string => !!n)
    .join('・');
  const t = next.teacher as { display_name?: string | null; last_name?: string | null } | undefined;
  const teacher =
    next.teacher_id && t ? normalizePersonName(t.display_name || t.last_name || '') : '';
  return {
    value,
    sub: [`${subjects || '科目未設定'}・${teacher || '担当未定'}`],
    tone: 'neutral',
  };
}

/* ============================================================
 * 直近のテスト（定期テスト＋模試）
 * ========================================================== */

/** 5科（英数国社理） */
export const FIVE_SUBJECTS = ['english', 'math', 'japanese', 'social', 'science'] as const;

/** −23 / +5 / ±0。マイナスは記号の − で出す（ハイフンは細くて読み落とす） */
export function formatSignedDiff(diff: number): string {
  if (diff > 0) return `+${diff}`;
  if (diff < 0) return `−${Math.abs(diff)}`;
  return '±0';
}

function assessmentLabel(a: AssessmentWithScores): string {
  const name = ASSESSMENT_NAME_LABELS[a.name_code] ?? a.name_code;
  // 実施日があれば日付、無ければ学年（「1学期期末」だけでは中2と中3のどちらか分からないため）
  const when = a.exam_date ?? (a.exam_month ? a.exam_month.slice(0, 7) : null);
  const prefix = when ?? GRADE_LABELS[a.grade] ?? '';
  return prefix ? `${prefix} ${name}` : name;
}

/**
 * 直近の定期テストの指標。値は5科合計、下に「5科合計・前回比 −23」と「2026-07-05 1学期期末」。
 *
 * ★合計と前回比は成績セクション（ScorePanel）と同じ computeScoreSummary に出させる。
 *   ただし渡す前に科目を5科に絞る（学校によって定期テストに実技4科が入り、そのまま足すと9科合計になるため）。
 * ★5科のうち1つでも欠けていれば合計を出さない（欠けたまま足すと点数が下がって見え、下落と区別できない）。
 *   前回も欠けがあれば前回比は出さない。0点は HubDataContext で未入力に読み替え済み（面談画面と同じ）。
 * assessments は listAssessments の並び（新しい順）であること。
 */
export function buildRegularTestMetric(assessments: AssessmentWithScores[]): HubStatusMetric {
  const regular = assessments.filter((a) => a.category === 'regular_test');
  // ラベルが「直近のテスト」で下に模試も出るので、何が無いのかを言う
  if (regular.length === 0) return none('定期テストの記録なし');

  const fiveSet = new Set<string>(FIVE_SUBJECTS);
  const fiveOnly = regular.slice(0, 2).map((a) => ({
    ...a,
    scores: a.scores.filter((s) => fiveSet.has(s.subject)),
  }));
  const summary = computeScoreSummary(fiveOnly, 'regular_test', 2);
  // summary は古い → 新しい順。末尾が直近、その1つ前が前回
  const latestIdx = summary.testLabels.length - 1;
  const complete = (i: number) =>
    FIVE_SUBJECTS.every((subj) => summary.rows.find((r) => r.subject === subj)?.values[i] != null);
  const label = assessmentLabel(regular[0]);

  if (!complete(latestIdx)) {
    return {
      value: '一部未入力',
      sub: ['5科がそろっていません', label],
      tone: 'neutral',
      textValue: true,
    };
  }
  const total = summary.totals[latestIdx];
  const prevIdx = latestIdx - 1;
  const diffText =
    prevIdx >= 0 && complete(prevIdx)
      ? `前回比 ${formatSignedDiff(total - summary.totals[prevIdx])}`
      : null;
  return {
    value: String(total),
    sub: [diffText ? `5科合計・${diffText}` : '5科合計', label],
    tone: 'neutral',
  };
}

/** 偏差値の表記。小数1桁まで（52.1 / 52） */
function formatHensa(v: number): string {
  return String(Math.round(v * 10) / 10);
}

interface MockHensa {
  kind: '5科' | '3科';
  value: number;
}

/** 模試の偏差値1件ぶん。5科が無ければ3科 */
function mockHensa(a: AssessmentWithScores): MockHensa | null {
  const v = (code: string) => a.scores.find((s) => s.subject === code)?.value ?? null;
  const h5 = v('hensa_5');
  if (h5 != null) return { kind: '5科', value: h5 };
  const h3 = v('hensa_3');
  if (h3 != null) return { kind: '3科', value: h3 };
  return null;
}

/**
 * 直近の模試の行。「模試 偏差値52.1（5科）・前回比 −2.3」と「2026-08 会場模試」。
 *
 * ★偏差値は成績の科目コード hensa_5（5科）、無ければ hensa_3（3科）。どちらかを必ず書く
 *  （3科と5科の偏差値は別物で、並べて読むと取り違える）。
 * ★直近の模試＝偏差値が入っている模試のうち最も新しいもの。偏差値が未入力の模試は飛ばす
 *  （点数だけの模試を拾うと、偏差値の行が出なくなる）。
 * ★前回比は同じ種類（5科どうし・3科どうし）の1つ前の模試とだけ比べる。種類が違えば出さない。
 * ★模試が無ければ空配列（「—」も出さない。定期テストだけ出す）。
 * assessments は listAssessments の並び（新しい順）。0は HubDataContext で未入力に読み替え済み。
 */
export function buildMockLines(assessments: AssessmentWithScores[]): string[] {
  const mocks: { a: AssessmentWithScores; h: MockHensa }[] = [];
  for (const a of assessments) {
    if (a.category !== 'mock') continue;
    const h = mockHensa(a);
    if (h) mocks.push({ a, h });
  }
  const latest = mocks[0];
  if (!latest) return [];
  const prev = mocks.slice(1).find((x) => x.h.kind === latest.h.kind);
  const diff = prev ? Math.round((latest.h.value - prev.h.value) * 10) / 10 : null;
  const head = `模試 偏差値${formatHensa(latest.h.value)}（${latest.h.kind}）`;
  return [
    diff != null ? `${head}・前回比 ${formatSignedDiff(diff)}` : head,
    assessmentLabel(latest.a),
  ];
}

/**
 * 直近のテストの指標。定期テスト（buildRegularTestMetric）の下に、模試の偏差値の行を添える。
 * 成績は HubDataContext の共有を使う（取り直さない）。
 */
export function buildRecentTestMetric(assessments: AssessmentWithScores[]): HubStatusMetric {
  const regular = buildRegularTestMetric(assessments);
  const mock = buildMockLines(assessments);
  return mock.length > 0 ? { ...regular, secondary: mock } : regular;
}

/* ============================================================
 * 前回の面談
 * ========================================================== */

/**
 * 前回の面談の指標。値は「92日前」、下に「2026-06-05 保護者面談」。
 * 約束（interview_type='task'）は面談ではないので除く（面談ワークスペースの「前回の申し送り」と同じ）。
 * 経過日数は面談未更新の判定と同じ daysSince。
 */
export function buildLastInterviewMetric(interviews: StudentInterview[]): HubStatusMetric {
  const latest = interviews
    .filter((i) => i.interview_type !== 'task')
    .reduce<StudentInterview | null>(
      (best, i) => (!best || i.interview_date > best.interview_date ? i : best),
      null
    );
  if (!latest) return none('記録なし');
  const days = daysSince(latest.interview_date);
  // 先の日付で登録された面談（予定として入れたもの）は「◯日後」と出す
  const value = days === 0 ? '今日' : days > 0 ? `${days}日前` : `${-days}日後`;
  const type = INTERVIEW_TYPE_LABELS[latest.interview_type] ?? latest.interview_type;
  return { value, sub: [`${latest.interview_date} ${type}`], tone: 'neutral' };
}

/* ============================================================
 * 今月の宿題・遅刻
 * ========================================================== */

/**
 * 今月の宿題未実施・遅刻。宿題・遅刻セクション（DisciplinePanel）と同じ computeDisciplineMonthly の今月分。
 * ★数えるのは日数（同じ日に複数テキストで付いても1回）。下の表と同じ数え方。
 * 今月の授業記録が無ければ「—」。記録があって両方0なら「なし」（0回を並べない）。
 */
export function buildDisciplineMetric(
  sessions: DisciplineSessionRow[],
  today: Date
): HubStatusMetric {
  const [month] = computeDisciplineMonthly(sessions, 1, today);
  if (!month || month.lessonDays === 0) return none('今月の授業記録なし');
  const lessons = `今月 授業${month.lessonDays}日`;
  if (month.homeworkMissedDays === 0 && month.tardyDays === 0) {
    return {
      value: 'なし',
      sub: [`${lessons}・宿題未実施も遅刻もなし`],
      tone: 'neutral',
      textValue: true,
    };
  }
  return {
    value: `宿題 ${month.homeworkMissedDays}回・遅刻 ${month.tardyDays}回`,
    sub: [lessons],
    tone: 'neutral',
    textValue: true,
  };
}

/* ============================================================
 * 進行表（科目ごとの LIVE のテキスト）
 * ========================================================== */

/** 進行表の指標に出す科目の数。これより多ければ「ほか N科目」 */
export const PROGRESS_MAX_SUBJECTS = 3;

/**
 * 到達した単元＝1回目の授業を実施した単元のうち、カリキュラムの並び（sort_order）で最も先のもの。
 *
 * ★「最後に授業をした単元」ではない。復習で前の単元に戻った日があると「どこまで進んだか」が
 *   後ろに下がって見えるため。「実施した」の判定は summarizeTextbookProgress の done と同じ
 *  （その単元に lesson_date の入った授業が1件でもある）。
 * ★sort_order が同じなら取得順で後ろのものを採る。
 */
export function reachedUnitTitle(rows: TextbookProgressData['rows']): string | null {
  let best: { title: string; order: number } | null = null;
  for (let index = 0; index < rows.length; index++) {
    const r = rows[index];
    if (!(r.progress?.lessons ?? []).some((l) => l.lesson_date)) continue;
    const order = r.sort_order ?? index;
    // >= なので sort_order が同じなら後ろのものが勝つ
    if (!best || order >= best.order) best = { title: r.title, order };
  }
  return best?.title ?? null;
}

/**
 * 進行表の指標。科目ごとに「今使っているテキスト」（LIVE）1冊の進み具合を1行ずつ。
 * 「数学 新中問 数学2 ｜ 二次関数まで」。その LIVE が停滞していれば、その行だけ黄で「停滞 N日」。
 *
 * ★LIVE は面談④と同じ pickLiveTextbookDetails に選ばせる（自前で選び直さない）。
 *   ハブの進行表データは面談と同じ形（テキスト×進行記録）なので、そのまま渡せる。
 *   進行表ページの pickLiveTextbookIds は最終利用日を別の取得（getLastUsedDateByTextbook）で
 *   作る前提で、ハブには無い取得が1本増えるため使わない。意味論（最終利用日が最新・同日なら手動の並びが上）は同じ。
 * ★講習のテキストは混ぜない。以前は管理中の全冊を数えており、講習の冊子まで「停滞」に数えていた。
 *   LIVE＝科目ごとに一番最近使った1冊なので、通常授業のテキストが主役になる。
 * ★停滞の判定は summarizeTextbookProgress の stalled（最終指導日から14日超）。N は最終指導日からの日数。
 * ★色は停滞の行だけ。停滞していない行も全体の数字も中立にする（対応が要るものだけ色を付ける）。
 */
export function buildProgressMetric(textbookData: TextbookProgressData[]): HubStatusMetric {
  const live = pickLiveTextbookDetails(textbookData);
  if (live.length === 0) return none('進行中のテキストなし');

  const rowsByTextbook = new Map(
    textbookData.map((d): [string, TextbookProgressData['rows']] => [d.textbook.id, d.rows])
  );
  const rows: HubStatusRow[] = live.slice(0, PROGRESS_MAX_SUBJECTS).map((detail): HubStatusRow => {
    const subject = SUBJECT_LABELS[detail.subject] ?? detail.subject;
    const reached = reachedUnitTitle(rowsByTextbook.get(detail.id) ?? []);
    const head = subject ? `${subject} ${detail.name}` : detail.name;
    return {
      text: reached ? `${head} ｜ ${reached}まで` : head,
      note: detail.stalled && detail.lastDate ? `停滞 ${daysSince(detail.lastDate)}日` : null,
      tone: detail.stalled ? 'warning' : 'neutral',
    };
  });
  const rest = live.length - rows.length;
  return {
    value: null,
    rows,
    sub: rest > 0 ? [`ほか ${rest}科目`] : [],
    tone: 'neutral',
  };
}

/* ============================================================
 * 講習（今年度の直近の期で受講した科目とコマ）
 * ========================================================== */

/** 年度の中の期の並び（春期→夏期→冬期）。lib/interview/story.ts の SEASON_ORDER と同じ */
const SEASON_ORDER_IN_YEAR: Record<string, number> = { spring: 0, summer: 1, winter: 2 };

function seasonLabel(season: string): string {
  return SEASON_LABELS[season as keyof typeof SEASON_LABELS] ?? season;
}

/** 「英語 8・数学 4」。並びは komaBySubjectText と同じ（コマの多い順→科目名） */
function compactKomaText(bucket: KoushuSeasonBucket): string {
  const parts = Object.entries(bucket.komaBySubject)
    .filter(([, koma]) => koma > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([subject, koma]) => `${subject} ${koma}`);
  return parts.length > 0 ? parts.join('・') : `${bucket.totalKoma}コマ`;
}

/**
 * 今年度に受講した期（古い順）。
 *
 * ★「受講した」の決まりは面談の受講の枠（lib/interview/story.ts の formatKoushuEnrollment）と同じ:
 *   年度が今年度で、申込済（approved）の期。提案中・下書きのまま終わった期は受講していない。
 * ★ただし今期を除かない。面談は今期の状態を画面上部の帯と⑤で出すので受講の枠から外しているが、
 *   ハブにはそれが無く、今期に申し込んでいればそれが「直近に受講した講習」だから。
 */
export function koushuTakenThisYear(
  buckets: readonly KoushuSeasonBucket[],
  fiscalYear: number
): KoushuSeasonBucket[] {
  return buckets
    .filter((b) => b.year === fiscalYear && b.status === 'approved')
    .sort((a, b) => (SEASON_ORDER_IN_YEAR[a.season] ?? 9) - (SEASON_ORDER_IN_YEAR[b.season] ?? 9));
}

/**
 * 講習の指標。今年度の中で直近に受講した期を大きく（「2026 夏期講習」）、
 * 下に「英語 12コマ・数学 4コマ（計16）」。それより前の今年度の期があれば、さらに下に「春期 英語 8・数学 4」。
 *
 * ★材料は面談と同じ（提案書の期のまとめ＋koushu_enrollments を mergeKoushuSeasons で合流させたもの）。
 *   提案書の状態は出さない（2026-09-28 教室長「今年の直近の講習で受講した科目とコマ」）。
 * ★年度は4月始まり（koushuFiscalYear）。今年度の受講が無ければ「—」と、面談と同じ「2026年度の受講なし」。
 */
export function buildKoushuMetric(
  buckets: readonly KoushuSeasonBucket[],
  fiscalYear: number
): HubStatusMetric {
  const taken = koushuTakenThisYear(buckets, fiscalYear);
  const latest = taken[taken.length - 1];
  if (!latest) return none(`${fiscalYear}年度の受講なし`);
  const body = komaBySubjectText(latest.komaBySubject);
  const sub = [body ? `${body}（計${latest.totalKoma}）` : `${latest.totalKoma}コマ`];
  const earlier = taken.slice(0, -1);
  if (earlier.length > 0) {
    sub.push(earlier.map((b) => `${seasonLabel(b.season)} ${compactKomaText(b)}`).join(' ／ '));
  }
  return {
    value: `${latest.year} ${seasonLabel(latest.season)}講習`,
    sub,
    tone: 'neutral',
    textValue: true,
  };
}
