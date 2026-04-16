#!/usr/bin/env node
// DEFAULT 校（d0dea5b6...）に居て、永山校（d187f7a3...）にも同名で居る生徒を物理削除
// 関連: student_logs を先に削除してから students を削除
// 使い方:
//   node scripts/delete-default-duplicates.mjs           # dry-run
//   node scripts/delete-default-duplicates.mjs --go      # 実行
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const DEFAULT_SCHOOL = 'd0dea5b6-7f4c-4160-9ea6-3b91b4f895a0';
const NAGAYAMA_SCHOOL = 'd187f7a3-633a-46ce-8d32-c56c85d17bac';
const DRY = !process.argv.includes('--go');

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const { data: defStu } = await supa
  .from('students')
  .select('id, last_name, first_name, deleted_at')
  .eq('school_id', DEFAULT_SCHOOL);
const { data: nagStu } = await supa
  .from('students')
  .select('last_name, first_name')
  .eq('school_id', NAGAYAMA_SCHOOL);
const nagNames = new Set(nagStu.map((s) => s.last_name + s.first_name));
const dups = defStu.filter((s) => nagNames.has(s.last_name + s.first_name));
const dupIds = dups.map((s) => s.id);

console.log(`DEFAULT 重複生徒: ${dups.length} 名`);
console.log(`  内 soft-deleted: ${dups.filter((s) => s.deleted_at != null).length}`);
console.log(`  内 alive:        ${dups.filter((s) => s.deleted_at == null).length}`);

// 念のため再確認: assessments / interviews / 他参照が無いこと
const checkTables = [
  'assessments', 'student_interviews', 'student_applications',
  'student_textbooks', 'alert_dismissals', 'student_seasonal_shift_plans',
];
for (const t of checkTables) {
  const { count } = await supa.from(t).select('id', { count: 'exact', head: true }).in('student_id', dupIds);
  console.log(`  ${t}: ${count ?? 0} 件参照`);
  if ((count ?? 0) > 0) {
    console.error(`  ! ${t} に参照が残っている。中止。`);
    process.exit(1);
  }
}
const { count: logsCount } = await supa.from('student_logs').select('id', { count: 'exact', head: true }).in('student_id', dupIds);
console.log(`  student_logs: ${logsCount ?? 0} 件（先に削除）`);

if (DRY) {
  console.log('\n--- DRY-RUN サンプル (先頭5名) ---');
  for (const s of dups.slice(0, 5)) {
    console.log(' ', s.last_name + s.first_name, s.deleted_at ? '[soft-deleted]' : '[alive]');
  }
  console.log('\n(--go で実行)');
  process.exit(0);
}

// 1. student_logs 削除
console.log('\nstudent_logs 削除中...');
const { error: e1 } = await supa.from('student_logs').delete().in('student_id', dupIds);
if (e1) { console.error('logs delete err:', e1); process.exit(1); }

// 2. students 物理削除
console.log('students 削除中...');
const { error: e2 } = await supa.from('students').delete().in('id', dupIds);
if (e2) { console.error('students delete err:', e2); process.exit(1); }

console.log(`\n✓ ${dupIds.length} 名 + student_logs ${logsCount ?? 0} 件 を削除しました。`);
