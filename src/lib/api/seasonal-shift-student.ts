/**
 * 生徒版 seasonal-shifts の CRUD API
 *
 * 設計：
 *  - 講師版 (seasonal-shift.ts) と対称構造
 *  - setting は seasonal_shift_settings を共通流用（getSeasonalShiftSetting で取得）
 *  - submit 時に既存の submission があれば修正（allow_edit=true 必須）、無ければ新規
 *  - スロットは「全削除 → 全件 insert」の置換方式
 */

import { supabase } from '@/lib/supabase';
import type {
  SeasonalShiftStudentSubmission,
  SeasonalShiftStudentSubmissionSlot,
  StudentSubmissionFormData,
} from '@/types/seasonal-shift-student';
import { randomBytes } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** 指定 setting の生徒提出一覧（室長集計画面用） */
export async function getStudentSubmissions(
  settingId: string
): Promise<SeasonalShiftStudentSubmission[]> {
  const { data, error } = await db
    .from('seasonal_shift_student_submissions')
    .select(
      '*, student:students(id, last_name, first_name, grade), slots:seasonal_shift_student_submission_slots(*)'
    )
    .eq('setting_id', settingId)
    .order('submitted_at', { ascending: false });

  if (error) {
    console.error('Error fetching student submissions:', error);
    throw new Error('生徒提出の取得に失敗しました');
  }
  return (data || []) as SeasonalShiftStudentSubmission[];
}

/** 1件取得 */
export async function getStudentSubmission(
  submissionId: string
): Promise<SeasonalShiftStudentSubmission | null> {
  const { data, error } = await db
    .from('seasonal_shift_student_submissions')
    .select(
      '*, student:students(id, last_name, first_name, grade), slots:seasonal_shift_student_submission_slots(*)'
    )
    .eq('id', submissionId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching student submission:', error);
    throw new Error('生徒提出の取得に失敗しました');
  }
  return (data as SeasonalShiftStudentSubmission) ?? null;
}

/** edit_token で取得（保護者ポータル修正画面用） */
export async function getStudentSubmissionByEditToken(
  token: string
): Promise<SeasonalShiftStudentSubmission | null> {
  const { data, error } = await db
    .from('seasonal_shift_student_submissions')
    .select(
      '*, student:students(id, last_name, first_name, grade), slots:seasonal_shift_student_submission_slots(*)'
    )
    .eq('edit_token', token)
    .eq('allow_edit', true)
    .maybeSingle();

  if (error) {
    console.error('Error fetching submission by token:', error);
    throw new Error('修正リンクが無効です');
  }
  return (data as SeasonalShiftStudentSubmission) ?? null;
}

/**
 * 提出（新規 or 更新）。
 *  - 新規：(setting_id, student_id) で既存無し → 新規 insert
 *  - 更新：既存あり かつ allow_edit=true（または同セットで初回） → 上書き
 */
