/**
 * 講習 自動コマ割りシミュレータ — 実データアダプタ（読み取り専用）
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md
 *
 * 目的:
 *  - シミュレータ画面（/schedule/koushu/simulator）の「実データモード」から呼ばれる。
 *  - 本番テーブルを読み取り、allocateKoushu() が食える AllocatorInput を組み立てる。
 *  - ブラウザクライアント（ログイン中ユーザーのRLS）だけを使う。service role は使わない。
 *  - 書き込み系（insert/update/delete/upsert/rpc）は一切呼ばない。
 *
 * 実データの既知の欠損とフォールバック（呼び出し元の画面に notes として出す）:
 *  - 科目: student_progress は curriculum_item 単位で、科目への正式な紐付けが未実装（P1で追加予定）。
 *    このアダプタは生徒IDから決定的に暫定科目を割り振る（TODOコメント参照）。
 *  - ratio/duration: 申込側に情報が無いため student_subject_contracts（あれば）→ 無ければ ratio=2、
 *    subjects.duration_minutes（無ければ90分）を使う。
 *  - 生徒の出席可能枠: seasonal_shift_student_submissions が空なら通塾日程（schedule_regular_patterns）に
 *    フォールバックする。
 *  - 講師の出勤: seasonal_shift_submissions は teacher_name/teacher_email 逆引きが必要な提出が多い
 *    （教室によっては user_id が入っていない提出が大半、または全件）。解決できなかった提出者は
 *    notes.unresolvedTeachers に名前を積み、そのシフトは teacherAvailability に反映しない。
 */

import { supabase } from '@/lib/supabase';
import { fetchAllPaged, fetchAllInChunks } from '@/lib/utils/supabasePaging';
import { normalizePersonName } from '@/lib/utils/personName';
import { getClosedDays } from '@/lib/api/schedule';
import { getClassCapacity, DEFAULT_CLASS_CAPACITY } from '@/lib/api/school-class-capacity';
import { INDIVIDUAL_FORMATION } from '@/types/schedule';
import type {
  AllocatorInput,
  AllocatorSettings,
  CellKey,
  ExistingPlacement,
  SlotDef,
  StudentDef,
  SubjectDef,
  TaskDef,
  TeacherDef,
} from './types';

// このファイルが触るテーブルの一部は生成型（src/types/database.ts）に未反映の列を含む
// （ratio/duration_minutes/half_position 等、Phase R以降の追加列）。既存コードと同じく any でクエリする。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ============================================================
// 公開型
// ============================================================

export interface RealDataOptions {
  schoolId: string;
  /** course_prep_periods の1件（getKoushuPeriods の戻り値と互換） */
  period: { schedule_start_date: string; schedule_end_date: string; season: string; year: number };
  settings: AllocatorSettings;
}

export interface RealDataNotes {
  /** 申込コマ(application_count>0)がある生徒数 */
  studentsWithApplication: number;
  /** 申込コマの合計 */
  totalAppliedKoma: number;
  /** 講習シフト（seasonal_shift_submissions）の提出者数 */
  teacherSubmissions: number;
  /** 提出者のうち user_profiles を解決できた人数（= 出勤可能講師として反映できた人数） */
  teacherSubmissionsResolved: number;
  /** 講習シフトの出勤可スロット行数（available=true・期間内） */
  teacherSlotRows: number;
  /** user_id / email / 氏名 のいずれでも user_profiles を解決できなかった提出者名 */
  unresolvedTeachers: string[];
  /** 生徒の出席可能枠の取得元。'none' は対象生徒が0人だった場合 */
  studentAvailabilitySource: 'shift_submission' | 'regular_pattern' | 'none';
  /** 申込のある生徒のうち、出席可能枠が1つも組み立てられなかった人数 */
  studentsWithoutAvailability: number;
  /** シフトの time_slot 文字列が schedule_time_slots に解決できなかった行数 */
  unresolvedTimeSlots: number;
  /** 科目は暫定割当（生徒IDのハッシュから決定的に選んでいる）であることの明示フラグ */
  subjectAssignmentIsProvisional: true;
}

export interface RealDataResult {
  input: AllocatorInput;
  notes: RealDataNotes;
}

// ============================================================
// 日付・ハッシュ ユーティリティ
// ============================================================

