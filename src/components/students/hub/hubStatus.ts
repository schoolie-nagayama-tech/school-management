/**
 * 生徒ハブ「今の状態」の6指標の組み立て。画面から切り離した純粋関数。
 *
 * 正典: docs/student-hub-plan.md §3 ／ 見た目: public/student-hub-mock.html の「今の状態」
 *
 * ★数え方は下のセクション（成績・進行表・宿題・遅刻・面談・講習）と同じ関数に任せる。
 *   ここで別の数え方をすると、上の指標と下の表で数字が食い違う（成績サマリが4か所で
 *   別実装になって見え方がずれている事故を繰り返さない。docs/student-hub-plan.md §2）。
 * ★値が無いときは value=null（画面は「—」）にし、sub に短い理由を書く。空欄にも「0回」の羅列にもしない。
 */
import type { AssessmentWithScores, StudentInterview } from '@/types/database';
import {
  ASSESSMENT_NAME_LABELS,
  GRADE_LABELS,
  INTERVIEW_TYPE_LABELS,
  PROPOSAL_STATUS_LABELS,
  type ProposalStatus,
} from '@/types/database';
import type { ScheduleEntry } from '@/types/schedule';
import type { DisciplineSessionRow } from '@/lib/api/progress-sessions';
import type { StudentKoushuPeriodGroup } from '@/lib/studentKoushuSummary';
import type { TextbookProgressData } from '@/app/interview/ProgressPanel';
import {
  computeDisciplineMonthly,
  computeScoreSummary,
  daysSince,
  summarizeTextbookProgress,
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
 * 直近の定期テスト
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
  if (regular.length === 0) return none('記録なし');

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
 * 進行表
 * ========================================================== */

/**
 * 進行表の指標。「4冊中 1冊が停滞」。停滞が1冊以上なら黄（対応が要るもの）。
 * ★停滞の判定は進行表セクション（ProgressPanel）と同じ summarizeTextbookProgress（最終指導日から14日超）。
 * 対象は進行表で管理中のテキスト（HubDataContext で track_progress に絞り済み。面談画面と同じ）。
 */
export function buildProgressMetric(textbookData: TextbookProgressData[]): HubStatusMetric {
  if (textbookData.length === 0) return none('管理中のテキストなし');
  const n = textbookData.length;
  const stalled = textbookData.filter(
    ({ textbook, rows }) => summarizeTextbookProgress(textbook, rows).stalled
  ).length;
  if (stalled === 0) {
    return {
      value: `${n}冊中 停滞なし`,
      sub: ['進行表で管理中のテキスト'],
      tone: 'neutral',
      textValue: true,
    };
  }
  return {
    value: `${n}冊中 ${stalled}冊が停滞`,
    sub: ['最終指導から14日を超えたもの'],
    tone: 'warning',
    textValue: true,
  };
}

/* ============================================================
 * 講習
 * ========================================================== */

const STATUS_ORDER: ProposalStatus[] = ['draft', 'sent', 'approved'];

/**
 * 講習の指標。今期の提案書の状態。値は「2026 冬期講習」、下に「提案書 下書き」など。
 *
 * ★今期＝講習セクション（StudentKoushuTab）が一番上に出す期（groupStudentKoushu の並びの先頭＝最も新しい期）。
 *   別の規則で「今期」を決めると、上の指標と下の講習欄で違う期を指してしまう。
 */
export function buildKoushuMetric(groups: StudentKoushuPeriodGroup[]): HubStatusMetric {
  const g = groups[0];
  if (!g) return none('記録なし');
  if (g.proposals.length === 0) {
    return { value: g.label, sub: ['申込のみ（提案書なし）'], tone: 'neutral', textValue: true };
  }
  const counts = new Map<ProposalStatus, number>();
  for (const p of g.proposals) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
  const present = STATUS_ORDER.filter((s) => counts.has(s));
  const statusText =
    present.length === 1
      ? PROPOSAL_STATUS_LABELS[present[0]]
      : present.map((s) => `${PROPOSAL_STATUS_LABELS[s]} ${counts.get(s)}`).join('・');
  return { value: g.label, sub: [`提案書 ${statusText}`], tone: 'neutral', textValue: true };
}
