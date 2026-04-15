#!/usr/bin/env node
// 未ヒット4名を students に INSERT
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { writeFileSync, readFileSync } from 'node:fs';
config({ path: '.env.local' });

const SCHOOL_ID = 'd187f7a3-633a-46ce-8d32-c56c85d17bac';
const DRY_RUN = process.argv.includes('--dry-run');

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const NEW = [
  { sheet_id: '19WtJcacHqV3_ZG0aPbTwMNLG8DgX5TIYNr9QebkFtGw', sheet_name: '中２＿冨來瑞生',
    last_name: '冨來', first_name: '瑞生', last_name_kana: 'トミキ', first_name_kana: 'ミズキ', grade: 8 },
  { sheet_id: '1HLIPw5HYFq06UK9IzuM-9q5zLh7sl2lynEHIh-yr9EQ', sheet_name: '中１＿大石朝陽',
    last_name: '大石', first_name: '朝陽', last_name_kana: 'オオイシ', first_name_kana: 'アサヒ', grade: 7 },
  { sheet_id: '15T4HBdt7JyKbnbdfk_IU0hG6vCS5C2vy7JgyBVMZOR8', sheet_name: '中１＿宇佐美結菜',
    last_name: '宇佐美', first_name: '結菜', last_name_kana: 'ウサミ', first_name_kana: 'ユイナ', grade: 7 },
  { sheet_id: '14g3VvHUWE4e1JaOWvrRvtlHH2m1F36iPe0XX3-96nZE', sheet_name: '小３＿大崎透',
    last_name: '大崎', first_name: '透', last_name_kana: 'オオサキ', first_name_kana: 'トオル', grade: 3 },
];

// 既存 student_code 採番パターン確認
const { data: existing } = await supa.from('students')
  .select('student_code').eq('school_id', SCHOOL_ID);
console.log('既存 student_code サンプル:', existing.slice(0, 3).map(s => s.student_code));
const existingCodes = new Set(existing.map(s => s.student_code));

// "Ammum" + 10chars lowercase alphanum (既存パターンに合わせる)
function genCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let s = 'Ammum';
    for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
    if (!existingCodes.has(s)) { existingCodes.add(s); return s; }
  }
  throw new Error('code gen failed');
}

const toInsert = NEW.map((s) => ({
  school_id: SCHOOL_ID,
  student_code: genCode(),
  last_name: s.last_name, first_name: s.first_name,
  last_name_kana: s.last_name_kana, first_name_kana: s.first_name_kana,
  grade: s.grade, status: 'active',
}));

console.log('\n--- INSERT 予定 ---');
for (const r of toInsert) console.log(' ', JSON.stringify(r));

if (DRY_RUN) { console.log('\n(dry-run — 実行せず終了)'); process.exit(0); }

const { data, error } = await supa.from('students').insert(toInsert).select('id, last_name, first_name, student_code');
if (error) { console.error('INSERT error:', error); process.exit(1); }
console.log('\n✓ INSERT 成功:', data.length, '件');

// mapping.json に反映
const map = JSON.parse(readFileSync('scripts/student-mapping.json', 'utf8'));
for (let i = 0; i < NEW.length; i++) {
  const inserted = data[i];
  map.mapping.push({
    sheet_id: NEW[i].sheet_id, sheet_name: NEW[i].sheet_name,
    student_id: inserted.id,
    db_name: inserted.last_name + inserted.first_name,
    db_grade: NEW[i].grade, db_status: 'active', grade_match: true, newly_inserted: true,
  });
}
map.unmatched = [];
writeFileSync('scripts/student-mapping.json', JSON.stringify(map, null, 2), 'utf8');
console.log('mapping 更新済み (全 ' + map.mapping.length + ' 件)');
