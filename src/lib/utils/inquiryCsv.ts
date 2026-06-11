/**
 * HPシステムの問合せCSVエクスポート（boshu_applicant_*.csv）パーサ。
 *
 * ファイル形式: Shift_JIS(cp932) / 57列 / ヘッダ行あり
 * 用途: CSV確認画面で ParsedInquiryRow[] を表示し、確定後に importInquiries() へ渡す。
 */

import Papa from 'papaparse';
import type { InquiryInsert } from '@/types/database';

// ============================================================
// 公開型
// ============================================================

export interface ParsedInquiryRow {
  /** school_id を除いた inquiries 投入データ。school は schoolName で後から解決する */
  data: Omit<InquiryInsert, 'school_id'>;
  /** CSVの教室名（例: "永山校"）。API層で schools.name と突合して school_id を解決 */
  schoolName: string;
  /** CSVの教室CD（例: "5M13"）。schoolName で解決できない時のフォールバック用 */
  schoolCode: string;
  /** CSV全57列を {ヘッダ名: 値} で保持。data.raw_source に入れる元 */
  rawSource: Record<string, string>;
  /** 取込時の注意（学年がパースできなかった等）。確認画面で表示 */
  warnings: string[];
}

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * 全角数字を半角数字に変換する。
 * 例: "２" → "2"
 */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 48));
}

/**
 * JST日時文字列（"2026-06-06 15:19:39" 形式）を UTC の ISO 8601 文字列に変換する。
 * JST = UTC+9 として扱う。
 * 空文字列や変換不能な文字列の場合は null を返す。
 */
