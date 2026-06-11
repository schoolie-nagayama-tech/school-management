/**
 * 問合せ管理 API 層。
 * 対象テーブル: inquiries / inquiry_contacts
 *
 * 1000 行上限対策: 一覧取得は fetchAllPaged() でページング済み。
 * 認証: created_by は RLS / DB デフォルトに任せ、クライアントからは設定しない。
 */

import { supabase } from '../supabase';
import type {
  Inquiry,
  InquiryInsert,
  InquiryUpdate,
  InquiryStatus,
  InquiryContact,
  InquiryContactInsert,
} from '@/types/database';
import { getSchools } from './schools';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import type { ParsedInquiryRow } from '@/lib/utils/inquiryCsv';

// ============================================================
// 型定義
// ============================================================

export interface InquiryFilters {
  /** ステータス絞り込み（未指定で全件） */
  status?: InquiryStatus;
  /** 媒体絞り込み */
  media?: string;
  /** 学年絞り込み */
  grade?: string;
  /** 受付日 以降（YYYY-MM-DD） */
  dateFrom?: string;
  /** 受付日 以前（YYYY-MM-DD） */
  dateTo?: string;
  /** 生徒名・保護者名・電話・メールの部分一致検索 */
  search?: string;
}

export interface InquiryImportResult {
  /** 新規 insert 成功件数 */
  created: number;
  /** hp_inquiry_no 重複によるスキップ件数 */
  skipped: number;
  /** エラー行（学校名解決失敗・DB エラー等）の詳細 */
  errors: { schoolName: string; hpNo: string; message: string }[];
}

// ============================================================
// 問合せ台帳 CRUD
// ============================================================

/**
 * 問合せ一覧を取得する。
 * - deleted_at IS NULL のレコードのみ返す。
 * - inquired_at 降順 + id 昇順（安定ページング用）で取得する。
 * - 1000 件を超えるケースに備えてページングを使う。
 *
 * @param schoolId 単一または複数の school_id
 * @param filters 絞り込み条件（任意）
 */
export async function getInquiries(
  schoolId: string | string[],
  filters?: InquiryFilters
): Promise<Inquiry[]> {
  const schoolIds = Array.isArray(schoolId) ? schoolId : [schoolId];

  // クエリビルダを関数化して fetchAllPaged に渡す
  const buildQuery = (from: number, to: number) => {
    let query = supabase
      .from('inquiries')
      .select('*')
      .in('school_id', schoolIds)
      .is('deleted_at', null); // 論理削除済みは除外

    // ステータス絞り込み
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    // 媒体絞り込み
    if (filters?.media) {
      query = query.eq('media', filters.media);
    }

    // 学年絞り込み
    if (filters?.grade) {
      query = query.eq('grade', filters.grade);
    }

    // 受付日フィルター（YYYY-MM-DD を timestamptz の境界に変換）
    if (filters?.dateFrom) {
      query = query.gte('inquired_at', filters.dateFrom + 'T00:00:00+09:00');
    }
    if (filters?.dateTo) {
      query = query.lte('inquired_at', filters.dateTo + 'T23:59:59+09:00');
    }

    // 氏名・電話・メールの部分一致検索（PostgREST の or フィルタを使用）
    if (filters?.search) {
      const like = `%${filters.search}%`;
      query = query.or(
        `student_name.ilike.${like},guardian_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`
      );
    }

    return query
      .order('inquired_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);
  };

  return fetchAllPaged<Inquiry>(buildQuery);
}

/**
 * 問合せを1件取得する。
 * 見つからない場合は null を返す。
 */
export async function getInquiry(id: string): Promise<Inquiry | null> {
  const { data, error } = await supabase
    .from('inquiries')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`問合せの取得に失敗しました: ${error.message}`);
  }

  return data as Inquiry;
}

/**
 * 問合せを新規作成する。
 */
export async function createInquiry(data: InquiryInsert): Promise<Inquiry> {
  const { data: created, error } = await supabase
    .from('inquiries')
    .insert(data)
    .select()
    .single();

  if (error) {
    throw new Error(`問合せの作成に失敗しました: ${error.message}`);
  }

  return created as Inquiry;
}

/**
 * 問合せを更新する。
 */
export async function updateInquiry(id: string, data: InquiryUpdate): Promise<Inquiry> {
  const { data: updated, error } = await supabase
    .from('inquiries')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`問合せの更新に失敗しました: ${error.message}`);
  }

  return updated as Inquiry;
}

/**
 * 問合せを論理削除する（deleted_at = now()）。
 * 物理削除はしない。
 */
export async function softDeleteInquiry(id: string): Promise<void> {
  const { error } = await supabase
    .from('inquiries')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    throw new Error(`問合せの削除に失敗しました: ${error.message}`);
  }
}

// ============================================================
// コンタクト履歴
// ============================================================

/**
 * 指定問合せのコンタクト履歴を取得する。
 * contacted_at 降順で返す。
 */