/** JST安全に期間の全日付を列挙する（toISOString().slice は使わない）。除外は呼び出し側で行う。 */
function buildDateRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const cur = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** 文字列の決定的ハッシュ（32bit）。科目の暫定割当にだけ使う。Math.random は使わない。 */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * TODO(P1): student_progress（curriculum_item単位）を教材→科目へ正式に紐付ける実装に置き換える。
 * それまでの暫定措置として、生徒IDのハッシュから決定的に1〜2科目を選ぶ。
 * 同じ生徒なら常に同じ科目になる（再読み込みで結果がブレない）。
 */
function pickProvisionalSubjects(hash: number, subjects: SubjectDef[]): SubjectDef[] {
  if (subjects.length === 0) return [];
  if (subjects.length === 1) return [subjects[0]];
  const firstIdx = hash % subjects.length;
  const wantsTwo = hash % 2 === 0;
  if (!wantsTwo) return [subjects[firstIdx]];
  const secondIdx =
    (firstIdx + 1 + (Math.floor(hash / 7) % (subjects.length - 1))) % subjects.length;
  if (secondIdx === firstIdx) return [subjects[firstIdx]];
  return [subjects[firstIdx], subjects[secondIdx]];
}

/** 合計コマ数を暫定科目数（1 or 2）に決定的に按分する。 */
function splitKomaAmongSubjects(total: number, subjectCount: number, hash: number): number[] {
  if (subjectCount <= 1 || total <= 1) {
    return [total, ...Array(Math.max(0, subjectCount - 1)).fill(0)];
  }
  // 0.40〜0.60 の範囲で決定的に按分（極端な偏りを避ける）
  const ratio = 0.4 + (hash % 21) / 100;
  const first = Math.min(total - 1, Math.max(1, Math.round(total * ratio)));
  return [first, total - first];
}

/** 教室内講師の display_name → user_id（空白正規化・完全一致・同名は除外）。schedule.ts の buildTeacherNameIndex と同じ規約。 */
function buildNameIndex(teachers: { id: string; name: string }[]): Map<string, string> {
  const counts = new Map<string, number>();
  const firstId = new Map<string, string>();
  for (const t of teachers) {
    const key = normalizePersonName(t.name);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!firstId.has(key)) firstId.set(key, t.id);
  }
  const result = new Map<string, string>();
  firstId.forEach((id, key) => {
    if (counts.get(key) === 1) result.set(key, id);
  });
  return result;
}

// ============================================================
// メイン
// ============================================================

