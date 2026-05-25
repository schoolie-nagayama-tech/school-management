/**
 * Phase 0 マイグレーション適用確認スクリプト
 *
 * 実行: node scripts/verify-phase0-migrations.mjs
 *
 * 各テーブルに対し、新規追加されたカラム / テーブルが存在するかを検証する。
 * 1件でも失敗したら exit 1。全件OKなら exit 0。
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が .env.local に必要です');
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const checks = [
  // schedule_entries.kind, formation
  {
    label: 'schedule_entries.kind / formation',
    run: () => supabase.from('schedule_entries').select('id, kind, formation').limit(1),
  },
  // schedule_regular_patterns.formation, effective_from/until
  {
    label: 'schedule_regular_patterns.formation / effective_from / effective_until',
    run: () =>
      supabase
        .from('schedule_regular_patterns')
        .select('id, formation, effective_from, effective_until')
        .limit(1),
  },
  // schedule_time_slots.formation
  {
    label: 'schedule_time_slots.formation',
    run: () => supabase.from('schedule_time_slots').select('id, formation').limit(1),
  },
  // students.withdrawal_date, preferred_teacher_gender, fixed_teacher_ids, excluded_teacher_ids
  {
    label: 'students.withdrawal_date / 講師希望3種',
    run: () =>
      supabase
        .from('students')
        .select('id, withdrawal_date, preferred_teacher_gender, fixed_teacher_ids, excluded_teacher_ids')
        .limit(1),
  },
  // user_profiles.gender
  {
    label: 'user_profiles.gender',
    run: () => supabase.from('user_profiles').select('id, gender').limit(1),
  },
  // school_class_capacity テーブル存在
  {
    label: 'school_class_capacity テーブル',
    run: () =>
      supabase
        .from('school_class_capacity')
        .select('id, max_students_per_teacher_individual, total_individual_seats, max_students_per_group, max_concurrent_groups')
        .limit(1),
  },
  // schedule_daily_booth_assignments テーブル存在 (P1-NEW で追加)
  {
    label: 'schedule_daily_booth_assignments テーブル (P1)',
    run: () =>
      supabase
        .from('schedule_daily_booth_assignments')
        .select('id, school_id, assignment_date, teacher_id, booth_no')
        .limit(1),
  },
  // schedule_entries.transfer_deadline (P1-1)
  {
    label: 'schedule_entries.transfer_deadline (P1)',
    run: () => supabase.from('schedule_entries').select('id, transfer_deadline').limit(1),
  },
  // class_reports テーブル (P2-1)
  {
    label: 'class_reports テーブル (P2)',
    run: () =>
      supabase
        .from('class_reports')
        .select('id, schedule_entry_id, status, lesson_date')
        .limit(1),
  },
  // lesson_report_units テーブル (P2-1)
  {
    label: 'lesson_report_units テーブル (P2)',
    run: () =>
      supabase
        .from('lesson_report_units')
        .select('id, report_id, is_main, curriculum_item_ids, page_start, page_end')
        .limit(1),
  },
  // progress_sessions.report_id (P2-1)
  {
    label: 'progress_sessions.report_id (P2)',
    run: () => supabase.from('progress_sessions').select('id, report_id').limit(1),
  },
];

let pass = 0;
let fail = 0;
for (const c of checks) {
  const { error } = await c.run();
  if (error) {
    console.log(`  ✗  ${c.label}`);
    console.log(`     → ${error.message}`);
    fail++;
  } else {
    console.log(`  ✓  ${c.label}`);
    pass++;
  }
}

console.log(`\n結果: ${pass} OK / ${fail} NG`);
process.exit(fail === 0 ? 0 : 1);
