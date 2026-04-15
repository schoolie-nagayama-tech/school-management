#!/usr/bin/env node
// 永山教室スプレッドシート棚卸し（読み取りのみ）
// 出力: scripts/audit-report.csv, scripts/audit-report.json

import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PARENT = '1oBX0Z2N06HwvvTQZhweE_Q68-U7Wvp_L'; // 永山
const TARGET_FOLDERS = {
  '中学生': '1QfOgX25voehxQqWcyXTunWhlT3UYrJwV',
  '小学生': '1M7skjpzXZrZSZCcTEumZrKFiDD-C9RWm',
  '高校生': '1rVcG9pXF_80Eczz49XDgWyZtnmKE8rCS',
  'HAL':    '1Thb6MfB1gmnBKGL6vRydhDeStsbKflKW',
};

const GWS_CMD = 'C:\\Users\\ytaka\\AppData\\Roaming\\npm\\gws.cmd';
function gws(args) {
  // Escape inner double quotes for cmd.exe, then wrap each arg
  const quoted = args.map(a => {
    if (a.startsWith('{') || a.includes(' ') || a.includes('"')) {
      return '"' + a.replace(/"/g, '\\"') + '"';
    }
    return a;
  });
  let r;
  for (let attempt = 0; attempt < 5; attempt++) {
    r = spawnSync('cmd.exe', ['/c', GWS_CMD, ...quoted], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsVerbatimArguments: true });
    if (r.status === 0) break;
    if (r.stderr && r.stderr.includes('Quota exceeded')) {
      console.error(`  quota hit, sleeping 45s (attempt ${attempt+1})`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 45000);
      continue;
    }
    break;
  }
  if (r.status !== 0) {
    console.error('gws error status', r.status, r.stderr);
    return { __error: r.stderr };
  }
  const out = r.stdout || '';
  const jsonStart = out.indexOf('{');
  if (jsonStart < 0) { console.error('no JSON in output:', out.slice(0,200)); return {}; }
  try { return JSON.parse(out.slice(jsonStart)); }
  catch (e) { console.error('parse error', e.message, out.slice(0,200)); return {}; }
}

function listFolder(folderId) {
  const res = gws([
    'drive', 'files', 'list',
    '--params', JSON.stringify({
      q: `'${folderId}' in parents and trashed=false and mimeType='application/vnd.google-apps.spreadsheet'`,
      fields: 'files(id,name)',
      pageSize: 200,
    }),
  ]);
  return res.files || [];
}

function getTabs(spreadsheetId) {
  const res = gws([
    'sheets', 'spreadsheets', 'get',
    '--params', JSON.stringify({ spreadsheetId, fields: 'sheets.properties.title' }),
  ]);
  return (res.sheets || []).map(s => s.properties.title);
}

function readRange(spreadsheetId, range) {
  const res = gws([
    'sheets', '+read',
    '--spreadsheet', spreadsheetId,
    '--range', range,
  ]);
  return res.values || [];
}

// タブ名正規化
function classifyTab(title) {
  const t = title.replace(/\s+/g, '');
  if (/成績.*中/.test(t)) return 'seiseki_jhs';
  if (/成績.*高/.test(t)) return 'seiseki_hs';
  if (/面談/.test(t)) return 'mendan';
  return null;
}

// 成績表: 学校定期テスト (行5〜21) / 学校内申 (行24〜40) の記入行数
function countSeiseki(rows) {
  // A列に「学校定期テスト」「学校内申」があるブロック境界を探す
  let testStart = -1, hyoteiStart = -1;
  for (let i = 0; i < rows.length; i++) {
    const a = (rows[i]?.[0] || '').trim();
    if (a.includes('学校定期テスト')) testStart = i + 2; // ヘッダー飛ばす
    if (a.includes('学校内申')) hyoteiStart = i + 2;
  }
  function countBlock(start, end) {
    if (start < 0) return 0;
    let n = 0;
    for (let i = start; i < Math.min(end, rows.length); i++) {
      // C〜G(英数国社理) のいずれかに数値あれば1行カウント
      const cells = (rows[i] || []).slice(2, 7);
      if (cells.some(c => c !== '' && c != null && !isNaN(Number(c)) && Number(c) > 0)) n++;
    }
    return n;
  }
  const testEnd = hyoteiStart > 0 ? hyoteiStart - 3 : rows.length;
  return {
    test_rows: countBlock(testStart, testEnd),
    hyotei_rows: countBlock(hyoteiStart, rows.length),
  };
}

