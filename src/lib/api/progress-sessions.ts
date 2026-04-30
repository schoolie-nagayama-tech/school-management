import { supabase } from '@/lib/supabase';
import type {
  ProgressSession,
  ProgressSessionInsert,
  ProgressSessionUpdate,
  ProgressSessionWithDetails,
  StudentProgressLessonInsert,
} from '@/types/database';

// ============================================
// セッション CRUD
// ============================================

/**
 * セッションを作成
 */
export async function createProgressSession(
  session: ProgressSessionInsert
): Promise<ProgressSession> {
  const { data, error } = await supabase
    .from('progress_sessions')
    .insert(session)
    .select()
    .single();

  if (error) {
    throw new Error(`セッションの作成に失敗しました: ${error.message}`);
  }
  return data as ProgressSession;
}

/**
 * セッションを更新
 */
export async function updateProgressSession(
  id: string,
  patch: ProgressSessionUpdate
): Promise<ProgressSession> {
  const { data, error } = await supabase
    .from('progress_sessions')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`セッションの更新に失敗しました: ${error.message}`);
  }
  return data as ProgressSession;
}

/**
 * セッションを削除
 */
export async function deleteProgressSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('progress_sessions')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`セッションの削除に失敗しました: ${error.message}`);
  }
}

// ============================================
// セッション取得
// ============================================

/**
 * 特定テキストの直近セッション一覧を取得
 */
export async function getProgressSessions(
  studentTextbookId: string,
  limit = 20
): Promise<ProgressSession[]> {
  const { data, error } = await supabase
    .from('progress_sessions')
    .select('*')
    .eq('student_textbook_id', studentTextbookId)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`セッションの取得に失敗しました: ${error.message}`);
  }
  return (data || []) as ProgressSession[];
}

/**
 * 直前のセッション（引継ぎ表示用）
 */
export async function getLastSession(
  studentTextbookId: string
): Promise<ProgressSession | null> {
  const { data, error } = await supabase
    .from('progress_sessions')
    .select('*')
    .eq('student_textbook_id', studentTextbookId)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`直前セッションの取得に失敗しました: ${error.message}`);
  }
  return (data as ProgressSession) || null;
}

// ============================================
// 一括保存（セッション + 指導日記録）
// ============================================

export interface SessionUnitAction {
  curriculumItemId: number;
  lessonNumber: 1 | 2 | 3;
}

/**
 * セッション一括保存
 * 1. progress_sessions を作成
 * 2. 各単元の student_progress を upsert（なければ作成）
 * 3. student_progress_lessons を upsert（session_id 付き）
 * 4. 学校進度を更新
 */
export async function recordSession(params: {
  studentTextbookId: string;
  sessionDate: string;
  teacherId?: string | null;
  teacherName: string;
  handover: string;
  homeworkNotDone: boolean;
  tardy: boolean;
  unitActions: SessionUnitAction[];
  schoolProgressUnits: number[]; // curriculum_item_ids with school dates
  scheduleEntryId?: string | null;
}): Promise<ProgressSession> {
  const {
    studentTextbookId,
    sessionDate,
    teacherId,
    teacherName,
    handover,
    homeworkNotDone,
    tardy,
    unitActions,
    schoolProgressUnits,
    scheduleEntryId,
  } = params;

  // 1. セッション作成
  const session = await createProgressSession({
    student_textbook_id: studentTextbookId,
    session_date: sessionDate,
    teacher_id: teacherId,
    teacher_name: teacherName,
    handover,
    homework_not_done: homeworkNotDone,
    tardy,
    schedule_entry_id: scheduleEntryId,
  });

  // 2. 各単元の student_progress を upsert + lesson 記録
  for (const action of unitActions) {
    // student_progress upsert（なければ作成）
    const { data: progress, error: progressError } = await supabase
      .from('student_progress')
      .upsert(
        {
          student_textbook_id: studentTextbookId,
          curriculum_item_id: action.curriculumItemId,
          teacher_name: teacherName,
          homework_not_done: homeworkNotDone,
          tardy,
          handover,
        },
        { onConflict: 'student_textbook_id,curriculum_item_id' }
      )
      .select('id')
      .single();

    if (progressError) {
      console.error('student_progress upsert error:', progressError);
      continue;
    }

    // student_progress_lessons upsert
    const lessonInsert: StudentProgressLessonInsert = {
      student_progress_id: progress.id,
      lesson_number: action.lessonNumber,
      lesson_date: sessionDate,
      teacher_name: teacherName,
      session_id: session.id,
    };

    const { error: lessonError } = await supabase
      .from('student_progress_lessons')
      .upsert(lessonInsert, {
        onConflict: 'student_progress_id,lesson_number',
      });

    if (lessonError) {
      console.error('student_progress_lessons upsert error:', lessonError);
    }
  }

  // 3. 学校進度を更新
  for (const curriculumItemId of schoolProgressUnits) {
    const { error: schoolError } = await supabase
      .from('student_progress')
      .upsert(
        {
          student_textbook_id: studentTextbookId,
          curriculum_item_id: curriculumItemId,
          school_progress_date: sessionDate,
        },
        { onConflict: 'student_textbook_id,curriculum_item_id' }
      );

    if (schoolError) {
      console.error('school progress upsert error:', schoolError);
    }
  }

  return session;
}

