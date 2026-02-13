import { supabase } from '@/lib/supabase';

export interface SystemSetting {
  id: string;
  key: string;
  value: string;
  description: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
}

let settingsCache: { category: string; data: SystemSetting[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // 1分

/**
 * システム設定を取得（categoryでフィルタ可能）
 */
export async function getSystemSettings(category?: string): Promise<SystemSetting[]> {
  const cacheKey = category ?? '_all';
  if (settingsCache && settingsCache.category === cacheKey && Date.now() < settingsCache.expiresAt) {
    return settingsCache.data;
  }

  let query = supabase.from('system_settings').select('*');

  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching system settings:', error);
    throw new Error('システム設定の取得に失敗しました');
  }

  const result = (data || []) as SystemSetting[];
  settingsCache = { category: cacheKey, data: result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
}

/**
 * システム設定を更新
 */
export async function updateSystemSetting(key: string, value: string): Promise<SystemSetting> {
  const { data, error } = await supabase
    .from('system_settings')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', key)
    .select()
    .single();

  if (error) {
    console.error('Error updating system setting:', error);
    throw new Error(`システム設定の更新に失敗しました: ${error.message}`);
  }

  // キャッシュ無効化
  settingsCache = null;

  return data as SystemSetting;
}

/**
 * キャッシュを無効化（設定変更後に呼び出す）
 */
export function invalidateSystemSettingsCache(): void {
  settingsCache = null;
}
