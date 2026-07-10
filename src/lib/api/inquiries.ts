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
  InquiryContactUpdate,
  InquiryMailLogInsert,
} from '@/types/database';
import { getSchools } from './schools';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import type { ParsedInquiryRow } from '@/lib/utils/inquiryCsv';
import type { MigrationRow } from '@/lib/utils/inquiryMigration';

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
      // LIKE のメタ文字（\ % _）をエスケープしてリテラル検索にする。
      // 未エスケープだと「%」入力で意図せず広範囲にマッチしたり、PostgREST が
      // エラーを返したりする。\ を最初に処理しないと二重エスケープになる点に注意。
      const escaped = filters.search.replace(/[\\%_]/g, (c) => `\\${c}`);
      const like = `%${escaped}%`;
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
  // 一覧（getInquiries）と対称に論理削除済みは除外する。これがないと削除済み
  // 問合せの URL を直打ちすると個人情報が詳細ページに表示されてしまう。
  const { data, error } = await supabase
    .from('inquiries')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
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
  const { data: created, error } = await supabase.from('inquiries').insert(data).select().single();

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
 * 追客メールの配信停止（オプトアウト）状態を切り替える。
 *
 * - optOut=true: 以後の追客メールを一律ブロック（送信フローで除外）。
 *   停止日時を記録し、経路（'unsubscribe_link' | 'manual'）を残す。
 * - optOut=false: 配信を再開（電話等で再開希望を受けた場合の手動戻し）。
 *   日時・経路はクリアする。
 *
 * @param id      問合せID
 * @param optOut  true=配信停止 / false=配信再開
 * @param source  停止経路（既定 'manual'）。配信再開時は無視される。
 */
export async function setInquiryOptOut(
  id: string,
  optOut: boolean,
  source: 'manual' | 'unsubscribe_link' = 'manual'
): Promise<Inquiry> {
  return updateInquiry(id, {
    email_opt_out: optOut,
    email_opt_out_at: optOut ? new Date().toISOString() : null,
    email_opt_out_source: optOut ? source : null,
  });
}

/**
 * 問合せを更新し、ステータス・資料発送日の変化を自動でコンタクト履歴に記録する。
 *
 * 追客タイムラインに「いつ何が起きたか」が時系列で残るようにするための薄いラッパー。
 * - status が変わったら → contacts に method='status_change', result='対応中→入会' を残す
 * - material_sent_at が null→値 になったら → method='material_sent', result='資料発送' を残す
 *
 * 「現在のステータス」と「最後のアクション」を別々の場所で見なくて済むようにする狙い。
 */
export async function updateInquiryWithTimeline(
  current: Inquiry,
  patch: InquiryUpdate
): Promise<Inquiry> {
  const updated = await updateInquiry(current.id, patch);

  const events: InquiryContactInsert[] = [];

  // タイムライン表示用のステータス日本語ラベル。
  // UI 定数(inquiryConstants)をここで import すると循環依存になるため最小限を直書き。
  const STATUS_JP: Record<InquiryStatus, string> = {
    in_progress: '対応中',
    trial_waiting: '体験待ち',
    trial_done: '返事待ち',
    enrolled: '入会',
    unreachable: '連絡不通',
    lost: '没',
    trial_lost: '体験没',
  };

  // ステータス変更
  if (patch.status && patch.status !== current.status) {
    events.push({
      inquiry_id: current.id,
      school_id: current.school_id,
      method: 'status_change',
      direction: null,
      result: `${STATUS_JP[current.status]} → ${STATUS_JP[patch.status]}`,
      note: null,
    });
  }

  // 資料発送（null → 値）
  if (patch.material_sent_at && !current.material_sent_at) {
    events.push({
      inquiry_id: current.id,
      school_id: current.school_id,
      method: 'material_sent',
      direction: 'outbound',
      result: '資料発送',
      note: null,
    });
  }

  // 失敗しても本体の更新は守りたいので、バルク insert を best-effort で実行
  if (events.length > 0) {
    const { error } = await supabase.from('inquiry_contacts').insert(events);
    if (error) {
      console.warn('[inquiries] タイムライン記録に失敗（本体は更新済み）:', error.message);
    }
  }

  return updated;
}

/**
 * 体験コマ登録に伴い、問合せを「体験予約済み」状態に更新する（Phase T）。
 *
 * - trial_at にコマ日時（timestamptz）をセットする。
 * - status は現在が in_progress（対応中）のときだけ trial_waiting（体験待ち）へ引き上げる。
 *   既に trial_done（返事待ち）/ enrolled（入会）/ 失注系などの場合はステータスを下げない
 *   （体験を複数回組む・入会後に追加体験を組む等でも段階が巻き戻らないようにする guard）。
 * - ステータス変更は updateInquiryWithTimeline 経由でコンタクト履歴にも自動記録する。
 *
 * @param inquiryId 問合せID
 * @param trialAt   体験コマ日時（ISO / timestamptz 文字列）
 */
