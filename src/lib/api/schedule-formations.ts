import { supabase } from '@/lib/supabase';
import { GROUP_FORMATION } from '@/types/schedule';
import type { ScheduleFormation, SchoolFormationCapacity } from '@/types/schedule';

// schedule_formations / school_formation_capacity は Database 型（自動生成）に未反映のため any でクエリする。
// 既存の schedule.ts と同じ流儀（型は @/types/schedule 側で手当てする）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ========================================
// 指導形態マスタ（schedule_formations）
// ========================================

/**
 * 形態一覧を sort_order 順で取得。
 * includeInactive=false（既定）では is_active=true のみ返す（タブ描画用）。
 * 設定画面など無効形態も見せたい場面では includeInactive=true を渡す。
 */
export async function getFormations(includeInactive = false): Promise<ScheduleFormation[]> {
  let q = db.from('schedule_formations').select('*');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    console.error('Error fetching formations:', error);
    throw new Error('指導形態の取得に失敗しました');
  }
  return (data || []) as ScheduleFormation[];
}

/** 'f_' + ランダム8文字英数のキー候補を生成（ユーザーには入力させない） */
function randomFormationKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `f_${s}`;
}

/**
 * 形態を新規作成。
 * - key はユーザーに入力させず自動生成（衝突したら数回リトライ）。ユーザーが触るのは label のみ。
 * - lane_type は当面 'group' 固定（1講師N名型。個別グリッド型を増やす需要が出たら解禁）。
 * - sort_order は既存の末尾（最大+1）に付ける。
 */
export async function createFormation(label: string): Promise<ScheduleFormation> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('形態名を入力してください');

  // 末尾 sort_order を算出（無効形態も含めて最大値の次に置く）
  const { data: maxRows } = await db
    .from('schedule_formations')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  const nextOrder = ((maxRows?.[0] as { sort_order?: number } | undefined)?.sort_order ?? 0) + 1;

  // key 自動生成＋衝突リトライ（PK 重複=23505 のときだけ別キーで再試行）
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = randomFormationKey();
    const { data, error } = await db
      .from('schedule_formations')
      .insert({
        key,
        label: trimmed,
        lane_type: GROUP_FORMATION,
        is_system: false,
        is_active: true,
        sort_order: nextOrder,
      })
      .select()
      .single();
    if (!error) return data as ScheduleFormation;
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: string }).code)
        : '';
    // PK 衝突なら別キーで再試行、それ以外は即エラー
    if (code !== '23505') {
      console.error('Error creating formation:', error);
      throw new Error('指導形態の作成に失敗しました');
    }
  }
  throw new Error('指導形態の作成に失敗しました（キーの生成に繰り返し失敗）');
}

/** is_system の形態（individual/group）は改名・削除・無効化できないので事前に弾く共通ガード */
async function ensureNotSystemFormation(key: string): Promise<void> {
  const { data, error } = await db
    .from('schedule_formations')
    .select('is_system')
    .eq('key', key)
    .maybeSingle();
  if (error) {
    console.error('Error checking formation:', error);
    throw new Error('指導形態の確認に失敗しました');
  }
  if (!data) throw new Error('指導形態が見つかりません');
  if ((data as { is_system: boolean }).is_system) {
    throw new Error('個別・集団は既定の形態のため、変更・削除できません');
  }
}

/** 形態を改名。is_system（個別/集団）は改名不可。 */
export async function renameFormation(key: string, label: string): Promise<ScheduleFormation> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('形態名を入力してください');
  await ensureNotSystemFormation(key);
  const { data, error } = await db
    .from('schedule_formations')
    .update({ label: trimmed })
    .eq('key', key)
    .select()
    .single();
  if (error) {
    console.error('Error renaming formation:', error);
    throw new Error('指導形態の改名に失敗しました');
  }
  return data as ScheduleFormation;
}

/**
 * 形態の有効/無効を切り替える（ソフト削除）。
 * is_system も無効化してはいけない（個別=メイングリッド、集団=講習レーンが依存するため）。
 */