// 面談記録: 2行目=日付, 3行目=種別, 4行目=内容 (横方向)
function countMendan(rows) {
  const dateRow = rows[1] || [];
  const typeRow = rows[2] || [];
  const contentRow = rows[3] || [];
  let n = 0;
  const max = Math.max(dateRow.length, typeRow.length, contentRow.length);
  for (let i = 0; i < max; i++) {
    const d = (dateRow[i] || '').toString().trim();
    const c = (contentRow[i] || '').toString().trim();
    if (d && c) n++;
  }
  return n;
}

const report = [];
let idx = 0;

for (const [folderLabel, folderId] of Object.entries(TARGET_FOLDERS)) {
  const files = listFolder(folderId);
  console.error(`[${folderLabel}] ${files.length} files`);
  for (const f of files) {
    idx++;
    const row = {
      folder: folderLabel, name: f.name, id: f.id,
      tabs_total: 0, has_seiseki_jhs: false, has_seiseki_hs: false, has_mendan: false,
      tab_variants: '',
      test_rows: 0, hyotei_rows: 0, mendan_count: 0,
      error: '',
    };
    try {
      const tabs = getTabs(f.id);
      row.tabs_total = tabs.length;
      const variants = [];
      let jhsTab = null, hsTab = null, mendanTab = null;
      for (const t of tabs) {
        const cls = classifyTab(t);
        if (cls === 'seiseki_jhs') { jhsTab = t; row.has_seiseki_jhs = true; if (t !== '成績表中学生') variants.push(t); }
        if (cls === 'seiseki_hs')  { hsTab  = t; row.has_seiseki_hs  = true; if (t !== '成績表高校生') variants.push(t); }
        if (cls === 'mendan')      { mendanTab = t; row.has_mendan = true; if (t !== '面談記録') variants.push(t); }
      }
      row.tab_variants = variants.join('|');
      if (jhsTab) {
        const v = readRange(f.id, `${jhsTab}!A1:N45`);
        const r = countSeiseki(v);
        row.test_rows += r.test_rows; row.hyotei_rows += r.hyotei_rows;
      }
      if (hsTab) {
        const v = readRange(f.id, `${hsTab}!A1:N45`);
        const r = countSeiseki(v);
        row.test_rows += r.test_rows; row.hyotei_rows += r.hyotei_rows;
      }
      if (mendanTab) {
        const v = readRange(f.id, `${mendanTab}!A1:AZ10`);
        row.mendan_count = countMendan(v);
      }
    } catch (e) {
      row.error = e.message || String(e);
    }
    console.error(`  ${idx} ${f.name}: test=${row.test_rows} hyotei=${row.hyotei_rows} mendan=${row.mendan_count}`);
    report.push(row);
  }
}

// CSV 出力
const cols = ['folder','name','id','tabs_total','has_seiseki_jhs','has_seiseki_hs','has_mendan','test_rows','hyotei_rows','mendan_count','tab_variants','error'];
const csv = [cols.join(',')].concat(
  report.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))
).join('\n');

writeFileSync('scripts/audit-report.csv', csv, 'utf8');
writeFileSync('scripts/audit-report.json', JSON.stringify(report, null, 2), 'utf8');

// サマリー
const sum = (k) => report.reduce((a, r) => a + (Number(r[k]) || 0), 0);
console.log('\n=== SUMMARY ===');
console.log(`総生徒数: ${report.length}`);
console.log(`定期テスト記入行 合計: ${sum('test_rows')}`);
console.log(`内申記入行 合計: ${sum('hyotei_rows')}`);
console.log(`面談記録 合計: ${sum('mendan_count')}`);
console.log(`成績表タブ揺れあり: ${report.filter(r => r.tab_variants).length}`);
console.log(`エラー: ${report.filter(r => r.error).length}`);
console.log('\n出力: scripts/audit-report.csv, scripts/audit-report.json');
