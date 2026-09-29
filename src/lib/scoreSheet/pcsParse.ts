/**
 * PCS 結果帳票（スクールIE）を、PDF の文字の層の「文字＋座標」だけで読む。AI を使わない。
 * 正典: docs/score-sheet-plan-draft.md §4.1
 *
 * ★この関数はブラウザで pdfjs が取り出した文字の並びを受けるだけの純関数。
 *   PDF そのものはサーバーにも外部にも送らない（PCS は画面の中で読み終える）。
 *
 * 帳票の作り：各単元の行は「単元名の枠 | 左の枠（前回） ⇒ 右の枠（今回）」。
 * 印（●△×）は枠の中に文字として入っている。空欄は「出題なし」。
 *
 * - 数学：単元名も文字として入っているので、⇒ と同じ高さにある左の文字を単元名にする。
 * - 英語：単元名が図形化されていて文字が無い。様式は全員同じなので、
 *   印の座標から単元を引く表（pcsEnglishLayout.ts）を使う。
 */

import type { PcsMark, PcsReading, PcsUnitMark, ScoreSubject } from './types';
import { PCS_ENGLISH_ROWS } from './pcsEnglishLayout';

/** pdfjs の getTextContent から取った1片。y はページ上端から（pt） */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  w: number;
}

/**
 * 突き合わせ用に名前をそろえる。空白と、かっこ書きの補足を落とす。
 * ★数学の「方程式の利用［応用］(濃度,割合,…)」は補足が2行目に割れて入るので、補足ごと落として比べる。
 */
export function normalizeKey(s: string): string {
  return s
    .replace(/[\s　]+/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[，,]/g, '，');
}

/** 対応表の鍵。★群名を付ける。「肯定・否定・疑問」「文字式の利用」のように同じ単元名が別の群にある */
export function pcsKey(group: string, unit: string): string {
  return `${normalizeKey(group)}｜${normalizeKey(unit)}`;
}

const MARK_MAP: Record<string, PcsMark> = { '●': '●', '△': '△', '▲': '△', '×': '×' };
// ★比例・反比例の列だけ、⇒ が別のフォントで「ą」として出てくる（実物で確認）
const ARROWS = new Set(['⇒', 'ą']);
const isPct = (s: string) => /^\d+%$/.test(s) || /^[－−-]+$/.test(s);

/** どちらの教科の PCS か。PCS でなければ null（模試として扱う） */
export function detectPcsSubject(items: PdfTextItem[]): ScoreSubject | null {
  if (items.some((i) => i.str === '中学数学')) return 'math';
  // 英語は見出しが図形なので、英語の帳票にだけある注記で見分ける
  const hasMarks = items.some((i) => i.str in MARK_MAP);
  if (items.some((i) => i.str.includes('教科書によって異なります')) && hasMarks) return 'eng';
  return null;
}

function readHeader(items: PdfTextItem[]): Pick<PcsReading, 'grade' | 'examLabel'> {
  const gradeText = items.find((i) => /中学\d年生/.test(i.str))?.str ?? '';
  const g = gradeText.match(/中学(\d)年生/);
  const exam = items.find((i) => /\d{4}年\d{1,2}月.*テスト/.test(i.str))?.str ?? null;
  return { grade: g ? Number(g[1]) : null, examLabel: exam };
}

