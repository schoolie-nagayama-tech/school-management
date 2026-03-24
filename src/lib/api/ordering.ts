import { supabase } from '../supabase';
import type {
  MaterialOrder,
  MaterialOrderWithDetails,
  OrderStatus,
  BillingItem,
} from '@/types/database';
import { getDefaultSchoolId } from './schools';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { createBillingItem, toggleStudentBilling } from '@/lib/api/billing';
import { createStockTransaction } from '@/lib/api/inventory';

interface OrderFilters {
  status?: string;
  materialId?: string;
  studentId?: string;
  search?: string;
}

/**
 * 発注一覧を取得（教材・生徒情報付き）
 */
export async function getOrders(
  schoolIds?: string | string[],
  filters?: OrderFilters
): Promise<MaterialOrderWithDetails[]> {
  const targetSchoolIds = Array.isArray(schoolIds)
    ? schoolIds
    : schoolIds
    ? [schoolIds]
    : [getDefaultSchoolId()];

  let query = supabase
    .from('material_orders')
    .select('*, material:materials(*), student:students(id, last_name, first_name, grade)')
    .in('school_id', targetSchoolIds)
    .order('created_at', { ascending: false });

  // ステータスフィルター
  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status as OrderStatus);
  }

  // 教材フィルター
  if (filters?.materialId) {
    query = query.eq('material_id', filters.materialId);
  }

  // 生徒フィルター
  if (filters?.studentId) {
    query = query.eq('student_id', filters.studentId);
  }

  const { data, error } = await query;

  if (error) {
    // テーブルが存在しない場合は空配列を返す
    if (error.code === 'PGRST116' || error.code === '42501' || error.message.includes('schema cache')) {
      console.warn('material_ordersテーブルの取得に失敗しました（無視します）:', error);
      return [];
    }
    throw new Error(getUserErrorMessage(error, '発注一覧の取得に失敗しました'));
  }

  let results = (data || []) as MaterialOrderWithDetails[];

  // 検索フィルター（生徒名）
  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    results = results.filter((order) => {
      if (!order.student) return false;
      const studentName = `${order.student.last_name}${order.student.first_name}`;
      return studentName.toLowerCase().includes(searchLower);
    });
  }

  return results;
}

/**
 * 発注を作成
 */
export async function createOrder(
  order: {
    material_id: string;
    student_id: string;
    quantity?: number;
    notes?: string;
  },
  schoolId?: string
): Promise<MaterialOrder> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  const { data, error } = await supabase
    .from('material_orders')
    .insert({
      school_id: targetSchoolId,
      material_id: order.material_id,
      student_id: order.student_id,
      quantity: order.quantity ?? 1,
      status: 'pending' as OrderStatus,
      notes: order.notes || null,
      ordered_at: null,
      delivered_at: null,
      distributed_at: null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(getUserErrorMessage(error, '発注の作成に失敗しました'));
  }

  return data as MaterialOrder;
}

/**
 * 発注を作成し、請求項目・生徒請求も自動作成する
 */
export async function createOrderWithBilling(
  order: { material_id: string; student_id: string; quantity?: number; notes?: string },
  billingPeriodId: string,
  schoolId?: string
): Promise<{ order: MaterialOrder; billingItem: BillingItem | null }> {
  // 1. 発注を作成
  const createdOrder = await createOrder(order, schoolId);

  let billingItem: BillingItem | null = null;

  try {
    // 2. 教材名を取得
    const { data: material, error: materialError } = await supabase
      .from('materials')
      .select('name')
      .eq('id', order.material_id)
      .single();

    if (materialError || !material) {
      console.warn('教材名の取得に失敗しました（請求連携をスキップ）:', materialError);
      return { order: createdOrder, billingItem: null };
    }

    // 3. 請求項目を作成
    billingItem = await createBillingItem(
      {
        billing_period_id: billingPeriodId,
        name: material.name,
        source_type: 'order',
      },
      schoolId
    );

    // 3b. source_order_id を設定（createBillingItem では設定されないため直接更新）
    await supabase
      .from('billing_items')
      .update({ source_order_id: createdOrder.id })
      .eq('id', billingItem.id);

    // 4. 生徒請求エントリを作成
    await toggleStudentBilling(
      order.student_id,
      billingItem.id,
      true,
      schoolId
    );
  } catch (error) {
    // 請求連携に失敗しても発注自体は成功として返す
    console.error('請求連携に失敗しました:', error);
  }

  return { order: createdOrder, billingItem };
}

/**
 * 発注ステータスを更新
 */
export async function updateOrderStatus(
  id: string,
  status: OrderStatus
): Promise<MaterialOrder> {
  const now = new Date().toISOString();

  // 在庫連携のため、先に発注情報を取得
  const { data: existingOrder, error: fetchError } = await supabase
    .from('material_orders')
    .select('material_id, student_id, quantity, school_id')
    .eq('id', id)
    .single();

  if (fetchError || !existingOrder) {
    throw new Error(getUserErrorMessage(fetchError, '発注情報の取得に失敗しました'));
  }

  const updates: Record<string, unknown> = {
    status,
    updated_at: now,
  };

  // ステータスに応じてタイムスタンプを設定
  if (status === 'ordered') {
    updates.ordered_at = now;
  } else if (status === 'delivered') {
    updates.delivered_at = now;
  } else if (status === 'distributed') {
    updates.distributed_at = now;
  }

  const { data, error } = await supabase
    .from('material_orders')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(getUserErrorMessage(error, '発注ステータスの更新に失敗しました'));
  }

  // 在庫トランザクションを自動作成
  try {
    if (status === 'delivered') {
      // 納品時: 入庫
      await createStockTransaction({
        school_id: existingOrder.school_id,
        material_id: existingOrder.material_id,
        transaction_type: 'in',
        quantity: existingOrder.quantity,
        reason: '発注納品',
        related_order_id: id,
        related_student_id: null,
      });
    } else if (status === 'distributed') {
      // 配布時: 出庫
      await createStockTransaction({
        school_id: existingOrder.school_id,
        material_id: existingOrder.material_id,
        transaction_type: 'out',
        quantity: existingOrder.quantity,
        reason: '生徒配布',
        related_order_id: id,
        related_student_id: existingOrder.student_id,
      });
    }
  } catch (stockError) {
    // 在庫連携に失敗してもステータス更新自体は成功として返す
    console.error('在庫トランザクションの自動作成に失敗しました:', stockError);
  }

  return data as MaterialOrder;
}

/**
 * 発注を削除（pendingのみ）
 */
export async function deleteOrder(id: string): Promise<void> {
  const { error } = await supabase
    .from('material_orders')
    .delete()
    .eq('id', id)
    .eq('status', 'pending');

  if (error) {
    throw new Error(getUserErrorMessage(error, '発注の削除に失敗しました'));
  }
}

/**
 * 一括発注作成
 */
export async function createBulkOrders(
  orders: Array<{
    material_id: string;
    student_id: string;
    quantity?: number;
  }>,
  schoolId?: string
): Promise<MaterialOrder[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  const inserts = orders.map((order) => ({
    school_id: targetSchoolId,
    material_id: order.material_id,
    student_id: order.student_id,
    quantity: order.quantity ?? 1,
    status: 'pending' as OrderStatus,
    notes: null,
    ordered_at: null,
    delivered_at: null,
    distributed_at: null,
  }));

  const { data, error } = await supabase
    .from('material_orders')
    .insert(inserts)
    .select();

  if (error) {
    throw new Error(getUserErrorMessage(error, '一括発注の作成に失敗しました'));
  }

  return (data || []) as MaterialOrder[];
}
