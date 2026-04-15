#!/usr/bin/env node
// A: 永山教室 students と棚卸しJSONを突合
// スプレッドシートにのみ存在する生徒は students に INSERT
// 出力: scripts/student-mapping.json  (sheetFileId -> student_id)

import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const SCHOOL_ID = 'd187f7a3-633a-46ce-8d32-c56c85d17bac'; // 永山
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// 正規化: 空白除去
const norm = s => (s || '').replace(/[\s　]+/g, '');

// ファイル名 "中１＿松尾玲衣" を {gradeLabel, fullName} に分解
function parseName(fileName) {
  const m = fileName.match(/^(小|中|高)([０-９1-9])[＿_](.+)$/);
  if (!m) return null;
  const gradeZenToHan = c => ({ '１':1,'２':2,'３':3,'４':4,'５':5,'６':6 }[c] ?? Number(c));
  const level = m[1]; const y = gradeZenToHan(m[2]);
  // grade: 小=1-6, 中=7-9, 高=10-12
  const grade = level === '小' ? y : level === '中' ? 6 + y : 9 + y;
  const full = m[3].trim();
  return { level, grade, fullName: full };
}

// 氏名を姓と名に分ける（簡易：1〜2文字を姓に試し、DBで探す方式のためとりあえず full のまま保持）
// DBの突合は last_name+first_name を結合して一致判定

const audit = JSON.parse(readFileSync('scripts/audit-report.json', 'utf8'));
console.log(`スプレッドシート生徒: ${audit.length}`);

// NEST 側 永山生徒取得
const { data: dbStudents, error } = await supa
  .from('students')
  .select('id, last_name, first_name, grade, status')
  .eq('school_id', SCHOOL_ID);
if (error) { console.error(error); process.exit(1); }
console.log(`DB 永山生徒(全ステータス): ${dbStudents.length}`);

const dbByNorm = new Map();
for (const s of dbStudents) {
  const key = norm(s.last_name + s.first_name);
  if (!dbByNorm.has(key)) dbByNorm.set(key, []);
  dbByNorm.get(key).push(s);
}

const mapping = [];
const unmatched = [];
const multiMatch = [];

for (const row of audit) {
  const parsed = parseName(row.name);
  if (!parsed) { unmatched.push({ ...row, reason: 'filename parse failed' }); continue; }
  const key = norm(parsed.fullName);
  const hits = dbByNorm.get(key) || [];
  if (hits.length === 1) {
    mapping.push({
      sheet_id: row.id, sheet_name: row.name, folder: row.folder,
      student_id: hits[0].id,
      db_name: hits[0].last_name + hits[0].first_name,
      db_grade: hits[0].grade, db_status: hits[0].status,
      grade_match: hits[0].grade === parsed.grade,
    });
  } else if (hits.length === 0) {
    unmatched.push({ ...row, reason: 'no DB match', parsed });
  } else {
    multiMatch.push({ ...row, reason: 'multiple DB matches', hits, parsed });
  }
}

console.log('\n=== 突合結果 ===');
console.log(`一致: ${mapping.length}`);
console.log(`未ヒット: ${unmatched.length}`);
console.log(`複数ヒット: ${multiMatch.length}`);
console.log(`学年不一致: ${mapping.filter(m => !m.grade_match).length}`);

if (unmatched.length) {
  console.log('\n--- 未ヒット（DBに無い）---');
  for (const u of unmatched) console.log(`  ${u.folder} / ${u.name} -> ${u.reason}`);
}
if (multiMatch.length) {
  console.log('\n--- 複数ヒット（要手動確認）---');
  for (const m of multiMatch) console.log(`  ${m.name} -> ${m.hits.length} 件`);
}
const gradeMismatch = mapping.filter(m => !m.grade_match);
if (gradeMismatch.length) {
  console.log('\n--- 学年不一致（表示のみ・移行には影響なし）---');
  for (const m of gradeMismatch) console.log(`  ${m.sheet_name} sheet=${m.db_grade}<->DB=${m.db_grade}`);
}

writeFileSync('scripts/student-mapping.json', JSON.stringify({ mapping, unmatched, multiMatch }, null, 2), 'utf8');
console.log('\n出力: scripts/student-mapping.json');
console.log('\n※ 未ヒットの自動 INSERT はこのスクリプトでは行いません。レビュー後に別ステップで実施。');
