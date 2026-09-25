/**
 * 模試結果の一括取り込み（MockPasteImportModal）の読み取り部分。
 * ------------------------------------------------------------------
 * ★画面から切り出した純関数。以前は画面の中にあってテストが無く、志望校の
 *   合格可能性を読み捨てていたことに誰も気づかなかった（2026-09-23 に修正）。
 */

import type { Student } from '@/types/database';
import { readMockSchoolPairs, type MockSchoolChoice } from './mockSchools';

/** パースした1生徒分のデータ */
export interface ParsedMockRow {
  originalCode: string;
  originalName: string;
  matchedStudent: Student | null;
  scores: {
    japanese: number | null;
    math: number | null;
    english: number | null;
    social: number | null;
    science: number | null;
    hensa_3: number | null;
    hensa_5: number | null;
  };
  /** 志望校（最大5枠）。★枠の番号は模試の位置のまま（1〜3＝公立、4〜5＝私立） */
  schools: MockSchoolChoice[];
}

/** 氏名を正規化（全角スペース・半角スペース除去、全角英数→半角） */
export function normalizeName(name: string): string {
  return name
    .replace(/[\s　]+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .trim();
}

/** 生徒名でマッチング */
export function findStudentByName(name: string, students: Student[]): Student | null {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  // 完全一致（姓+名）
  for (const s of students) {
    const fullName = normalizeName(s.last_name + s.first_name);
    if (fullName === normalized) return s;
  }
  // カナ一致
  for (const s of students) {
    const fullKana = normalizeName((s.last_name_kana ?? '') + (s.first_name_kana ?? ''));
    if (fullKana === normalized) return s;
  }
  // 部分一致（姓だけ一致 + 名の先頭一致）
  for (const s of students) {
    const last = normalizeName(s.last_name);
    const first = normalizeName(s.first_name);
    if (normalized.startsWith(last) && normalized.endsWith(first)) return s;
  }
  return null;
}

/** 数値パース（空白や全角数字対応） */
export function parseNum(val: string | number | undefined | null): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  const trimmed = val
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (trimmed === '' || trimmed === '-' || trimmed === '—') return null;
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : n;
}

/** ファイルの行で、志望校の対が始まる列 */
const FILE_SCHOOL_START = 26;
/** 貼り付けの得点行で、志望校の対が始まる列 */
const PASTE_SCHOOL_START = 14;

/**
 * xlsx/CSVファイルから読み込んだデータをパースする。
 *
 * 進研テストの列構造:
 *   0:登録番号, 1:塾コード, 2:塾名, 3:教室名, 4:学年, 5:塾内番号, 6:性別, 7:氏名,
 *   8:年度, 9:商品, 10:学年, 11:回号,
 *   12:国語得点, 13:国語偏差値, 14:数学得点, 15:数学偏差値,
 *   16:英語得点, 17:英語偏差値, 18:社会得点, 19:社会偏差値,
 *   20:理科得点, 21:理科偏差値, 22:二科三科得点, 23:二科三科偏差値,
 *   24:四科五科得点, 25:四科五科偏差値,
 *   26〜: 志望校名,合格可能性 のペア（最大5つ。1〜3＝公立、4〜5＝私立）
 */
export function parseFileRows(
  rows: (string | number | undefined)[][],
  students: Student[]
): ParsedMockRow[] {
  const results: ParsedMockRow[] = [];

  // ヘッダー行をスキップ（先頭行）
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 12) continue;

    const name = String(r[7] || '').trim();
    if (!name) continue;

    results.push({
      originalCode: String(r[5] || ''),
      originalName: name,
      matchedStudent: findStudentByName(name, students),
      scores: {
        japanese: parseNum(r[13]),
        math: parseNum(r[15]),
        english: parseNum(r[17]),
        social: parseNum(r[19]),
        science: parseNum(r[21]),
        hensa_3: parseNum(r[23]),
        hensa_5: parseNum(r[25]),
      },
      schools: readMockSchoolPairs(r, FILE_SCHOOL_START),
    });
  }

  return results;
}

/**
 * コピペされたデータをパースする。
 *
 * フォーマット:
 *   生徒行ブロック: 番号 TAB 性別 TAB 氏名
 *   得点行ブロック: 国語得点 TAB 国語SS TAB 数学得点 TAB 数学SS TAB ... TAB 志望校名 TAB 合格可能性 ...
 *   ★生徒行が先にまとめて並び、得点行が同じ順で後に続く（模試会社のサイトの表の都合）。
 */
export function parsePastedData(text: string, students: Student[]): ParsedMockRow[] {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));

  const headerKeywords = [
    '塾内',
    '番号',
    '性別',
    '氏名',
    '得点',
    'ＳＳ',
    'SS',
    '志望校',
    '合格',
    '可能性',
    '年度',
    '商品',
    '学年',
    '回号',
    '偏差値',
  ];

  const studentRows: { code: string; name: string }[] = [];
  const scoreRows: string[][] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isHeader = headerKeywords.some((kw) => trimmed.includes(kw));
    if (isHeader) continue;

    // ★列の位置で読むので、行の頭は trim しない（頭の空欄を詰めると列がずれる）。
    //   末尾の空き枠が消えるのは構わない（空き枠は読まないため）。
    const cols = line.replace(/\s+$/, '').split('\t');
    const col0 = (cols[0] || '').trim();
    const col1 = (cols[1] || '').trim();
    const col2 = (cols[2] || '').trim();

    const isGender = col1 === '男' || col1 === '女';
    const hasName = col2.length > 0 && /[　-鿿゠-ヿ぀-ゟ]/.test(col2);
    const restEmpty = cols.slice(3).every((c) => !c || !c.trim());

    if (isGender && hasName && restEmpty) {
      studentRows.push({ code: col0, name: col2 });
      continue;
    }

    const firstNum = parseNum(col0);
    if (firstNum !== null && cols.length >= 6) {
      scoreRows.push(cols);
      continue;
    }
  }

  const results: ParsedMockRow[] = [];
  const count = Math.min(studentRows.length, scoreRows.length);

  for (let i = 0; i < count; i++) {
    const sr = studentRows[i];
    const sc = scoreRows[i];

    // 偏差値列を参照（得点ではなく SS を取得）
    // 0:国語得点, 1:国語SS, 2:数学得点, 3:数学SS, 4:英語得点, 5:英語SS,
    // 6:社会得点, 7:社会SS, 8:理科得点, 9:理科SS,
    // 10:二科三科得点, 11:二科三科SS, 12:四科五科得点, 13:四科五科SS
    results.push({
      originalCode: sr.code,
      originalName: sr.name,
      matchedStudent: findStudentByName(sr.name, students),
      scores: {
        japanese: parseNum(sc[1]),
        math: parseNum(sc[3]),
        english: parseNum(sc[5]),
        social: parseNum(sc[7]),
        science: parseNum(sc[9]),
        hensa_3: parseNum(sc[11]),
        hensa_5: parseNum(sc[13]),
      },
      schools: readMockSchoolPairs(sc, PASTE_SCHOOL_START),
    });
  }

  return results;
}
