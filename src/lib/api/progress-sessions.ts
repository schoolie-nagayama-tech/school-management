import { supabase } from '@/lib/supabase';
import { fetchAllPaged, fetchAllInChunks, fetchInChunks } from '@/lib/utils/supabasePaging';
import type {
  ProgressSession,
  ProgressSessionInsert,
  ProgressSessionUpdate,
  ProgressSessionWithDetails,
  StudentProgressLessonInsert,
} from '@/types/database';

/** Supabase select 句（フィード共通） */
// student_textbooks は !inner。これにより getSessionFeed で school_id を
// 埋め込み側のフィルタ（student_textbook.school_id=in.(...)）で絞れる。
// progress_sessions.student_textbook_id は常に存在するので inner でも件数は変わらない。
const FEED_SELECT = `
  *,
  student_textbook:student_textbooks!inner(
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
 * 1コマ（schedule_entry）に紐づく既存セッションを student_textbook_id 単位で引く。
 *
 * 授業報告書フォーム（/lesson-reports/[scheduleEntryId]）が使う。報告書は下書き保存・
 * 再提出で何度も保存されるため、そのたびに recordSession が新しいセッションを作ると
 * 進行表のフィードに同じコマが積み上がってしまう。既存セッションの id を渡して
 * 「上書き更新」させるための読み取り専用ヘルパー（保存経路は recordSession のまま）。
 */
export async function getSessionsByScheduleEntry(
  scheduleEntryId: string
): Promise<Record<string, ProgressSession>> {
  const { data, error } = await supabase
    .from('progress_sessions')
    .select('*')
    .eq('schedule_entry_id', scheduleEntryId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`セッションの取得に失敗しました: ${error.message}`);
  }
  const out: Record<string, ProgressSession> = {};
  // 同一コマ×同一教材は1セッションの想定。万一重複していたら最初の1件を採用し、
  // 以降の保存はそれを上書きしていく（増殖を止める側に倒す）。
  for (const s of (data || []) as ProgressSession[]) {
    if (!out[s.student_textbook_id]) out[s.student_textbook_id] = s;
  }
  return out;
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

/** 記録パネルで再編集するためのセッション復元データ */
export interface EditableSession {
  session: ProgressSession;
  /** curriculum_item_id → 指導回（lesson_number） */
  unitActions: Record<number, 1 | 2 | 3>;
  /** このセッション日に学校進度がついている単元ID（学校進度はセッションに直接紐づかないため session_date で近似） */
  schoolUnitIds: number[];
}

/**
 * 記録パネルでの再編集用に、直近の保存済みセッションを復元して返す。
 * - session 本体（日付・講師・引継ぎ・宿題/遅刻）は progress_sessions から
 * - 指導単元（unitActions）は student_progress_lessons(session_id) から
 * - 学校進度（schoolUnitIds）は student_progress.school_progress_date == session_date で近似的に紐付け
 *   （学校進度は単元ごとに1日付しか持たずセッションに直接紐づかないため、同日の別セッションと混同しうる点に注意）
 */
export async function getSessionsForEdit(
  studentTextbookId: string,
  limit = 10
): Promise<EditableSession[]> {
  const { data: sessions, error } = await supabase
    .from('progress_sessions')
    .select('*')
    .eq('student_textbook_id', studentTextbookId)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`編集用セッションの取得に失敗しました: ${error.message}`);
  if (!sessions || sessions.length === 0) return [];

  const sessionRows = sessions as ProgressSession[];
  const sessionIds = sessionRows.map((s) => s.id);

  // このテキストの student_progress: id → 単元ID / 学校進度日付
  const { data: progressRows } = await supabase
    .from('student_progress')
    .select('id, curriculum_item_id, school_progress_date')
    .eq('student_textbook_id', studentTextbookId);
  const progById = new Map<string, { curriculumItemId: number; schoolDate: string | null }>();
  for (const p of (progressRows || []) as Array<{
    id: string;
    curriculum_item_id: number;
    school_progress_date: string | null;
  }>) {
    progById.set(p.id, {
      curriculumItemId: p.curriculum_item_id,
      schoolDate: p.school_progress_date,
    });
  }

  // セッションに紐づくレッスンから unitActions を復元
  const { data: lessons } = await supabase
    .from('student_progress_lessons')
    .select('session_id, lesson_number, student_progress_id')
    .in('session_id', sessionIds);
  const unitActionsBySession = new Map<string, Record<number, 1 | 2 | 3>>();
  for (const l of (lessons || []) as Array<{
    session_id: string | null;
    lesson_number: number;
    student_progress_id: string;
  }>) {
    if (!l.session_id) continue;
    const prog = progById.get(l.student_progress_id);
    if (!prog) continue;
    const rec = unitActionsBySession.get(l.session_id) ?? {};
    rec[prog.curriculumItemId] = l.lesson_number as 1 | 2 | 3;
    unitActionsBySession.set(l.session_id, rec);
  }

  // 学校進度を日付ごとにバケツ分け（session_date で近似紐付け）
  const schoolByDate = new Map<string, number[]>();
  for (const p of (progressRows || []) as Array<{
    curriculum_item_id: number;
    school_progress_date: string | null;
  }>) {
    if (!p.school_progress_date) continue;
    const arr = schoolByDate.get(p.school_progress_date) ?? [];
    arr.push(p.curriculum_item_id);
    schoolByDate.set(p.school_progress_date, arr);
  }

  return sessionRows.map((s) => ({
    session: s,
    unitActions: unitActionsBySession.get(s.id) ?? {},
    schoolUnitIds: schoolByDate.get(s.session_date) ?? [],
  }));
}

/**
 * 直前のセッションを、指導単元・学校進度まで含めて取得（進行表の「前回の引継ぎ」カードを
 * 室長の進行表確認カードと同じ情報量で表示するため）。
 */
export async function getLastSessionDetail(
  studentTextbookId: string
): Promise<ProgressSessionWithDetails | null> {
  const { data, error } = await supabase
    .from('progress_sessions')
    .select(FEED_SELECT)
    .eq('student_textbook_id', studentTextbookId)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`直前セッションの取得に失敗しました: ${error.message}`);
  }
  return (data as unknown as ProgressSessionWithDetails) || null;
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
  /** 編集時に「学校進度から外された」単元ID。指定行の school_progress_date を null に戻す */
  clearSchoolProgressUnits?: number[];
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
    clearSchoolProgressUnits,
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
  // 編集時に「残すべきレッスン」を (student_progress_id:lesson_number) で控える。ループ後に stale を削除する
  const desiredLessonKeys = new Set<string>();
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
    desiredLessonKeys.add(`${progress.id}:${action.lessonNumber}`);
  }

  // 2b. 編集時: このセッションに紐づくレッスンのうち、今回の指導単元から外されたものを削除する
  //     （新規作成時は既存レッスンが無いのでスキップ）
  if (sessionId) {
    const { data: existingLessons } = await supabase
      .from('student_progress_lessons')
      .select('id, student_progress_id, lesson_number')
      .eq('session_id', sessionId);
    for (const l of (existingLessons || []) as Array<{
      id: string;
      student_progress_id: string;
      lesson_number: number;
    }>) {
      if (!desiredLessonKeys.has(`${l.student_progress_id}:${l.lesson_number}`)) {
        await supabase.from('student_progress_lessons').delete().eq('id', l.id);
      }
    }
  }

  // 2c. 編集時: 学校進度から外された単元は school_progress_date を null に戻す
  if (clearSchoolProgressUnits && clearSchoolProgressUnits.length > 0) {
    await supabase
      .from('student_progress')
      .update({ school_progress_date: null })
      .eq('student_textbook_id', studentTextbookId)
      .in('curriculum_item_id', clearSchoolProgressUnits);
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
 * 統合フィード取得（フィルタ対応）
 *
 * 教室の絞り込みは student_textbooks への inner join（FEED_SELECT）で行う。
 * かつて student_textbook_id を全件取得して .in(...) に流し込んでいたが、
 * 「すべての教室」だと ID が数千件になり (1) 1000行上限で切り捨て
 * (2) .in() のURLが長大化して 400 になる、の二重の罠でフィードが空になった。
 * 埋め込みフィルタならサーバー側の join で絞れるので教室数に依らず動く。
 */
export async function getSessionFeed(
  schoolIds: string[],
  filter: SessionFeedFilter = {},
  limit = 50,
  offset = 0
): Promise<ProgressSessionWithDetails[]> {
  if (schoolIds.length === 0) return [];

  let q = supabase
    .from('progress_sessions')
    .select(FEED_SELECT)
    // student_textbooks!inner 側のカラムで教室・在籍・生徒を絞る
    .in('student_textbook.school_id', schoolIds)
    .eq('student_textbook.is_active', true)
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filter.studentId) {
    q = q.eq('student_textbook.student_id', filter.studentId);
  }
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
  // homework_not_done / tardy は進行表確認の「注意事項」板で現用の種類。
  // school_catching_up / no_exam_goal / exam_soon は精度不足のためペンディング（getSmartAlerts参照）。
  type: 'homework_not_done' | 'tardy' | 'school_catching_up' | 'no_exam_goal' | 'exam_soon';
  severity: 'urgent' | 'warning';
  studentName: string;
  studentId: string;
  textbookName: string;
  studentTextbookId: string;
  detail: string;
  /** exam_date（テスト系アラートの場合） */
  examDate?: string;
  /** 該当単元の curriculum_item_id（school_catching_up の場合。進行表への直接ジャンプに使う） */
  curriculumItemId?: number;
}

/**
 * 進行表確認「注意事項」板のアラートを取得（現用）。
 *
 * 宿題未提出・遅刻フラグの付いた直近セッションを、板に出すアラートへ変換する。
 * 講師が入力したフラグ由来で確実に動く指標のみを扱う（学校追い抜き等のスマート
 * アラートは精度不足のためペンディング。getSmartAlerts 参照）。
 * 1セッションに両方のフラグが付いていれば宿題・遅刻の2件に分けて出す。
 */
export async function getHomeworkTardyAlerts(
  schoolIds: string[],
  limit = 30
): Promise<SmartAlert[]> {
  if (schoolIds.length === 0) return [];

  // 「要注意」タブと同じソース（homework_not_done or tardy の付いた直近セッション）。
  const sessions = await getAlertSessionFeed(schoolIds, limit);
  const alerts: SmartAlert[] = [];

  for (const s of sessions) {
    const st = s.student_textbook;
    if (!st?.student) continue;
    const base = {
      studentName: `${st.student.last_name} ${st.student.first_name}`,
      studentId: st.student.id,
      textbookName: st.textbook?.name ?? '',
      studentTextbookId: s.student_textbook_id,
      // 緊急ではなく警告扱い（緊急判定はペンディングのため赤バッジは出さない）
      severity: 'warning' as const,
    };
    const dateLabel = s.session_date ? s.session_date.replace(/-/g, '/') : '';
    if (s.homework_not_done) {
      alerts.push({
        ...base,
        type: 'homework_not_done',
        detail: `${dateLabel} の授業で宿題未提出`,
      });
    }
    if (s.tardy) {
      alerts.push({ ...base, type: 'tardy', detail: `${dateLabel} の授業で遅刻` });
    }
  }

  return alerts;
}

/** 宿題忘れ・遅刻の期間集計（教室長ダッシュボードの集計項目用） */
export interface HomeworkTardyCounts {
  /** 集計対象期間内に「宿題未提出」フラグが付いた授業（セッション）の件数 */
  homework: number;
  /** 集計対象期間内に「遅刻」フラグが付いた授業（セッション）の件数 */
  tardy: number;
  /** 集計に使った日数（7=直近1週間 / 30=直近1ヶ月） */
  days: number;
}

/**
 * 直近 days 日間の宿題忘れ・遅刻の件数を教室（複数可）横断で集計する。
 *
 * データ源は progress_sessions（1 授業 = 1 行、session_date と homework_not_done / tardy を持つ）。
 * student_textbooks を内部結合して school_id で絞り込み、フラグごとに head カウントだけを取る
 * （行本体は取得しないので PostgREST の1000行上限に触れない）。
 * 「宿題忘れの数」「遅刻の数」は授業単位の発生件数であり、生徒数ではない点に注意。
 */
export async function getHomeworkTardyCounts(
  schoolIds: string[],
  days: number
): Promise<HomeworkTardyCounts> {
  if (schoolIds.length === 0) return { homework: 0, tardy: 0, days };

  // 期間の開始日（今日を含む直近 days 日）。7 → 今日-6, 30 → 今日-29
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  const fromStr = from.toISOString().slice(0, 10);

  // 内部結合で school_id を絞ったうえで、フラグごとに件数のみ取得（head:true）
  const countFor = async (column: 'homework_not_done' | 'tardy'): Promise<number> => {
    const { count, error } = await supabase
      .from('progress_sessions')
      .select('id, student_textbook:student_textbooks!inner(school_id)', {
        count: 'exact',
        head: true,
      })
      .in('student_textbook.school_id', schoolIds)
      .gte('session_date', fromStr)
      .eq(column, true);
    if (error) {
      console.warn(`${column} の件数取得に失敗:`, error.message);
      return 0;
    }
    return count ?? 0;
  };

  const [homework, tardy] = await Promise.all([countFor('homework_not_done'), countFor('tardy')]);
  return { homework, tardy, days };
}

/**
 * 【ペンディング】教室単位のスマートアラートを取得
 * - 学校に追い抜かれている（school_progress_date が今日以前なのに未指導）
 * - 近い試験に目標が未設定
 * - 14日以内に試験がある
 *
 * 「緊急（学校追い抜き等）」の検知精度が不足しており誤検知が多いため、進行表確認の
 * 注意事項板からは一旦外している（現在は getHomeworkTardyAlerts を使用）。
 * ロジックは将来の再有効化に備えて温存する。呼び出しを復活させれば元に戻せる。
 */
export async function getSmartAlerts(schoolIds: string[]): Promise<SmartAlert[]> {
  if (schoolIds.length === 0) return [];

  const alerts: SmartAlert[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const in14Days = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  type STRow = {
    id: string;
    student: { id: string; last_name: string; first_name: string } | null;
    textbook: { name: string } | null;
  };

  // active student_textbooks with student & textbook info。
  // (生徒数 × 教材) でスケールし教室横断で1000行を超えうるため全件ページング取得
  // （切り捨てるとアラート対象の生徒・教材が静かに欠落する）。id 昇順で安定ページング。
  let stRows: STRow[];
  try {
    stRows = await fetchAllPaged<STRow>((from, to) =>
      supabase
        .from('student_textbooks')
        .select('id, student:students(id, last_name, first_name), textbook:textbooks(name)')
        .in('school_id', schoolIds)
        .eq('is_active', true)
        .order('id', { ascending: true })
        .range(from, to)
    );
  } catch (stError) {
    console.error('Failed to fetch student_textbooks for smart alerts:', stError);
    return [];
  }
  if (stRows.length === 0) return [];

  const stIds = stRows.map((st) => st.id);
  const stMap = new Map(stRows.map((st) => [st.id, st]));

  // ── 1. 学校に追い抜かれている ──
  // 「未指導の単元に学校日付が付いているか」を単元ごとに見ると、まだ習っていない
  // 先の単元（正常な進度差）まで大量に誤検知してしまう。正しくは「生徒の指導済み
  // 最深部（1回目実施済みの最大 sort_order）」と「学校の到達済み最深部（今日以前の
  // school_progress_date が付いた最大 sort_order）」を比べ、学校側が上回っている
  // 場合だけ「追い抜かれた」とみなす（教材ごとに最大1件のアラート）。
  // school_progress_date は手入力欄（学校の進度予定を先に入れておけるため）なので、
  // 未来日の予定入力は学校の到達済み最深部に含めない（today 以前のみ集計）。
  // student_progress は (教材 × 単元) でスケールし stIds も多いため、チャンク分割 +
  // チャンク内ページングの両対応で取得する（id 昇順で安定ページング）。
  const progressRows = await fetchAllInChunks<{
    id: string;
    student_textbook_id: string;
    curriculum_item_id: number;
    school_progress_date: string | null;
    // PostgREST の embed は関係の解釈によりオブジェクト/配列どちらでも返り得るため両対応する
    curriculum_item: { sort_order: number } | { sort_order: number }[] | null;
  }>(stIds, (chunk, from, to) =>
    supabase
      .from('student_progress')
      .select(
        'id, student_textbook_id, curriculum_item_id, school_progress_date, curriculum_item:curriculum_items(sort_order)'
      )
      .in('student_textbook_id', chunk)
      .order('id', { ascending: true })
      .range(from, to)
  );

  if (progressRows.length > 0) {
    const progressIdList = progressRows.map((r) => r.id);

    // lesson1 完了済みの student_progress_id を取得。
    // 1 progress につき lesson1 は高々1行なのでチャンク分割のみで足りる（fetchInChunks）。
    const lessons = await fetchInChunks<{
      student_progress_id: string;
      lesson_number: number;
      lesson_date: string | null;
    }>(progressIdList, (chunk) =>
      supabase
        .from('student_progress_lessons')
        .select('student_progress_id, lesson_number, lesson_date')
        .in('student_progress_id', chunk)
        .eq('lesson_number', 1)
        .not('lesson_date', 'is', null)
    );

    const hasLesson1 = new Set(lessons.map((l) => l.student_progress_id));

    // 教材（student_textbook）ごとに「指導済み最深部」と「学校到達済み最深部」を求める
    type Frontier = {
      taughtMaxSort: number;
      schoolMaxSort: number;
      schoolMaxItemId: number | null;
    };
    const frontierMap = new Map<string, Frontier>();
    for (const p of progressRows) {
      const ci = Array.isArray(p.curriculum_item) ? p.curriculum_item[0] : p.curriculum_item;
      const sortOrder = ci?.sort_order;
      if (sortOrder == null) continue;
      const f = frontierMap.get(p.student_textbook_id) ?? {
        taughtMaxSort: -1,
        schoolMaxSort: -1,
        schoolMaxItemId: null,
      };
      if (hasLesson1.has(p.id) && sortOrder > f.taughtMaxSort) {
        f.taughtMaxSort = sortOrder;
      }
      if (
        p.school_progress_date &&
        p.school_progress_date <= today &&
        sortOrder > f.schoolMaxSort
      ) {
        f.schoolMaxSort = sortOrder;
        f.schoolMaxItemId = p.curriculum_item_id;
      }
      frontierMap.set(p.student_textbook_id, f);
    }

    // 学校の到達済み最深部が生徒の指導済み最深部を上回っている教材だけを対象にする
    for (const [studentTextbookId, f] of Array.from(frontierMap.entries())) {
      if (f.schoolMaxSort <= f.taughtMaxSort) continue; // 追い抜かれていない
      if (f.schoolMaxItemId == null) continue;

      const st = stMap.get(studentTextbookId);
      if (!st?.student) continue;

      alerts.push({
        type: 'school_catching_up',
        severity: 'urgent',
        studentName: `${st.student.last_name} ${st.student.first_name}`,
        studentId: st.student.id,
        textbookName: st.textbook?.name ?? '',
        studentTextbookId,
        detail: '学校が既に進んだ単元で塾の指導が追いついていません',
        curriculumItemId: f.schoolMaxItemId,
      });
    }
  }

  // ── 2. 近い試験（14日以内） + 目標未設定チェック ──
  // 14日以内の試験のみ。stIds が多いと .in() の URL が長くなるためチャンク分割で取得
  // （期間が14日と短く 1 チャンクの結果は 1000 行未満に収まるため fetchInChunks で十分）。
  const exams = await fetchInChunks<{
    id: string;
    student_textbook_id: string;
    exam_date: string;
    target_score: number | null;
    custom_exam_name: string | null;
    exam_type_id: string | null;
  }>(stIds, (chunk) =>
    supabase
      .from('student_textbook_exams')
      .select('id, student_textbook_id, exam_date, target_score, custom_exam_name, exam_type_id')
      .in('student_textbook_id', chunk)
      .gte('exam_date', today)
      .lte('exam_date', in14Days)
      .order('exam_date', { ascending: true })
  );

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

/** 学校進度がついている単元（進行表の「学校進度」列由来）。確認カードの学校単元行に使う */
export interface SchoolProgressUnit {
  curriculumItemId: number;
  /** 表示ラベル（item_number + title） */
  label: string;
  /** 学校進度の日付 YYYY-MM-DD */
  schoolDate: string;
}

/**
 * 教材(student_textbook)ごとに、学校進度がついている単元を一括取得する。
 * セッションの指導単元とは別に「学校進度の列」のデータをそのまま出したいので、
 * student_progress.school_progress_date が入っている行を curriculum_items 順で返す。
 * （本番実測で1教材あたり最大2件程度と少ないため単一クエリで取得。）
 */
export async function getSchoolProgressUnitsByTextbooks(
  studentTextbookIds: string[]
): Promise<Record<string, SchoolProgressUnit[]>> {
  const out: Record<string, SchoolProgressUnit[]> = {};
  for (const id of studentTextbookIds) out[id] = [];
  if (studentTextbookIds.length === 0) return out;

  const { data, error } = await supabase
    .from('student_progress')
    .select(
      'student_textbook_id, curriculum_item_id, school_progress_date, curriculum_item:curriculum_items(item_number, title, sort_order)'
    )
    .in('student_textbook_id', studentTextbookIds)
    .not('school_progress_date', 'is', null);

  if (error) {
    console.error('Failed to fetch school progress units:', error);
    return out;
  }

  type CurriculumMeta = {
    item_number: string | null;
    title: string | null;
    sort_order: number | null;
  };
  const rows = (data || []) as Array<{
    student_textbook_id: string;
    curriculum_item_id: number;
    school_progress_date: string;
    curriculum_item: CurriculumMeta | CurriculumMeta[] | null;
  }>;

  // カリキュラム順（sort_order）で安定表示するため、いったん sort_order を保持して並べてから整形する
  const withOrder: Record<string, Array<SchoolProgressUnit & { sortOrder: number }>> = {};
  for (const id of studentTextbookIds) withOrder[id] = [];
  for (const r of rows) {
    const ci = Array.isArray(r.curriculum_item) ? r.curriculum_item[0] : r.curriculum_item;
    const label = `${ci?.item_number ?? ''} ${ci?.title ?? ''}`.trim();
    (withOrder[r.student_textbook_id] ||= []).push({
      curriculumItemId: r.curriculum_item_id,
      label,
      schoolDate: r.school_progress_date,
      sortOrder: ci?.sort_order ?? Number.MAX_SAFE_INTEGER,
    });
  }

  for (const id of Object.keys(withOrder)) {
    out[id] = withOrder[id]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ curriculumItemId, label, schoolDate }) => ({ curriculumItemId, label, schoolDate }));
  }
  return out;
}
