/**
 * 問合せ管理 — 教室別発送/メール設定 API層。
 * 対象テーブル: inquiry_school_settings (school_id が PK)
 */

import { supabase } from '../supabase';
import type { InquirySchoolSettings, InquirySchoolSettingsInsert } from '@/types/database';

/**
 * 複数教室の発送/メール設定を一括取得する。
 * 存在しない教室の設定は返さない(呼び出し側で欠損を処理する)。
 *
 * @param schoolIds 取得対象の school_id 一覧
 */
export async function getAllInquirySchoolSettings(
  schoolIds: string[]
): Promise<InquirySchoolSettings[]> {
  if (schoolIds.length === 0) return [];

  const { data, error } = await supabase
    .from('inquiry_school_settings')
    .select('*')
    .in('school_id', schoolIds);

  if (error) {
    throw new Error(`発送設定の取得に失敗しました: ${error.message}`);
  }

  return (data ?? []) as InquirySchoolSettings[];
}

/**
 * 教室の発送/メール設定を upsert する。
 * 同一 school_id が既存の場合は UPDATE、なければ INSERT。
 *
 * @param data InquirySchoolSettingsInsert (school_id 必須)
 */
export async function upsertInquirySchoolSettings(
  data: InquirySchoolSettingsInsert
): Promise<InquirySchoolSettings> {
  const { data: upserted, error } = await supabase
    .from('inquiry_school_settings')
    .upsert(data, { onConflict: 'school_id' })
    .select()
    .single();

  if (error) {
    throw new Error(`発送設定の保存に失敗しました: ${error.message}`);
  }

  return upserted as InquirySchoolSettings;
}
