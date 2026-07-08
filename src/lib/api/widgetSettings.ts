import { supabase } from '../supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/** ダッシュボード系ウィジェットの表示ON/OFF識別子（教室単位設定） */
export type WidgetKey = 'course_progress_summary';

export const WIDGET_KEY_LABELS: Record<WidgetKey, string> = {
  course_progress_summary: '生徒管理ページの講習進捗サマリー',
};

export const WIDGET_KEY_DESCRIPTIONS: Record<WidgetKey, string> = {
  course_progress_summary:
    '生徒管理ページ上部に表示される「講習進捗」の数値まとめ（PCS回収・面談申込・増コマ等）。',
};

const ALL_WIDGET_KEYS: WidgetKey[] = ['course_progress_summary'];

type WidgetSettingRow = {
  school_id: string;
  widget_key: string;
  enabled: boolean;
};

/** 教室ごとのウィジェット設定を取得（未保存のキーはデフォルト=表示中で補完） */
export async function getWidgetSettings(schoolId: string): Promise<Record<WidgetKey, boolean>> {
  const { data, error } = await (supabase.from('school_widget_settings' as never) as any)
    .select('school_id, widget_key, enabled')
    .eq('school_id', schoolId);

  if (error) {
    if (error.code === 'PGRST116' || (error.message ?? '').includes('schema cache')) {
      return buildDefaults();
    }
    throw new Error(`ウィジェット設定の取得に失敗しました: ${error.message}`);
  }

  const map = buildDefaults();
  for (const row of (data ?? []) as WidgetSettingRow[]) {
    map[row.widget_key as WidgetKey] = row.enabled;
  }
  return map;
}

/**
 * 複数教室分のウィジェット設定を一括取得し、指定キーが有効な教室IDだけを返す。
 * 未設定の教室は「表示中」扱い（デフォルト有効）。
 *
 * @param client - RLS 認証済みのサーバークライアント（省略時はブラウザシングルトン）
 */
export async function getEnabledSchoolIdsForWidget(
  schoolIds: string[],
  widgetKey: WidgetKey,
  client: SupabaseClient<Database> = supabase
): Promise<Set<string>> {
  if (schoolIds.length === 0) return new Set();
  const { data, error } = await (client.from('school_widget_settings' as never) as any)
    .select('school_id, widget_key, enabled')
    .in('school_id', schoolIds)
    .eq('widget_key', widgetKey);

  if (error && !(error.code === 'PGRST116' || (error.message ?? '').includes('schema cache'))) {
    throw new Error(`ウィジェット設定の取得に失敗しました: ${error.message}`);
  }

  const disabled = new Set(
    ((data ?? []) as WidgetSettingRow[]).filter((row) => !row.enabled).map((row) => row.school_id)
  );
  return new Set(schoolIds.filter((id) => !disabled.has(id)));
}

/** 設定を upsert */
export async function upsertWidgetSetting(
  schoolId: string,
  widgetKey: WidgetKey,
  enabled: boolean
): Promise<void> {
  const { error } = await (supabase.from('school_widget_settings' as never) as any).upsert(
    {
      school_id: schoolId,
      widget_key: widgetKey,
      enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'school_id,widget_key' }
  );
  if (error) {
    throw new Error(`ウィジェット設定の保存に失敗しました: ${error.message}`);
  }
}

function buildDefaults(): Record<WidgetKey, boolean> {
  const map = {} as Record<WidgetKey, boolean>;
  for (const key of ALL_WIDGET_KEYS) map[key] = true;
  return map;
}
