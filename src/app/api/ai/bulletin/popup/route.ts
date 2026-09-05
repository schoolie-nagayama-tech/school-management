import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS } from '@/lib/ai/claude';
import {
  decideTiming,
  daysUntilDue,
  isDueTodayOrOverdue,
  type Checkpoint,
} from '@/lib/bulletin/popupTiming';
import {
  parsePopupDecision,
  popupSystemPrompt,
  popupUserText,
  type PopupDecision,
} from '@/lib/bulletin/popupPrompt';
import { computeTaskProgress, isJudgeable, type StudentRow } from '@/lib/bulletin/progress';
import {
  REPORT_CARD_SUBJECTS,
  TASK_KIND_LABELS,
  type TaskKind,
  type TaskScope,
} from '@/lib/bulletin/taskCatalog';
import { taskActionText, taskLink } from '@/lib/bulletin/taskLink';
import type { BulletinPopupResponse } from '@/lib/bulletin/apiTypes';

export const dynamic = 'force-dynamic';

/**
 * 授業中ポップアップ。いま授業をしている講師に、事務作業のお願いを出すかどうかを返す。
 *
 * ★呼ぶのは報告書フォーム。「授業を記録」で見張りが起動し、
 *   経過に応じてこれを叩く。出すかどうかはここが決める。
 *
 * ★AIを呼ぶのは最後の最後。未対応0件・表示済み・時間切れ・照合の時刻でない、を
 *   先に落とすので、大半の授業ではAIを一度も呼ばない（費用が効くのはここ）。
 *
 * ★AIアシストがOFFの講師には何も出さない（既定OFF・教室長が講師ごとに付ける）。
 *
 * 正典: docs/bulletin-ai-assist.html §3
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** コマの時間が引けなかったときに使う既定（1コマ80分） */
const DEFAULT_LESSON_MINUTES = 80;

const NOT_SHOWN: BulletinPopupResponse = {
  show: false,
  taskId: null,
  kindLabel: null,
  message: '',
  actionText: '',
  href: null,
  linkLabel: null,
  skipReason: null,
};

/** 生徒に聞けば済むか、相談が要るか。AIの判断材料 */
const TASK_NATURE: Partial<Record<TaskKind, string>> = {
  report_card_entry: '生徒に通知表を見せてもらえば終わる',
  test_result_entry: '生徒に答案を見せてもらえば終わる',
  goal_setting: '生徒と相談する必要がある',
  progress_entry: '生徒に聞かなくても講師だけでできる',
  owned_material_check: '生徒の手元を確認すれば終わる',
  material_handout_check: '生徒に渡したかを確認すれば終わる',
};

