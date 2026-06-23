import { supabase } from '@/lib/supabase';
import type {
  ProgressSession,
  ProgressSessionInsert,
  ProgressSessionUpdate,
  ProgressSessionWithDetails,
  StudentProgressLessonInsert,
} from '@/types/database';

/** Supabase select 句（フィード共通） */
const FEED_SELECT = `
  *,
  student_textbook:student_textbooks(
    *,
    textbook:textbooks(*),
    student:students(*)
  ),
  lessons:student_progress_lessons(
    lesson_number,
    lesson_date,
    student_progress:student_progress(
      curriculum_item_id,
      school_progress_date,
      curriculum_item:curriculum_items(item_number, title)
    )
  )
`;

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
  const { error } = await supabase.from('progress_sessions').delete().eq('id', id);

  if (error) {
    throw new Error(`セッションの削除に失敗しました: ${error.message}`);
  }
}

// ============================================
// 教室長確認
// ============================================

/**
 * セッションを「確認済み」にする
 */
export async function confirmProgressSession(
  sessionId: string,
  confirmedBy: string
): Promise<void> {
  const { error } = await supabase
    .from('progress_sessions')
    .update({
      confirmed_at: new Date().toISOString(),
      confirmed_by: confirmedBy,
    })
    .eq('id', sessionId);

  if (error) {
    throw new Error(`確認に失敗しました: ${error.message}`);
  }
}

/**
 * 確認を取り消す
 */
export async function unconfirmProgressSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('progress_sessions')
    .update({ confirmed_at: null, confirmed_by: null })
    .eq('id', sessionId);

  if (error) {
    throw new Error(`確認取り消しに失敗しました: ${error.message}`);
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
 * 生徒の全テキスト横断で直近セッションを取得（生徒詳細ミニフィード用）
 */
export async function getStudentSessionFeed(
  studentId: string,
  limit = 5
): Promise<ProgressSessionWithDetails[]> {
  // 生徒に紐づく student_textbook を全取得
  const { data: stList } = await supabase
    .from('student_textbooks')
    .select('id')
    .eq('student_id', studentId)
    .eq('is_active', true);

  if (!stList || stList.length === 0) return [];
  const stIds = (stList as { id: string }[]).map((st) => st.id);

  const { data, error } = await supabase
    .from('progress_sessions')
    .select(FEED_SELECT)
    .in('student_textbook_id', stIds)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`生徒セッションの取得に失敗しました: ${error.message}`);
  }
  return (data || []) as unknown as ProgressSessionWithDetails[];
}

/**
 * 直前のセッション（引継ぎ表示用）
 */
