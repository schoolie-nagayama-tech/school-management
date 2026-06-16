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

  // 検索フィルター（生徒名 / 見本）
  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    results = results.filter((order) => {
      // 見本発注は「見本」で検索可能
      if (order.is_sample && '見本'.includes(searchLower)) return true;
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
    student_id?: string | null;
    is_sample?: boolean;
    quantity?: number;
    notes?: string;
  },
  schoolId?: string
): Promise<MaterialOrder> {
  const targetSchoolId = schoolId || getDefaultSchoolId();
  const isSample = order.is_sample ?? false;

  const { data, error } = await supabase
    .from('material_orders')
    .insert({
      school_id: targetSchoolId,
      material_id: order.material_id,
      student_id: isSample ? null : (order.student_id || null),
      is_sample: isSample,
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

// ============================================
// 提案書公開時の発注候補（ハイブリッド自動発注）
// ============================================

/** 公開しようとする提案書の発注判定に必要な最小情報 */
export interface ProposalOrderInput {
  proposalId: string;
  studentId: string;
  studentName: string;
  schoolId: string | null;
  textbookId: number;
  textbookName: string;
  /** textbooks.material_id（発注教材の紐付け。未紐付けは null） */
  materialId: string | null;
}

export interface OrderCandidate extends ProposalOrderInput {
  materialName: string | null;
  /** 既にその生徒がこのテキストを所持しているか（student_textbooks に有効化済み行あり） */
  alreadyOwned: boolean;
  /** 既に未キャンセルの発注があるか（生徒×教材） */
  hasOrder: boolean;
  /** 自動発注の対象か（紐付けあり & 未所持 & 既存発注なし） */
  needsOrder: boolean;
}

/**
 * 提案書公開に伴う発注候補を算出する。
 * 重要: student_textbooks の所持判定は「公開で is_draft=false になる前」の状態を見る必要があるため、
 * 必ず publishProposal を呼ぶ「前」に実行すること（公開後だと当該テキストが所持済み扱いになる）。
 * - alreadyOwned: 同生徒・同テキストの有効化済み(student_textbooks.is_draft=false)があれば所持とみなし発注しない
 * - hasOrder: 同生徒・同教材の未キャンセル発注があれば重複作成しない
 * - needsOrder: 教材紐付けあり & 未所持 & 既存発注なし → 自動発注の対象
 */
export async function getProposalOrderCandidates(
  inputs: ProposalOrderInput[]
): Promise<OrderCandidate[]> {
  if (inputs.length === 0) return [];

  const studentIds = Array.from(new Set(inputs.map((i) => i.studentId)));
  const textbookIds = Array.from(new Set(inputs.map((i) => i.textbookId)));
  const materialIds = Array.from(new Set(inputs.map((i) => i.materialId).filter((m): m is string => !!m)));

  // 所持テキスト（有効化済み = is_draft=false）。下書き作成だけの行は所持扱いしない。
  const ownedSet = new Set<string>();
  if (studentIds.length > 0 && textbookIds.length > 0) {
    const { data } = await supabase
      .from('student_textbooks')
      .select('student_id, textbook_id')
      .in('student_id', studentIds)
      .in('textbook_id', textbookIds)
      .eq('is_draft', false);
    for (const r of (data ?? []) as { student_id: string; textbook_id: number }[]) {
      ownedSet.add(`${r.student_id}:${r.textbook_id}`);
    }
  }

  // 既存の未キャンセル発注（生徒×教材）→ 重複発注防止
  const orderedSet = new Set<string>();
  const materialNameMap = new Map<string, string>();
  if (materialIds.length > 0) {
    const [{ data: orders }, { data: materials }] = await Promise.all([
      supabase
        .from('material_orders')
        .select('student_id, material_id, status')
        .in('student_id', studentIds)
        .in('material_id', materialIds)
        .neq('status', 'cancelled'),
      supabase.from('materials').select('id, name').in('id', materialIds),
    ]);
    for (const r of (orders ?? []) as { student_id: string | null; material_id: string }[]) {
      if (r.student_id) orderedSet.add(`${r.student_id}:${r.material_id}`);
    }
    for (const m of (materials ?? []) as { id: string; name: string }[]) {
      materialNameMap.set(m.id, m.name);
    }
  }

  return inputs.map((i) => {
    const alreadyOwned = ownedSet.has(`${i.studentId}:${i.textbookId}`);
    const hasOrder = !!i.materialId && orderedSet.has(`${i.studentId}:${i.materialId}`);
    const needsOrder = !!i.materialId && !alreadyOwned && !hasOrder;
    return {
      ...i,
      materialName: i.materialId ? materialNameMap.get(i.materialId) ?? null : null,
      alreadyOwned,
      hasOrder,
      needsOrder,
    };
  });
}

/**
 * 発注候補から material_orders を作成し、そのまま「発注済(ordered)」まで進める。
 * 公開ダイアログでユーザーが明示的に選んだ確定発注なので要確認(unconfirmed)で止めず、
 * updateOrderStatus('ordered') を呼んで ordered_at と所持教材登録(registerStudentTextbook)まで実行する。
 * （発注→所持教材の流れを維持。請求連携は配布時のみなのでここでは発生しない）
 * 各候補は materialId と schoolId が必須。失敗は件数で返す。
 */
export async function createOrdersForCandidates(
  candidates: OrderCandidate[]
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  for (const c of candidates) {
    if (!c.materialId || !c.schoolId) {
      failed++;
      continue;
    }
    try {
      const created = await createOrder(
        {
          material_id: c.materialId,
          student_id: c.studentId,
          quantity: 1,
          notes: `提案書公開による発注（${c.textbookName}）`,
        },
        c.schoolId
      );
      // 確認済みとして即「発注済」に進める（所持教材にも登録される）
      await updateOrderStatus(created.id, 'ordered');
      success++;
    } catch (e) {
      console.error('発注候補からの発注作成に失敗:', e);
      failed++;
    }
  }
  return { success, failed };
}

/**
 * 発注を作成し、「教材発注」請求項目の生徒セルに教材名を自動反映する
 */
export async function createOrderWithBilling(
  order: { material_id: string; student_id?: string | null; is_sample?: boolean; quantity?: number; notes?: string },
  billingPeriodId: string,
  schoolId?: string
): Promise<{ order: MaterialOrder; billingItem: BillingItem | null }> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  // 1. 発注を作成
  const createdOrder = await createOrder(order, schoolId);

  let billingItem: BillingItem | null = null;

  // 見本発注の場合は請求連携をスキップ
  const isSample = order.is_sample ?? false;
  if (isSample || !order.student_id) {
    return { order: createdOrder, billingItem: null };
  }

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
    console.error('在庫トランザクションの自動作成に失敗しました:', stockError);
  }

  // 発注時: 所持教材に自動登録（見本発注はスキップ）
  if (status === 'ordered' && existingOrder.student_id) {
    try {
      await registerStudentTextbook(
        existingOrder.material_id,
        existingOrder.student_id,
        existingOrder.school_id
      );
    } catch (err) {
      console.error('発注時の所持教材登録に失敗しました:', err);
    }
  }

  // 配布時: 単語練習帳なら請求管理の単語練習帳列に自動記入
  // 見本発注（student_id が null）の場合はスキップ
  if (status === 'distributed' && existingOrder.student_id) {
    try {
      await onMaterialDistributed(
        existingOrder.material_id,
        existingOrder.student_id,
        existingOrder.school_id,
        existingOrder.quantity
      );
    } catch (err) {
      console.error('配布時の自動連携に失敗しました:', err);
    }
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
    .eq('id', id);

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

/**
 * 生徒の所持教材一覧を取得（キャンセル以外の発注教材）
 */
export interface StudentTextbook {
  orderId: string;
  textbookName: string;
  quantity: number;
  status: OrderStatus;
  orderedAt: string | null;
}

export async function getStudentTextbooks(studentId: string): Promise<StudentTextbook[]> {
  const { data, error } = await supabase
    .from('material_orders')
    .select('id, quantity, status, ordered_at, materials(name)')
    .eq('student_id', studentId)
    .eq('status', 'distributed')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(getUserErrorMessage(error, '所持教材の取得に失敗しました'));
  }

  return (data || []).map((row: Record<string, unknown>) => {
    const mat = row.materials as Record<string, unknown> | null;
    return {
      orderId: row.id as string,
      textbookName: mat?.name ? String(mat.name) : '不明',
      quantity: row.quantity as number,
      status: row.status as OrderStatus,
      orderedAt: row.ordered_at as string | null,
    };
  });
}

/**
 * 配布済み教材を削除（使い終わった教材を所持教材から外す）
 * - material_orders レコードを削除
 * - 対応する student_textbooks レコードがあれば削除
 */
export async function deleteDistributedMaterial(orderId: string, studentId: string): Promise<void> {
  // まず注文情報を取得して教材名を特定
  const { data: order } = await supabase
    .from('material_orders')
    .select('id, material_id, materials(name)')
    .eq('id', orderId)
    .single();

  if (!order) {
    throw new Error('注文が見つかりません');
  }

  // material_orders を削除
  const { error: deleteOrderError } = await supabase
    .from('material_orders')
    .delete()
    .eq('id', orderId);

  if (deleteOrderError) {
    throw new Error(getUserErrorMessage(deleteOrderError, '配布教材の削除に失敗しました'));
  }

  // 対応する student_textbooks があれば削除
  const mat = order.materials as Record<string, unknown> | null;
  const materialName = mat?.name ? String(mat.name) : null;
  if (materialName) {
    const { data: textbook } = await supabase
      .from('textbooks')
      .select('id')
      .eq('name', materialName)
      .maybeSingle();

    if (textbook) {
      const { data: stb } = await supabase
        .from('student_textbooks')
        .select('id')
        .eq('student_id', studentId)
        .eq('textbook_id', textbook.id)
        .maybeSingle();

      if (stb) {
        await supabase.from('student_textbooks').delete().eq('id', stb.id);
      }
    }
  }
}

/**
 * 発注時: 所持教材に自動登録
 * textbooks テーブルに同名の教材があれば student_textbooks に追加（track_progress=false）
 *
 * 注意: 引数の schoolId は「発注（在庫/請求）の教室」であり、生徒の所属校とは限らない
 * （他校の生徒に発注する場合や、操作中の選択校が先頭校に倒れる場合がある）。
 * 所持教材(student_textbooks)は RLS の可視性が school_id に依存し、講師は user_schools の
 * 自校しか見られないため、必ず「生徒の所属校」を school_id に入れる。発注校を入れると
 * 別校の student_textbook ができ、その生徒の担当講師から所持教材が見えなくなる。
 */
async function registerStudentTextbook(
  materialId: string,
  studentId: string,
  schoolId: string
): Promise<void> {
  const { data: material } = await supabase
    .from('materials')
    .select('name')
    .eq('id', materialId)
    .single();

  if (!material) return;

  const { data: textbook } = await supabase
    .from('textbooks')
    .select('id')
    .eq('name', material.name)
    .maybeSingle();

  if (textbook) {
    const { data: existingSt } = await supabase
      .from('student_textbooks')
      .select('id')
      .eq('student_id', studentId)
      .eq('textbook_id', textbook.id)
      .maybeSingle();

    if (!existingSt) {
      // 生徒の所属校を引いて student_textbooks の school_id に使う（発注校 schoolId は使わない）。
      // 取得できない場合のみ発注校をフォールバックにする。
      const { data: student } = await supabase
        .from('students')
        .select('school_id')
        .eq('id', studentId)
        .maybeSingle();
      const stSchoolId = (student as { school_id: string } | null)?.school_id ?? schoolId;

      await supabase
        .from('student_textbooks')
        .insert({
          school_id: stSchoolId,
          student_id: studentId,
          textbook_id: textbook.id,
          is_active: true,
          track_progress: false,
        });
    }
  }
}

/**
 * 配布時: 単語練習帳なら請求管理の単語練習帳列に自動記入
 */
async function onMaterialDistributed(
  materialId: string,
  studentId: string,
  schoolId: string,
  _quantity: number
): Promise<void> {
  const { data: material } = await supabase
    .from('materials')
    .select('name')
    .eq('id', materialId)
    .single();

  if (!material) return;

  if (material.name !== '単語練習帳') return;

  const { data: periods } = await supabase
    .from('billing_periods')
    .select('id')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('start_date', { ascending: false })
    .limit(1);

  if (!periods || periods.length === 0) return;

  const periodId = periods[0].id;
  const { data: vocabItem } = await supabase
    .from('billing_items')
    .select('id')
    .eq('billing_period_id', periodId)
    .eq('school_id', schoolId)
    .eq('name', '単語練習帳')
    .maybeSingle();

  if (!vocabItem) return;

  const { data: existing } = await supabase
    .from('student_billings')
    .select('id')
    .eq('student_id', studentId)
    .eq('billing_item_id', vocabItem.id)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('student_billings')
      .update({ value_number: 1, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('student_billings')
      .insert({
        school_id: schoolId,
        student_id: studentId,
        billing_item_id: vocabItem.id,
        is_billed: false,
        value_number: 1,
      });
  }
}
