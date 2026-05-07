#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const GWS_CMD = 'C:\\Users\\ytaka\\AppData\\Roaming\\npm\\gws.cmd';
function gws(args) {
  const quoted = args.map(a => {
    if (a.startsWith('{') || a.includes(' ') || a.includes('"')) return '"' + a.replace(/"/g, '\\"') + '"';
    return a;
  });
  let r;
  for (let attempt = 0; attempt < 5; attempt++) {
    r = spawnSync('cmd.exe', ['/c', GWS_CMD, ...quoted], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsVerbatimArguments: true });
    if (r.status === 0) break;
    if (r.stderr && r.stderr.includes('Quota exceeded')) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 45000);
    } else break;
  }
  if (r.status !== 0) { console.error('stderr:', r.stderr); return null; }
  const out = r.stdout || '';
  const j = out.indexOf('{');
  if (j < 0) return null;
  try { return JSON.parse(out.slice(j)); } catch { return null; }
}

const SHEETS = [
  { id: '1kqMjH0pOfo2bYgcheN6bPvOyOYCV4mSgiIls15wqDJ4', name: '佐藤駿(弟)' },
  { id: '1u_t_8f2QMxcXgKjTSP_JhEt8XrRIsr_gygEIf8-KFRE', name: '佐藤遼(兄)' },
  { id: '1TbxEwegfZIcRjaodwtzO24rx-lpb_VuZrD7VJuarVzM', name: '一階駿介' },
  { id: '1Kfhs4BHfN0SRkpEouVg1yTcvJvrT5e0KSrnfotvLAs0', name: '山本晴也' },
];

for (const s of SHEETS) {
  const meta = gws(['sheets','spreadsheets','get','--params', JSON.stringify({ spreadsheetId: s.id, fields: 'sheets.properties.title' })]);
  const titles = (meta?.sheets || []).map(x => x.properties.title);
  console.log('\n===', s.name, '===');
  console.log('tabs:', titles.join(' | '));
  // カルテ / 基本情報 / 生徒情報っぽいタブを探す
  const candidate = titles.find(t => /(カルテ|基本|生徒|情報|プロフィール|表紙|名簿)/.test(t)) || titles[0];
  if (candidate) {
    const data = gws(['sheets','+read','--spreadsheet', s.id, '--range', `${candidate}!A1:N20`]);
    console.log('first tab (' + candidate + ') content:');
    const rows = data?.values || [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r && r.some(c => /[ぁ-ヿ]/.test((c||'').toString()))) {
        console.log(' ', i, ':', r.slice(0,8).join(' | '));
      }
    }
  }
}
