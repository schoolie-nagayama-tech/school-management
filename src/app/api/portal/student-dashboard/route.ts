/**
 * 生徒/保護者ダッシュボードの公開取得API（未ログイン）
 *
 * URL: /api/portal/student-dashboard?school_code=XXX&student_code=YYY&parent_email=ZZZ
 *
 * 認証：当面は school_code + student_code の組み合わせを「擬似的な認証」として扱う
 *      （生徒アカウントが整備されたら、サイン済みトークンに置き換える）
 *
 * 返却内容：
 *  - 生徒情報（名前、学年）
 *  - 今後1週間の授業（日付・科目・講師）
 *  - 振替予定（pending な転入コマ）
 *  - 今月の出欠サマリ（出席/欠席/遅刻/振替）
 *  - 科目ごとの最新報告書（承認済みのみ）
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// クライアントはリクエスト時に作る（モジュールロード時に作ると、
// Next.js のビルド時ページデータ収集フェーズで env が無い CI 環境などで
// `supabaseUrl is required` で落ちる）
function getAdminDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars are not configured');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const schoolCode = searchParams.get('school_code');
  const studentCode = searchParams.get('student_code');

  if (!schoolCode || !studentCode) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }

  const adminDb = getAdminDb();

  // 学校・生徒を特定
  const { data: school } = await adminDb
    .from('schools')
    .select('id, name, school_code')
    .eq('school_code', schoolCode)
    .maybeSingle();
  if (!school) {
    return NextResponse.json({ error: 'school_not_found' }, { status: 404 });
  }
  const { data: student } = await adminDb
    .from('students')
    .select('id, last_name, first_name, grade, status')
    .eq('school_id', (school as { id: string }).id)
    .eq('student_code', studentCode)
    .neq('status', 'withdrawn')
    .maybeSingle();
  if (!student) {
    return NextResponse.json({ error: 'student_not_found' }, { status: 404 });
  }
  type StudentLite = { id: string; last_name: string; first_name: string; grade: number };
  const stu = student as unknown as StudentLite;

  // 期間：今日〜+7日 / 今月
  const today = new Date();
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 7);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  // 今後1週間の授業
  const { data: upcoming } = await adminDb
    .from('schedule_entries')
    .select(
      'id, entry_date, time_slot:schedule_time_slots(slot_number, start_time, end_time), subject_ids, teacher:user_profiles!schedule_entries_teacher_id_fkey(display_name), kind, formation, status, transfer_from_id'
    )
    .eq('student_id', stu.id)
    .gte('entry_date', ymd(today))
    .lte('entry_date', ymd(weekEnd))
    .in('status', ['scheduled', 'transferred_in'])
    .order('entry_date', { ascending: true });

  // 今月の出欠サマリ
  const { data: monthEntries } = await adminDb
    .from('schedule_entries')
    .select('attendance_status, status')
    .eq('student_id', stu.id)
    .gte('entry_date', ymd(monthStart))
    .lte('entry_date', ymd(monthEnd));

  const attendanceCounts = { present: 0, absent: 0, late: 0, transfer: 0 };
  for (const e of (monthEntries || []) as Array<{
    attendance_status: 'present' | 'absent' | 'late' | null;
    status: string;
  }>) {
    if (e.attendance_status === 'present') attendanceCounts.present += 1;
    else if (e.attendance_status === 'absent') attendanceCounts.absent += 1;
    else if (e.attendance_status === 'late') attendanceCounts.late += 1;
    if (e.status === 'transferred_in') attendanceCounts.transfer += 1;
  }

  // 科目ごとの最新報告書（承認済みのみ、最新10件をサンプリング）
  const { data: reports } = await adminDb
    .from('class_reports')
    .select(
      'id, lesson_date, schedule_entry_id, review_comment, short_term_goal, homework_completion_pct, vocab_test_score, vocab_test_total, vocab_test_passed, check_test_score, check_test_total, check_test_passed, teacher:user_profiles!class_reports_teacher_id_fkey(display_name)'
    )
    .eq('student_id', stu.id)
    .eq('status', 'approved')
    .order('lesson_date', { ascending: false })
    .limit(15);

  // 科目名を解決（schedule_entries → subject_ids 経由）
  type ReportRow = {
    id: string;
    lesson_date: string;
    schedule_entry_id: string;
    review_comment: string | null;
    short_term_goal: string | null;
    homework_completion_pct: number | null;
    vocab_test_score: number | null;
    vocab_test_total: number | null;
    vocab_test_passed: boolean | null;
    check_test_score: number | null;
    check_test_total: number | null;
    check_test_passed: boolean | null;
    teacher: { display_name: string | null } | { display_name: string | null }[] | null;
  };
  const reportRows = (reports || []) as ReportRow[];
  const entryIds = reportRows.map((r) => r.schedule_entry_id);
  const subjectsByReport = new Map<string, string>();
  if (entryIds.length > 0) {
    const { data: ents } = await adminDb
      .from('schedule_entries')
      .select('id, subject_ids')
      .in('id', entryIds);
    const entryToSubjects = new Map<string, string[]>();
    for (const e of (ents || []) as { id: string; subject_ids: string[] }[]) {
      entryToSubjects.set(e.id, e.subject_ids || []);
    }
    const allSubIds = Array.from(new Set(Array.from(entryToSubjects.values()).flat()));
    if (allSubIds.length > 0) {
      const { data: subs } = await adminDb
        .from('subjects')
        .select('id, name')
        .in('id', allSubIds);
      const subMap = new Map<string, string>();
      for (const s of (subs || []) as { id: string; name: string }[]) subMap.set(s.id, s.name);
      for (const r of reportRows) {
        const subIds = entryToSubjects.get(r.schedule_entry_id) ?? [];
        const names = subIds.map((id) => subMap.get(id)).filter((n): n is string => !!n);
        subjectsByReport.set(r.id, names[0] ?? 'その他');
      }
    }
  }

  // 科目ごと最新1件にまとめ
  const latestBySubject = new Map<string, ReportRow & { subject: string }>();
  for (const r of reportRows) {
    const subject = subjectsByReport.get(r.id) ?? 'その他';
    if (!latestBySubject.has(subject)) {
      latestBySubject.set(subject, { ...r, subject });
    }
  }

  return NextResponse.json({
    school: { name: (school as { name: string }).name },
    student: stu,
    upcoming: upcoming ?? [],
    attendance_this_month: attendanceCounts,
    latest_reports_by_subject: Array.from(latestBySubject.values()).map((r) => ({
      id: r.id,
      subject: r.subject,
      lesson_date: r.lesson_date,
      teacher_name: Array.isArray(r.teacher)
        ? r.teacher[0]?.display_name
        : r.teacher?.display_name,
      preview: r.review_comment || r.short_term_goal || '',
      homework_completion_pct: r.homework_completion_pct,
      vocab_test_score: r.vocab_test_score,
      vocab_test_total: r.vocab_test_total,
      vocab_test_passed: r.vocab_test_passed,
      check_test_score: r.check_test_score,
      check_test_total: r.check_test_total,
      check_test_passed: r.check_test_passed,
    })),
  });
}
