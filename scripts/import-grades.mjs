#!/usr/bin/env node
// 成績表 → assessments + assessment_scores
// 使い方:
//   node scripts/import-grades.mjs --dry-run
//   node scripts/import-grades.mjs --only "中１＿松尾玲衣"
//   node scripts/import-grades.mjs --go
//   node scripts/import-grades.mjs --go --only "中１＿松尾玲衣"

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const SCHOOL_ID = process.env.MIGRATE_SCHOOL_ID || 'd187f7a3-633a-46ce-8d32-c56c85d17bac';
const GWS = 'C:\\Users\\ytaka\\AppData\\Roaming\\npm\\gws.cmd';
const DRY = !process.argv.includes('--go');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i+1] : null; })();

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function gws(args) {
  const q = args.map(a => (a.startsWith('{') || a.includes(' ') || a.includes('"')) ? '"' + a.replace(/"/g, '\\"') + '"' : a);
  for (let i = 0; i < 5; i++) {
    const r = spawnSync('cmd.exe', ['/c', GWS, ...q], { encoding: 'utf8', maxBuffer: 20*1024*1024, windowsVerbatimArguments: true });
    if (r.status === 0) { const o = r.stdout || ''; return JSON.parse(o.slice(o.indexOf('{'))); }
    if (r.stderr?.includes('Quota exceeded')) { console.error('  quota hit, sleep 45s'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 45000); continue; }
    throw new Error('gws: ' + r.stderr);
  }
  throw new Error('gws quota retries exhausted');
}
const readRange = (id, range) => (gws(['sheets','+read','--spreadsheet',id,'--range',range]).values || []);

// term → name_code
const REGULAR_MAP = {
  '1学期中間': 'term1_mid', '１学期中間': 'term1_mid',
  '1学期期末': 'term1_final', '１学期期末': 'term1_final',
  '2学期中間': 'term2_mid', '２学期中間': 'term2_mid',
  '2学期期末': 'term2_final', '２学期期末': 'term2_final',
  '学年末': 'year_end',
  '前期中間': 'first_mid', '前期期末': 'first_final',
  '後期中間': 'second_mid', '後期期末': 'second_final',
};
const REPORT_MAP = {
  '1学期': 'term1', '１学期': 'term1',
  '2学期': 'term2', '２学期': 'term2',
  '学年末': 'year_end',
  '前期': 'first', '後期': 'second',
};
const GRADE_LABEL = { '小1':1,'小2':2,'小3':3,'小4':4,'小5':5,'小6':6,'中1':7,'中2':8,'中3':9,'高1':10,'高2':11,'高3':12 };
const normLabel = s => (s||'').toString().replace(/[\s　]+/g,'').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0)-0xFEE0));

// 中学生固定ヘッダー
const JHS_SUBJECTS = ['英語','数学','国語','社会','理科',null,'音楽','美術','技術・家庭','保体']; // index: cols C(2) D E F G H(skip=5科合計) I J K L

// 日本語ラベル → NEST 内部キー
const SUBJECT_KEY = {
  // 中学共通
  '英語':'english','数学':'math','国語':'japanese','社会':'social','理科':'science',
  '音楽':'music','美術':'art','技術・家庭':'tech_home','技術':'tech_home','家庭':'tech_home','保体':'pe','保健体育':'pe',
  // 高校（5科に集約）
  'コミュ英':'english','英表':'english','英語表現':'english','英コミュ':'english',
  '数ⅠⅡⅢ':'math','数ＡＢＣ':'math','数学Ⅰ':'math','数学Ⅱ':'math','数学Ⅲ':'math','数学A':'math','数学B':'math','数学C':'math',
  '世界史':'social','日本史':'social','政経':'social','政治経済':'social','地理':'social','倫理':'social',
  '生物':'science','物理':'science','化学':'science','地学':'science','化学基礎':'science','物理基礎':'science','生物基礎':'science','地学基礎':'science',
  '現代の国語':'japanese','現代文':'japanese','古文':'japanese','漢文':'japanese','古典':'japanese','言語文化':'japanese',
};
function toSubjectKey(jp) {
  const k = (jp||'').replace(/[\s　]+/g,'');
  return SUBJECT_KEY[k] || null;
}

// 行ブロック抽出
function extractBlock(rows, headerLabel, headerRowCols) {
  // headerLabel を A 列で探す → 次の行が列見出し → その次から値行
  let start = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i]?.[0] || '').toString().includes(headerLabel)) { start = i; break; }
  }
  if (start < 0) return null;
  const colRow = rows[start + 1] || [];
  const subjectCols = [];
  for (let c = 2; c < Math.max(colRow.length, headerRowCols); c++) {
    const label = (colRow[c] || '').toString().trim();
    if (label && !/合計/.test(label)) subjectCols.push({ col: c, subject: label });
  }
  const dataRows = [];
  for (let i = start + 2; i < rows.length; i++) {
    const row = rows[i] || [];
    const a = normLabel(row[0]);
    const b = (row[1] || '').toString().trim();
    // 次セクションのヘッダーに当たったら終了
    if (b === '' && a === '' && row.slice(2).every(c => !c || c === '' || c === '0')) continue;
    if (/学校内申|学校評定|模試結果/.test((row[0]||'')+(row[1]||''))) break;
    // 記入あり判定
    const scores = {};
    let any = false;
    for (const { col, subject } of subjectCols) {
      const v = row[col];
      if (v !== '' && v != null && !isNaN(Number(v)) && Number(v) >= 0) {
        const key = toSubjectKey(subject);
        if (!key) continue; // 未対応科目はスキップ（警告は後で）
        // 同じキーに複数科目が当たる場合は最初の値を採用（例：コミュ英 vs 英表）
        if (scores[key] == null) scores[key] = Number(v);
        if (Number(v) > 0) any = true;
      }
    }
    if (!any) continue;
    dataRows.push({
      grade_label: a, term_label: b, scores,
    });
  }
  return { subjectCols, dataRows };
}

