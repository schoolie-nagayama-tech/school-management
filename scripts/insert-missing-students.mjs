#!/usr/bin/env node
// 未ヒット4名を students に INSERT
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { writeFileSync, readFileSync } from 'node:fs';
config({ path: '.env.local' });

const SCHOOL_ID = process.env.MIGRATE_SCHOOL_ID || 'd187f7a3-633a-46ce-8d32-c56c85d17bac';
const DRY_RUN = process.argv.includes('--dry-run');

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// unmatched 情報は student-mapping.json から読み取る
import { readFileSync as _rf } from 'node:fs';
const _unmatched = JSON.parse(_rf('scripts/student-mapping.json','utf8')).unmatched || [];
const _kanaMap = {
  // 緑園都市
  '渡利日向子': { ln: 'ワタリ', fn: 'ヒナコ' },
  '渡邊琉': { ln: 'ワタナベ', fn: 'リュウ' },
  '石山愛莉': { ln: 'イシヤマ', fn: 'アイリ' },
  // 清瀬
  '高橋芽依': { ln: 'タカハシ', fn: 'メイ' },
  '村野孝太郎': { ln: 'ムラノ', fn: 'コウタロウ' },
};
const NEW = _unmatched.map(u => {
  const full = u.parsed.fullName.replace(/[\s　]/g,'').replace(/（.*?）/g,'');
  // 姓名分割: 既知の姓リストにマッチさせる（現行 3名は 1文字姓 or 2文字姓）
  const known = Object.keys(_kanaMap);
  const name = known.find(k => k === full);
  if (!name) throw new Error('unmatched name mapping missing: ' + full);
  // 姓と名を分ける (各ケースで明示)
  const split = { '渡利日向子':['渡利','日向子'], '渡邊琉':['渡邊','琉'], '石山愛莉':['石山','愛莉'], '高橋芽依':['高橋','芽依'], '村野孝太郎':['村野','孝太郎'] };
  const [ln, fn] = split[name];
  return {
    sheet_id: u.id, sheet_name: u.name,
    last_name: ln, first_name: fn,
    last_name_kana: _kanaMap[name].ln, first_name_kana: _kanaMap[name].fn,
    grade: u.parsed.grade,
  };
});

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