// ============================================
// 教室長フィード（②教室長UI用）
// ============================================

/**
 * 教室単位で直近のセッションをフィード取得
 * student_textbook → student, textbook 情報付き
 */
export async function getSessionFeed(
  schoolIds: string[],
  limit = 30,
  offset = 0
): Promise<ProgressSessionWithDetails[]> {
  if (schoolIds.length === 0) return [];

  // student_textbooks を school_id でフィルタして取得
  const { data: stList, error: stError } = await supabase
    .from('student_textbooks')
    .select('id')
    .in('school_id', schoolIds)
    .eq('is_active', true);

  if (stError || !stList || stList.length === 0) return [];

  const stIds = (stList as { id: string }[]).map((st) => st.id);

  // セッション取得
  const { data: sessions, error: sessError } = await supabase
    .from('progress_sessions')
    .select(`
      *,
      student_textbook:student_textbooks(
        *,
        textbook:textbooks(*),
        student:students(*)
      )
    `)
    .in('student_textbook_id', stIds)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (sessError) {
    throw new Error(`フィードの取得に失敗しました: ${sessError.message}`);
  }

  return (sessions || []) as unknown as ProgressSessionWithDetails[];
}

/**
 * 要注意セッション（宿題未/遅刻）のみフィルタ取得
 */
export async function getAlertSessionFeed(
  schoolIds: string[],
  limit = 30
): Promise<ProgressSessionWithDetails[]> {
  if (schoolIds.length === 0) return [];

  const { data: stList, error: stError } = await supabase
    .from('student_textbooks')
    .select('id')
    .in('school_id', schoolIds)
    .eq('is_active', true);

  if (stError || !stList || stList.length === 0) return [];

  const stIds = (stList as { id: string }[]).map((st) => st.id);

  const { data: sessions, error: sessError } = await supabase
    .from('progress_sessions')
    .select(`
      *,
      student_textbook:student_textbooks(
        *,
        textbook:textbooks(*),
        student:students(*)
      )
    `)
    .in('student_textbook_id', stIds)
    .or('homework_not_done.eq.true,tardy.eq.true')
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (sessError) {
    throw new Error(`要注意フィードの取得に失敗しました: ${sessError.message}`);
  }

  return (sessions || []) as unknown as ProgressSessionWithDetails[];
}

// ============================================
// スマートアラート（教室長用）
// ============================================

export interface SmartAlert {
  type: 'school_catching_up' | 'no_exam_goal' | 'exam_soon';
  severity: 'urgent' | 'warning';
  studentName: string;
  studentId: string;
  textbookName: string;
  studentTextbookId: string;
  detail: string;
  /** exam_date（テスト系アラートの場合） */
  examDate?: string;
}

/**
 * 教室単位のスマートアラートを取得
 * - 学校進度に追いつかれている
 * - 近い試験に目標が未設定
 * - 14日以内に試験がある
 */
