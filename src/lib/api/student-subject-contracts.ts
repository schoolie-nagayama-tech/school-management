// 生徒×科目のコース（PS1=1対1・90分 / PS2=1対2・90分 / キッズ=1対2・45分）の読み書き。
//
// ★画面での呼び名は「コース」。テーブル名 student_subject_contracts は本番にあるものをそのまま使う
//   （改名すると移行が要るため）。この対応を知らずに読むとコード上の語がズレて見えるので、ここに書いておく。
//
// このファイルの役割は「コースを正のソースに保つこと」。
// 以前は通塾日程・座席表のフォームが保存のたびに upsertStudentContract でコースを書き戻しており、
// 同じ「英語は1対1」という事実を、曜日を足すたび・版を切るたび・講師を変えるたびに選ばされ、
// そのつど上書きされていた。どこか1回で1対2を選べばコースごと1対2になり、矛盾が残らないので
// 誰も気づけない（他社システムで数か月気づかれなかった事故と同じ構造）。
// そこで upsertStudentContract は廃止し、コースを動かす経路を setStudentCourse 1本に絞って、
// 変更には必ず理由と履歴を残す。授業登録フォームはコースを読むだけにする。
//
// 既存の受講科目リスト student_subjects とは別テーブルのままにしている
// （student_subjects は編集のたび delete-all→re-insert される破壊的置換なので、
//   ここに比率を載せると編集のたびにコースが消える）。

import { supabase } from '@/lib/supabase';
import { isManagerOrAbove } from '@/lib/utils/roles';
import type {
  CourseDuration,
  CourseRatio,
  CourseReasonCode,
  StudentCourse,
} from '@/lib/utils/studentCourse';