export function parseJstToIso(s: string): string | null {
  if (!s || !s.trim()) return null;
  // スペースを T に置換し JST オフセットを付与してパース
  const normalized = s.trim().replace(' ', 'T') + '+09:00';
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * 日付文字列から "YYYY-MM-DD" を返す。
 * - "YYYY-MM-DD" 形式はそのまま返す。
 * - 日時形式（スペースや T を含む）は日付部分のみを切り出す。
 * - 空文字列 → null。
 */
export function parseDateOnly(s: string): string | null {
  if (!s || !s.trim()) return null;
  const trimmed = s.trim();
  // "YYYY-MM-DD" or "YYYY/MM/DD" or 日時形式（先頭10文字が日付部分）
  const datePart = trimmed.split(/[\sT]/)[0];
  // YYYY-MM-DD か YYYY/MM/DD を許容
  const match = datePart.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
  if (!match) return null;
  // "-" 区切りに正規化して返す
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * 学年表記を正規化する。
 * 例: "中学２年" → "中2", "高校３年" → "高3", "小学５年" → "小5"
 * 全角数字は半角に変換する。
 * 変換できない場合は ok=false で原文を返す。
 */
export function normalizeGrade(s: string): { grade: string; ok: boolean } {
  if (!s || !s.trim()) return { grade: '', ok: true };
  // 全角数字を半角に変換してから正規化
  let normalized = toHalfWidthDigits(s.trim());
  // "小学" → "小", "中学" → "中", "高校" → "高"
  normalized = normalized
    .replace('小学', '小')
    .replace('中学', '中')
    .replace('高校', '高')
    .replace('高等', '高');
  // "〇年生" / "〇年" / "〇校" の語尾を削除
  normalized = normalized.replace(/[年生校]$/, '');
  // "既卒" はそのまま
  if (normalized === '既卒') return { grade: '既卒', ok: true };
  // "小N" / "中N" / "高N" の形式に当てはまるか検証
  if (/^[小中高]\d+$/.test(normalized)) {
    return { grade: normalized, ok: true };
  }
  // 変換できなかった場合は原文を返す
  return { grade: s.trim(), ok: false };
}

/**
 * channel（問合せ経路）をアプリ内の値にマッピングする。
 * メモ列の値は「その他外部サイト」の細分類判定に使う。
 */
function mapChannel(raw: string, memo: string): string {
  if (!raw) return '';
  if (raw === 'HP' || raw === 'CC') return '本部HP';
  if (raw === '塾ナビ') return '塾ナビ';
  if (raw === '教室電話') return '電話';
  if (raw === '直接来校') return '直来';
  if (raw === 'その他外部サイト') {
    if (memo.includes('塾選')) return '塾選';
    if (memo.includes('塾シル')) return '塾シル';
    return '';
  }
  // その他の値は原文を返す
  return raw;
}

/**
 * media（認知動機）をアプリ内の値にマッピングする。
 * 優先順位に基づき、カンマ区切りの複数値から最初に該当する媒体を返す。
 *
 * 優先順位:
 * 1. 友人・知人の紹介 → "友人紹介"
 * 2. 教室の看板       → "看板・外パンフ"
 * 3. チラシ           → "チラシ"
 * 4. 塾比較サイト・クチコミサイト → channel の値を流用
 * 5. ホームページ     → "本部HP"
 * 6. どれにも当たらない → "" (warnings に追加)
 */
function mapMedia(
  rawMedia: string,
  channel: string,
  warnings: string[]
): string {
  if (!rawMedia || !rawMedia.trim()) {
    warnings.push('媒体を判定できません（認知動機が空です）');
    return '';
  }
  if (rawMedia.includes('友人・知人の紹介')) return '友人紹介';
  if (rawMedia.includes('教室の看板')) return '看板・外パンフ';
  if (rawMedia.includes('チラシ')) return 'チラシ';
  if (rawMedia.includes('塾比較サイト・クチコミサイト')) return channel;
  if (rawMedia.includes('ホームページ')) return '本部HP';
  warnings.push(`媒体を判定できません（認知動機: ${rawMedia}）`);
  return '';
}

/**
 * request_type（受付タイプ）をアプリ内の値にマッピングする。
 * 受付タイプが空の場合は問合せ内容を代替として使う。
 */
function mapRequestType(requestType: string, inquiryContent: string): string {
  const raw = requestType.trim() || inquiryContent.trim();
  if (!raw) return '';
  if (raw === '体験授業' || raw.includes('体験')) return '無料体験授業';
  if (raw === '資料請求') return '資料請求';
  if (raw === '学習相談・教室見学' || raw === '教室見学') return '学習相談・教室見学';
  if (raw.includes('料金') || raw.includes('講習') || raw.includes('キャンペーン')) return 'その他';
  return raw;
}

// ============================================================
// 公開 API
// ============================================================

/**
 * HPシステムの問合せCSVファイル（Shift_JIS, 57列）をパースして ParsedInquiryRow[] を返す。
 *
 * - 問合せNOが空の行はスキップする。
 * - 受付日時がパース不能な行はスキップする（ログ出力あり）。
 * - papaparse の header:true でカラム名をキーにした Record<string,string> として読み込む。
 */
export async function parseInquiryCsvFile(file: File): Promise<ParsedInquiryRow[]> {
  // Shift_JIS(cp932) として読み込む
  const buf = await file.arrayBuffer();
  const text = new TextDecoder('shift-jis').decode(buf);

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const results: ParsedInquiryRow[] = [];

  for (const row of parsed.data) {
    // 問合せNOが空の行はスキップ（ヘッダ行の重複や集計行対策）
    const hpNo = (row['問合せNO'] ?? '').trim();
    if (!hpNo) continue;

    const warnings: string[] = [];

    // rawSource: CSV全57列を文字列マップとして保持
    const rawSource: Record<string, string> = { ...row };

    // ---- 受付日時 ----
    const inquiredAtRaw = row['受付日時'] ?? '';
    const inquiredAt = parseJstToIso(inquiredAtRaw);
    if (!inquiredAt) {
      // パース不能な行はスキップ（正常な運用では受付日時は必ず存在する）
      console.warn(`[inquiryCsv] 受付日時をパースできないためスキップ: 問合せNO=${hpNo}, 受付日時="${inquiredAtRaw}"`);
      continue;
    }

    // ---- 学年 ----
    const gradeRaw = row['お子さまの学年'] ?? '';
    const { grade, ok: gradeOk } = normalizeGrade(gradeRaw);
    if (!gradeOk) {
      warnings.push(`学年を正規化できません（元の値: "${gradeRaw}"）`);
    }

    // ---- 性別 ----
    let gender: string;
    const genderRaw = row['お子さまの性別'] ?? '';
    if (genderRaw === '男性') gender = '男';
    else if (genderRaw === '女性') gender = '女';
    else gender = '不明';

    // ---- channel（問合せ経路）----
    const memo = row['メモ'] ?? '';
    const channel = mapChannel(row['問合せ経路'] ?? '', memo);

    // ---- media（認知動機）----
    const media = mapMedia(row['認知動機'] ?? '', channel, warnings);

    // ---- request_type（受付タイプ）----
    const requestType = mapRequestType(row['受付タイプ'] ?? '', row['問合せ内容'] ?? '');

    // ---- material_sent_at（資料送付日）----
    const materialSentAt = parseDateOnly(row['資料送付日'] ?? '');

    // ---- trial_at（体験日時）----
    const trialAt = parseJstToIso(row['体験日時'] ?? '');

    // ---- interview_at（面談日時）----
    const interviewAt = parseJstToIso(row['面談日時'] ?? '');

    // ---- enrolled_at（入会成約日）----
    const enrolledAt = parseDateOnly(row['入会成約日'] ?? '');

    // ---- weekly_count（個別週回数）----
    const weeklyCountRaw = row['個別週回数'] ?? '';
    const weeklyCountParsed = parseInt(toHalfWidthDigits(weeklyCountRaw), 10);
    const weeklyCount = isNaN(weeklyCountParsed) ? null : weeklyCountParsed;

    // ---- status（結果）----
    // CSVからは "入会" → enrolled, それ以外は in_progress のみ取込む
    const statusRaw = row['結果'] ?? '';
    const status: InquiryInsert['status'] =
      statusRaw === '入会' ? 'enrolled' : 'in_progress';

    // ---- 生徒氏名（漢字優先、なければカナ）----
    const studentName =
      (row['生徒氏名（漢字）'] ?? '').trim() ||
      (row['生徒氏名（カナ）'] ?? '').trim() ||
      null;

    // ---- 保護者氏名（漢字優先、なければカナ）----
    const guardianName =
      (row['保護者氏名（漢字）'] ?? '').trim() ||
      (row['保護者氏名（カナ）'] ?? '').trim() ||
      null;

    // ---- null 変換ヘルパー（空文字 → null）----
    const orNull = (v: string | undefined): string | null =>
      v && v.trim() ? v.trim() : null;

    const data: Omit<InquiryInsert, 'school_id'> = {
      hp_inquiry_no: hpNo,
      inquired_at: inquiredAt,
      student_name: studentName,
      student_name_kana: orNull(row['生徒氏名（カナ）']),
      guardian_name: guardianName,
      guardian_name_kana: orNull(row['保護者氏名（カナ）']),
      relationship: orNull(row['生徒との関係性']),
      grade: grade || null,
      gender,
      // 電話番号は変換せずそのまま保持（先頭 0 付きで入っているため変換不要）
      phone: orNull(row['電話番号']),
      email: orNull(row['メールアドレス']),
      postal_code: orNull(row['郵便番号']),
      address_pref: orNull(row['都道府県']),
      address_detail: orNull(row['ご住所']),
      address_building: orNull(row['建物名']),
      school_name: orNull(row['学校名']),
      media: media || null,
      channel: channel || null,
      request_type: requestType || null,
      device: orNull(row['デバイス']),
      initial_message: orNull(row['ご質問・ご要望']),
      purpose: orNull(row['通塾目的']),
      preferred_subjects: orNull(row['希望科目']),
      juku_experience: orNull(row['通塾経験']),
      status,
      material_sent_at: materialSentAt,
      trial_at: trialAt,
      trial_teacher: orNull(row['体験担当講師']),
      interview_at: interviewAt,
      enrolled_at: enrolledAt,
      weekly_count: weeklyCount,
      linked_student_id: null,
      referrer_inquiry_note: null,
      // raw_source には全57列を保持する（型は Record<string, unknown>）
      raw_source: rawSource as Record<string, unknown>,
      note: null,
      created_by: null,
    };

    results.push({
      data,
      schoolName: (row['教室名'] ?? '').trim(),
      schoolCode: (row['教室CD'] ?? '').trim(),
      rawSource,
      warnings,
    });
  }

  return results;
}