export async function setFormationActive(
  key: string,
  isActive: boolean
): Promise<ScheduleFormation> {
  await ensureNotSystemFormation(key);
  const { data, error } = await db
    .from('schedule_formations')
    .update({ is_active: isActive })
    .eq('key', key)
    .select()
    .single();
  if (error) {
    console.error('Error toggling formation active:', error);
    throw new Error('指導形態の有効・無効の切り替えに失敗しました');
  }
  return data as ScheduleFormation;
}

/**
 * 形態の並び順（sort_order）を更新。
 * 改名・無効化・削除とは異なり、並び替えは individual/group（is_system）にも許可する
 * ので、他の更新系と違いここだけ ensureNotSystemFormation ガードを掛けない。
 */
export async function updateFormationOrder(
  key: string,
  sortOrder: number
): Promise<ScheduleFormation> {
  const { data, error } = await db
    .from('schedule_formations')
    .update({ sort_order: sortOrder })
    .eq('key', key)
    .select()
    .single();
  if (error) {
    console.error('Error updating formation order:', error);
    throw new Error('指導形態の並び替えに失敗しました');
  }
  return data as ScheduleFormation;
}

/**
 * 形態を物理削除。
 * - is_system は削除不可。
 * - 参照データ（コマ時間・パターン・エントリ等）があると FK RESTRICT で弾かれる（23503）。
 *   ユーザーには「無効化してください」というフレンドリーな案内に変換する。
 */
export async function deleteFormation(key: string): Promise<void> {
  await ensureNotSystemFormation(key);
  const { error } = await db.from('schedule_formations').delete().eq('key', key);
  if (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: string }).code)
        : '';
    // 23503 = foreign_key_violation（RESTRICT）。使用中のため削除できない。
    if (code === '23503') {
      throw new Error('この指導形態は使用中のため削除できません。無効化してください。');
    }
    console.error('Error deleting formation:', error);
    throw new Error('指導形態の削除に失敗しました');
  }
}

// ========================================
// 形態別定員（school_formation_capacity）
// ========================================

/** 教室×形態の定員設定を取得（未設定なら null）。 */
export async function getFormationCapacity(
  schoolId: string,
  formation: string
): Promise<SchoolFormationCapacity | null> {
  const { data, error } = await db
    .from('school_formation_capacity')
    .select('*')
    .eq('school_id', schoolId)
    .eq('formation', formation)
    .maybeSingle();
  if (error) {
    console.error('Error fetching formation capacity:', error);
    throw new Error('形態別定員の取得に失敗しました');
  }
  return (data as SchoolFormationCapacity) ?? null;
}

/** 教室の全形態の定員設定をまとめて取得（設定画面の一覧用）。 */
export async function getFormationCapacities(schoolId: string): Promise<SchoolFormationCapacity[]> {
  const { data, error } = await db
    .from('school_formation_capacity')
    .select('*')
    .eq('school_id', schoolId);
  if (error) {
    console.error('Error fetching formation capacities:', error);
    throw new Error('形態別定員の取得に失敗しました');
  }
  return (data || []) as SchoolFormationCapacity[];
}

/**
 * 教室×形態の定員設定を upsert。
 * UNIQUE(school_id, formation) を競合キーにして、あれば更新・なければ挿入する。
 */
export async function upsertFormationCapacity(
  schoolId: string,
  formation: string,
  values: { max_students_per_group: number; max_concurrent_groups: number }
): Promise<SchoolFormationCapacity> {
  const { data, error } = await db
    .from('school_formation_capacity')
    .upsert(
      {
        school_id: schoolId,
        formation,
        max_students_per_group: values.max_students_per_group,
        max_concurrent_groups: values.max_concurrent_groups,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'school_id,formation' }
    )
    .select()
    .single();
  if (error) {
    console.error('Error upserting formation capacity:', error);
    throw new Error('形態別定員の保存に失敗しました');
  }
  return data as SchoolFormationCapacity;
}