export async function getLastSession(studentTextbookId: string): Promise<ProgressSession | null> {
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
 * 1. progress_sessions を作成（または sessionId 指定時は更新）
 * 2. 各単元の student_progress を upsert（なければ作成）
 *    - primaryCurriculumItemId に一致する行のみ handover/homework_not_done/tardy も書く
 * 3. student_progress_lessons を upsert（session_id 付き）
 * 4. 学校進度を更新
 * 5. primaryCurriculumItemId が unitActions に含まれない場合も、その行に引継ぎ等を書く
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
  /** 引継ぎ・遅刻・宿題を書き込む「一番下の行」の単元ID（カリキュラム順で最後の指導単元） */
  primaryCurriculumItemId?: number | null;
  /** 既存セッションの上書き更新用。指定時は新規作成せず更新する（編集時の二重作成防止） */
  sessionId?: string | null;
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
    primaryCurriculumItemId,
    sessionId,
  } = params;

  // 1. セッション作成 or 更新（sessionId がある場合は既存セッションを上書きして二重作成を防ぐ）
  let session: ProgressSession;
  if (sessionId) {
    // 編集モード: 既存セッションをフィールド更新（日付・講師・引継ぎ・フラグを最新値で上書き）
    session = await updateProgressSession(sessionId, {
      session_date: sessionDate,
      teacher_id: teacherId,
      teacher_name: teacherName,
      handover,
      homework_not_done: homeworkNotDone,
      tardy,
    });
  } else {
    // 新規モード: セッションを作成
    session = await createProgressSession({
      student_textbook_id: studentTextbookId,
      session_date: sessionDate,
      teacher_id: teacherId,
      teacher_name: teacherName,
      handover,
      homework_not_done: homeworkNotDone,
      tardy,
      schedule_entry_id: scheduleEntryId,
    });
  }

  // 2. 各単元の student_progress を upsert + lesson 記録
  // primaryCurriculumItemId の行にだけ引継ぎ・遅刻・宿題も書く（授業記録パネルが主入力源）
  const touchedCurriculumItemIds = new Set<number>();
  for (const action of unitActions) {
    touchedCurriculumItemIds.add(action.curriculumItemId);
    // primaryCurriculumItemId に一致する場合は引継ぎ・フラグも含めて upsert
    const isPrimary = action.curriculumItemId === primaryCurriculumItemId;
    const progressFields = isPrimary
      ? {
          student_textbook_id: studentTextbookId,
          curriculum_item_id: action.curriculumItemId,
          teacher_name: teacherName,
          handover,
          homework_not_done: homeworkNotDone,
          tardy,
        }
      : {
          student_textbook_id: studentTextbookId,
          curriculum_item_id: action.curriculumItemId,
          teacher_name: teacherName,
        };

    const { data: progress, error: progressError } = await supabase
      .from('student_progress')
      .upsert(progressFields, { onConflict: 'student_textbook_id,curriculum_item_id' })
      .select('id')
      .single();

    if (progressError) {
      console.error('student_progress upsert error:', progressError);
      continue;
    }

    // student_progress_lessons upsert（session_id を紐付け）
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
    const { error: schoolError } = await supabase.from('student_progress').upsert(
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

  // 4. primaryCurriculumItemId が unitActions に含まれていない場合も、
  //    その単元の行に引継ぎ・遅刻・宿題を書き込む（学校進度のみ触れた場合など）
  if (primaryCurriculumItemId != null && !touchedCurriculumItemIds.has(primaryCurriculumItemId)) {
    const { error: primaryError } = await supabase.from('student_progress').upsert(
      {
        student_textbook_id: studentTextbookId,
        curriculum_item_id: primaryCurriculumItemId,
        teacher_name: teacherName,
        handover,
        homework_not_done: homeworkNotDone,
        tardy,
      },
      { onConflict: 'student_textbook_id,curriculum_item_id' }
    );

    if (primaryError) {
      console.error('primary row upsert error:', primaryError);
    }
  }

  return session;
}

/**
 * 直接入力された進行データからセッションを生成する（「提出」ボタン用）。
 *
 * 指導日が入力済みかつ session_id 未紐付けの student_progress_lessons を検出し、
 * それらをまとめて1つの progress_sessions に紐付ける。
 * 引継ぎ・宿題未提出・遅刻は対象行のうち最後に更新されたものから取得。
 */
export async function submitDirectInput(params: {
  studentTextbookId: string;
  teacherName: string;
  teacherId?: string | null;
}): Promise<{ session: ProgressSession; linkedCount: number } | null> {
  const { studentTextbookId, teacherName, teacherId } = params;

  // student_progress → student_progress_lessons で session_id が null かつ lesson_date がある行を取得
  const { data: progressRows } = await supabase
    .from('student_progress')
    .select('id, handover, homework_not_done, tardy, teacher_name, updated_at')
    .eq('student_textbook_id', studentTextbookId);

  if (!progressRows || progressRows.length === 0) return null;
  const progressIds = progressRows.map((r) => r.id);

  // session_id が null で lesson_date が入っているレッスンを検出
  const { data: unlinkedLessons } = await supabase
    .from('student_progress_lessons')
    .select('id, student_progress_id, lesson_number, lesson_date')
    .in('student_progress_id', progressIds)
    .is('session_id', null)
    .not('lesson_date', 'is', null);

  if (!unlinkedLessons || unlinkedLessons.length === 0) return null;

  // 代表値: 最新の更新行から引継ぎ・フラグを取得
  const linkedProgressIds = Array.from(new Set(unlinkedLessons.map((l) => l.student_progress_id)));
  const linkedRows = progressRows
    .filter((r) => linkedProgressIds.includes(r.id))
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  const representative = linkedRows[0];

  // セッション日付: レッスンの lesson_date のうち最新を使う
  const dates = unlinkedLessons
    .map((l) => l.lesson_date as string)
    .filter(Boolean)
    .sort();
  const sessionDate = dates[dates.length - 1] || new Date().toISOString().slice(0, 10);

  // セッション作成
  const session = await createProgressSession({
    student_textbook_id: studentTextbookId,
    session_date: sessionDate,
    teacher_id: teacherId,
    teacher_name: representative?.teacher_name || teacherName,
    handover: representative?.handover || null,
    homework_not_done: representative?.homework_not_done || false,
    tardy: representative?.tardy || false,
  });

  // 未紐付けレッスンに session_id を設定
  for (const lesson of unlinkedLessons) {
    await supabase
      .from('student_progress_lessons')
      .update({ session_id: session.id })
      .eq('id', lesson.id);
  }

  return { session, linkedCount: unlinkedLessons.length };
}

// ============================================
// 進行表→セッション同期（編集時にフィードへ反映）
// ============================================

/** セッション共有フィールド: student_progress と progress_sessions の両方に存在 */
// 引継ぎ・遅刻・宿題もセッション↔行で双方向同期する（授業記録パネルが主入力源）
const SESSION_SHARED_FIELDS = ['teacher_name', 'handover', 'homework_not_done', 'tardy'] as const;

/**
 * 進行表で直接編集された内容を、紐付く progress_sessions にも同期する。
 * student_progress_lessons.session_id 経由で最新セッションを特定し更新する。
 */
export async function syncProgressToSession(
  studentProgressId: string,
  patch: Record<string, unknown>
): Promise<void> {
  // セッションに関係するフィールドだけ抽出
  const sessionPatch: ProgressSessionUpdate = {};
  for (const key of SESSION_SHARED_FIELDS) {
    if (key in patch) {
      (sessionPatch as Record<string, unknown>)[key] = patch[key];
    }
  }
  if (Object.keys(sessionPatch).length === 0) return;

  // 紐付くレッスンから最新の session_id を取得
  const { data: lesson } = await supabase
    .from('student_progress_lessons')
    .select('session_id')
    .eq('student_progress_id', studentProgressId)
    .not('session_id', 'is', null)
    .order('lesson_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lesson?.session_id) return;

  await updateProgressSession(lesson.session_id, sessionPatch);
}

/**
 * セッション側で編集された内容を、紐付く student_progress にも同期する（逆方向）。
 * progress_sessions → student_progress_lessons → student_progress の経路で特定。
 */
export async function syncSessionToProgress(
  sessionId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const progressPatch: Record<string, unknown> = {};
  for (const key of SESSION_SHARED_FIELDS) {
    if (key in patch) {
      progressPatch[key] = patch[key];
    }
  }
  if (Object.keys(progressPatch).length === 0) return;

  // このセッションに紐付く全 student_progress を取得
  const { data: lessons } = await supabase
    .from('student_progress_lessons')
    .select('student_progress_id')
    .eq('session_id', sessionId);

  if (!lessons || lessons.length === 0) return;

  const progressIds = Array.from(new Set(lessons.map((l) => l.student_progress_id)));
  for (const pid of progressIds) {
    await supabase.from('student_progress').update(progressPatch).eq('id', pid);
  }
}

// ============================================
// 教室長フィード（②教室長UI用）
// ============================================

/** フィード取得フィルタ */
export interface SessionFeedFilter {
  alertsOnly?: boolean;
  confirmedOnly?: boolean;
  unconfirmedOnly?: boolean;
  studentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * student_textbook_ids を school_id + 任意の student_id で取得
 */
async function getTextbookIds(schoolIds: string[], studentId?: string): Promise<string[]> {
  const q = supabase
    .from('student_textbooks')
    .select('id, student_id')
    .in('school_id', schoolIds)
    .eq('is_active', true);

  const { data, error } = await q;
  if (error || !data || data.length === 0) return [];

  let ids = data as { id: string; student_id: string | null }[];
  if (studentId) {
    ids = ids.filter((st) => st.student_id === studentId);
  }
  return ids.map((st) => st.id);
}

/**
 * 統合フィード取得（フィルタ対応）
 */
export async function getSessionFeed(
  schoolIds: string[],
  filter: SessionFeedFilter = {},
  limit = 50,
  offset = 0
): Promise<ProgressSessionWithDetails[]> {
  if (schoolIds.length === 0) return [];

  const stIds = await getTextbookIds(schoolIds, filter.studentId);
  if (stIds.length === 0) return [];

  let q = supabase
    .from('progress_sessions')
    .select(FEED_SELECT)
    .in('student_textbook_id', stIds)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filter.alertsOnly) {
    q = q.or('homework_not_done.eq.true,tardy.eq.true');
  }
  if (filter.confirmedOnly) {
    q = q.not('confirmed_at', 'is', null);
  }
  if (filter.unconfirmedOnly) {
    q = q.is('confirmed_at', null);
  }
  if (filter.dateFrom) {
    q = q.gte('session_date', filter.dateFrom);
  }
  if (filter.dateTo) {
    q = q.lte('session_date', filter.dateTo);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`フィードの取得に失敗しました: ${error.message}`);
  }
  return (data || []) as unknown as ProgressSessionWithDetails[];
}

/**
 * 後方互換: 要注意フィードのみ取得
 */
export async function getAlertSessionFeed(
  schoolIds: string[],
  limit = 30
): Promise<ProgressSessionWithDetails[]> {
  return getSessionFeed(schoolIds, { alertsOnly: true }, limit);
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
export async function getSmartAlerts(schoolIds: string[]): Promise<SmartAlert[]> {
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

    const hasLesson1 = new Set((lessons ?? []).map((l) => l.student_progress_id));

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

      const daysLeft = Math.ceil((new Date(exam.exam_date).getTime() - Date.now()) / 86400000);
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

// ============================================
// フィード用 目標・行動目標 一括取得
// ============================================

export interface FeedGoalSummary {
  /** 直近の試験目標（複数あれば exam_date が早いものを優先） */
  exam: {
    id: string;
    label: string; // 試験名
    examDate: string | null;
    targetScore: number | null;
  } | null;
  /** その試験目標に紐づく行動目標 */
  actionGoals: Array<{
    id: string;
    title: string;
    achieved: boolean;
    counterCurrent: number | null;
    counterTarget: number | null;
  }>;
  achievedCount: number;
  totalCount: number;
}

/**
 * フィードカードに表示する 目標 / 行動目標 を student_textbook_id 単位で一括取得。
 * 試験日が今日以降のものを優先し、なければ最新の試験を返す。
 */
export async function getFeedGoalsByTextbooks(
  studentTextbookIds: string[]
): Promise<Record<string, FeedGoalSummary>> {
  if (studentTextbookIds.length === 0) return {};

  // 試験目標を一括取得
  const { data: exams, error: examErr } = await supabase
    .from('student_textbook_exams')
    .select('id, student_textbook_id, exam_date, target_score, custom_exam_name, exam_type_id')
    .in('student_textbook_id', studentTextbookIds)
    .order('exam_date', { ascending: true });
  if (examErr) {
    console.error('Failed to fetch feed exams:', examErr);
    return {};
  }
  const examRows = (exams || []) as Array<{
    id: string;
    student_textbook_id: string;
    exam_date: string | null;
    target_score: number | null;
    custom_exam_name: string | null;
    exam_type_id: string | null;
  }>;

  // exam_type_id → name 解決のため exam_types を取得
  const examTypeIds = Array.from(
    new Set(examRows.map((r) => r.exam_type_id).filter((v): v is string => !!v))
  );
  const examTypeNameMap = new Map<string, string>();
  if (examTypeIds.length > 0) {
    const { data: types } = await supabase
      .from('exam_types')
      .select('id, name')
      .in('id', examTypeIds);
    for (const t of (types || []) as Array<{ id: string; name: string }>) {
      examTypeNameMap.set(t.id, t.name);
    }
  }

  // student_textbook ごとに「直近の未来の試験」または最新の試験を選択
  const today = new Date().toISOString().slice(0, 10);
  const examByTextbook = new Map<string, (typeof examRows)[0]>();
  for (const e of examRows) {
    const cur = examByTextbook.get(e.student_textbook_id);
    if (!cur) {
      examByTextbook.set(e.student_textbook_id, e);
      continue;
    }
    // 未来の試験を優先（exam_date >= today）。両方未来なら早いほう、両方過去なら新しいほう。
    const curFuture = (cur.exam_date ?? '') >= today;
    const newFuture = (e.exam_date ?? '') >= today;
    if (newFuture && !curFuture) examByTextbook.set(e.student_textbook_id, e);
    else if (newFuture === curFuture) {
      if (newFuture && (e.exam_date ?? '') < (cur.exam_date ?? '')) {
        examByTextbook.set(e.student_textbook_id, e);
      } else if (!newFuture && (e.exam_date ?? '') > (cur.exam_date ?? '')) {
        examByTextbook.set(e.student_textbook_id, e);
      }
    }
  }

  // 行動目標を該当 examId 群で一括取得
  const examIds = Array.from(examByTextbook.values()).map((e) => e.id);
  const goalsByExam = new Map<
    string,
    Array<{
      id: string;
      title: string;
      achieved: boolean;
      counter_current: number | null;
      counter_target: number | null;
      sort_order: number | null;
    }>
  >();
  if (examIds.length > 0) {
    const { data: goals } = await supabase
      .from('action_goals')
      .select(
        'id, student_textbook_exam_id, title, achieved, counter_current, counter_target, sort_order'
      )
      .in('student_textbook_exam_id', examIds)
      .order('sort_order', { ascending: true });
    for (const g of (goals || []) as Array<{
      id: string;
      student_textbook_exam_id: string;
      title: string;
      achieved: boolean;
      counter_current: number | null;
      counter_target: number | null;
      sort_order: number | null;
    }>) {
      const k = g.student_textbook_exam_id;
      if (!goalsByExam.has(k)) goalsByExam.set(k, []);
      goalsByExam.get(k)!.push(g);
    }
  }

  // textbook_id → サマリへ
  const out: Record<string, FeedGoalSummary> = {};
  for (const tbId of studentTextbookIds) {
    const exam = examByTextbook.get(tbId);
    if (!exam) {
      out[tbId] = { exam: null, actionGoals: [], achievedCount: 0, totalCount: 0 };
      continue;
    }
    const label =
      exam.custom_exam_name ??
      (exam.exam_type_id ? (examTypeNameMap.get(exam.exam_type_id) ?? 'テスト') : 'テスト');
    const goals = goalsByExam.get(exam.id) ?? [];
    out[tbId] = {
      exam: {
        id: exam.id,
        label,
        examDate: exam.exam_date,
        targetScore: exam.target_score,
      },
      actionGoals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        achieved: g.achieved,
        counterCurrent: g.counter_current,
        counterTarget: g.counter_target,
      })),
      achievedCount: goals.filter((g) => g.achieved).length,
      totalCount: goals.length,
    };
  }
  return out;
}
