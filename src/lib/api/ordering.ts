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
import { createStockTransaction, createMaterial } from '@/lib/api/inventory';

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
    if (
      error.code === 'PGRST116' ||
      error.code === '42501' ||
      error.message.includes('schema cache')
    ) {
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
      student_id: isSample ? null : order.student_id || null,
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
// 取次サイト（日本教材出版）への発注データ生成
// ============================================

/** 取次サイトの注文フォーム1行分（版元・教材名・教科・準拠・学年・部数）。 */
export interface DistributorOrderRow {
  hanmoto: string; // 版元（ワーク発行元。NESTに該当カラムなし → 既定は空、手入力可）
  kyuozaimei: string; // 教材名
  kyouka: string; // 教科
  junkyo: string; // 準拠（NESTの textbooks.publisher = 教科書準拠先を充当）
  gakunen: string; // 学年
  busuu: string; // 部数
}

/**
 * 発注（通常は未確認 unconfirmed）を、取次サイトの注文行に集約する。
 * - 準拠/教科/学年は materials ではなく textbooks 側にあるため、material_id で textbooks を引いて構造化する。
 *   引けなかった分は materials.name のラベル「名前 | [準拠 |] 学年 | 科目」を逆パースして補完する。
 * - 重要: NEST の textbooks.publisher は出版社ではなく「準拠(教科書準拠先: 東京書籍/啓林館等)」を指す。
 *   よって publisher → 取次フォームの「準拠(junkyo)」に入れる。
 * - 版元(hanmoto, ワークの発行元)は NEST に構造化カラムが無いため空。教材名が版元を兼ねることが多い。
 *   必要なら呼び出し側のダイアログで手入力する。
 * - 同一教材は部数を合算する（取次へは「商品×総部数」で発注するため、生徒単位の行は不要）。
 * - 「フォレスタ」は別の取次会社へ発注するため、教材名に含む発注はこの注文（日本教材出版）から除外する。
 */
/** 日本教材出版以外へ発注する教材（教材名に含まれていたら除外）。 */
const EXCLUDED_MATERIAL_KEYWORDS = ['フォレスタ'];

export async function buildDistributorOrderRows(
  orders: MaterialOrderWithDetails[]
): Promise<DistributorOrderRow[]> {
  const isExcluded = (name: string) => EXCLUDED_MATERIAL_KEYWORDS.some((kw) => name.includes(kw));
  // 別取次の教材（フォレスタ等）は最初に除外する。materials.name は「教材名 | …」のラベルなので名前判定に使える。
  const active = orders.filter(
    (o) => o.status !== 'cancelled' && !isExcluded(o.material?.name ?? '')
  );
  if (active.length === 0) return [];

  // material_id → textbooks の構造化フィールド（版元/教材名/教科/学年）
  const materialIds = Array.from(new Set(active.map((o) => o.material_id)));
  const tbByMaterial = new Map<
    string,
    { name: string; publisher: string | null; subject: string | null; grade: string | null }
  >();
  const { data: tbs } = await supabase
    .from('textbooks')
    .select('name, publisher, subject, grade, material_id')
    .in('material_id', materialIds);
  for (const t of (tbs ?? []) as {
    name: string;
    publisher: string | null;
    subject: string | null;
    grade: string | null;
    material_id: string | null;
  }[]) {
    if (t.material_id && !tbByMaterial.has(t.material_id)) {
      tbByMaterial.set(t.material_id, {
        name: t.name,
        publisher: t.publisher,
        subject: t.subject,
        grade: t.grade,
      });
    }
  }

  // materials.name ラベルの逆パース（textbooks を引けなかった場合のフォールバック）。
  // ラベル形式は formatTextbookLabel と同じ「名前 | [準拠 |] 学年 | 科目」（publisher=準拠は存在する時だけ index1 に入る）。
  const parseLabel = (
    label: string
  ): { name: string; publisher: string; grade: string; subject: string } => {
    const p = label.split(' | ').map((s) => s.trim());
    if (p.length >= 4)
      return {
        name: p.slice(0, p.length - 3).join(' | '),
        publisher: p[p.length - 3],
        grade: p[p.length - 2],
        subject: p[p.length - 1],
      };
    if (p.length === 3) return { name: p[0], publisher: '', grade: p[1], subject: p[2] };
    if (p.length === 2) return { name: p[0], publisher: '', grade: '', subject: p[1] };
    return { name: label, publisher: '', grade: '', subject: '' };
  };

  // 教材ごとに部数を合算
  const agg = new Map<string, { qty: number; order: MaterialOrderWithDetails }>();
  for (const o of active) {
    const cur = agg.get(o.material_id);
    if (cur) cur.qty += o.quantity;
    else agg.set(o.material_id, { qty: o.quantity, order: o });
  }

  const rows: DistributorOrderRow[] = [];
  agg.forEach(({ qty, order }, materialId) => {
    const tb = tbByMaterial.get(materialId);
    const fallback = parseLabel(order.material?.name ?? '');
    const kyuozaimei = (tb?.name ?? fallback.name) || '';
    // 解決後の教材名にも除外キーワードが残っていれば最終的に弾く（material.name と textbook 名の食い違い対策）
    if (isExcluded(kyuozaimei)) return;
    rows.push({
      hanmoto: '', // 版元(ワーク発行元)はNESTに構造化データが無い → 空。必要ならダイアログで手入力
      kyuozaimei,
      kyouka: (tb?.subject ?? fallback.subject) || '',
      junkyo: (tb?.publisher ?? fallback.publisher) || '', // textbooks.publisher = 準拠(教科書準拠先)
      gakunen: (tb?.grade ?? fallback.grade) || '',
      busuu: String(qty),
    });
  });
  rows.sort((a, b) => a.kyuozaimei.localeCompare(b.kyuozaimei, 'ja'));
  return rows;
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
 * - 発注教材の解決: textbooks.material_id を最優先。未設定なら、教材(materials)は textbooks と同源データで
 *   名前が「テキスト名 | 学年 | 科目」(出版社ありは間に出版社)の形なので、その名前で照合して解決する。
 * - alreadyOwned: 同生徒・同テキストの有効化済み(student_textbooks.is_draft=false)があれば所持とみなし発注しない
 * - hasOrder: 同生徒・同教材の未キャンセル発注があれば重複作成しない
 * - needsOrder: 発注教材が解決でき & 未所持 & 既存発注なし → 発注対象
 */
export async function getProposalOrderCandidates(
  inputs: ProposalOrderInput[]
): Promise<OrderCandidate[]> {
  if (inputs.length === 0) return [];

  const studentIds = Array.from(new Set(inputs.map((i) => i.studentId)));
  const textbookIds = Array.from(new Set(inputs.map((i) => i.textbookId)));
  const inputSchoolIds = Array.from(
    new Set(inputs.map((i) => i.schoolId).filter((s): s is string => !!s))
  );

  // テキスト詳細（material_id + 名前/学年/科目/出版社）。発注教材の名前照合に使う。
  const tbDetail = new Map<
    number,
    {
      material_id: string | null;
      name: string;
      grade: string | null;
      subject: string | null;
      publisher: string | null;
    }
  >();
  {
    const { data } = await supabase
      .from('textbooks')
      .select('id, name, grade, subject, publisher, material_id')
      .in('id', textbookIds);
    for (const t of (data ?? []) as {
      id: number;
      name: string;
      grade: string | null;
      subject: string | null;
      publisher: string | null;
      material_id: string | null;
    }[]) {
      tbDetail.set(t.id, {
        material_id: t.material_id,
        name: t.name,
        grade: t.grade,
        subject: t.subject,
        publisher: t.publisher,
      });
    }
  }

  // 教材カタログ（名前→id / id→名前）。textbooks と同源データのため名前で照合できる。
  const matIdByName = new Map<string, string>();
  const matNameById = new Map<string, string>();
  {
    let q = supabase.from('materials').select('id, name, school_id').eq('is_active', true);
    if (inputSchoolIds.length > 0) q = q.in('school_id', inputSchoolIds);
    const { data } = await q;
    for (const m of (data ?? []) as { id: string; name: string }[]) {
      if (!matIdByName.has(m.name)) matIdByName.set(m.name, m.id);
      matNameById.set(m.id, m.name);
    }
  }

  // テキスト → 発注教材ラベル。発注ページの formatTextbookLabel と同形式
  // （名前 | [出版社 |] 学年 | 科目）。既存 material が無くても、このラベルで
  // 発注時に material を作成して発注できる（発注ページと同じ挙動）。
  const labelOf = (textbookId: number): string | null => {
    const tb = tbDetail.get(textbookId);
    if (!tb || !tb.name) return null;
    const parts: string[] = [tb.name];
    if (tb.publisher) parts.push(tb.publisher);
    if (tb.grade) parts.push(tb.grade);
    if (tb.subject) parts.push(tb.subject);
    return parts.join(' | ');
  };
  // 既存 material の解決（material_id 優先、無ければラベル名で照合）。無ければ null（発注時に作成）。
  const resolveExistingMaterialId = (
    textbookId: number,
    fallback: string | null
  ): string | null => {
    const tb = tbDetail.get(textbookId);
    if (tb?.material_id) return tb.material_id;
    const label = labelOf(textbookId);
    if (label && matIdByName.has(label)) return matIdByName.get(label)!;
    return fallback;
  };

  // input ごとに「既存material / ラベル」を解決
  const perInput = inputs.map((i) => ({
    existingId: resolveExistingMaterialId(i.textbookId, i.materialId),
    label: labelOf(i.textbookId),
  }));
  const materialIds = Array.from(
    new Set(perInput.map((p) => p.existingId).filter((m): m is string => !!m))
  );

  // 「所持している(is_owned=true)」教材は発注しない。track_progress(進行表管理)とは独立。
  // 公開しただけ(所持してないけど管理する=is_owned=false)のテキストは発注候補に含める。
  const ownedSet = new Set<string>();
  if (studentIds.length > 0 && textbookIds.length > 0) {
    const { data } = await supabase
      .from('student_textbooks')
      .select('student_id, textbook_id')
      .in('student_id', studentIds)
      .in('textbook_id', textbookIds)
      .eq('is_owned', true);
    for (const r of (data ?? []) as { student_id: string; textbook_id: number }[]) {
      ownedSet.add(`${r.student_id}:${r.textbook_id}`);
    }
  }

  // 既存の未キャンセル発注（生徒×教材）→ 重複発注防止
  const orderedSet = new Set<string>();
  if (materialIds.length > 0) {
    const { data: orders } = await supabase
      .from('material_orders')
      .select('student_id, material_id, status')
      .in('student_id', studentIds)
      .in('material_id', materialIds)
      .neq('status', 'cancelled');
    for (const r of (orders ?? []) as { student_id: string | null; material_id: string }[]) {
      if (r.student_id) orderedSet.add(`${r.student_id}:${r.material_id}`);
    }
  }

  return inputs.map((i, idx) => {
    const { existingId, label } = perInput[idx];
    const alreadyOwned = ownedSet.has(`${i.studentId}:${i.textbookId}`);
    const hasOrder = !!existingId && orderedSet.has(`${i.studentId}:${existingId}`);
    // 発注教材ラベルが作れる（=テキスト名がある）なら、material が無くても発注可能（発注時に作成）。
    // 未所持(物理) かつ 既存発注なし のものを発注対象とする。
    const needsOrder = !!label && !alreadyOwned && !hasOrder;
    return {
      ...i,
      // 既存があればその id、無ければ null（発注時に label から作成）
      materialId: existingId,
      // 表示・作成に使う教材名（既存があればその名、無ければラベル）
      materialName: existingId ? (matNameById.get(existingId) ?? label) : label,
      alreadyOwned,
      hasOrder,
      needsOrder,
    };
  });
}

/**
 * 発注候補から material_orders を「未確認(unconfirmed)」で作成する（通常の発注手順に乗せる）。
 * 発注ページと同じく、対応する material が無ければ materialName(ラベル)で material を作成してから登録する
 * （提案書のテキストはすべて発注リストに積める）。
 * ここでは発注済みにはせず、所持教材へも反映しない。発注画面で未確認→発注→発送→配布と進める運用。
 * schoolId と materialName が必須。失敗は件数で返す。
 */
export async function createOrdersForCandidates(
  candidates: OrderCandidate[]
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  for (const c of candidates) {
    if (!c.schoolId || !c.materialName) {
      failed++;
      continue;
    }
    try {
      // 発注教材を解決。既存があればそれ、無ければラベル名で作成（発注ページと同じ get-or-create）。
      let materialId = c.materialId;
      if (!materialId) {
        const { data: existing } = await supabase
          .from('materials')
          .select('id')
          .eq('name', c.materialName)
          .eq('school_id', c.schoolId)
          .limit(1)
          .maybeSingle();
        if (existing) {
          materialId = (existing as { id: string }).id;
        } else {
          const created = await createMaterial(
            { name: c.materialName, category: 'テキスト', unit: '冊' },
            c.schoolId
          );
          materialId = created.id;
        }
      }

      // 未確認のまま発注リストに積む（発注済みにはしない／所持教材にも入れない）。
      // 以降は通常の発注手順（未確認→発注→発送→配布）で進める。
      await createOrder(
        {
          material_id: materialId,
          student_id: c.studentId,
          quantity: 1,
          notes: `提案書公開による発注（${c.textbookName}）`,
        },
        c.schoolId
      );
      // 発注に使った教材をテキストに永続紐付け（次回から即マッチ・自動候補に）。
      // 既に紐付け済み(material_id 非null)は触らない。リンク保存失敗は致命的でないので無視。
      try {
        await supabase
          .from('textbooks')
          .update({ material_id: materialId })
          .eq('id', c.textbookId)
          .is('material_id', null);
      } catch (linkErr) {
        console.error('テキストへの発注教材リンク保存に失敗:', linkErr);
      }
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
  order: {
    material_id: string;
    student_id?: string | null;
    is_sample?: boolean;
    quantity?: number;
    notes?: string;
  },
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
      await supabase.from('student_billings').insert({
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
export async function updateOrderStatus(id: string, status: OrderStatus): Promise<MaterialOrder> {
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

  // 配布時: 所持教材に「所持(is_owned=true)」として登録（配布したら所持済み）
  if (status === 'distributed' && existingOrder.student_id) {
    try {
      await markMaterialOwned(
        existingOrder.material_id,
        existingOrder.student_id,
        existingOrder.school_id
      );
    } catch (err) {
      console.error('配布時の所持登録に失敗しました:', err);
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
  const { error } = await supabase.from('material_orders').delete().eq('id', id);

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

  const { data, error } = await supabase.from('material_orders').insert(inserts).select();

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
  materialId: string;
  textbookName: string;
  quantity: number;
  status: OrderStatus;
  orderedAt: string | null;
}

export async function getStudentTextbooks(
  studentId: string,
  statuses: OrderStatus[] = ['distributed']
): Promise<StudentTextbook[]> {
  const { data, error } = await supabase
    .from('material_orders')
    .select('id, material_id, quantity, status, ordered_at, materials(name)')
    .eq('student_id', studentId)
    .in('status', statuses)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(getUserErrorMessage(error, '所持教材の取得に失敗しました'));
  }

  return (data || []).map((row: Record<string, unknown>) => {
    const mat = row.materials as Record<string, unknown> | null;
    return {
      orderId: row.id as string,
      materialId: row.material_id as string,
      textbookName: mat?.name ? String(mat.name) : '不明',
      quantity: row.quantity as number,
      status: row.status as OrderStatus,
      orderedAt: row.ordered_at as string | null,
    };
  });
}

/**
 * 発注(material)に対応する textbook_id を解決する。
 * textbooks.material_id 優先、無ければ material 名のラベル(名前 | [出版社 |] 学年 | 科目)を
 * 分解して name/grade/subject で照合する。解決できなければ null。
 */
async function resolveTextbookIdForMaterial(
  materialId: string,
  materialName?: string
): Promise<number | null> {
  const { data: linked } = await supabase
    .from('textbooks')
    .select('id')
    .eq('material_id', materialId)
    .limit(1)
    .maybeSingle();
  if (linked) return (linked as { id: number }).id;

  let name = materialName;
  if (!name) {
    const { data: mat } = await supabase
      .from('materials')
      .select('name')
      .eq('id', materialId)
      .maybeSingle();
    name = (mat as { name: string } | null)?.name;
  }
  if (!name) return null;

  // ラベルを分解: 末尾=科目、その前=学年、先頭=名前（出版社は無視）
  const parts = name
    .split(' | ')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const tbName = parts[0];
  const subject = parts.length >= 2 ? parts[parts.length - 1] : null;
  const grade = parts.length >= 3 ? parts[parts.length - 2] : null;
  let q = supabase.from('textbooks').select('id').eq('name', tbName);
  if (subject) q = q.eq('subject', subject);
  if (grade) q = q.eq('grade', grade);
  const { data: matched } = await q.limit(1).maybeSingle();
  return matched ? (matched as { id: number }).id : null;
}

/**
 * 発注した教材を「所持(is_owned=true)」として student_textbooks に登録する（配布時に呼ぶ）。
 * 対応テキストを解決し、st があれば is_owned=true に更新、無ければ作成する（track_progress は触らない）。
 * 解決できない場合は静かにスキップ（フリーテキスト教材名など）。
 */
async function markMaterialOwned(
  materialId: string,
  studentId: string,
  fallbackSchoolId: string
): Promise<void> {
  const textbookId = await resolveTextbookIdForMaterial(materialId);
  if (textbookId == null) return;

  const { data: existing } = await supabase
    .from('student_textbooks')
    .select('id')
    .eq('student_id', studentId)
    .eq('textbook_id', textbookId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('student_textbooks')
      .update({ is_owned: true })
      .eq('id', (existing as { id: string }).id);
  } else {
    const { data: student } = await supabase
      .from('students')
      .select('school_id')
      .eq('id', studentId)
      .maybeSingle();
    const stSchoolId = (student as { school_id: string } | null)?.school_id ?? fallbackSchoolId;
    await supabase.from('student_textbooks').insert({
      school_id: stSchoolId,
      student_id: studentId,
      textbook_id: textbookId,
      is_active: true,
      is_owned: true,
    });
  }

  // 発注教材リンクを保存（次回以降の解決を確実に）
  try {
    await supabase
      .from('textbooks')
      .update({ material_id: materialId })
      .eq('id', textbookId)
      .is('material_id', null);
  } catch {
    /* リンク保存失敗は無視 */
  }
}

/**
 * 発注由来の教材を「進行表で管理」ON/OFF する。
 * 発注(material)に対応するテキストを解決して student_textbooks の track_progress を切り替える
 * （発注由来は registerStudentTextbook の名前不一致で st が無いことが多いため、ここで作成/更新する）。
 * テキスト解決: textbooks.material_id 優先、無ければ material 名のラベル(名前 | [出版社 |] 学年 | 科目)を
 * 分解して name/grade/subject で照合する。
 */
export async function setOrderedTextbookProgress(
  studentId: string,
  materialId: string,
  materialName: string,
  track: boolean,
  fallbackSchoolId: string
): Promise<void> {
  // 1) テキストを解決
  const textbookId = await resolveTextbookIdForMaterial(materialId, materialName);
  if (textbookId == null) {
    throw new Error('対応するテキストが見つかりません（教材マスタの名称をご確認ください）');
  }

  // 2) 生徒の所属校（student_textbooks.school_id 用）
  const { data: student } = await supabase
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .maybeSingle();
  const stSchoolId = (student as { school_id: string } | null)?.school_id ?? fallbackSchoolId;

  // 3) st を upsert（あれば track_progress 更新、無ければ作成）
  const { data: existing } = await supabase
    .from('student_textbooks')
    .select('id')
    .eq('student_id', studentId)
    .eq('textbook_id', textbookId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('student_textbooks')
      .update({ track_progress: track })
      .eq('id', (existing as { id: string }).id);
  } else {
    await supabase.from('student_textbooks').insert({
      school_id: stSchoolId,
      student_id: studentId,
      textbook_id: textbookId,
      is_active: true,
      track_progress: track,
    });
  }

  // 4) テキストに発注教材リンクを保存（次回以降の解決を確実に）
  try {
    await supabase
      .from('textbooks')
      .update({ material_id: materialId })
      .eq('id', textbookId)
      .is('material_id', null);
  } catch {
    /* リンク保存失敗は無視 */
  }
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

      await supabase.from('student_textbooks').insert({
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
    await supabase.from('student_billings').insert({
      school_id: schoolId,
      student_id: studentId,
      billing_item_id: vocabItem.id,
      is_billed: false,
      value_number: 1,
    });
  }
}