export async function submitStudentShift(
  schoolId: string,
  form: StudentSubmissionFormData
): Promise<SeasonalShiftStudentSubmission> {
  // 既存確認
  const { data: existingRow } = await db
    .from('seasonal_shift_student_submissions')
    .select('id, allow_edit')
    .eq('setting_id', form.setting_id)
    .eq('student_id', form.student_id)
    .maybeSingle();

  const existing = existingRow as { id: string; allow_edit: boolean } | null;

  let submissionId: string;
  if (existing) {
    // 既存あり：allow_edit が false の場合はエラー（修正許可なし）
    if (!existing.allow_edit) {
      throw new Error('既に提出済みです。修正には室長の許可が必要です。');
    }
    // 上書き
    const { error: updErr } = await db
      .from('seasonal_shift_student_submissions')
      .update({
        submitter_email: form.submitter_email,
        submitter_name: form.submitter_name,
        notes: form.notes || null,
        submitted_at: new Date().toISOString(),
        // 修正後は再度ロックする運用：講師版と揃える
        allow_edit: false,
        edit_token: null,
      })
      .eq('id', existing.id);
    if (updErr) {
      console.error('Error updating student submission:', updErr);
      throw new Error('提出の更新に失敗しました');
    }
    submissionId = existing.id;
  } else {
    // 新規
    const { data, error } = await db
      .from('seasonal_shift_student_submissions')
      .insert({
        setting_id: form.setting_id,
        school_id: schoolId,
        student_id: form.student_id,
        submitter_email: form.submitter_email,
        submitter_name: form.submitter_name,
        notes: form.notes || null,
      })
      .select()
      .single();
    if (error || !data) {
      console.error('Error creating student submission:', error);
      throw new Error('提出に失敗しました');
    }
    submissionId = (data as { id: string }).id;
  }

  // スロットを全置換
  await db
    .from('seasonal_shift_student_submission_slots')
    .delete()
    .eq('submission_id', submissionId);
  if (form.selected_slots.length > 0) {
    const rows = form.selected_slots.map((s) => ({
      submission_id: submissionId,
      shift_date: s.shift_date,
      time_slot: s.time_slot,
      available: true,
    }));
    const { error: insErr } = await db
      .from('seasonal_shift_student_submission_slots')
      .insert(rows);
    if (insErr) {
      console.error('Error inserting slots:', insErr);
      throw new Error('スロット保存に失敗しました');
    }
  }

  const result = await getStudentSubmission(submissionId);
  if (!result) throw new Error('保存後の取得に失敗しました');
  return result;
}

/** 室長による「修正許可」発行：edit_token を生成して allow_edit=true に */
export async function grantStudentSubmissionEdit(
  submissionId: string
): Promise<string> {
  const token = randomBytes(24).toString('hex');
  const { error } = await db
    .from('seasonal_shift_student_submissions')
    .update({ allow_edit: true, edit_token: token })
    .eq('id', submissionId);
  if (error) {
    console.error('Error granting edit:', error);
    throw new Error('修正許可の発行に失敗しました');
  }
  return token;
}

/** 室長による「マッチング消化済み」フラグ切替 */
export async function setStudentSubmissionMatchingConsumed(
  submissionId: string,
  consumed: boolean
): Promise<void> {
  const { error } = await db
    .from('seasonal_shift_student_submissions')
    .update({ matching_consumed: consumed })
    .eq('id', submissionId);
  if (error) {
    console.error('Error updating matching_consumed:', error);
    throw new Error('フラグ更新に失敗しました');
  }
}

/** 提出削除（誤提出対応） */
export async function deleteStudentSubmission(submissionId: string): Promise<void> {
  const { error } = await db
    .from('seasonal_shift_student_submissions')
    .delete()
    .eq('id', submissionId);
  if (error) {
    console.error('Error deleting submission:', error);
    throw new Error('提出の削除に失敗しました');
  }
}

/**
 * 集計：日付×時間帯ごとに「通えると答えた生徒の人数」
 */
export async function aggregateStudentAvailability(
  settingId: string
): Promise<Map<string, number>> {
  // 全 submission の全スロットを取得して集計
  const { data, error } = await db
    .from('seasonal_shift_student_submissions')
    .select('id, slots:seasonal_shift_student_submission_slots(shift_date, time_slot, available)')
    .eq('setting_id', settingId);
  if (error) {
    console.error('Error aggregating availability:', error);
    throw new Error('集計に失敗しました');
  }

  const counts = new Map<string, number>();
  for (const row of (data || []) as Array<{
    id: string;
    slots?: { shift_date: string; time_slot: string; available: boolean }[];
  }>) {
    for (const s of row.slots ?? []) {
      if (!s.available) continue;
      const key = `${s.shift_date}|${s.time_slot}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

export type {
  SeasonalShiftStudentSubmission,
  SeasonalShiftStudentSubmissionSlot,
  StudentSubmissionFormData,
};
