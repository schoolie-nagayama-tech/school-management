/**
 * 旧スプレッドシート（問合せ管理表.xlsx）の移行用パーサ。
 *
 * 対象シート: 「問合せ管理」(無ければ先頭シート)
 * 列構成: A〜AH の34列。ヘッダ行で列名解決するため、列順ズレに頑健。
 *
 * 用途: 初回移行のみ想定。再実行時は importMigrationRows() 側の重複ガードでスキップされる。
 */

import * as XLSX from 'xlsx';
import type { InquiryInsert, InquiryContactInsert } from '@/types/database';

// ============================================================
// 公開型
// ============================================================

export interface MigrationRow {
  /** school_id を除いた inquiries 投入データ */
  data: Omit<InquiryInsert, 'school_id'>;
  /** シートの教室名（例: "永山"）。API層で schools.name 末尾「校」を除いた名前と突合 */
  schoolNameShort: string;
  /** 1st/2nd/3rd コンタクト列から生成したコンタクト履歴 */
  contacts: Omit<InquiryContactInsert, 'inquiry_id' | 'school_id'>[];
  /** メール/SMS列から生成した送信ログ */
  mailLogs: { method: 'email' | 'sms'; sent_at: string }[];
  /** パース時の注意（ステータス不明等）。確認画面で表示 */
  warnings: string[];
}

export interface ParseMigrationXlsxResult {
  rows: MigrationRow[];
  /** 問合日が無い/パース不能でスキップした行数 */
  skipped: number;
}

// ============================================================
// 内部定数 — シートのヘッダ名と内部フィールドの対応表
// ============================================================

/** 列名の正規化（全角スペース・前後空白を除去）してマップキーにする */
function normHeader(s: string): string {
  return s.trim().replace(/　/g, ' ');
}

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * Excelセル値を文字列に変換する。
 * - Date 型の場合は「YYYY-MM-DD」形式で返す（cellDates:true 時に Date になる）。
 * - null/undefined は '' を返す。
 */
/** Date のローカルTZ(=利用者のJST)の日付成分を "YYYY-MM-DD" にする */
function localDayStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cellStr(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    // xlsx の cellDates:true はローカルTZの Date を返すため、ローカル成分で日付を切り出す
    // (toISOString だと JST 環境では前日にズレる)
    return localDayStr(v);
  }
  return String(v).trim();
}

/**
 * セル値を Date | null に変換する。
 * - cellDates:true で既に Date になっている場合はそのまま。
 * - 文字列の場合は new Date() でパース (best-effort)。
 * - 数値の場合は Excel シリアル値として xlsx の SSF で変換。
 * - 変換できない/無効な場合は null。
 */
function cellDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? null : v;
  }
  if (typeof v === 'number') {
    // xlsx.SSF.parse_date_code でシリアル値 → Dateに変換
    try {
      const parsed = XLSX.SSF.parse_date_code(v);
      if (parsed) {
        // parsed は { y, m, d, H, M, S } のオブジェクト。
        // cellDates:true の Date と同様にローカルTZで生成して日付成分を一致させる
        const d = new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S);
        return isNaN(d.getTime()) ? null : d;
      }
    } catch {
      // ignore
    }
    return null;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Date を「JSTの日付の 00:00+09:00」として ISO 8601 文字列に変換する。
 * 例: 2024-04-01(UTC日付部分) → "2024-04-01T00:00:00+09:00"
 */
function dateToJstIso(d: Date): string {
  // ローカルTZ(JST)の日付成分を「その日の 00:00+09:00」として扱う
  return `${localDayStr(d)}T00:00:00+09:00`;
}

/**
 * Date を "YYYY-MM-DD" 文字列に変換する（ローカルTZの日付成分を使用）。
 */
function dateToDayStr(d: Date): string {
  return localDayStr(d);
}

/**
 * 電話番号を正規化する。
 * - 数値セルで先頭 0 が落ちている場合は補完する。
 * - 数字以外を除去し、10〜11桁かつ先頭が '0' でない場合に '0' を付与。
 * - 空・変換不能 → null。
 */
function normalizePhone(v: unknown): string | null {
  let s = '';
  if (typeof v === 'number') {
    // 数値 → 文字列化（小数点以下は切り捨て）
    s = Math.floor(v).toString();
  } else if (typeof v === 'string') {
    s = v.trim();
  }
  if (!s) return null;
  // 数字以外を除去
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  // 先頭が '0' 以外で9〜11桁 → '0' を補完
  // (携帯090...→数値セルで90...の10桁 / 固定042-339-...→42...の9桁 になるため)
  let result = digits;
  if (result.length >= 9 && result.length <= 11 && result[0] !== '0') {
    result = '0' + result;
  }
  return result || null;
}

/**
 * 郵便番号を正規化する。
 * - 数値セルは文字列化し、7桁未満なら先頭ゼロ埋め。
 * - 空 → null。
 */