export async function loadRealAllocatorInput(opts: RealDataOptions): Promise<RealDataResult> {
  const { schoolId, period, settings } = opts;

  // ---- 1. 個別コマ定義（講習は個別レーンのみ対象） ----
  const { data: slotRows, error: slotErr } = await db
    .from('schedule_time_slots')
    .select('id, slot_number, start_time, end_time')
    .eq('school_id', schoolId)
    .eq('formation', INDIVIDUAL_FORMATION)
    .eq('is_active', true)
    .order('slot_number', { ascending: true });
  if (slotErr) throw new Error(`個別コマの取得に失敗しました: ${slotErr.message}`);
  const slots: SlotDef[] = (
    (slotRows ?? []) as Array<{
      id: string;
      slot_number: number;
      start_time: string;
      end_time: string;
    }>
  ).map((s) => ({
    id: s.id,
    slot_number: s.slot_number,
    start_time: s.start_time,
    end_time: s.end_time,
  }));
  const slotIdSet = new Set(slots.map((s) => s.id));
  const timeToSlotId = new Map(slots.map((s) => [s.start_time.slice(0, 5), s.id]));

  // ---- 2. 期間の稼働日（休講日・日曜を除外） ----
  // 休講日の取得は非致命的：失敗しても稼働日を絞れないだけなので、空扱いで続行する。
  let closedSet = new Set<string>();
  try {
    const closedDays = await getClosedDays(schoolId, {
      from: period.schedule_start_date,
      to: period.schedule_end_date,
    });
    closedSet = new Set(closedDays.map((d) => d.closed_date));
  } catch (err) {
    console.error('loadRealAllocatorInput: 休講日の取得に失敗（空扱いで続行）', err);
  }
  const dates = buildDateRange(period.schedule_start_date, period.schedule_end_date).filter((d) => {
    const dow = new Date(d + 'T12:00:00').getDay();
    return dow !== 0 && !closedSet.has(d);
  });

  // ---- 3. 科目マスタ（全校共通） ----
  const { data: subjectRows, error: subjErr } = await db
    .from('subjects')
    .select('id, name, duration_minutes')
    .order('sort_order', { ascending: true });
  if (subjErr) throw new Error(`科目マスタの取得に失敗しました: ${subjErr.message}`);
  const subjectRowsSafe = (subjectRows ?? []) as Array<{
    id: string;
    name: string;
    duration_minutes: number | null;
  }>;
  const subjects: SubjectDef[] = subjectRowsSafe.map((s) => ({ id: s.id, name: s.name }));
  const subjectDurationById = new Map<string, 45 | 90>(
    subjectRowsSafe.map((s) => [s.id, s.duration_minutes === 45 ? 45 : 90])
  );

  // ---- 4. 生徒（在籍中・研修用テスト生徒は除外） ----
  const studentRows = await fetchAllPaged<{
    id: string;
    last_name: string;
    first_name: string;
    grade: number;
    fixed_teacher_ids: string[] | null;
    excluded_teacher_ids: string[] | null;
    preferred_teacher_gender: 'male' | 'female' | null;
  }>((from, to) =>
    db
      .from('students')
      .select(
        'id, last_name, first_name, grade, fixed_teacher_ids, excluded_teacher_ids, preferred_teacher_gender'
      )
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .eq('is_test', false)
      .order('id', { ascending: true })
      .range(from, to)
  );
  const students: StudentDef[] = studentRows.map((s) => ({
    id: s.id,
    name: `${s.last_name} ${s.first_name}`,
    grade: s.grade,
    fixedTeacherIds: s.fixed_teacher_ids ?? [],
    excludedTeacherIds: s.excluded_teacher_ids ?? [],
    preferredTeacherGender: s.preferred_teacher_gender ?? null,
  }));
  const studentById = new Map(students.map((s) => [s.id, s]));

  // ---- 5. 講師（この教室に紐づく role=teacher・有効アカウント） ----
  const { data: schoolLinks, error: linkErr } = await db
    .from('user_schools')
    .select('user_id')
    .eq('school_id', schoolId);
  if (linkErr) throw new Error(`講師の教室紐付け取得に失敗しました: ${linkErr.message}`);
  const teacherUserIds = Array.from(
    new Set(
      ((schoolLinks ?? []) as Array<{ user_id: string | null }>)
        .map((l) => l.user_id)
        .filter((v): v is string => !!v)
    )
  );
  let teachers: TeacherDef[] = [];
  if (teacherUserIds.length > 0) {
    const { data: teacherRows, error: teacherErr } = await db
      .from('user_profiles')
      .select('id, display_name, email, gender, teachable_subject_ids')
      .in('id', teacherUserIds)
      .eq('role', 'teacher')
      .eq('is_active', true);
    if (teacherErr) throw new Error(`講師の取得に失敗しました: ${teacherErr.message}`);
    teachers = (
      (teacherRows ?? []) as Array<{
        id: string;
        display_name: string | null;
        email: string;
        gender: 'male' | 'female' | 'other' | null;
        teachable_subject_ids: string[] | null;
      }>
    ).map((t) => ({
      id: t.id,
      name: t.display_name || t.email,
      gender: t.gender ?? null,
      teachableSubjectIds: t.teachable_subject_ids ?? null,
    }));
  }

  // ---- 6. 申込コマ（student_progress.application_count） ----
  // student_progress に school_id / student_id は無いため student_textbooks 経由で辿る。
  // 期間の season に一致する student_textbooks（is_active のみ）に限定し、他学期の混入を防ぐ。
  const stbRows = await fetchAllPaged<{ id: string; student_id: string }>((from, to) =>
    db
      .from('student_textbooks')
      .select('id, student_id')
      .eq('school_id', schoolId)
      .eq('season', period.season)
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, to)
  );
  const studentByStbId = new Map(stbRows.map((r) => [r.id, r.student_id]));
  const stbIds = stbRows.map((r) => r.id);

  // 申込コマ>0の行だけを単純合算する。application_count は「結合グループの先頭行に合計・他は0」の
  // 規約で保存されている（syncApplicationToProgress／src/lib/api/proposals.ts 585-600行付近）ため、
  // >0 の行だけを足せば二重計上にならない（0の行＝結合の非先頭行は自動的に無視される）。
  const progressRows =
    stbIds.length > 0
      ? await fetchAllInChunks<{ student_textbook_id: string; application_count: number }>(
          stbIds,
          (chunk, from, to) =>
            db
              .from('student_progress')
              .select('student_textbook_id, application_count')
              .in('student_textbook_id', chunk)
              .gt('application_count', 0)
              .order('id', { ascending: true })
              .range(from, to)
        )
      : [];

  const komaByStudent = new Map<string, number>();
  for (const row of progressRows) {
    const studentId = studentByStbId.get(row.student_textbook_id);
    if (!studentId) continue;
    if (!studentById.has(studentId)) continue; // 在籍中・非テスト生徒のみ対象
    komaByStudent.set(studentId, (komaByStudent.get(studentId) ?? 0) + row.application_count);
  }
  const applicantStudentIds = Array.from(komaByStudent.keys());

  // ---- 7. ratio（生徒×科目の指導契約）。無ければ既定 ratio=2 ----
  // student_subject_contracts の意味は getStudentContractRatioMap と同じ（student_id×subject_id→ratio）。
  // ここでは対象生徒数ぶんの逐次呼び出しを避けるため、同じテーブルを bulk + チャンク取得する。
  const contractRows =
    applicantStudentIds.length > 0
      ? await fetchAllInChunks<{ student_id: string; subject_id: string; ratio: number }>(
          applicantStudentIds,
          (chunk, from, to) =>
            db
              .from('student_subject_contracts')
              .select('student_id, subject_id, ratio')
              .in('student_id', chunk)
              .order('id', { ascending: true })
              .range(from, to)
        )
      : [];
  const ratioByStudentSubject = new Map<string, 1 | 2>();
  for (const r of contractRows) {
    ratioByStudentSubject.set(`${r.student_id}_${r.subject_id}`, r.ratio === 1 ? 1 : 2);
  }

  // ---- 8. タスク組み立て（科目は暫定割当。上の pickProvisionalSubjects の TODO 参照） ----
  const tasks: TaskDef[] = [];
  for (const studentId of applicantStudentIds) {
    const totalKoma = komaByStudent.get(studentId) ?? 0;
    if (totalKoma <= 0 || subjects.length === 0) continue;
    const hash = hashString(studentId);
    const chosen = pickProvisionalSubjects(hash, subjects);
    const split = splitKomaAmongSubjects(totalKoma, chosen.length, hash);
    chosen.forEach((subj, i) => {
      const koma = split[i] ?? 0;
      if (koma <= 0) return;
      const ratio = ratioByStudentSubject.get(`${studentId}_${subj.id}`) ?? 2;
      const duration = subjectDurationById.get(subj.id) ?? 90;
      tasks.push({ studentId, subjectId: subj.id, koma, ratio, duration });
    });
  }

  // ---- 9. 講師の出勤（夏期講習シフト提出）----
  // 非致命的：解決できなかった提出者・スロットは notes に数を残して空扱いで続行する。
  const teacherAvailability = new Map<CellKey, string[]>();
  let teacherSubmissions = 0;
  let teacherSubmissionsResolved = 0;
  let teacherSlotRows = 0;
  let unresolvedTimeSlots = 0;
  const unresolvedTeachers: string[] = [];

  try {
    const { data: settingRows, error: settingErr } = await db
      .from('seasonal_shift_settings')
      .select('id')
      .eq('school_id', schoolId)
      .eq('status', 'published')
      .lte('start_date', period.schedule_end_date)
      .gte('end_date', period.schedule_start_date);
    if (settingErr) throw new Error(settingErr.message);
    const settingIds = ((settingRows ?? []) as Array<{ id: string }>).map((s) => s.id);

    if (settingIds.length > 0) {
      const { data: subRows, error: subErr } = await db
        .from('seasonal_shift_submissions')
        .select('id, teacher_name, teacher_email, user_id')
        .in('setting_id', settingIds);
      if (subErr) throw new Error(subErr.message);
      const submissions = (subRows ?? []) as Array<{
        id: string;
        teacher_name: string;
        teacher_email: string | null;
        user_id: string | null;
      }>;
      teacherSubmissions = submissions.length;

      // 講師の解決順: 1) user_id  2) teacher_email（小文字完全一致）  3) teacher_name（空白正規化・完全一致）
      const emails = Array.from(
        new Set(
          submissions.map((s) => s.teacher_email?.toLowerCase()).filter((e): e is string => !!e)
        )
      );
      const emailToUserId = new Map<string, string>();
      if (emails.length > 0) {
        const { data: byEmail } = await db
          .from('user_profiles')
          .select('id, email')
          .in('email', emails);
        for (const u of (byEmail ?? []) as Array<{ id: string; email: string }>) {
          if (u.email) emailToUserId.set(u.email.toLowerCase(), u.id);
        }
      }
      // 氏名逆引きは「この教室の講師一覧」から作る（同名は曖昧なので除外＝schedule.tsと同じ規約）
      const nameToUserId = buildNameIndex(teachers.map((t) => ({ id: t.id, name: t.name })));

      const submissionToUserId = new Map<string, string>();
      for (const s of submissions) {
        if (s.user_id) {
          submissionToUserId.set(s.id, s.user_id);
          continue;
        }
        const byEmail = s.teacher_email
          ? emailToUserId.get(s.teacher_email.toLowerCase())
          : undefined;
        if (byEmail) {
          submissionToUserId.set(s.id, byEmail);
          continue;
        }
        const byName = nameToUserId.get(normalizePersonName(s.teacher_name));
        if (byName) {
          submissionToUserId.set(s.id, byName);
          continue;
        }
        unresolvedTeachers.push(s.teacher_name);
      }
      teacherSubmissionsResolved = submissionToUserId.size;

      // 解決できた提出者ぶんだけ出勤スロットを展開する
      const submissionIds = Array.from(submissionToUserId.keys());
      if (submissionIds.length > 0) {
        const dateSet = new Set(dates);
        const slotRowsAll = await fetchAllInChunks<{
          submission_id: string;
          shift_date: string;
          time_slot: string;
          available: boolean;
        }>(submissionIds, (chunk, from, to) =>
          db
            .from('seasonal_shift_submission_slots')
            .select('submission_id, shift_date, time_slot, available')
            .in('submission_id', chunk)
            .eq('available', true)
            .order('id', { ascending: true })
            .range(from, to)
        );
        teacherSlotRows = slotRowsAll.length;
        for (const row of slotRowsAll) {
          if (!dateSet.has(row.shift_date)) continue;
          const slotId = timeToSlotId.get((row.time_slot ?? '').slice(0, 5));
          if (!slotId) {
            unresolvedTimeSlots++;
            continue;
          }
          const teacherId = submissionToUserId.get(row.submission_id);
          if (!teacherId) continue;
          const key = `${row.shift_date}_${slotId}`;
          const arr = teacherAvailability.get(key);
          if (arr) {
            if (!arr.includes(teacherId)) arr.push(teacherId);
          } else {
            teacherAvailability.set(key, [teacherId]);
          }
        }
      }
    }
  } catch (err) {
    console.error('loadRealAllocatorInput: 講師シフトの取得に失敗（出勤なし扱いで続行）', err);
  }

  // ---- 10. 生徒の出席可能枠（講習可能表 → 通塾日程フォールバック） ----
  const studentAvailability = new Map<string, Set<CellKey>>();
  let studentAvailabilitySource: RealDataNotes['studentAvailabilitySource'] = 'none';

  if (applicantStudentIds.length > 0) {
    try {
      const dateSet = new Set(dates);
      const studentSubRows = await fetchAllInChunks<{ id: string; student_id: string }>(
        applicantStudentIds,
        (chunk, from, to) =>
          db
            .from('seasonal_shift_student_submissions')
            .select('id, student_id')
            .eq('school_id', schoolId)
            .in('student_id', chunk)
            .order('id', { ascending: true })
            .range(from, to)
      );

      if (studentSubRows.length > 0) {
        // 生徒の講習可能表が1件でもあれば優先（buildKoushuPlacementStrip と同じ規約）
        studentAvailabilitySource = 'shift_submission';
        const subIds = studentSubRows.map((r) => r.id);
        const subIdToStudent = new Map(studentSubRows.map((r) => [r.id, r.student_id]));
        const slotsForStudents = await fetchAllInChunks<{
          submission_id: string;
          shift_date: string;
          time_slot: string;
          available: boolean;
        }>(subIds, (chunk, from, to) =>
          db
            .from('seasonal_shift_student_submission_slots')
            .select('submission_id, shift_date, time_slot, available')
            .in('submission_id', chunk)
            .eq('available', true)
            .order('id', { ascending: true })
            .range(from, to)
        );
        for (const row of slotsForStudents) {
          const studentId = subIdToStudent.get(row.submission_id);
          if (!studentId) continue;
          if (!dateSet.has(row.shift_date)) continue;
          const slotId = timeToSlotId.get((row.time_slot ?? '').slice(0, 5));
          if (!slotId) continue;
          const set = studentAvailability.get(studentId) ?? new Set<CellKey>();
          set.add(`${row.shift_date}_${slotId}`);
          studentAvailability.set(studentId, set);
        }
      } else {
        // フォールバック: 通塾日程（個別・有効）を期間の各日付に展開
        studentAvailabilitySource = 'regular_pattern';
        const patterns = await fetchAllInChunks<{
          student_id: string;
          day_of_week: number;
          time_slot_id: string;
          effective_from: string;
          effective_until: string | null;
        }>(applicantStudentIds, (chunk, from, to) =>
          db
            .from('schedule_regular_patterns')
            .select('student_id, day_of_week, time_slot_id, effective_from, effective_until')
            .eq('school_id', schoolId)
            .eq('formation', INDIVIDUAL_FORMATION)
            .eq('is_active', true)
            .in('student_id', chunk)
            .order('id', { ascending: true })
            .range(from, to)
        );
        for (const dateStr of dates) {
          const dow = new Date(dateStr + 'T12:00:00').getDay();
          for (const p of patterns) {
            if (p.day_of_week !== dow) continue;
            if (!slotIdSet.has(p.time_slot_id)) continue;
            if (p.effective_from && p.effective_from > dateStr) continue;
            if (p.effective_until && p.effective_until < dateStr) continue;
            const set = studentAvailability.get(p.student_id) ?? new Set<CellKey>();
            set.add(`${dateStr}_${p.time_slot_id}`);
            studentAvailability.set(p.student_id, set);
          }
        }
      }
    } catch (err) {
      console.error(
        'loadRealAllocatorInput: 生徒の出席可能枠の取得に失敗（枠なし扱いで続行）',
        err
      );
    }
  }
  const studentsWithoutAvailability = applicantStudentIds.filter(
    (id) => !studentAvailability.get(id)?.size
  ).length;

  // ---- 11. 既存配置（公開済み講習・期間内・個別） ----
  let existing: ExistingPlacement[] = [];
  try {
    const existingRows = await fetchAllPaged<{
      student_id: string;
      subject_ids: string[] | null;
      entry_date: string;
      time_slot_id: string;
      teacher_id: string | null;
      ratio: number | null;
      duration_minutes: number | null;
      half_position: 'first' | 'second' | null;
    }>((from, to) =>
      db
        .from('schedule_entries')
        .select(
          'student_id, subject_ids, entry_date, time_slot_id, teacher_id, ratio, duration_minutes, half_position'
        )
        .eq('school_id', schoolId)
        .eq('kind', 'koushu')
        .eq('formation', INDIVIDUAL_FORMATION)
        .gte('entry_date', period.schedule_start_date)
        .lte('entry_date', period.schedule_end_date)
        .in('status', ['scheduled', 'completed', 'transferred_in'])
        .order('id', { ascending: true })
        .range(from, to)
    );
    existing = existingRows
      .filter((row) => !!row.teacher_id && (row.subject_ids ?? []).length > 0)
      .map((row) => ({
        studentId: row.student_id,
        subjectId: (row.subject_ids as string[])[0],
        date: row.entry_date,
        slotId: row.time_slot_id,
        teacherId: row.teacher_id as string,
        ratio: row.ratio === 1 ? 1 : 2,
        duration: row.duration_minutes === 45 ? 45 : 90,
        halfPosition: row.half_position ?? null,
      }));
  } catch (err) {
    console.error('loadRealAllocatorInput: 既存配置の取得に失敗（既存配置なし扱いで続行）', err);
  }

  // ---- 12. 容量（未設定なら既定値） ----
  const capRow = await getClassCapacity(schoolId);
  const capacity = {
    maxStudentsPerTeacher:
      capRow?.max_students_per_teacher_individual ??
      DEFAULT_CLASS_CAPACITY.max_students_per_teacher_individual,
    totalIndividualSeats:
      capRow?.total_individual_seats ?? DEFAULT_CLASS_CAPACITY.total_individual_seats,
  };

  const input: AllocatorInput = {
    dates,
    slots,
    students,
    teachers,
    subjects,
    tasks,
    studentAvailability,
    teacherAvailability,
    capacity,
    existing,
    settings,
  };

  const notes: RealDataNotes = {
    studentsWithApplication: applicantStudentIds.length,
    totalAppliedKoma: Array.from(komaByStudent.values()).reduce((a, b) => a + b, 0),
    teacherSubmissions,
    teacherSubmissionsResolved,
    teacherSlotRows,
    unresolvedTeachers,
    studentAvailabilitySource,
    studentsWithoutAvailability,
    unresolvedTimeSlots,
    subjectAssignmentIsProvisional: true,
  };

  return { input, notes };
}
