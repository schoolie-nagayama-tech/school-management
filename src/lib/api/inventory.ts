import { supabase } from '../supabase';
import type {
  Material,
  MaterialInsert,
  MaterialUpdate,
  MaterialStockTransaction,
  MaterialStockTransactionInsert,
} from '@/types/database';
import { getDefaultSchoolId } from './schools';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

/**
 * 教材一覧を取得
 */
export async function getMaterials(
  schoolIds?: string | string[],
  includeInactive: boolean = false
): Promise<Material[]> {
  const targetSchoolIds = Array.isArray(schoolIds)
    ? schoolIds
    : schoolIds
    ? [schoolIds]
    : [getDefaultSchoolId()];

  let query = supabase
    .from('materials')
    .select('*')
    .in('school_id', targetSchoolIds)
    .order('name', { ascending: true });

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(getUserErrorMessage(error, '教材の取得に失敗しました'));
  }

  return (data || []) as Material[];
}

/**
 * 教材を作成
 */
export async function createMaterial(
  item: Omit<MaterialInsert, 'school_id'>,
  schoolId?: string
): Promise<Material> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  const { data, error } = await supabase
    .from('materials')
    .insert({
      ...item,
      school_id: targetSchoolId,
      unit: item.unit || '冊',
      stock_quantity: item.stock_quantity ?? 0,
      low_stock_threshold: item.low_stock_threshold ?? 5,
      is_active: item.is_active ?? true,
    })
    .select()
    .single();

  if (error) {
    throw new Error(getUserErrorMessage(error, '教材の作成に失敗しました'));
  }

  return data as Material;
}

/**
 * 教材を更新
 */
export async function updateMaterial(
  id: string,
  updates: MaterialUpdate
): Promise<Material> {
  const { data, error } = await supabase
    .from('materials')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(getUserErrorMessage(error, '教材の更新に失敗しました'));
  }

  return data as Material;
}

/**
 * 教材を削除
 */
export async function deleteMaterial(id: string): Promise<void> {
  const { error } = await supabase
    .from('materials')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(getUserErrorMessage(error, '教材の削除に失敗しました'));
  }
}

/**
 * 在庫トランザクション一覧を取得
 */
export async function getStockTransactions(
  materialId: string,
  options?: { limit?: number }
): Promise<MaterialStockTransaction[]> {
  let query = supabase
    .from('material_stock_transactions')
    .select('*')
    .eq('material_id', materialId)
    .order('created_at', { ascending: false });

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(getUserErrorMessage(error, '在庫履歴の取得に失敗しました'));
  }

  return (data || []) as MaterialStockTransaction[];
}

/**
 * 在庫トランザクションを作成し、教材の在庫数を更新する
 *
 * transaction_type:
 * - 'in': 入庫（quantity を加算）
 * - 'out': 出庫（quantity を減算、quantity は正の値で指定）
 * - 'adjust': 調整（quantity が新しい在庫数になる）
 */
export async function createStockTransaction(
  txn: MaterialStockTransactionInsert
): Promise<MaterialStockTransaction> {
  // 1. トランザクションを挿入
  const { data: txnData, error: txnError } = await supabase
    .from('material_stock_transactions')
    .insert(txn)
    .select()
    .single();

  if (txnError) {
    throw new Error(getUserErrorMessage(txnError, '在庫トランザクションの作成に失敗しました'));
  }

  // 2. 現在の在庫数を取得
  const { data: material, error: materialError } = await supabase
    .from('materials')
    .select('stock_quantity')
    .eq('id', txn.material_id)
    .single();

  if (materialError || !material) {
    throw new Error(getUserErrorMessage(materialError, '教材の取得に失敗しました'));
  }

  // 3. 新しい在庫数を計算
  let newQuantity: number;
  const currentQuantity = (material as { stock_quantity: number }).stock_quantity;

  switch (txn.transaction_type) {
    case 'in':
      newQuantity = currentQuantity + txn.quantity;
      break;
    case 'out':
      newQuantity = currentQuantity - txn.quantity;
      break;
    case 'adjust':
      newQuantity = txn.quantity;
      break;
    default:
      newQuantity = currentQuantity;
  }

  // 4. 在庫数を更新
  const { error: updateError } = await supabase
    .from('materials')
    .update({
      stock_quantity: newQuantity,
      updated_at: new Date().toISOString(),
    })
    .eq('id', txn.material_id);

  if (updateError) {
    throw new Error(getUserErrorMessage(updateError, '在庫数の更新に失敗しました'));
  }

  return txnData as MaterialStockTransaction;
}

/**
 * 在庫不足教材を取得（stock_quantity < low_stock_threshold の教材）
 */
export async function getLowStockMaterials(
  schoolIds?: string | string[]
): Promise<Material[]> {
  const targetSchoolIds = Array.isArray(schoolIds)
    ? schoolIds
    : schoolIds
    ? [schoolIds]
    : [getDefaultSchoolId()];

  // Supabase では stock_quantity < low_stock_threshold を直接フィルタリングできないため、
  // 全件取得後にクライアント側でフィルタリング
  const { data, error } = await supabase
    .from('materials')
    .select('*')
    .in('school_id', targetSchoolIds)
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) {
    throw new Error(getUserErrorMessage(error, '在庫不足教材の取得に失敗しました'));
  }

  return ((data || []) as Material[]).filter(
    (m) => m.stock_quantity < m.low_stock_threshold
  );
}
