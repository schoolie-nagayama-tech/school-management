import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/scores/parse-xlsx
 *
 * xlsx/csv ファイルを受け取り、行データ (string|number|undefined)[][] を返す。
 * xlsx は動的 require でサーバーサイドのみ使用（クライアントバンドル対象外）。
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'ファイルが見つかりません' }, { status: 400 });
    }

    const buf = await file.arrayBuffer();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require('xlsx');
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // !ref がセルの実データ範囲より狭い場合がある（進研テスト等）ので
    // 実在するセルから正しい範囲を再計算する
    const cellKeys = Object.keys(ws).filter((k: string) => !k.startsWith('!'));
    if (cellKeys.length > 0) {
      let maxRow = 0;
      let maxCol = 0;
      for (const key of cellKeys) {
        const decoded = XLSX.utils.decode_cell(key);
        if (decoded.r > maxRow) maxRow = decoded.r;
        if (decoded.c > maxCol) maxCol = decoded.c;
      }
      const correctRef = XLSX.utils.encode_range(
        { s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } }
      );
      if (ws['!ref'] !== correctRef) {
        ws['!ref'] = correctRef;
      }
    }

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

    return NextResponse.json({ rows });
  } catch (e) {
    console.error('parse-xlsx error:', e);
    return NextResponse.json({ error: 'ファイルの解析に失敗しました' }, { status: 500 });
  }
}
