#!/usr/bin/env node
// 面談記録 → student_interviews
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const SCHOOL_ID = 'd187f7a3-633a-46ce-8d32-c56c85d17bac';
const GWS = 'C:\\Users\\ytaka\\AppData\\Roaming\\npm\\gws.cmd';
const DRY = !process.argv.includes('--go');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i+1] : null; })();

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function gws(args) {
  const q = args.map(a => (a.startsWith('{') || a.includes(' ') || a.includes('"')) ? '"' + a.replace(/"/g, '\\"') + '"' : a);
  for (let i = 0; i < 5; i++) {
    const r = spawnSync('cmd.exe', ['/c', GWS, ...q], { encoding: 'utf8', maxBuffer: 20*1024*1024, windowsVerbatimArguments: true });
    if (r.status === 0) { const o = r.stdout || ''; return JSON.parse(o.slice(o.indexOf('{'))); }
    if (r.stderr?.includes('Quota exceeded')) { console.error('  quota hit, sleep 45s'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 45000); continue; }
    throw new Error('gws: ' + r.stderr);
  }
  throw new Error('quota retries exhausted');
}
const readRange = (id, range) => (gws(['sheets','+read','--spreadsheet',id,'--range',range]).values || []);

function mapType(label) {
  const s = (label||'').toString();
  if (s.includes('保護者')) return 'parent_interview';
  if (s.includes('生徒')) return 'student_interview';
  if (s.includes('電話')) return 'phone';
  if (s.includes('入塾')) return 'enrollment';
  if (s.includes('雑談') || s.includes('カジュアル')) return 'casual';
  if (s.includes('タスク')) return 'task';
  return 'other';
}

// 日付正規化: 2024-01-18, 2024/1/18, 2024.1.18 等
function parseDate(s) {
  const t = (s||'').toString().trim();
  if (!t) return null;
  // ISO
  let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  // 日本語: 2024年1月18日
  m = t.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  return null;
}

async function processStudent(m) {
  let rows;
  try { rows = readRange(m.sheet_id, '面談記録!A1:AZ10'); } catch (e) { return { student: m.sheet_name, error: e.message }; }
  const dateRow = rows[1] || [], typeRow = rows[2] || [], contentRow = rows[3] || [];
  const records = [];
  const max = Math.max(dateRow.length, typeRow.length, contentRow.length);
  for (let i = 0; i < max; i++) {
    const date = parseDate(dateRow[i]);
    const content = (contentRow[i] || '').toString().trim();
    if (!date || !content) continue;
    records.push({
      interview_date: date,
      interview_type: mapType(typeRow[i]),
      content,
    });
  }
  return { student: m.sheet_name, student_id: m.student_id, records };
}

const mapping = JSON.parse(readFileSync('scripts/student-mapping.json','utf8')).mapping;
const targets = ONLY ? mapping.filter(m => m.sheet_name === ONLY) : mapping;
console.log(`対象: ${targets.length} 名 / DRY=${DRY}`);

let total = 0, inserted = 0, errored = 0;
const preview = [];
for (const m of targets) {
  const r = await processStudent(m);
  if (r.error) { errored++; console.error('  !', r.student, r.error); continue; }
  if (!r.records.length) continue;
  total += r.records.length;
  preview.push(r);

  if (DRY) continue;

  const { data: existing } = await supa.from('student_interviews')
    .select('interview_date, interview_type').eq('student_id', r.student_id);
  const existSet = new Set((existing||[]).map(e => `${e.interview_date}|${e.interview_type}`));
  const toIns = r.records
    .filter(rec => !existSet.has(`${rec.interview_date}|${rec.interview_type}`))
    .map(rec => ({ school_id: SCHOOL_ID, student_id: r.student_id, ...rec, created_by: 'sheet-import' }));
  if (!toIns.length) continue;
  const { error } = await supa.from('student_interviews').insert(toIns);
  if (error) { console.error('  ! insert', r.student, error.message); continue; }
  inserted += toIns.length;
  console.log(`  ✓ ${r.student}: +${toIns.length}`);
}

console.log('\n=== 集計 ===');
console.log(`抽出 records: ${total} / エラー: ${errored}`);
if (DRY) {
  console.log('\n--- 先頭2件プレビュー ---');
  for (const p of preview.slice(0,2)) {
    console.log(`\n[${p.student}] ${p.records.length} 件`);
    for (const rec of p.records.slice(0,3)) console.log(' ', rec.interview_date, rec.interview_type, '-', rec.content.replace(/\n/g,' / ').slice(0,60));
  }
  console.log('\n(--go で実行)');
} else {
  console.log(`INSERT: ${inserted}`);
}
