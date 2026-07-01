/**
 * ヤマトB2クラウド「外部データ取り込み基本レイアウト」向けCSV生成ユーティリティ。
 * 旧GASの exportNekoPosCSV の移植・修正版。
 *
 * 変更点(旧GAS比):
 *  - 送り状種類: '7'(旧GAS) → 'A'(ネコポス正式コード)
 *  - 投函完了メール(index 92-94): 有料化のため廃止
 *  - BOMなしUTF-8: B2クラウド取込実績ありの形式に統一
 */

import type { Inquiry, InquirySchoolSettings } from '@/types/database';

// ────────────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────────────

export interface YamatoCsvResult {
  /** 生成されたCSV文字列（ヘッダー行 + データ行 CRLF結合） */
  csv: string;
  /** 出力された送り状数 */
  count: number;
  /** 出力対象外となった行の詳細 */
  skipped: { name: string; reason: string }[];
  /**
   * 実際にCSV行として出力された問合せのID一覧。
   * 発送日記録(material_sent_at)の更新対象を、宛名一致ではなくIDで
   * 正確に突合するために返す（同名複数の誤更新を防ぐ）。
   */
  includedIds: string[];
}

// ────────────────────────────────────────────────────────
// 内部ヘルパー
// ────────────────────────────────────────────────────────

/** B2クラウド外部取込フォーマット: 全97要素の空配列を生成 */
function makeEmptyRow(): string[] {
  return new Array(97).fill('');
}

/**
 * ヤマトB2クラウドのヘッダー行を返す。
 * index(0-based) に対してフィールド名をセットし、残りは空文字。
 */
function makeHeaderRow(): string[] {
  const row = makeEmptyRow();
  row[1] = '送り状種類';
  row[4] = '出荷予定日';
  row[8] = 'お届け先電話番号';
  row[10] = 'お届け先郵便番号';
  row[11] = 'お届け先住所';
  row[15] = 'お届け先名';
  row[18] = '請求先顧客コード';
  row[19] = 'ご依頼主電話番号';
  row[21] = 'ご依頼主郵便番号';
  row[22] = 'ご依頼主住所';
  row[24] = 'ご依頼主名';
  row[27] = '品名1';
  row[37] = '発行枚数';
  row[38] = '個数口表示フラグ';
  row[39] = '請求先顧客コード';
  row[41] = '運賃管理番号';
  return row;
}

/**
 * 97要素の行配列をダブルクォート囲みCSV行文字列に変換。
 * GAS互換: 全フィールドをダブルクォートで囲む("a","b",...)。
 * 値内のダブルクォートは "" にエスケープ。
 */
function rowToCsvLine(row: string[]): string {
  return row.map((v) => `"${v.replace(/"/g, '""')}"`).join(',');
}

/**
 * Date を 'YYYY/MM/DD' 形式に変換。
 */
function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

/**
 * 保護者名の宛名判定。
 * guardian_name が空またはカタカナのみ(全角カタカナ+スペース)の場合は
 * student_name にフォールバックする。
 */
function resolveAddressee(inquiry: Inquiry): string | null {
  const guardian = inquiry.guardian_name?.trim() ?? '';
  const isKanaOnly = /^[ァ-ヶー\s　]+$/.test(guardian);

  if (guardian && !isKanaOnly) {
    return guardian;
  }
  // 保護者名が空またはカナのみ → 生徒名を使う
  const student = inquiry.student_name?.trim() ?? '';
  return student || null;
}

// ────────────────────────────────────────────────────────
// 公開API
// ────────────────────────────────────────────────────────

/**
 * ネコポス(ヤマトB2クラウド外部取込)用CSVを生成する。
 *
 * @param inquiries      発送対象の問合せ一覧
 * @param settingsBySchool  school_id → InquirySchoolSettings のMap
 * @param today          出荷予定日として使う日付
 */
export function generateNekoposCsv(
  inquiries: Inquiry[],
  settingsBySchool: Map<string, InquirySchoolSettings>,
  today: Date
): YamatoCsvResult {
  const skipped: YamatoCsvResult['skipped'] = [];
  const includedIds: string[] = [];
  const dataLines: string[] = [];
  const todayStr = formatDate(today);

  for (const inquiry of inquiries) {
    const displayName = inquiry.student_name ?? inquiry.guardian_name ?? '—';

    // ── バリデーション ──

    // 教室の発送設定チェック
    const settings = settingsBySchool.get(inquiry.school_id);
    if (!settings || !settings.yamato_customer_code) {
      skipped.push({ name: displayName, reason: '教室の発送設定が未入力' });
      continue;
    }

    // 住所チェック(pref/detail/building がすべて空)
    const addressParts = [
      inquiry.address_pref ?? '',
      inquiry.address_detail ?? '',
      inquiry.address_building ?? '',
    ];
    if (addressParts.every((p) => p.trim() === '')) {
      skipped.push({ name: displayName, reason: '住所なし' });
      continue;
    }

    // 宛名解決
    const addressee = resolveAddressee(inquiry);
    if (!addressee) {
      skipped.push({ name: displayName, reason: '宛名なし' });
      continue;
    }

    // ── データ行組み立て ──
    const row = makeEmptyRow();

    // 送り状種類: 'A' = ネコポス(旧GASの'7'は誤り)
    row[1] = 'A';
    // 出荷予定日
    row[4] = todayStr;
    // お届け先電話番号
    row[8] = inquiry.phone ?? '';
    // お届け先郵便番号: ハイフン除去
    row[10] = (inquiry.postal_code ?? '').replace(/-/g, '');
    // お届け先住所: 都道府県 + 番地 + 建物名
    row[11] = `${inquiry.address_pref ?? ''}${inquiry.address_detail ?? ''}${inquiry.address_building ?? ''}`;
    // お届け先名
    row[15] = addressee;
    // 請求先顧客コード(18, 39 に同じ値)
    row[18] = settings.yamato_customer_code;
    row[39] = settings.yamato_customer_code;
    // ご依頼主電話番号
    row[19] = settings.sender_tel ?? '';
    // ご依頼主郵便番号
    row[21] = settings.sender_zip ?? '';
    // ご依頼主住所
    row[22] = settings.sender_address ?? '';
    // ご依頼主名
    row[24] = settings.sender_name ?? '';
    // 品名1
    row[27] = '資料';
    // 発行枚数
    row[37] = '1';
    // 個数口表示フラグ
    row[38] = '1';
    // 運賃管理番号(未設定時は '01')
    row[41] = settings.yamato_fare_code ?? '01';

    dataLines.push(rowToCsvLine(row));
    includedIds.push(inquiry.id);
  }

  // ヘッダー行 + データ行を CRLF で結合(GAS互換)
  const headerLine = rowToCsvLine(makeHeaderRow());
  const csv = [headerLine, ...dataLines].join('\r\n');

  return {
    csv,
    count: dataLines.length,
    skipped,
    includedIds,
  };
}

/**
 * BOMなしUTF-8でCSVをファイルダウンロードする。
 * ヤマトB2クラウドはBOMなしUTF-8での取込実績があるため、
 * BOM付きのdownloadCSV(csvUtils.ts)とは別に定義する。
 *
 * @param content  CSV文字列
 * @param filename ダウンロードファイル名
 */
export function downloadCsvNoBom(content: string, filename: string): void {
  // BOMを付けない点のみ csvUtils.ts の downloadCSV と異なる
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
