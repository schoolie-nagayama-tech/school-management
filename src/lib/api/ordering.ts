import { supabase } from '../supabase';
import type {
  MaterialOrder,
  MaterialOrderWithDetails,
  OrderStatus,
  BillingItem,
} from '@/types/database';
import { getDefaultSchoolId } from './schools';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { createBillingItem } from '@/lib/api/billing';
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
      status: 'unconfirmed' as OrderStatus,
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
 * 発注を作成し、「教材発注」請求項目の生徒セルに教材名を自動反映する
 */
export async function createOrderWithBilling(
  order: { material_id: string; student_id: string; quantity?: number; notes?: string },
  billingPeriodId: string,
  schoolId?: string
): Promise<{ order: MaterialOrder; billingItem: BillingItem | null }> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

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

    // 3. 「教材発注」請求項目を検索（source_type='order' のもの）
    const { data: existingItem } = await supabase
      .from('billing_items')
      .select('*')
      .eq('billing_period_id', billingPeriodId)
      .eq('school_id', targetSchoolId)
      .eq('source_type', 'order')
      .maybeSingle();

    if (!existingItem) {
      // 「教材発注」項目がまだない場合は新規作成
      billingItem = await createBillingItem(
        {
          billing_period_id: billingPeriodId,
          name: '教材発注',
          source_type: 'order',
          value_type: 'text',
        },
        schoolId
      );
    } else {
      billingItem = existingItem as BillingItem;
    }

    // 4. この生徒の全発注から教材名を収集
    const { data: periodData } = await supabase
      .from('billing_periods')
      .select('start_date, end_date')
      .eq('id', billingPeriodId)
      .single();

    const startDate = periodData?.start_date || '';
    const endDate = periodData?.end_date || '';

    const { data: studentOrders } = await supabase
      .from('material_orders')
      .select('material_id, materials(name)')
      .eq('student_id', order.student_id)
      .eq('school_id', targetSchoolId)
      .neq('status', 'cancelled')
      .gte('created_at', startDate)
      .lte('created_at', endDate + 'T23:59:59');

    // 教材名をユニークに収集
    const textbookNames: string[] = [];
    for (const o of studentOrders || []) {
      const name = (o as Record<string, unknown>).materials
        ? ((o as Record<string, unknown>).materials as { name: string })?.name
        : null;
      if (name && !textbookNames.includes(name)) {
        textbookNames.push(name);
      }
    }
    const valueText = textbookNames.length > 0 ? textbookNames.join(', ') : null;

    // 5. student_billings を upsert（value_text に教材名を設定）
    const { data: existingBilling } = await supabase
      .from('student_billings')
      .select('id')
      .eq('student_id', order.student_id)
      .eq('billing_item_id', billingItem.id)
      .maybeSingle();

    if (existingBilling) {
      await supabase
        .from('student_billings')
        .update({ value_text: valueText, is_billed: false })
        .eq('id', existingBilling.id);
    } else {
      await supabase
        .from('student_billings')
        .insert({
          school_id: targetSchoolId,
          student_id: order.student_id,
          billing_item_id: billingItem.id,
          is_billed: false,
          value_text: valueText,
        });
    }
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
      // 発送済み: 入庫
      await createStockTransaction({
        school_id: existingOrder.school_id,
        material_id: existingOrder.material_id,
        transaction_type: 'in',
        quantity: existingOrder.quantity,
        reason: '発注発送',
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
 * 発注を削除（unconfirmedのみ）
 */
export async function deleteOrder(id: string): Promise<void> {
  const { error } = await supabase
    .from('material_orders')
    .delete()
    .eq('id', id)
    .eq('status', 'unconfirmed');

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
    status: 'unconfirmed' as OrderStatus,
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
