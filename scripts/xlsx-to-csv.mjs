#!/usr/bin/env node
// 教育委員会の Excel（.xlsx）を、シートごとに UTF-8 の CSV へそのまま書き出す。
//
// 使い方:
//   node scripts/xlsx-to-csv.mjs <入力.xlsx> <出力の接頭辞>
//   例: node scripts/xlsx-to-csv.mjs ~/Downloads/high_student-class_r07.xlsx docs/data/kanagawa-roster-r7
//       → docs/data/kanagawa-roster-r7.sheet1.csv, ...sheet2.csv ...
//
// ★中身は加工しない（見出しの複数行も、結合セルの空欄もそのまま）。どの列が何かの解釈は
//   取込スクリプト（import-high-school-facts.mjs）が持つ。変換と解釈を分けておくと、
//   来年の資料で列がずれたときに「変換し直したCSVの差分」で気づける。
//
// ★依存パッケージを足さないため、xlsx（zip）は OS の unzip で展開する。
//   Git Bash には unzip が入っている。

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [input, prefix] = process.argv.slice(2);
if (!input || !prefix) {
  console.error('使い方: node scripts/xlsx-to-csv.mjs <入力.xlsx> <出力の接頭辞>');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'xlsx-'));
try {
  execFileSync('unzip', ['-o', '-q', input, '-d', dir]);

  const decode = (s) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&amp;/g, '&');

  // 共有文字列。★ふりがな（<rPh>）は落とす。残すと「希望ケ丘キボウオカ」のように読みが混ざる
  const ssPath = join(dir, 'xl', 'sharedStrings.xml');
  const shared = existsSync(ssPath)
    ? [...readFileSync(ssPath, 'utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        decode(
          [...m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t[^>]*>([^<]*)<\/t>/g)]
            .map((t) => t[1])
            .join('')
        )
      )
    : [];

  // シート名（workbook.xml の順＝ sheetN.xml の番号とは限らないので rId で引く）
  const wb = readFileSync(join(dir, 'xl', 'workbook.xml'), 'utf8');
  const rels = readFileSync(join(dir, 'xl', '_rels', 'workbook.xml.rels'), 'utf8');
  const target = Object.fromEntries(
    [...rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [
      m[1],
      m[2],
    ])
  );
  const sheets = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({
    name: decode(m[1]),
    file: target[m[2]].replace(/^\/?xl\//, ''),
  }));

  const colIndex = (ref) => {
    const letters = ref.replace(/\d+/g, '');
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const csvCell = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

  sheets.forEach((sheet, i) => {
    const xml = readFileSync(join(dir, 'xl', sheet.file), 'utf8');
    const out = [];
    for (const row of xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of row[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[2];
        const body = c[3] ?? '';
        let v = '';
        if (/t="s"/.test(attrs)) v = shared[Number(body.match(/<v>([^<]*)<\/v>/)?.[1])] ?? '';
        else if (/t="inlineStr"/.test(attrs))
          v = decode([...body.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(''));
        else v = decode(body.match(/<v>([^<]*)<\/v>/)?.[1] ?? '');
        cells[colIndex(c[1])] = v.replace(/\r?\n/g, ' ').trim();
      }
      out.push(Array.from(cells, (v) => csvCell(v ?? '')).join(','));
    }
    const path = `${prefix}.sheet${i + 1}.csv`;
    writeFileSync(path, out.join('\n') + '\n');
    console.log(`${path}  ← シート「${sheet.name}」 ${out.length}行`);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