/** 数学：⇒ を行の目印にして、単元名・群名・印を組み立てる */
function parseMath(items: PdfTextItem[]): { units: PcsUnitMark[]; orphanMarks: number } {
  const marks = items.filter((i) => i.str in MARK_MAP);
  const arrows = items.filter((i) => ARROWS.has(i.str));
  const labels = items.filter(
    (i) => !(i.str in MARK_MAP) && !ARROWS.has(i.str) && !isPct(i.str) && i.y > 95
  );

  const used = new Set<PdfTextItem>();
  const rowLabel = new Map<PdfTextItem, PdfTextItem[]>();
  for (const a of arrows) {
    // 単元名は ⇒ の左 130pt 以内・高さ ±7pt（2行に折り返した単元名も拾う）
    const lab = labels
      .filter((l) => l.x < a.x && a.x - l.x < 130 && Math.abs(l.y - a.y) <= 7)
      .sort((p, q) => p.y - q.y || p.x - q.x);
    rowLabel.set(a, lab);
    lab.forEach((l) => used.add(l));
  }

  const takenMarks = new Set<PdfTextItem>();
  const units: PcsUnitMark[] = [];
  for (const a of arrows) {
    const lab = rowLabel.get(a) ?? [];
    // ★単元名が同じ高さに無い行は、右の「受験総合・単元のまとめ」の欄。単元の計画には使わないので読まない
    if (lab.length === 0) continue;

    const now = marks.find((m) => Math.abs(m.y - a.y) <= 3 && m.x > a.x && m.x - a.x < 25);
    const prev = marks.find((m) => Math.abs(m.y - a.y) <= 3 && m.x < a.x && a.x - m.x < 25);
    if (now) takenMarks.add(now);
    if (prev) takenMarks.add(prev);

    // 群名：この行より上で、行の単元名の少し右〜⇒ の手前にある、どの行にも属さない文字のうち一番近いもの
    const minX = Math.min(...lab.map((l) => l.x));
    const topY = Math.min(...lab.map((l) => l.y));
    const heads = labels.filter(
      (l) => !used.has(l) && l.y < topY - 3 && l.x >= minX - 20 && l.x < a.x - 10
    );
    let group = '';
    if (heads.length > 0) {
      const hy = Math.max(...heads.map((h) => h.y));
      // 見出しが2行に割れている群（「図形の性質」「と証明」）は、上の行もつなぐ
      group = heads
        .filter((h) => h.y <= hy && hy - h.y <= 16)
        .sort((p, q) => p.y - q.y || p.x - q.x)
        .map((h) => h.str)
        .join('');
    }

    if (!now && !prev) {
      units.push({ group, unit: lab.map((l) => l.str).join(''), now: null, prev: null });
      continue;
    }
    units.push({
      group,
      unit: lab.map((l) => l.str).join(''),
      now: now ? MARK_MAP[now.str] : null,
      prev: prev ? MARK_MAP[prev.str] : null,
    });
  }
  const orphanMarks = marks.filter((m) => !takenMarks.has(m) && m.y > 95).length;
  return { units, orphanMarks };
}

/**
 * 英語：印の座標から、様式の表で単元を引く。
 * ★文字の層の印は、文字の原点（左下）が枠の中心から (-4, +3.5) ずれて出る（実物で21個すべて0.4pt以内）
 */
function parseEnglish(items: PdfTextItem[]): { units: PcsUnitMark[]; orphanMarks: number } {
  const marks = items.filter((i) => i.str in MARK_MAP && i.y > 95);
  const units: PcsUnitMark[] = [];
  let orphanMarks = 0;
  for (const m of marks) {
    const cx = m.x + 4;
    const cy = m.y - 3.5;
    const row = PCS_ENGLISH_ROWS.find((r) => Math.abs(r.x - cx) <= 5 && Math.abs(r.y - cy) <= 5);
    if (!row) {
      // 左の枠（前回）の印もここに来る。前回は計画に使わないので数えるだけ
      orphanMarks += 1;
      continue;
    }
    units.push({ group: row.group, unit: row.unit, now: MARK_MAP[m.str], prev: null });
  }
  return { units, orphanMarks };
}

/** PCS 帳票1枚を読む。PCS でなければ null */
export function parsePcs(items: PdfTextItem[]): PcsReading | null {
  const subject = detectPcsSubject(items);
  if (!subject) return null;
  const { units, orphanMarks } = subject === 'math' ? parseMath(items) : parseEnglish(items);
  return { subject, ...readHeader(items), units, orphanMarks };
}
