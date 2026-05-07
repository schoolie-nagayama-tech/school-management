#!/usr/bin/env node
// スプレッドシートの成績表タブ中身を直接確認
import { spawnSync } from 'node:child_process';
const GWS = 'C:\\Users\\ytaka\\AppData\\Roaming\\npm\\gws.cmd';
function gws(args) {
  const q = args.map(a => (a.startsWith('{')||a.includes(' ')||a.includes('"')) ? '"'+a.replace(/"/g,'\\"')+'"' : a);
  for (let i=0;i<5;i++) {
    const r = spawnSync('cmd.exe', ['/c', GWS, ...q], { encoding:'utf8', maxBuffer:20*1024*1024, windowsVerbatimArguments:true });
    if (r.status === 0) { const o = r.stdout||''; return JSON.parse(o.slice(o.indexOf('{'))); }
    if (r.stderr?.includes('Quota')) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,45000); continue; }
    throw new Error(r.stderr);
  }
}
const id = process.argv[2];
const meta = gws(['sheets','spreadsheets','get','--params', JSON.stringify({spreadsheetId:id, fields:'sheets.properties.title'})]);
const titles = (meta?.sheets||[]).map(x=>x.properties.title);
console.log('TABS:', titles.join(' | '));
// Pick grades tab: 成績 系全部
const targets = titles.filter(t => /成績/.test(t));
for (const t of targets) {
  console.log('\n===', t, '===');
  const d = gws(['sheets','+read','--spreadsheet', id, '--range', `${t}!A1:N50`]);
  const rows = d?.values || [];
  for (let i=0;i<rows.length;i++) {
    const r = rows[i];
    if (r && r.some(c => String(c||'').trim())) {
      console.log(String(i+1).padStart(3), '|', r.map(c=>(c||'').toString()).join(' | ').slice(0, 200));
    }
  }
}