export async function getSmartAlerts(
  schoolIds: string[]
): Promise<SmartAlert[]> {
  if (schoolIds.length === 0) return [];

  const alerts: SmartAlert[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const in14Days = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  // active student_textbooks with student & textbook info
  const { data: stList, error: stError } = await supabase
    .from('student_textbooks')
    .select('id, student:students(id, last_name, first_name), textbook:textbooks(name)')
    .in('school_id', schoolIds)
    .eq('is_active', true);

  if (stError || !stList || stList.length === 0) return [];

  type STRow = {
    id: string;
    student: { id: string; last_name: string; first_name: string } | null;
    textbook: { name: string } | null;
  };
  const stRows = stList as unknown as STRow[];

  const stIds = stRows.map((st) => st.id);
  const stMap = new Map(stRows.map((st) => [st.id, st]));

  // ── 1. 学校進度に追いつかれている ──
  // student_progress に school_progress_date があり lesson1 が完了していない = 追いつかれ
  const { data: progressRows } = await supabase
    .from('student_progress')
    .select('id, student_textbook_id, curriculum_item_id, school_progress_date')
    .in('student_textbook_id', stIds)
    .not('school_progress_date', 'is', null);

  if (progressRows && progressRows.length > 0) {
    const progressIdList = progressRows.map((r) => r.id);

    // lesson1 完了済みの student_progress_id を取得
    const { data: lessons } = await supabase
      .from('student_progress_lessons')
      .select('student_progress_id, lesson_number, lesson_date')
      .in('student_progress_id', progressIdList)
      .eq('lesson_number', 1)
      .not('lesson_date', 'is', null);

    const hasLesson1 = new Set(
      (lessons ?? []).map((l) => l.student_progress_id)
    );

    // school_progress_date がある単元で lesson1 が未完了 = 追いつかれている
    const seenSt = new Set<string>();
    for (const p of progressRows) {
      if (hasLesson1.has(p.id)) continue; // 指導済み
      if (seenSt.has(p.student_textbook_id)) continue; // 重複抑止
      seenSt.add(p.student_textbook_id);

      const st = stMap.get(p.student_textbook_id);
      if (!st?.student) continue;

      alerts.push({
        type: 'school_catching_up',
        severity: 'urgent',
        studentName: `${st.student.last_name} ${st.student.first_name}`,
        studentId: st.student.id,
        textbookName: st.textbook?.name ?? '',
        studentTextbookId: p.student_textbook_id,
        detail: '学校が進んだ単元で塾の指導が追いついていません',
      });
    }
  }

  // ── 2. 近い試験（14日以内） + 目標未設定チェック ──
  const { data: exams } = await supabase
    .from('student_textbook_exams')
    .select('id, student_textbook_id, exam_date, target_score, custom_exam_name, exam_type_id')
    .in('student_textbook_id', stIds)
    .gte('exam_date', today)
    .lte('exam_date', in14Days)
    .order('exam_date', { ascending: true });

  if (exams) {
    for (const exam of exams) {
      const st = stMap.get(exam.student_textbook_id);
      if (!st?.student) continue;
      const name = `${st.student.last_name} ${st.student.first_name}`;

      const daysLeft = Math.ceil(
        (new Date(exam.exam_date).getTime() - Date.now()) / 86400000
      );
      const examLabel = exam.custom_exam_name || 'テスト';

      // テストが近い
      alerts.push({
        type: 'exam_soon',
        severity: daysLeft <= 7 ? 'urgent' : 'warning',
        studentName: name,
        studentId: st.student.id,
        textbookName: st.textbook?.name ?? '',
        studentTextbookId: exam.student_textbook_id,
        detail: `${examLabel}まであと${daysLeft}日（${exam.exam_date.replace(/-/g, '/')}）`,
        examDate: exam.exam_date,
      });

      // 目標未設定
      if (exam.target_score == null) {
        alerts.push({
          type: 'no_exam_goal',
          severity: 'warning',
          studentName: name,
          studentId: st.student.id,
          textbookName: st.textbook?.name ?? '',
          studentTextbookId: exam.student_textbook_id,
          detail: `${examLabel}（${exam.exam_date.replace(/-/g, '/')}）の目標点が未設定`,
          examDate: exam.exam_date,
        });
      }
    }
  }

  // severity でソート（urgent 先）
  alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'urgent' ? -1 : 1;
    return 0;
  });

  return alerts;
}