export async function getInquiryContacts(inquiryId: string): Promise<InquiryContact[]> {
  const { data, error } = await supabase
    .from('inquiry_contacts')
    .select('*')
    .eq('inquiry_id', inquiryId)
    .order('contacted_at', { ascending: false })
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`コンタクト履歴の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as InquiryContact[];
}

/**
 * コンタクト履歴を1件追加する。
 */
export async function addInquiryContact(data: InquiryContactInsert): Promise<InquiryContact> {
  const { data: created, error } = await supabase
    .from('inquiry_contacts')
    .insert(data)
    .select()
    .single();

  if (error) {
    throw new Error(`コンタクト履歴の追加に失敗しました: ${error.message}`);
  }

  return created as InquiryContact;
}

// ============================================================
// リマインド用ヘルパー
// ============================================================

/**
 * 指定教室群でコンタクト履歴が 1 件以上ある inquiry_id の集合を返す。
 * リマインドの「初回未接触判定」用。fetchAllPaged でページング済み。
 *
 * @param schoolId 単一または複数の school_id
 */
export async function getContactedInquiryIds(
  schoolId: string | string[]
): Promise<Set<string>> {
  const schoolIds = Array.isArray(schoolId) ? schoolId : [schoolId];

  // inquiry_contacts は school_id を持つため .in() で一括取得する
  const rows = await fetchAllPaged<{ inquiry_id: string }>((from, to) =>
    supabase
      .from('inquiry_contacts')
      .select('inquiry_id')
      .in('school_id', schoolIds)
      .order('inquiry_id', { ascending: true })
      .range(from, to)
  );

  // Set 化（重複は自動排除）
  return new Set(rows.map((r) => r.inquiry_id));
}

// ============================================================
// CSV一括取込
// ============================================================

/**
 * CSV確認画面で確定後に呼ぶ一括取込関数。
 *
 * 処理順:
 * 1. getSchools() で全校を取得し、schoolName → school_id のマップを作る。
 * 2. 各行の schoolName でマップを参照して school_id を解決する。
 *    解決できない行は errors に追加してスキップ。
 * 3. school_id ごとに既存の hp_inquiry_no を1000件ページングで全件取得し Set 化。
 * 4. 重複行（既存の hp_inquiry_no）はスキップ。
 * 5. 新規行を 500 件ずつバッチ insert する。
 *
 * @param rows parseInquiryCsvFile() の戻り値
 */
export async function importInquiries(rows: ParsedInquiryRow[]): Promise<InquiryImportResult> {
  const result: InquiryImportResult = { created: 0, skipped: 0, errors: [] };

  if (rows.length === 0) return result;

  // ---- 1. schools マップ（name → id）を構築 ----
  const schools = await getSchools();
  const schoolNameToId = new Map<string, string>(
    schools.map((s) => [s.name, s.id])
  );

  // ---- 2. 各行の school_id を解決。解決できない行をエラーに分類 ----
  // school_id が解決できた行のみ取込対象とする
  const resolvable: { schoolId: string; row: ParsedInquiryRow }[] = [];

  for (const row of rows) {
    const schoolId = schoolNameToId.get(row.schoolName);
    if (!schoolId) {
      result.errors.push({
        schoolName: row.schoolName,
        hpNo: row.data.hp_inquiry_no ?? '',
        message: `教室名 "${row.schoolName}" が schools テーブルに見つかりません`,
      });
      continue;
    }
    resolvable.push({ schoolId, row });
  }

  if (resolvable.length === 0) return result;

  // ---- 3. 取込対象の school_id 一覧を収集し、既存 hp_inquiry_no を取得 ----
  // Array.from を使って Set を配列に変換（downlevelIteration 不要）
  const targetSchoolIds = Array.from(new Set(resolvable.map((r) => r.schoolId)));

  // school_id ごとに既存の hp_inquiry_no を全件取得して Set 化する
  // （1000 件を超えるケースに備えてページング済みの fetchAllPaged を使用）
  const existingNoMap = new Map<string, Set<string>>();

  await Promise.all(
    targetSchoolIds.map(async (sid) => {
      const existing = await fetchAllPaged<{ hp_inquiry_no: string | null }>((from, to) =>
        supabase
          .from('inquiries')
          .select('hp_inquiry_no')
          .eq('school_id', sid)
          .not('hp_inquiry_no', 'is', null)
          .order('id', { ascending: true })
          .range(from, to)
      );
      existingNoMap.set(
        sid,
        new Set(existing.map((r) => r.hp_inquiry_no).filter((v): v is string => v !== null))
      );
    })
  );

  // ---- 4. 重複チェックと新規行の抽出 ----
  const newRows: InquiryInsert[] = [];

  for (const { schoolId, row } of resolvable) {
    const hpNo = row.data.hp_inquiry_no;
    if (hpNo && existingNoMap.get(schoolId)?.has(hpNo)) {
      // 同一 school_id 内で hp_inquiry_no が既存 → スキップ
      result.skipped++;
      continue;
    }

    newRows.push({
      ...row.data,
      school_id: schoolId,
      // raw_source は ParsedInquiryRow.rawSource を入れる（data 側の raw_source は同値だが明示）
      raw_source: row.rawSource as Record<string, unknown>,
    });
  }

  // ---- 5. 500 件ずつバッチ insert ----
  const BATCH_SIZE = 500;
  for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
    const batch = newRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('inquiries').insert(batch);
    if (error) {
      // バッチ全体のエラーは errors に追加（個別行特定は困難なため batch 情報を記録）
      result.errors.push({
        schoolName: '',
        hpNo: `バッチ ${Math.floor(i / BATCH_SIZE) + 1}（${batch.length} 件）`,
        message: `INSERT に失敗しました: ${error.message}`,
      });
      // エラーになった分は created に加算しない
      continue;
    }
    result.created += batch.length;
  }

  return result;
}