function normalizePostalCode(v: unknown): string | null {
  if (v == null || v === '') return null;
  let s = '';
  if (typeof v === 'number') {
    s = Math.floor(v).toString();
    // 7桁未満なら先頭ゼロ埋め
    while (s.length < 7) s = '0' + s;
  } else {
    s = String(v).trim().replace(/[^\d-]/g, '');
  }
  return s || null;
}

/**
 * メールアドレスを正規化する。
 * 'なし'(大文字小文字問わず)や空 → null。
 */
function normalizeEmail(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : cellStr(v);
  if (!s || /^なし$/i.test(s)) return null;
  return s;
}

/**
 * 結論列 → status をマッピングする。
 * 不明な値は 'in_progress' + warning を返す。
 */
function mapStatus(
  v: unknown,
  warnings: string[]
): 'in_progress' | 'enrolled' | 'unreachable' | 'lost' | 'trial_lost' {
  const s = cellStr(v);
  if (!s) return 'in_progress';
  if (s === '入会') return 'enrolled';
  if (s === '連絡不通') return 'unreachable';
  if (s === '没') return 'lost';
  if (s === '体験没') return 'trial_lost';
  if (s === '対応中') return 'in_progress';
  // 未知の値は in_progress に fallback して警告
  warnings.push(`ステータス不明 (結論: "${s}") → in_progress として扱います`);
  return 'in_progress';
}

/**
 * 男女列 → gender をマッピングする。
 * '男'/'女' 以外は '不明' にする。
 */
function mapGender(v: unknown): string {
  const s = cellStr(v);
  if (s === '男' || s === '女') return s;
  return '不明';
}

// ============================================================
// 公開 API
// ============================================================

/**
 * 問合せ管理表.xlsx をパースして MigrationRow[] を返す。
 *
 * - シート名「問合せ管理」を優先し、無ければ先頭シートを使う。
 * - ヘッダ行で列名を解決するため、列の追加・移動に対して頑健。
 * - 教室名が空の行はスキップ。
 * - 問合日が無い/パース不能な行はスキップ（skipped にカウント）。
 *
 * @param file ブラウザ File オブジェクト
 */
