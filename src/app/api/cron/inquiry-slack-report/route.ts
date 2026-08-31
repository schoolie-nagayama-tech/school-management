import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { notifyInquiryReport, type InquirySchoolReport } from '@/lib/slack';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import { requireCronAuth } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// 対応遅延として通知する経過日数（旧GAS互換）
const ALERT_DAYS = [3, 5, 7, 10, 14, 21, 30];

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** JSTの日付(00:00)としての経過日数 */
function daysSinceJst(iso: string, nowJstMs: number): number {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const nowDate = new Date(nowJstMs);
  const nowStart = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
  return Math.floor((nowStart - dayStart) / 86400000);
}

type InquiryRow = {
  school_id: string;
  inquired_at: string;
  student_name: string | null;
  guardian_name: string | null;
  status: string;
  trial_at: string | null;
  interview_at: string | null;
  enrolled_at: string | null;
};

/**
 * GET /api/cron/inquiry-slack-report
 * 平日13:00 JST にVercel Cronから呼ばれる（vercel.json）。
 * 教室別の問合せ進捗サマリー＋対応遅延案件をSlackに通知。月曜は週次レポートを併記。
 */
export async function GET(request: NextRequest) {
  // Vercel Cron認証（CRON_SECRET 未設定なら拒否＝フェイルクローズド）
  const authError = requireCronAuth(request);
  if (authError) return authError;

  // 土日チェック（JST）
  const nowJstMs = Date.now() + 9 * 60 * 60 * 1000;
  const nowJst = new Date(nowJstMs);
  const dayOfWeek = nowJst.getUTCDay(); // 0=日, 6=土
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'weekend' });
  }
  const isMonday = dayOfWeek === 1;

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 教室＋問合せ用設定（メンション先）を取得
    const [{ data: schools, error: schoolError }, { data: settings }] = await Promise.all([
      supabaseAdmin.from('schools').select('id, name').eq('is_demo', false),
      supabaseAdmin.from('inquiry_school_settings').select('school_id, slack_mention_id'),
    ]);
    if (schoolError || !schools || schools.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'no schools' });
    }
    const mentionBySchool = new Map<string, string | null>(
      (settings ?? []).map((s) => [s.school_id as string, s.slack_mention_id as string | null])
    );

    // 全問合せ（未削除）をページングで取得
    const inquiries = await fetchAllPaged<InquiryRow>((from, to) =>
      supabaseAdmin
        .from('inquiries')
        .select(
          'school_id, inquired_at, student_name, guardian_name, status, trial_at, interview_at, enrolled_at'
        )
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to)
    ).catch(() => [] as InquiryRow[]);

    if (inquiries.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'no inquiries' });
    }

    // 今月のJST境界（YYYY-MM プレフィックス比較で十分）
    const monthPrefix = `${nowJst.getUTCFullYear()}-${String(nowJst.getUTCMonth() + 1).padStart(2, '0')}`;
    const weekAgoMs = nowJstMs - 7 * 86400000;

    const reportSchools: InquirySchoolReport[] = [];

    for (const school of schools) {
      const rows = inquiries.filter((i) => i.school_id === school.id);
      if (rows.length === 0) continue; // 問合せのない教室は通知しない

      // 進捗サマリー（GASのデイリーサマリー互換）
      const summary = {
        inProgress: 0,
        trialPlanned: 0,
        interviewPlanned: 0,
        unreachable: 0,
        monthInquiries: 0,
        monthEnrolled: 0,
      };
      const delays: InquirySchoolReport['delays'] = [];
      let weekNew = 0;
      let weekTrials = 0;
      let weekEnrolled = 0;

      for (const r of rows) {
        // 今月の問合せ・入会
        const inqJst = new Date(new Date(r.inquired_at).getTime() + 9 * 3600000);
        const inqMonth = `${inqJst.getUTCFullYear()}-${String(inqJst.getUTCMonth() + 1).padStart(2, '0')}`;
        if (inqMonth === monthPrefix) summary.monthInquiries++;
        if (r.enrolled_at && r.enrolled_at.startsWith(monthPrefix)) summary.monthEnrolled++;

        if (r.status === 'in_progress') {
          if (r.trial_at) summary.trialPlanned++;
          else if (r.interview_at) summary.interviewPlanned++;
          else summary.inProgress++;
        } else if (r.status === 'unreachable') {
          summary.unreachable++;
        }

        // 対応遅延: 対応中/連絡不通で体験・入面が無く、経過日数がALERT_DAYSに一致
        if (
          (r.status === 'in_progress' || r.status === 'unreachable') &&
          !r.trial_at &&
          !r.interview_at
        ) {
          const days = daysSinceJst(r.inquired_at, nowJstMs);
          if (ALERT_DAYS.includes(days)) {
            delays.push({
              name: r.student_name || r.guardian_name || '名前未登録',
              days,
              inquiredAt: `${inqJst.getUTCMonth() + 1}/${inqJst.getUTCDate()}`,
            });
          }
        }

        // 週次（直近7日）
        if (isMonday) {
          if (new Date(r.inquired_at).getTime() + 9 * 3600000 >= weekAgoMs) weekNew++;
          if (r.trial_at && new Date(r.trial_at).getTime() + 9 * 3600000 >= weekAgoMs) weekTrials++;
          if (
            r.enrolled_at &&
            new Date(r.enrolled_at + 'T00:00:00+09:00').getTime() + 9 * 3600000 >= weekAgoMs
          )
            weekEnrolled++;
        }
      }

      delays.sort((a, b) => b.days - a.days);

      reportSchools.push({
        schoolName: school.name as string,
        slackMentionId: mentionBySchool.get(school.id as string) ?? null,
        summary,
        delays,
        weekly: isMonday
          ? {
              newInquiries: weekNew,
              trials: weekTrials,
              enrolled: weekEnrolled,
              enrollRate: weekNew > 0 ? Math.round((weekEnrolled / weekNew) * 100) : 0,
            }
          : null,
      });
    }

    if (reportSchools.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'no report targets' });
    }

    const dateStr = `${nowJst.getUTCMonth() + 1}/${nowJst.getUTCDate()}`;
    const result = await notifyInquiryReport({ date: dateStr, schools: reportSchools });

    return NextResponse.json({ ok: true, notified: result, schools: reportSchools.length });
  } catch (e) {
    console.error('[cron/inquiry-slack-report] エラー:', e);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