function mapNameCode(termLabel, map) {
  const k = termLabel.replace(/[\s　]+/g,'').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0)-0xFEE0));
  return map[k] || null;
}

async function processStudent(m) {
  const { sheet_id, sheet_name, student_id, folder } = m;
  const isHS = folder === '高校生' || /^高/.test(sheet_name);
  const isJHS = folder === '中学生' || folder === 'HAL' || /^中/.test(sheet_name);
  const isES = folder === '小学生' || /^小/.test(sheet_name);
  if (isES) return { student: sheet_name, skipped: '小学生(成績なし)' };

  const tabName = isHS ? '成績表高校生' : '成績表中学生';
  let rows;
  try { rows = readRange(sheet_id, `${tabName}!A1:O50`); }
  catch (e) { return { student: sheet_name, error: e.message }; }

  const testBlock = extractBlock(rows, '学校定期テスト', 14);
  const hyoteiBlock = extractBlock(rows, isHS ? '学校評定' : '学校内申', 14);

  const assessments = [];
  for (const [category, block, nameMap] of [
    ['regular_test', testBlock, REGULAR_MAP],
    ['report_card', hyoteiBlock, REPORT_MAP],
  ]) {
    if (!block) continue;
    for (const r of block.dataRows) {
      const name_code = mapNameCode(r.term_label, nameMap);
      if (!name_code) continue; // 入塾時 や 未知ラベルはスキップ
      const gradeNum = GRADE_LABEL[r.grade_label] || null;
      assessments.push({
        category, name_code, title: r.term_label,
        grade: gradeNum, scores: r.scores,
      });
    }
  }
  return { student: sheet_name, student_id, sheet_id, assessments };
}

const mapping = JSON.parse(readFileSync('scripts/student-mapping.json','utf8')).mapping;
const targets = ONLY ? mapping.filter(m => m.sheet_name === ONLY) : mapping;
if (!targets.length) { console.error('target 0'); process.exit(1); }
console.log(`対象生徒: ${targets.length} 名 / DRY=${DRY}`);

let totalAssessments = 0, totalScores = 0, inserted = 0, skipped = 0, errored = 0;
const preview = [];
for (const m of targets) {
  const r = await processStudent(m);
  if (r.skipped) { skipped++; continue; }
  if (r.error) { errored++; console.error(`  ! ${r.student}: ${r.error}`); continue; }
  if (!r.assessments?.length) { continue; }
  totalAssessments += r.assessments.length;
  totalScores += r.assessments.reduce((a,x) => a + Object.keys(x.scores).length, 0);
  preview.push({ student: r.student, count: r.assessments.length, sample: r.assessments[0] });

  if (DRY) continue;

  // 生徒の既存 assessments を取得して重複回避
  const { data: existing } = await supa.from('assessments')
    .select('id, category, name_code, grade').eq('student_id', r.student_id);
  const existSet = new Set((existing||[]).map(e => `${e.category}|${e.name_code}|${e.grade}`));

  for (const a of r.assessments) {
    const key = `${a.category}|${a.name_code}|${a.grade}`;
    if (existSet.has(key)) continue;
    const { data: aIns, error: e1 } = await supa.from('assessments').insert({
      school_id: SCHOOL_ID, student_id: r.student_id,
      category: a.category, name_code: a.name_code, title: a.title,
      grade: a.grade || 1,
    }).select('id').single();
    if (e1) { console.error('  assessment insert error', r.student, a.title, e1.message); continue; }
    const scoreRows = Object.entries(a.scores).map(([subject, value]) => ({
      assessment_id: aIns.id, subject, value,
    }));
    const { error: e2 } = await supa.from('assessment_scores').insert(scoreRows);
    if (e2) { console.error('  scores insert error', r.student, e2.message); continue; }
    inserted++;
  }
  console.log(`  ✓ ${r.student}: ${r.assessments.length} 件処理`);
}

console.log('\n=== 集計 ===');
console.log(`assessments: ${totalAssessments} / scores: ${totalScores}`);
console.log(`小学生スキップ: ${skipped} / エラー: ${errored}`);
if (DRY) {
  console.log('\n--- 先頭3件 プレビュー ---');
  for (const p of preview.slice(0,3)) {
    console.log(`\n[${p.student}] ${p.count} 件`);
    console.log('  sample:', JSON.stringify(p.sample, null, 2).replace(/\n/g,'\n  '));
  }
  console.log('\n(dry-run — --go で実行)');
} else {
  console.log(`INSERT 済み: ${inserted} assessments`);
}