export async function parseMigrationXlsx(file: File): Promise<ParseMigrationXlsxResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });

  // シート名「問合せ管理」を優先、無ければ先頭シートを使用
  const sheetName = wb.SheetNames.includes('問合せ管理')
    ? '問合せ管理'
    : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // 2次元配列として取得（raw:true で生値のまま取得）
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  if (matrix.length === 0) {
    return { rows: [], skipped: 0 };
  }

  // ---- ヘッダ行から列インデックスを解決 ----
  // 1行目をヘッダとして扱う
  const headerRow = matrix[0] as unknown[];
  const colIndex: Record<string, number> = {};
  for (let i = 0; i < headerRow.length; i++) {
    const h = normHeader(cellStr(headerRow[i]));
    if (h) colIndex[h] = i;
  }

  // 列インデックス取得ヘルパー
  const col = (name: string): number => colIndex[normHeader(name)] ?? -1;

  const rows: MigrationRow[] = [];
  let skipped = 0;

  // ヘッダ行(0行目)をスキップして2行目以降を処理
  for (let rowIdx = 1; rowIdx < matrix.length; rowIdx++) {
    const r = matrix[rowIdx] as unknown[];

    // セル値取得ヘルパー（存在しないインデックスは空文字）
    const get = (name: string): unknown => {
      const i = col(name);
      return i >= 0 ? r[i] : '';
    };
    const str = (name: string): string => cellStr(get(name));

    // ---- 教室名が空の行はスキップ ----
    const schoolNameShort = str('教室名').replace(/[\s　]+/g, '').replace(/校$/, '');
    if (!schoolNameShort) continue;

    // ---- 問合日のパースと検証 ----
    const inquiredDateRaw = get('問合日');
    const inquiredDate = cellDate(inquiredDateRaw);
    if (!inquiredDate) {
      // 問合日が無い/パース不能 → スキップ
      skipped++;
      continue;
    }
    const inquired_at = dateToJstIso(inquiredDate);
    const inquiredDayStr = dateToDayStr(inquiredDate); // YYYY-MM-DD(重複判定用)

    const warnings: string[] = [];

    // ---- 基本情報 ----
    const student_name = str('生徒名') || null;
    const guardian_name = str('保護者名') || null;
    const grade = str('学年') || null;
    const gender = mapGender(get('男女'));

    // ---- 電話 ----
    const phone = normalizePhone(get('TEL'));

    // ---- 媒体 / 手段 / 申込内容 ----
    const media = str('問合媒体') || null;
    const channel = str('問合手段') || null;
    const request_type = str('申込内容') || null;

    // ---- 資送日 (YYYY-MM-DD) ----
    const materialSentDateRaw = get('資送日');
    const materialSentDate = cellDate(materialSentDateRaw);
    const material_sent_at = materialSentDate ? dateToDayStr(materialSentDate) : null;

    // ---- メールアドレス ----
    const email = normalizeEmail(get('メールアドレス'));

    // ---- 体験日 (timestamptz: 00:00 JST) ----
    const trialDateRaw = get('体験日');
    const trialDate = cellDate(trialDateRaw);
    const trial_at = trialDate ? dateToJstIso(trialDate) : null;

    // ---- 入面日 (timestamptz: 00:00 JST) ----
    const interviewDateRaw = get('入面日');
    const interviewDate = cellDate(interviewDateRaw);
    const interview_at = interviewDate ? dateToJstIso(interviewDate) : null;

    // ---- 入会日 (YYYY-MM-DD) ----
    const enrolledDateRaw = get('入会日');
    const enrolledDate = cellDate(enrolledDateRaw);
    const enrolled_at = enrolledDate ? dateToDayStr(enrolledDate) : null;

    // ---- 結論 → status ----
    const status = mapStatus(get('結論'), warnings);

    // ---- 週回数 ----
    const weeklyCountRaw = str('週回数');
    const weeklyCountParsed = parseInt(weeklyCountRaw, 10);
    const weekly_count = isNaN(weeklyCountParsed) ? null : weeklyCountParsed;

    // ---- 体験実施講師 ----
    const trial_teacher = str('体験実施講師') || null;

    // ---- 郵便番号 ----
    const postal_code = normalizePostalCode(get('〒'));

    // ---- 住所 ----
    // AC列の「住所」(統合版)があればそちら優先。
    // なければ 住所① を address_pref、住所② を address_detail に入れる。
    const addrUnified = str('住所');
    const addr1 = str('住所①');
    const addr2 = str('住所②');
    let address_pref: string | null = null;
    let address_detail: string | null = null;
    if (addrUnified) {
      address_detail = addrUnified;
    } else {
      address_pref = addr1 || null;
      address_detail = addr2 || null;
    }

    // ---- raw_source: 全34列を {列名: 文字列化した値} + {_migrated: 'true'} ----
    const raw_source: Record<string, unknown> = { _migrated: 'true' };
    for (let ci = 0; ci < headerRow.length; ci++) {
      const hName = normHeader(cellStr(headerRow[ci]));
      if (hName) raw_source[hName] = cellStr(r[ci]);
    }

    // ---- data (InquiryInsert から school_id を除いたもの) ----
    const data: Omit<InquiryInsert, 'school_id'> = {
      hp_inquiry_no: null, // スプレッドシートには問合せNOが無い
      inquired_at,
      student_name,
      student_name_kana: null,
      guardian_name,
      guardian_name_kana: null,
      relationship: null,
      grade,
      gender,
      phone,
      email,
      postal_code,
      address_pref,
      address_detail,
      address_building: null,
      school_name: null,
      media,
      channel,
      request_type,
      device: null,
      initial_message: null,
      purpose: null,
      preferred_subjects: null,
      juku_experience: null,
      status,
      material_sent_at,
      trial_at,
      trial_teacher,
      interview_at,
      enrolled_at,
      weekly_count,
      linked_student_id: null,
      referrer_inquiry_note: null,
      raw_source,
      note: null,
      created_by: null,
    };

    // ---- コンタクト履歴: 1st/2nd/3rd の日付+反応ペアから生成 ----
    const contacts: Omit<InquiryContactInsert, 'inquiry_id' | 'school_id'>[] = [];
    const contactPairs: { dateCol: string; noteCol: string }[] = [
      { dateCol: '1日付', noteCol: '1stct反応' },
      { dateCol: '2日付', noteCol: '2ndct反応' },
      { dateCol: '3日付', noteCol: '3rdct反応' },
    ];
    for (const { dateCol, noteCol } of contactPairs) {
      const ctDateRaw = get(dateCol);
      const ctNoteRaw = str(noteCol);
      if (!ctDateRaw && !ctNoteRaw) continue; // 日付も反応も無ければスキップ

      const ctDate = cellDate(ctDateRaw);
      // 日付が無い場合は問合日をフォールバックとして使用
      const contacted_at = ctDate ? dateToJstIso(ctDate) : inquired_at;

      contacts.push({
        contacted_at,
        method: 'tel' as const,
        direction: 'outbound' as const,
        note: ctNoteRaw || null,
      });
    }

    // ---- メール/SMSログ: 「メール」「ＳＭＳ」列の日付から生成 ----
    const mailLogs: { method: 'email' | 'sms'; sent_at: string }[] = [];

    const mailDateRaw = get('メール');
    const mailDate = cellDate(mailDateRaw);
    if (mailDate) {
      mailLogs.push({ method: 'email', sent_at: dateToJstIso(mailDate) });
    }

    const smsDateRaw = get('ＳＭＳ');
    const smsDate = cellDate(smsDateRaw);
    if (smsDate) {
      mailLogs.push({ method: 'sms', sent_at: dateToJstIso(smsDate) });
    }

    rows.push({
      data,
      schoolNameShort,
      contacts,
      mailLogs,
      warnings,
    });

    // rowIdx と inquiredDayStr は重複ガードには使わない（API層で行う）
    // 未使用変数の抑制
    void inquiredDayStr;
  }

  return { rows, skipped };
}