/** 内申が入っている科目を1人分だけ引く */
async function loadReportCardSubjects(
  supabase: SupabaseClient,
  studentId: string
): Promise<string[]> {
  const { data } = await supabase
    .from('assessments')
    .select('assessment_scores(subject, value)')
    .eq('category', 'report_card')
    .eq('name_code', 'term1')
    .eq('student_id', studentId);

  const core = new Set<string>(REPORT_CARD_SUBJECTS);
  const got: string[] = [];
  for (const row of data ?? []) {
    const scores = (row.assessment_scores ?? []) as { subject: string; value: number | null }[];
    for (const s of scores) {
      if (s.value != null && core.has(s.subject) && !got.includes(s.subject)) got.push(s.subject);
    }
  }
  return got;
}

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  let body: { scheduleEntryId?: unknown; elapsedMinutes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const entryId = typeof body.scheduleEntryId === 'string' ? body.scheduleEntryId : '';
  if (!UUID_RE.test(entryId)) {
    return NextResponse.json({ error: 'コマIDが不正です' }, { status: 400 });
  }
  const elapsedMinutes =
    typeof body.elapsedMinutes === 'number' && Number.isFinite(body.elapsedMinutes)
      ? Math.max(0, Math.round(body.elapsedMinutes))
      : 0;

  const supabase = getPortalServiceClient();

  // コマから生徒・講師・授業時間を取る。★担当を解決する必要は無い。
  //   ここで分かるのは「その日その生徒の授業をする講師」そのもの。
  const { data: entry } = await supabase
    .from('schedule_entries')
    .select(
      'id, school_id, student_id, teacher_id, entry_date, duration_minutes, time_slot:schedule_time_slots(start_time, end_time)'
    )
    .eq('id', entryId)
    .maybeSingle();

  if (!entry || !entry.student_id) {
    return NextResponse.json(NOT_SHOWN satisfies BulletinPopupResponse);
  }

  const schoolId = entry.school_id as string;
  const studentId = entry.student_id as string;
  const teacherId = (entry.teacher_id as string | null) ?? null;

  // ★出す相手はこのコマの講師本人だけ。他人のコマを覗いて判断させない
  if (teacherId !== auth.userId) {
    return NextResponse.json(NOT_SHOWN satisfies BulletinPopupResponse);
  }

  // ★AIアシストがOFFなら何も出さない（既定OFF）
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('bulletin_ai_assist')
    .eq('id', auth.userId)
    .maybeSingle();

  if (!profile?.bulletin_ai_assist) {
    return NextResponse.json({
      ...NOT_SHOWN,
      skipReason: 'assist_off',
    } satisfies BulletinPopupResponse);
  }

  // 授業時間。45分授業などは duration_minutes を優先し、無ければコマの時間から出す。
  // ★PostgREST の結合は配列で返ることがあるので、両方の形を受ける
  const slotRaw = entry.time_slot as
    | { start_time: string; end_time: string }
    | { start_time: string; end_time: string }[]
    | null;
  const slot = Array.isArray(slotRaw) ? (slotRaw[0] ?? null) : slotRaw;
  const totalMinutes =
    (entry.duration_minutes as number | null) ??
    (slot ? slotMinutes(slot.start_time, slot.end_time) : DEFAULT_LESSON_MINUTES);

  const today = new Date().toISOString().slice(0, 10);

  // 追跡中のタスク
  const { data: taskRows } = await supabase
    .from('bulletin_tasks')
    .select('id, kind, scope, target_grades, target_student_ids, due_date, application_item_id')
    .eq('school_id', schoolId)
    .is('closed_at', null)
    .eq('tracked', true);

  if (!taskRows || taskRows.length === 0) {
    return NextResponse.json({
      ...NOT_SHOWN,
      skipReason: 'no_pending',
    } satisfies BulletinPopupResponse);
  }

  const { data: student } = await supabase
    .from('students')
    .select('id, grade, last_name, first_name')
    .eq('id', studentId)
    .maybeSingle();

  if (!student) return NextResponse.json(NOT_SHOWN satisfies BulletinPopupResponse);

  // ★実データで再照合する。冒頭で講師が自分でやった分はここで消える
  const subjects = await loadReportCardSubjects(supabase, studentId);
  const subjectsByStudent = new Map<string, string[]>([[studentId, subjects]]);

  const pending: { id: string; kind: TaskKind; dueDate: string | null }[] = [];

  for (const t of taskRows) {
    const kind = t.kind as TaskKind;
    if (!isJudgeable(kind)) continue;

    const rows: StudentRow[] = [
      {
        id: studentId,
        grade: (student.grade as number | null) ?? null,
        teacherId,
        markedNotApplicable: false,
      },
    ];

    const progress = computeTaskProgress({
      kind,
      scope: t.scope as TaskScope,
      targetGrades: (t.target_grades as number[]) ?? [],
      targetStudentIds: (t.target_student_ids as string[]) ?? [],
      students: rows,
      subjectsByStudent,
    });

    if (progress.notYet > 0) {
      pending.push({ id: t.id as string, kind, dueDate: (t.due_date as string | null) ?? null });
    }
  }

  // 今日この講師がこのコマで出した回数
  const { count: shownToday } = await supabase
    .from('bulletin_popup_logs')
    .select('id', { count: 'exact', head: true })
    .eq('schedule_entry_id', entryId)
    .eq('shown', true);

  const timing = decideTiming({
    elapsedMinutes,
    totalMinutes,
    pendingCount: pending.length,
    alreadyShown: (shownToday ?? 0) > 0,
    hasDueTodayOrOverdue: pending.some((p) => isDueTodayOrOverdue(p.dueDate, today)),
  });

  if (timing.action === 'skip') {
    return NextResponse.json({
      ...NOT_SHOWN,
      skipReason: timing.reason,
    } satisfies BulletinPopupResponse);
  }

  // 期限が近いものを先に出す。期限なしは後ろ
  const sorted = [...pending].sort((a, b) => {
    const da = daysUntilDue(a.dueDate, today);
    const db = daysUntilDue(b.dueDate, today);
    if (da == null && db == null) return 0;
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db;
  });
  const target = sorted[0];
  const kindLabel = TASK_KIND_LABELS[target.kind];

  // カードに出す1行と、その作業ができる場所。
  // ★生徒が決まっている種別は生徒のページまで開く。「生徒管理を開いてください」で止めると、
  //   生徒を探す→タブを選ぶ→学期を選ぶ、で授業が終わる。
  const studentName =
    `${(student.last_name as string) ?? ''} ${(student.first_name as string) ?? ''}`.trim();
  const actionText = taskActionText(target.kind, studentName || null);
  const link = taskLink(target.kind, { studentId, scheduleEntryId: entryId });

  let decision: PopupDecision;

  if (timing.action === 'force') {
    // ★期限当日・超過はAIを通さない。文面もこちらで決める
    decision = {
      action: 'show',
      message: `${kindLabel}の期限が来ています。いまお願いできますか。`,
      reason: '期限当日または超過のため強制表示',
    };
  } else if (!isClaudeConfigured()) {
    // AIが使えないなら黙る。強制表示だけは上で通っている
    return NextResponse.json({
      ...NOT_SHOWN,
      skipReason: 'ai_unavailable',
    } satisfies BulletinPopupResponse);
  } else {
    try {
      const raw = await callClaudeJson<unknown>({
        model: CLAUDE_MODELS.fast,
        system: [{ text: popupSystemPrompt(), cache: true }],
        userText: popupUserText({
          elapsedMinutes,
          totalMinutes,
          checkpointLabel: labelOf(timing.checkpoint),
          taskLabel: kindLabel,
          taskNature: TASK_NATURE[target.kind] ?? '生徒に聞けば終わる',
          daysUntilDue: daysUntilDue(target.dueDate, today),
          studentToday: '',
          progressState: '',
          shownToday: shownToday ?? 0,
        }),
        maxTokens: 300,
      });
      decision = parsePopupDecision(raw);
    } catch (e) {
      // ★呼べなかったら出さない。授業中に壊れたカードを出すより黙るほうがよい
      console.error('[ai/bulletin/popup] failed', e);
      return NextResponse.json({
        ...NOT_SHOWN,
        skipReason: 'ai_error',
      } satisfies BulletinPopupResponse);
    }
  }

  // 出した／出さなかったを記録する。効果測定と、1コマ1件の判定に使う
  await supabase.from('bulletin_popup_logs').insert({
    schedule_entry_id: entryId,
    school_id: schoolId,
    task_id: target.id,
    teacher_id: teacherId,
    student_id: studentId,
    shown: decision.action === 'show',
    action: decision.action,
    reason: decision.reason,
    elapsed_minutes: elapsedMinutes,
  });

  if (decision.action !== 'show') {
    return NextResponse.json({
      ...NOT_SHOWN,
      skipReason: decision.action,
    } satisfies BulletinPopupResponse);
  }

  return NextResponse.json({
    show: true,
    taskId: target.id,
    kindLabel,
    message: decision.message,
    actionText,
    href: link?.href ?? null,
    linkLabel: link?.label ?? null,
    skipReason: null,
  } satisfies BulletinPopupResponse);
}

function labelOf(checkpoint: Checkpoint): string {
  return checkpoint === 'first' ? '1/3チェック' : '2/3チェック';
}

/** 'HH:MM:SS' 2つから分数を出す */
function slotMinutes(start: string, end: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const diff = toMin(end) - toMin(start);
  return diff > 0 ? diff : DEFAULT_LESSON_MINUTES;
}
