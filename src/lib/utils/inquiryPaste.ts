/**
 * HPシステムの問合せ詳細ページを全選択コピーした貼り付けテキストのパーサ。
 *
 * ブラウザでコピーするとタブ区切り・改行区切りの混在テキストになる。
 * 「ラベル」と「値」が同一行のタブ区切り、または次の行に来る形式に対応。
 *
 * 用途: /admin/inquiries/paste ページで PastedInquiry を受け取り、
 *       確認・編集 → createInquiry() へ渡す。
 */

import type { InquiryInsert } from '@/types/database';
import {
  normalizeGrade,
  parseJstToIso,
  parseDateOnly,
} from './inquiryCsv';

// ============================================================
// 公開型
// ============================================================

export interface PastedInquiry {
  /** school_id を除いた inquiries 投入データ */
  data: Omit<InquiryInsert, 'school_id'>;
  /** 受付教室の生値（例: "5F72 清瀬校"） */
  schoolRaw: string;
  /** 抽出した教室CD（例: "5F72"。先頭の英数字部分） */
  schoolCode: string;
  /** 抽出した教室名（例: "清瀬校"。教室CDと空白を除いた残り） */
  schoolName: string;
  /** ラベル→値のマップ（取れたもの全部。デバッグ・raw_source 用） */
  fields: Record<string, string>;
  /** 取込時の注意（重要項目が取れなかった等） */
  warnings: string[];
}

// ============================================================
// 内部ヘルパー
// ============================================================

/**
 * ラベル文字列を正規化して比較しやすくする。
 * - 全角カッコ → 半角カッコ
 * - 「※」と前後の空白を除去
 * - 先頭・末尾の空白を除去
 */
function normalizeLabel(label: string): string {
  return label
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s*※\s*/g, '')
    .trim();
}

/**
 * HPシステムで使われる既知ラベルのリスト（正規化後の形）。
 * ラベルマッチに使用する。
 */
const KNOWN_LABELS_NORMALIZED = new Set([
  '受付日時',
  '受付教室',
  '問合せ経路',
  'HP申込受付タイプ',
  '問合せ内容',
  '初回問合せ対応者',
  '保護者氏名(漢字)',
  '保護者氏名(カナ)',
  '生徒との関係性',
  '生徒氏名(漢字)',
  '生徒氏名(カナ)',
  '電話番号',
  'メールアドレス',
  'お子さまの性別',
  'お子さまの学年',
  '学校名',
  '郵便番号',
  '都道府県',
  'ご住所',
  '建物名',
  'ご質問・ご要望',
  '通塾目的',
  '希望科目',
  '通塾経験',
  '認知動機',
  '問合せ動機',
  '教室訪問申込日',
  '資料送付日',
  'メモ',
  '面談日時',
  '体験日時',
  '結果',
  '入会成約日',
  '個別週回数',
  '問合せNO',
]);

/**
 * ラベルが既知ラベルかどうかを判定する（正規化した上で比較）。
 */
function isKnownLabel(raw: string): boolean {
  return KNOWN_LABELS_NORMALIZED.has(normalizeLabel(raw));
}

/**
 * 全角数字を半角数字に変換する。
 */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 48));
}

/**
 * channel（問合せ経路）をアプリ内の値にマッピングする。
 * メモの値は「その他外部サイト」の細分類判定に使う。
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
function mapMedia(rawMedia: string, channel: string, warnings: string[]): string {
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
 * request_type（申込内容）をアプリ内の値にマッピングする。
 * 問合せ内容が優先、なければHP申込受付タイプを使う。
 */
function mapRequestType(inquiryContent: string, hpRequestType: string): string {
  const raw = (inquiryContent || hpRequestType || '').trim();
  if (!raw) return '';
  if (raw === '体験授業' || raw.includes('体験')) return '無料体験授業';
  if (raw === '資料請求') return '資料請求';
  if (raw === '学習相談・教室見学' || raw === '教室見学') return '学習相談・教室見学';
  if (raw.includes('料金') || raw.includes('講習') || raw.includes('キャンペーン')) return 'その他';
  return raw;
}