// 座席表系テーブルと同じく Database 型未追加のため any でクエリ
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface StudentSubjectContract {
  id: string;
  school_id: string;
  student_id: string;
  subject_id: string;
  ratio: 1 | 2;
  duration_minutes: 45 | 90 | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * コースの取得結果。
 *
 * ★「取得に失敗した」と「まだ設定されていない」を必ず区別する。
 *   以前は失敗時に空の Map を返しており、呼び出し側のフォームが既定 ratio=2 にフォールバックしていた。
 *   つまり通信エラーの生徒が黙って1対2で登録される穴になっていた。
 *   失敗は失敗として返し、フォーム側は入力をブロックする。
 */
export type StudentCourseMapResult =
  | { ok: true; map: Map<string, StudentCourse> }
  | { ok: false; message: string };

function toCourse(row: {
  subject_id: string;
  ratio: number | null;
  duration_minutes: number | null;
  updated_at?: string | null;
}): StudentCourse {
  return {
    subjectId: row.subject_id,
    ratio: row.ratio === 1 ? 1 : 2,
    durationMinutes: row.duration_minutes === 45 ? 45 : row.duration_minutes === 90 ? 90 : null,
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * 生徒の全科目のコースを subject_id → コース のマップで返す。
 * フォームで科目を選んだときに、その科目のコースを引く用途。
 */
export async function getStudentCourseMap(studentId: string): Promise<StudentCourseMapResult> {
  const { data, error } = await db
    .from('student_subject_contracts')
    .select('subject_id, ratio, duration_minutes, updated_at')
    .eq('student_id', studentId);
  if (error) {
    console.error('Error fetching student courses:', error);
    return { ok: false, message: 'コース（PS1／PS2／キッズ）の読み込みに失敗しました' };
  }
  const map = new Map<string, StudentCourse>();
  for (const r of (data ?? []) as Array<{
    subject_id: string;
    ratio: number | null;
    duration_minutes: number | null;
    updated_at: string | null;
  }>) {
    map.set(r.subject_id, toCourse(r));
  }
  return { ok: true, map };
}

/** 生徒詳細の「受講コース」一覧用。科目名も引いて並べる。 */
export interface StudentCourseRow extends StudentCourse {
  id: string;
  subjectName: string;
  updatedBy: string | null;
  updatedByName: string | null;
}

export async function getStudentCourseRows(studentId: string): Promise<StudentCourseRow[]> {
  const { data, error } = await db
    .from('student_subject_contracts')
    .select(
      'id, subject_id, ratio, duration_minutes, updated_at, updated_by, ' +
        'subject:subjects(name, sort_order), updater:user_profiles!student_subject_contracts_updated_by_fkey(display_name)'
    )
    .eq('student_id', studentId);
  if (error) {
    console.error('Error fetching student course rows:', error);
    throw new Error('コース（PS1／PS2／キッズ）の読み込みに失敗しました');
  }
  const rows = (data ?? []) as Array<{
    id: string;
    subject_id: string;
    ratio: number | null;
    duration_minutes: number | null;
    updated_at: string | null;
    updated_by: string | null;
    subject: { name: string; sort_order: number | null } | null;
    updater: { display_name: string | null } | null;
  }>;
  // 科目マスタの並び順に合わせる（同順位は名前順）。科目一覧の見え方と揃える。
  const sortKey = new Map<string, number>();
  const result: StudentCourseRow[] = rows.map((r) => {
    sortKey.set(r.id, r.subject?.sort_order ?? 9999);
    return {
      ...toCourse(r),
      id: r.id,
      subjectName: r.subject?.name ?? '—',
      updatedBy: r.updated_by,
      updatedByName: r.updater?.display_name ?? null,
    };
  });
  return result.sort(
    (a, b) =>
      (sortKey.get(a.id) ?? 9999) - (sortKey.get(b.id) ?? 9999) ||
      a.subjectName.localeCompare(b.subjectName, 'ja')
  );
}

/** コースの変更履歴。 */
export interface CourseChangeRow {
  id: string;
  subjectId: string;
  subjectName: string;
  fromRatio: CourseRatio | null;
  fromDuration: CourseDuration;
  toRatio: CourseRatio;
  toDuration: CourseDuration;
  reasonCode: CourseReasonCode;
  reasonNote: string | null;
  changedByName: string | null;
  changedAt: string;
}

export async function getStudentCourseChanges(studentId: string): Promise<CourseChangeRow[]> {
  const { data, error } = await db
    .from('student_subject_contract_changes')
    .select(
      'id, subject_id, from_ratio, from_duration_minutes, to_ratio, to_duration_minutes, ' +
        'reason_code, reason_note, changed_at, subject:subjects(name), changer:user_profiles(display_name)'
    )
    .eq('student_id', studentId)
    .order('changed_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('Error fetching course changes:', error);
    throw new Error('コースの変更履歴の読み込みに失敗しました');
  }
  const rows = (data ?? []) as Array<{
    id: string;
    subject_id: string;
    from_ratio: number | null;
    from_duration_minutes: number | null;
    to_ratio: number | null;
    to_duration_minutes: number | null;
    reason_code: CourseReasonCode;
    reason_note: string | null;
    changed_at: string;
    subject: { name: string } | null;
    changer: { display_name: string | null } | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    subjectId: r.subject_id,
    subjectName: r.subject?.name ?? '—',
    fromRatio: r.from_ratio === 1 ? 1 : r.from_ratio === 2 ? 2 : null,
    fromDuration: r.from_duration_minutes === 45 ? 45 : r.from_duration_minutes === 90 ? 90 : null,
    toRatio: r.to_ratio === 1 ? 1 : 2,
    toDuration: r.to_duration_minutes === 45 ? 45 : r.to_duration_minutes === 90 ? 90 : null,
    reasonCode: r.reason_code,
    reasonNote: r.reason_note ?? null,
    changedByName: r.changer?.display_name ?? null,
    changedAt: r.changed_at,
  }));
}

export interface SetStudentCourseParams {
  schoolId: string;
  studentId: string;
  subjectId: string;
  ratio: CourseRatio;
  durationMinutes: CourseDuration;
  /** 変更理由。初回登録なら 'initial'。 */
  reasonCode: CourseReasonCode;
  reasonNote?: string | null;
  /** 操作者。履歴に残す。 */
  actorId: string | null | undefined;
  /** 操作者のロール。教室長未満はコースを動かせない。 */
  actorRole: string | null | undefined;
}

/**
 * コースを登録・変更する唯一の入口。必ず履歴を1行積む。
 *
 * ★ロールの確認をここで行う理由:
 *   RLS は check_school_access(school_id) で自校スコープの境界しか引いていない
 *   （既存のポリシーと流儀を揃えるため、RLS 側でロールまでは見ない）。
 *   クライアントから supabase を直接叩く構成なので、UI でボタンを隠すだけだと
 *   境界が画面表示だけになる。ここで弾いて、経路を1本に保つ。
 *
 * 値が現在と同じなら何もしない（履歴を無意味に増やさない）。
 */
export async function setStudentCourse(params: SetStudentCourseParams): Promise<void> {
  const {
    schoolId,
    studentId,
    subjectId,
    ratio,
    durationMinutes,
    reasonCode,
    reasonNote,
    actorId,
    actorRole,
  } = params;

  if (!isManagerOrAbove(actorRole)) {
    throw new Error('コース（PS1／PS2／キッズ）を変更できるのは教室長以上です');
  }

  // 現在の値を読む。履歴の from に入れるのと、変更なしを弾くのに使う。
  const { data: existing, error: readError } = await db
    .from('student_subject_contracts')
    .select('id, ratio, duration_minutes')
    .eq('student_id', studentId)
    .eq('subject_id', subjectId)
    .maybeSingle();
  if (readError) {
    console.error('Error reading current course:', readError);
    throw new Error('現在のコースの読み込みに失敗しました');
  }

  const current = existing as {
    id: string;
    ratio: number | null;
    duration_minutes: number | null;
  } | null;
  const fromRatio = current ? (current.ratio === 1 ? 1 : 2) : null;
  const fromDuration = current
    ? current.duration_minutes === 45
      ? 45
      : current.duration_minutes === 90
        ? 90
        : null
    : null;

  if (current && fromRatio === ratio && fromDuration === durationMinutes) {
    return; // 変更なし
  }

  // 初回登録か変更かを、呼び出し側の申告ではなく実データで決める
  // （フォームが 'initial' を渡してきても、既にコースがあるなら訂正として記録する）。
  const effectiveReason: CourseReasonCode = current
    ? reasonCode === 'initial'
      ? 'correction'
      : reasonCode
    : 'initial';

  const { error: upsertError } = await db.from('student_subject_contracts').upsert(
    {
      school_id: schoolId,
      student_id: studentId,
      subject_id: subjectId,
      ratio,
      duration_minutes: durationMinutes,
      updated_by: actorId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,subject_id' }
  );
  if (upsertError) {
    console.error('Error saving student course:', upsertError);
    throw new Error('コース（PS1／PS2／キッズ）の保存に失敗しました');
  }

  // 履歴。ここが失敗してもコース自体は保存済みなので、登録を巻き戻さず警告に留める
  // （履歴の欠落より、コースが入らないほうが運用上の影響が大きい）。
  const { error: logError } = await db.from('student_subject_contract_changes').insert({
    school_id: schoolId,
    student_id: studentId,
    subject_id: subjectId,
    from_ratio: fromRatio,
    from_duration_minutes: fromDuration,
    to_ratio: ratio,
    to_duration_minutes: durationMinutes,
    reason_code: effectiveReason,
    reason_note: reasonNote?.trim() || null,
    changed_by: actorId ?? null,
  });
  if (logError) {
    console.warn('コースの変更履歴の記録に失敗しました:', logError);
  }
}
