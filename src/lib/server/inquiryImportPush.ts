/**
 * ブックマークレット経由の HP 問合せCSV 一括取込ロジック（サーバー専用）。
 *
 * importInquiries()（src/lib/api/inquiries.ts）はブラウザ supabase クライアント前提なので
 * サーバールートからは使えない。本ファイルは service role クライアントを受け取り、
 * 同等の取込処理を Node.js 環境で実行する。
 *
 * 主な差異:
 *  - supabase クライアントを引数で受け取る（依存注入）
 *  - getSchools() ではなく service client で直接 schools を取得
 *  - fetchAllPaged ではなく手動のページングループ（service client は PromiseLike 型の互換のため）
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { parseInquiryCsvText } from '@/lib/utils/inquiryCsv';
import type { InquiryInsert } from '@/types/database';

// ============================================================
// 公開型
// ============================================================

export interface PushImportResult {
  /** 新規 insert 成功件数 */
  created: number;
  /** hp_inquiry_no 重複によるスキップ件数 */
  skipped: number;
  /** エラー行（学校名解決失敗・DB エラー等）の詳細 */
  errors: { schoolName: string; hpNo: string; message: string }[];
}

// ============================================================
// ページングヘルパー（service client 用）
// ============================================================

const PAGE_SIZE = 1000;

/**
 * service client で 1000 行上限を超えて全件取得する汎用ページャー。
 * fetchAllPaged と同じ方式だが、引数に service SupabaseClient を受け取る点が異なる。
 */
async function fetchAllServicePaged<T>(
  buildQuery: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

// ============================================================
// 公開 API
// ============================================================

/**
 * CSV テキスト（UTF-8 デコード済み）を service client で inquiries に取り込む。
 *
 * 処理順:
 * 1. parseInquiryCsvText() で行をパース。
 * 2. schools を全件取得して schoolName → school_id マップを構築。
 *    一致しない教室名は errors に積んでスキップ。
 * 3. school_id ごとに既存 hp_inquiry_no を全件取得（1000 件超え対策: ページング）して Set 化。
 * 4. 同一 CSV 内の hp_inquiry_no 重複も Set で除外（二重カウント防止）。
 * 5. 新規行を 500 件ずつ insert。バッチエラーは errors に積んで継続。
 *
 * @param serviceClient  Service Role の Supabase クライアント（RLS バイパス用）
 * @param csvText        Shift_JIS → TextDecoder でデコード済みの UTF-8 CSV 文字列
 */
export async function importInquiryCsvText(
  serviceClient: SupabaseClient,
  csvText: string
): Promise<PushImportResult> {
  const result: PushImportResult = { created: 0, skipped: 0, errors: [] };

  // ---- 1. CSV パース ----
  const rows = parseInquiryCsvText(csvText);
  if (rows.length === 0) return result;

  // ---- 2. schools マップ（name → id）を構築 ----
  const { data: schoolsData, error: schoolsError } = await serviceClient
    .from('schools')
    .select('id, name');

  if (schoolsError) {
    throw new Error(`schools 取得失敗: ${schoolsError.message}`);
  }

  const schools = (schoolsData ?? []) as { id: string; name: string }[];
  const schoolNameToId = new Map<string, string>(schools.map((s) => [s.name, s.id]));

  // ---- 3. 各行の school_id を解決 ----
  type Resolvable = { schoolId: string; row: (typeof rows)[0] };
  const resolvable: Resolvable[] = [];

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

  // ---- 4. 取込対象 school_id 一覧を収集し、既存 hp_inquiry_no を全件取得して Set 化 ----
  const targetSchoolIds = Array.from(new Set(resolvable.map((r) => r.schoolId)));

  // school_id → 既存 hp_inquiry_no の Set
  const existingNoMap = new Map<string, Set<string>>();

  await Promise.all(
    targetSchoolIds.map(async (sid) => {
      // 1000 件超え対策: ページングで全件取得
      const existing = await fetchAllServicePaged<{ hp_inquiry_no: string | null }>((from, to) =>
        serviceClient
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

  // ---- 5. 重複チェックと新規行の抽出 ----
  // CSV 内の hp_inquiry_no 重複も除外するため、追加済み NO を seenInCsv で追跡する
  const seenInCsv = new Map<string, Set<string>>(); // schoolId → Set<hpNo>

  const newRows: InquiryInsert[] = [];

  for (const { schoolId, row } of resolvable) {
    const hpNo = row.data.hp_inquiry_no;

    // DB 側の重複チェック
    if (hpNo && existingNoMap.get(schoolId)?.has(hpNo)) {
      result.skipped++;
      continue;
    }

    // CSV 内の重複チェック（同一 CSV に同じ問合せNO が複数行ある場合）
    if (hpNo) {
      const seen = seenInCsv.get(schoolId) ?? new Set<string>();
      if (seen.has(hpNo)) {
        result.skipped++;
        continue;
      }
      seen.add(hpNo);
      seenInCsv.set(schoolId, seen);
    }

    newRows.push({
      ...row.data,
      school_id: schoolId,
      raw_source: row.rawSource as Record<string, unknown>,
    });
  }

  // ---- 6. 500 件ずつバッチ insert ----
  const BATCH_SIZE = 500;

  for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
    const batch = newRows.slice(i, i + BATCH_SIZE);
    const { error } = await serviceClient.from('inquiries').insert(batch);

    if (error) {
      // バッチ全体のエラーを記録して次のバッチに進む（部分失敗でも継続）
      result.errors.push({
        schoolName: '',
        hpNo: `バッチ ${Math.floor(i / BATCH_SIZE) + 1}（${batch.length} 件）`,
        message: `INSERT に失敗しました: ${error.message}`,
      });
      continue;
    }

    result.created += batch.length;
  }

  return result;
}