/**
 * 電話番号を正規化する。
 * - 数字以外を除去
 * - 9〜11桁で先頭0がなければ0を付与
 */
function normalizePhone(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return null;
  // 9〜11桁で先頭0がなければ0付与
  if (digits.length >= 9 && digits.length <= 11 && !digits.startsWith('0')) {
    return '0' + digits;
  }
  return digits;
}

/**
 * 受付教室の生値（例: "5F72 清瀬校"）から教室CDと教室名を抽出する。
 * 教室CD: 先頭の英数字連続部分（例: "5F72"）
 * 教室名: CDと空白を除いた残り（例: "清瀬校"）
 */
function parseSchoolField(raw: string): { schoolCode: string; schoolName: string } {
  if (!raw || !raw.trim()) return { schoolCode: '', schoolName: '' };
  const trimmed = raw.trim();
  // 先頭の英数字部分を教室CDとして抽出（全角英数字も半角に変換）
  const halfWidth = toHalfWidthDigits(trimmed)
    .replace(/[Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const codeMatch = halfWidth.match(/^([A-Za-z0-9]+)/);
  const schoolCode = codeMatch ? codeMatch[1] : '';
  // CDと後続の空白を除いた残りを教室名とする
  const schoolName = trimmed.replace(/^[A-Za-zＡ-Ｚａ-ｚ０-９0-9]+\s*/, '').trim();
  return { schoolCode, schoolName };
}

// ============================================================
// メインパーサ
// ============================================================

/**
 * HPシステムの問合せ詳細ページを全選択コピーした貼り付けテキストをパースする。
 *
 * 処理手順:
 * 1. テキストを行に分割し、各行をタブで分割してセル配列化する。
 * 2. 各ラベルに対して (a)同行右隣セル → (b)次行先頭セル → (c)コロン区切り の順で値を探す。
 * 3. 「ご質問・ご要望」「メモ」は複数行になりうるため次の既知ラベルまで連結する。
 * 4. 受付日時が取れない場合は null を返す。
 *
 * @param text 貼り付けられたテキスト
 * @returns PastedInquiry または null（受付日時が取れない場合）
 */
export function parsePastedInquiry(text: string): PastedInquiry | null {
  if (!text || !text.trim()) return null;

  // ---- 行分割 ----
  // \r\n, \r, \n すべてに対応
  const rawLines = text.split(/\r\n|\r|\n/);

  // 各行をタブで分割してセル配列にする
  // セル内のトリミングは値取得時に行う
  const lines: string[][] = rawLines.map((l) => l.split('\t'));

  // ---- ラベル→値マップの構築 ----
  const fields: Record<string, string> = {};

  /**
   * 全行を走査してラベルを探し、値を取得する。
   * 「ご質問・ご要望」と「メモ」は複数行対応（後処理）。
   */
  for (let li = 0; li < lines.length; li++) {
    const cells = lines[li];
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci].trim();
      if (!cell) continue;

      // (a) コロン区切り判定: "ラベル:値" 形式
      const colonIdx = cell.indexOf(':');
      if (colonIdx > 0) {
        const maybeLabel = cell.slice(0, colonIdx).trim();
        const maybeValue = cell.slice(colonIdx + 1).trim();
        if (isKnownLabel(maybeLabel) && !(normalizeLabel(maybeLabel) in fields)) {
          if (maybeValue) {
            fields[normalizeLabel(maybeLabel)] = maybeValue;
            continue;
          }
        }
      }

      // (b) ラベルとして認識できるか確認
      if (!isKnownLabel(cell)) continue;
      const normLabel = normalizeLabel(cell);

      // 複数行テキストの「ご質問・ご要望」「メモ」は後で連結処理するためスキップ
      if (normLabel === 'ご質問・ご要望' || normLabel === 'メモ') continue;

      // 既に取得済みならスキップ
      if (normLabel in fields) continue;

      // (c) 右隣のセルが値として使えるか確認
      let value = '';
      if (ci + 1 < cells.length && cells[ci + 1].trim()) {
        value = cells[ci + 1].trim();
      } else if (li + 1 < lines.length && lines[li + 1][0]?.trim()) {
        // 右隣が空なら次の行の先頭セルを値として使う
        const nextFirstCell = lines[li + 1][0].trim();
        // 次行先頭セルが既知ラベルでなければ値として採用
        if (!isKnownLabel(nextFirstCell)) {
          value = nextFirstCell;
        }
      }

      if (value) {
        fields[normLabel] = value;
      } else {
        // 値が空でも記録しておく（存在した証拠として）
        fields[normLabel] = '';
      }
    }
  }

  // ---- 複数行テキストの取得（ご質問・ご要望 / メモ） ----
  for (const multiLabel of ['ご質問・ご要望', 'メモ'] as const) {
    // ラベル行を見つける
    for (let li = 0; li < lines.length; li++) {
      const cells = lines[li];
      const found = cells.findIndex((c) => normalizeLabel(c.trim()) === multiLabel);
      if (found < 0) continue;

      const valueParts: string[] = [];

      // ラベルと同行に右隣セルがあれば最初の値として取る
      if (found + 1 < cells.length && cells[found + 1].trim()) {
        valueParts.push(cells[found + 1].trim());
      }

      // 次の行から次の既知ラベルが出るまで連結
      for (let ni = li + 1; ni < lines.length; ni++) {
        const nextCells = lines[ni];
        // 次の既知ラベルが出たら終了（右隣に値があってもラベル行とみなす）
        const hasKnownLabel = nextCells.some((c) => c.trim() && isKnownLabel(c.trim()));
        if (hasKnownLabel) break;
        const rowText = nextCells.join('\t').trim();
        if (rowText) valueParts.push(rowText);
      }

      if (valueParts.length > 0) {
        fields[multiLabel] = valueParts.join('\n');
      }
      break; // ラベルは1つのみ想定
    }
  }

  // ---- 受付日時（必須）----
  const inquiredAtRaw = fields['受付日時'] ?? '';
  // "2026/05/14 20:01" 形式のスラッシュも受け付ける
  const inquiredAtNormalized = inquiredAtRaw.replace(/\//g, '-');
  const inquiredAt = parseJstToIso(inquiredAtNormalized);
  if (!inquiredAt) {
    // 受付日時が取れない場合はパース失敗とする
    return null;
  }

  // ---- 受付教室 ----
  const schoolRaw = fields['受付教室'] ?? '';
  const { schoolCode, schoolName } = parseSchoolField(schoolRaw);

  const warnings: string[] = [];

  // ---- 学年 ----
  const gradeRaw = fields['お子さまの学年'] ?? '';
  const { grade, ok: gradeOk } = normalizeGrade(gradeRaw);
  if (gradeRaw && !gradeOk) {
    warnings.push(`学年を正規化できません（元の値: "${gradeRaw}"）`);
  }

  // ---- 性別 ----
  let gender: string | null = null;
  const genderRaw = fields['お子さまの性別'] ?? '';
  if (genderRaw === '男性') gender = '男';
  else if (genderRaw === '女性') gender = '女';
  else if (genderRaw) gender = '不明';

  // ---- メモ ----
  const memo = fields['メモ'] ?? '';

  // ---- channel（問合せ経路）----
  const channel = mapChannel(fields['問合せ経路'] ?? '', memo);

  // ---- media（認知動機）----
  const media = mapMedia(fields['認知動機'] ?? '', channel, warnings);

  // ---- request_type（申込内容）----
  const requestType = mapRequestType(fields['問合せ内容'] ?? '', fields['HP申込受付タイプ'] ?? '');

  // ---- 電話番号 ----
  const phone = normalizePhone(fields['電話番号'] ?? '');

  // ---- メールアドレス ----
  const emailRaw = (fields['メールアドレス'] ?? '').trim();
  const email = (emailRaw === 'なし' || emailRaw === '' ) ? null : emailRaw;

  // ---- 日付系フィールド ----
  const materialSentAt = parseDateOnly(fields['資料送付日'] ?? '');
  const trialAt = parseJstToIso(
    (fields['体験日時'] ?? '').replace(/\//g, '-')
  );
  const interviewAt = parseJstToIso(
    (fields['面談日時'] ?? '').replace(/\//g, '-')
  );
  const enrolledAt = parseDateOnly(fields['入会成約日'] ?? '');

  // ---- 個別週回数 ----
  const weeklyCountRaw = fields['個別週回数'] ?? '';
  const weeklyCountParsed = parseInt(toHalfWidthDigits(weeklyCountRaw), 10);
  const weeklyCount = isNaN(weeklyCountParsed) ? null : weeklyCountParsed;

  // ---- ステータス（結果）----
  const statusRaw = fields['結果'] ?? '';
  const status: InquiryInsert['status'] =
    statusRaw === '入会' ? 'enrolled' : 'in_progress';

  // ---- 氏名 ----
  const studentName =
    (fields['生徒氏名(漢字)'] ?? '').trim() ||
    (fields['生徒氏名(カナ)'] ?? '').trim() ||
    null;
  const studentNameKana = (fields['生徒氏名(カナ)'] ?? '').trim() || null;
  const guardianName =
    (fields['保護者氏名(漢字)'] ?? '').trim() ||
    (fields['保護者氏名(カナ)'] ?? '').trim() ||
    null;
  const guardianNameKana = (fields['保護者氏名(カナ)'] ?? '').trim() || null;

  // ---- 空文字 → null ヘルパー ----
  const orNull = (v: string | undefined): string | null =>
    v && v.trim() ? v.trim() : null;

  // ---- 重要項目の欠落警告 ----
  if (!guardianName && !studentName) {
    warnings.push('保護者名・生徒名がどちらも取得できませんでした');
  }
  if (!phone && !email) {
    warnings.push('電話番号・メールアドレスがどちらも取得できませんでした');
  }

  // ---- raw_source（貼り付けであることをフラグ） ----
  const rawSource: Record<string, unknown> = {
    ...fields,
    _pasted: 'true',
  };

  const data: Omit<InquiryInsert, 'school_id'> = {
    hp_inquiry_no: orNull(fields['問合せNO']),
    inquired_at: inquiredAt,
    student_name: studentName,
    student_name_kana: studentNameKana,
    guardian_name: guardianName,
    guardian_name_kana: guardianNameKana,
    relationship: orNull(fields['生徒との関係性']),
    grade: grade || null,
    gender,
    phone,
    email,
    postal_code: orNull(fields['郵便番号']),
    address_pref: orNull(fields['都道府県']),
    address_detail: orNull(fields['ご住所']),
    address_building: orNull(fields['建物名']),
    school_name: orNull(fields['学校名']),
    media: media || null,
    channel: channel || null,
    request_type: requestType || null,
    device: null,
    initial_message: orNull(fields['ご質問・ご要望']),
    purpose: orNull(fields['通塾目的']),
    preferred_subjects: orNull(fields['希望科目']),
    juku_experience: orNull(fields['通塾経験']),
    status,
    material_sent_at: materialSentAt,
    trial_at: trialAt,
    trial_teacher: null,
    interview_at: interviewAt,
    enrolled_at: enrolledAt,
    weekly_count: weeklyCount,
    linked_student_id: null,
    referrer_inquiry_note: null,
    raw_source: rawSource,
    note: orNull(memo),
    created_by: null,
  };

  return {
    data,
    schoolRaw,
    schoolCode,
    schoolName,
    fields,
    warnings,
  };
}