export async function markInquiryTrialScheduled(inquiryId: string, trialAt: string): Promise<void> {
  const current = await getInquiry(inquiryId);
  if (!current) return; // 削除済み等。体験コマ自体は登録済みなので黙って無視する。

  const patch: InquiryUpdate = { trial_at: trialAt };
  // 対応中 → 体験待ち だけ引き上げる（進んだ段階は下げない）。
  if (current.status === 'in_progress') {
    patch.status = 'trial_waiting';
  }
  await updateInquiryWithTimeline(current, patch);
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

/**
 * コンタクト履歴を1件更新する。
 */
export async function updateInquiryContact(
  id: string,
  patch: InquiryContactUpdate
): Promise<InquiryContact> {
  const { data: updated, error } = await supabase
    .from('inquiry_contacts')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`コンタクト履歴の更新に失敗しました: ${error.message}`);
  }

  return updated as InquiryContact;
}

/**
 * コンタクト履歴を1件削除する（物理削除）。
 */
export async function deleteInquiryContact(id: string): Promise<void> {
  const { error } = await supabase.from('inquiry_contacts').delete().eq('id', id);

  if (error) {
    throw new Error(`コンタクト履歴の削除に失敗しました: ${error.message}`);
  }
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
export async function getContactedInquiryIds(schoolId: string | string[]): Promise<Set<string>> {
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
  const schoolNameToId = new Map<string, string>(schools.map((s) => [s.name, s.id]));

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

// ============================================================
// スプレッドシート移行取込 (初回のみ)
// ============================================================

export interface MigrationImportResult {
  /** 新規 insert 成功件数 */
  created: number;
  /** 重複ガードによるスキップ件数 */
  skipped: number;
  /** エラー行（学校名解決失敗・DB エラー等）の詳細 */
  errors: { school: string; name: string; message: string }[];
}

/**
 * 旧スプレッドシート移行用の一括 insert 関数。
 *
 * 処理順:
 * 1. getSchools() で全校を取得し「末尾「校」を除いた name === schoolNameShort」で解決。
 * 2. 対象 school_id の既存 inquiries を fetchAllPaged で全件取得。
 *    「inquired_at の日付(YYYY-MM-DD)が同じ かつ (phone一致 or student_name一致 or guardian_name一致)」
 *    に該当する行は重複とみなしてスキップ。
 * 3. 新規行を 500 件バッチで insert。.select('id') で返った id を行順に対応付ける。
 * 4. contacts / mailLogs を inquiry_id 付きでバッチ insert。
 *
 * @param rows parseMigrationXlsx() で得た MigrationRow[]
 */
export async function importMigrationRows(rows: MigrationRow[]): Promise<MigrationImportResult> {
  const result: MigrationImportResult = { created: 0, skipped: 0, errors: [] };

  if (rows.length === 0) return result;

  // ---- 1. schools マップ（末尾「校」除去名 → id）を構築 ----
  const schools = await getSchools();
  // "永山校" → "永山" にして Map 登録。schoolNameShort は既に "校" を除去済み
  const shortNameToId = new Map<string, string>(
    schools.map((s) => [s.name.replace(/校$/, ''), s.id])
  );

  // ---- 2. 各行の school_id を解決 ----
  type Resolvable = { schoolId: string; schoolName: string; row: MigrationRow };
  const resolvable: Resolvable[] = [];

  for (const row of rows) {
    const schoolId = shortNameToId.get(row.schoolNameShort);
    if (!schoolId) {
      result.errors.push({
        school: row.schoolNameShort,
        name: row.data.student_name ?? '（不明）',
        message: `教室名 "${row.schoolNameShort}" が schools テーブルに見つかりません`,
      });
      continue;
    }
    // schools.name (末尾「校」あり) を保持（エラー表示用）
    const schoolName = schools.find((s) => s.id === schoolId)?.name ?? row.schoolNameShort;
    resolvable.push({ schoolId, schoolName, row });
  }

  if (resolvable.length === 0) return result;

  // ---- 3. 取込対象の school_id 一覧を収集し、既存 inquiries を取得して重複判定用 Set を構築 ----
  const targetSchoolIds = Array.from(new Set(resolvable.map((r) => r.schoolId)));

  // 重複判定キー: "YYYY-MM-DD|phone|<値>" / "YYYY-MM-DD|sname|<値>" / "YYYY-MM-DD|gname|<値>"
  // schoolId → Set<key> の Map
  const existingKeyMap = new Map<string, Set<string>>();

  await Promise.all(
    targetSchoolIds.map(async (sid) => {
      const existing = await fetchAllPaged<{
        inquired_at: string;
        phone: string | null;
        student_name: string | null;
        guardian_name: string | null;
      }>((from, to) =>
        supabase
          .from('inquiries')
          .select('inquired_at,phone,student_name,guardian_name')
          .eq('school_id', sid)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .range(from, to)
      );

      const keySet = new Set<string>();
      for (const e of existing) {
        // inquired_at の日付部分 (YYYY-MM-DD) を取り出す
        const day = e.inquired_at.slice(0, 10);
        if (e.phone) keySet.add(`${day}|phone|${e.phone}`);
        if (e.student_name) keySet.add(`${day}|sname|${e.student_name}`);
        if (e.guardian_name) keySet.add(`${day}|gname|${e.guardian_name}`);
      }
      existingKeyMap.set(sid, keySet);
    })
  );

  /**
   * 重複チェック: inquired_at 日付が同じ かつ phone/student_name/guardian_name のいずれか一致
   */
  const isDuplicate = (schoolId: string, row: MigrationRow): boolean => {
    const keySet = existingKeyMap.get(schoolId);
    if (!keySet) return false;
    const day = row.data.inquired_at.slice(0, 10); // ISO の先頭10文字
    const { phone, student_name, guardian_name } = row.data;
    if (phone && keySet.has(`${day}|phone|${phone}`)) return true;
    if (student_name && keySet.has(`${day}|sname|${student_name}`)) return true;
    if (guardian_name && keySet.has(`${day}|gname|${guardian_name}`)) return true;
    return false;
  };

  // ---- 4. 重複チェックと新規行の抽出 ----
  // 新規行とそのメタデータ（contacts/mailLogs/schoolId）を一緒に保持
  type NewEntry = {
    insert: InquiryInsert;
    contacts: MigrationRow['contacts'];
    mailLogs: MigrationRow['mailLogs'];
    schoolId: string;
  };
  const newEntries: NewEntry[] = [];

  for (const { schoolId, row } of resolvable) {
    if (isDuplicate(schoolId, row)) {
      result.skipped++;
      continue;
    }
    newEntries.push({
      insert: { ...row.data, school_id: schoolId },
      contacts: row.contacts,
      mailLogs: row.mailLogs,
      schoolId,
    });
  }

  if (newEntries.length === 0) return result;

  // ---- 5. 500 件バッチで inquiries を insert し、返った id で contacts/mailLogs を紐付け ----
  const BATCH_SIZE = 500;

  for (let i = 0; i < newEntries.length; i += BATCH_SIZE) {
    const batch = newEntries.slice(i, i + BATCH_SIZE);
    const inserts = batch.map((e) => e.insert);

    const { data: insertedRows, error: insertError } = await supabase
      .from('inquiries')
      .insert(inserts)
      .select('id');

    if (insertError) {
      result.errors.push({
        school: '',
        name: `バッチ ${Math.floor(i / BATCH_SIZE) + 1}（${batch.length} 件）`,
        message: `INSERT に失敗しました: ${insertError.message}`,
      });
      continue;
    }

    const insertedIds: string[] = (insertedRows ?? []).map((r: { id: string }) => r.id);
    result.created += insertedIds.length;

    // Supabase は insert 入力順で id を返す前提で inquiry_id を対応付ける
    const contactsBatch: InquiryContactInsert[] = [];
    const mailLogsBatch: InquiryMailLogInsert[] = [];

    for (let j = 0; j < insertedIds.length; j++) {
      const inquiryId = insertedIds[j];
      const entry = batch[j];
      if (!inquiryId || !entry) continue;

      // contacts の組み立て
      for (const c of entry.contacts) {
        contactsBatch.push({
          inquiry_id: inquiryId,
          school_id: entry.schoolId,
          contacted_at: c.contacted_at,
          method: c.method,
          direction: c.direction,
          note: c.note,
        });
      }

      // mailLogs の組み立て（inquiry_mail_logs テーブル）
      for (const ml of entry.mailLogs) {
        mailLogsBatch.push({
          inquiry_id: inquiryId,
          school_id: entry.schoolId,
          method: ml.method,
          sent_at: ml.sent_at,
          status: 'sent' as const,
          subject: null,
          template_id: null,
        });
      }
    }

    // contacts バッチ insert（エラーは記録するが全体を止めない）
    if (contactsBatch.length > 0) {
      const { error: contactsError } = await supabase
        .from('inquiry_contacts')
        .insert(contactsBatch);
      if (contactsError) {
        result.errors.push({
          school: '',
          name: `コンタクトバッチ ${Math.floor(i / BATCH_SIZE) + 1}`,
          message: `inquiry_contacts INSERT に失敗しました: ${contactsError.message}`,
        });
      }
    }

    // mailLogs バッチ insert（エラーは記録するが全体を止めない）
    if (mailLogsBatch.length > 0) {
      const { error: mailLogsError } = await supabase
        .from('inquiry_mail_logs')
        .insert(mailLogsBatch);
      if (mailLogsError) {
        result.errors.push({
          school: '',
          name: `メールログバッチ ${Math.floor(i / BATCH_SIZE) + 1}`,
          message: `inquiry_mail_logs INSERT に失敗しました: ${mailLogsError.message}`,
        });
      }
    }
  }

  return result;
}
