/**
 * ブラウザの中で PDF を開く（pdfjs-dist）。
 * 正典: docs/score-sheet-plan-draft.md §4
 *
 * ★サーバー（Vercel）では pdfjs を動かさない。ESM の読み込みで本番全ページ500を出した前例がある
 *   （落とし穴メモ「本番全ページ500=サーバーのjsdom」）。この関数群は画面からだけ動的に読む。
 * ★PCS は文字と座標を取り出すだけで、PDF は外に出さない。
 * ★模試は1・2ページ目だけを画像にして、読みやすい大きさに切って送る（答案の3・4ページ目は送らない）。
 */

import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfTextItem } from './pcsParse';

/** Claude が縮めずに読める長辺（これより大きいと縮められて帳票の細かい字が潰れる） */
export const TILE_LONG_EDGE = 1568;
/** 切れ目の行を両側に写すための重なり */
const OVERLAP = 0.03;

async function loadPdfjs() {
  const lib = await import('pdfjs-dist');
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  }
  return lib;
}

export async function openPdf(file: File): Promise<PDFDocumentProxy> {
  const lib = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  // ★PCS の日本語の文字（●△× を含む）を取り出すには CMap が要る。
  //   実物で使われていた2つだけを public/pdfjs/cmaps に置いている
  return lib.getDocument({ data, cMapUrl: '/pdfjs/cmaps/', cMapPacked: true }).promise;
}

/** 1ページの文字と座標。y はページ上端から（pt） */
export async function pageTextItems(doc: PDFDocumentProxy, pageNo = 1): Promise<PdfTextItem[]> {
  const page = await doc.getPage(pageNo);
  const { height } = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items: PdfTextItem[] = [];
  for (const it of content.items) {
    if (!('str' in it) || !it.str.trim()) continue;
    items.push({
      str: it.str.trim(),
      x: it.transform[4],
      y: height - it.transform[5],
      w: it.width,
    });
  }
  return items;
}

/** 切り方（ページに対する割合）。純関数にしてテストで固定する */
export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export function tileRects(cols: number, rows: number, overlap = OVERLAP): TileRect[] {
  const out: TileRect[] = [];
  const w = 1 / cols;
  const h = 1 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.max(0, c * w - (c > 0 ? overlap : 0));
      const y0 = Math.max(0, r * h - (r > 0 ? overlap : 0));
      const x1 = Math.min(1, (c + 1) * w + (c < cols - 1 ? overlap : 0));
      const y1 = Math.min(1, (r + 1) * h + (r < rows - 1 ? overlap : 0));
      out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }
  return out;
}

/**
 * 1ページを切って JPEG にする。
 * ★白黒にしてから圧縮する（色は読み取りに要らない・本文の上限4.5MBに収めるため）
 */
async function renderTiles(
  doc: PDFDocumentProxy,
  pageNo: number,
  cols: number,
  rows: number,
  quality: number
): Promise<string[]> {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const rects = tileRects(cols, rows);
  // 一番大きい切れ端の長辺が TILE_LONG_EDGE になる倍率で、ページ全体を1回だけ描く
  const maxW = Math.max(...rects.map((r) => r.w)) * base.width;
  const maxH = Math.max(...rects.map((r) => r.h)) * base.height;
  const scale = TILE_LONG_EDGE / Math.max(maxW, maxH);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas が使えません');
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;

  const out: string[] = [];
  for (const r of rects) {
    const tile = document.createElement('canvas');
    tile.width = Math.round(r.w * canvas.width);
    tile.height = Math.round(r.h * canvas.height);
    const tctx = tile.getContext('2d');
    if (!tctx) continue;
    tctx.filter = 'grayscale(1)';
    tctx.drawImage(
      canvas,
      Math.round(r.x * canvas.width),
      Math.round(r.y * canvas.height),
      tile.width,
      tile.height,
      0,
      0,
      tile.width,
      tile.height
    );
    out.push(tile.toDataURL('image/jpeg', quality).split(',')[1] ?? '');
  }
  return out;
}

/** Vercel の本文の上限（4.5MB）に余裕を持たせた、画像の合計の目安 */
const PAYLOAD_BUDGET = 3_600_000;

/**
 * 模試の帳票を送る画像にする：1ページ目を左右2枚、2ページ目（学力分析表）を上下左右4枚。
 * 大きすぎたら画質を下げてやり直す。
 */
export async function mockSheetImages(
  doc: PDFDocumentProxy
): Promise<{ mediaType: 'image/jpeg'; base64: string }[]> {
  if (doc.numPages < 2) throw new Error('2ページ目（学力分析表）がありません');
  for (const quality of [0.75, 0.6, 0.45]) {
    const p1 = await renderTiles(doc, 1, 2, 1, quality);
    const p2 = await renderTiles(doc, 2, 2, 2, quality);
    const all = [...p1, ...p2];
    const size = all.reduce((a, s) => a + s.length, 0);
    if (size <= PAYLOAD_BUDGET) return all.map((base64) => ({ mediaType: 'image/jpeg', base64 }));
  }
  throw new Error('帳票の画像が大きすぎます');
}
