import { supabase } from '../supabase';
import type { TrainingMaster } from '@/types/database';

// Database 型にまだ含まれていないため any キャストで参照
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface TrainingMasterInput {
  name: string;
  period_label?: string | null;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export type TrainingMasterPatch = Partial<TrainingMasterInput>;

/**
 * 研修マスタ一覧を取得
 * @param activeOnly true の場合は is_active=true のみ返す
 */
export async function getTrainingMasters(
  activeOnly = false
): Promise<TrainingMaster[]> {
  let query = db
    .from('training_masters')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`研修マスタの取得に失敗しました: ${error.message}`);
  }
  return (data || []) as TrainingMaster[];
}

export async function createTrainingMaster(
  input: TrainingMasterInput
): Promise<TrainingMaster> {
  const payload = {
    name: input.name,
    period_label: input.period_label ?? null,
    description: input.description ?? null,
    sort_order: input.sort_order ?? 0,
    is_active: input.is_active ?? true,
  };
  const { data, error } = await db
    .from('training_masters')
    .insert(payload)
    .select()
    .single();
  if (error) {
    throw new Error(`研修マスタの登録に失敗しました: ${error.message}`);
  }
  return data as TrainingMaster;
}

export async function updateTrainingMaster(
  id: string,
  patch: TrainingMasterPatch
): Promise<TrainingMaster> {
  const { data, error } = await db
    .from('training_masters')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    throw new Error(`研修マスタの更新に失敗しました: ${error.message}`);
  }
  return data as TrainingMaster;
}

export async function deleteTrainingMaster(id: string): Promise<void> {
  const { error } = await db.from('training_masters').delete().eq('id', id);
  if (error) {
    throw new Error(`研修マスタの削除に失敗しました: ${error.message}`);
  }
}
