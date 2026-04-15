#!/usr/bin/env node
// 生徒のフリガナ（ひらがな→カタカナ）統一
// --dry-run で変更対象を表示のみ / --all で全校 / デフォルトは永山のみ / --go で実行
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const SCHOOL_ID = 'd187f7a3-633a-46ce-8d32-c56c85d17bac';
const DRY = !process.argv.includes('--go');
const ALL_SCHOOLS = process.argv.includes('--all');

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ひらがな(U+3041..U+3096, U+309D..U+309E) -> カタカナ (+0x60)
function toKana(s) {
  if (!s) return s;
  return [...s].map(ch => {
    const code = ch.codePointAt(0);
    if ((code >= 0x3041 && code <= 0x3096) || code === 0x309D || code === 0x309E) {
      return String.fromCodePoint(code + 0x60);
    }
    return ch;
  }).join('');
}

const hasHiragana = s => /[\u3041-\u3096\u309D-\u309E]/.test(s || '');

let q = supa.from('students').select('id, last_name, first_name, last_name_kana, first_name_kana, school_id');
if (!ALL_SCHOOLS) q = q.eq('school_id', SCHOOL_ID);
const { data, error } = await q;
if (error) { console.error(error); process.exit(1); }

const targets = data.filter(s => hasHiragana(s.last_name_kana) || hasHiragana(s.first_name_kana));
console.log(`全対象: ${data.length} 名 / ひらがな含む: ${targets.length} 名`);

const updates = targets.map(s => ({
  id: s.id,
  last_name_kana_new: toKana(s.last_name_kana),
  first_name_kana_new: toKana(s.first_name_kana),
  name: s.last_name + s.first_name,
  old: s.last_name_kana + ' / ' + s.first_name_kana,
}));

console.log('\n--- 変換プレビュー (先頭10件) ---');
for (const u of updates.slice(0, 10)) {
  console.log(`  ${u.name}: ${u.old} -> ${u.last_name_kana_new} / ${u.first_name_kana_new}`);
}
if (updates.length > 10) console.log(`  ... 他 ${updates.length - 10} 件`);

if (DRY) { console.log('\n(dry-run — --go で実行)'); process.exit(0); }

let ok = 0, ng = 0;
for (const u of updates) {
  const { error: e } = await supa.from('students')
    .update({ last_name_kana: u.last_name_kana_new, first_name_kana: u.first_name_kana_new })
    .eq('id', u.id);
  if (e) { ng++; console.error('  NG', u.name, e.message); } else ok++;
}
console.log(`\n✓ 更新: ${ok} 件 / 失敗: ${ng} 件`);
