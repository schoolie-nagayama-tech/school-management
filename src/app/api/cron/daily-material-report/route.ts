import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { notifyDailyReport } from '@/lib/slack';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CRON_SECRET = process.env.CRON_SECRET;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/cron/daily-material-report
 * 平日13:00 JST にVercel Cronから呼ばれる
 * 未確認の発注 & 発送後7日以上未配布をSlackに通知
 */
export async function GET(request: NextRequest) {
  // Vercel Cron認証
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 土日チェック（JST）
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dayOfWeek = nowJST.getUTCDay(); // 0=日, 6=土
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'weekend' });
  }

  try {
    // 全教室を取得（デモ除外）
    const { data: schools, error: schoolError } = await supabaseAdmin
      .from('schools')
      .select('id, name, slack_mention_id')
      .eq('is_demo', false);

    if (schoolError || !schools || schools.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'no schools' });
    }

    // 未確認の注文を取得
    const { data: unconfirmedOrders } = await supabaseAdmin
      .from('material_orders')
      .select(`
        id, school_id, created_at,
        material:materials(name),
        student:students(last_name, first_name)
      `)
      .eq('status', 'unconfirmed');

    // 発送後7日以上未配布の注文を取得
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: overdueOrders } = await supabaseAdmin
      .from('material_orders')
      .select(`
        id, school_id, delivered_at,
        material:materials(name),
        student:students(last_name, first_name)
      `)
      .eq('status', 'delivered')
      .lt('delivered_at', sevenDaysAgo);

    // 教室ごとにグループ化
    const reportSchools = schools.map((school) => {
      const unconfirmed = (unconfirmedOrders || [])
        .filter((o: Record<string, unknown>) => o.school_id === school.id)
        .map((o: Record<string, unknown>) => {
          const mat = o.material as { name: string } | null;
          const stu = o.student as { last_name: string; first_name: string } | null;
          const created = new Date(o.created_at as string);
          return {
            materialName: mat?.name || '不明',
            studentName: stu ? `${stu.last_name} ${stu.first_name}` : '不明',
            createdAt: `${created.getMonth() + 1}/${created.getDate()}`,
          };
        });

      const overdueDistribution = (overdueOrders || [])
        .filter((o: Record<string, unknown>) => o.school_id === school.id)
        .map((o: Record<string, unknown>) => {
          const mat = o.material as { name: string } | null;
          const stu = o.student as { last_name: string; first_name: string } | null;
          const delivered = new Date(o.delivered_at as string);
          return {
            materialName: mat?.name || '不明',
            studentName: stu ? `${stu.last_name} ${stu.first_name}` : '不明',
            deliveredAt: `${delivered.getMonth() + 1}/${delivered.getDate()}`,
          };
        });

      return {
        schoolName: school.name,
        slackMentionId: school.slack_mention_id,
        unconfirmed,
        overdueDistribution,
      };
    });

    // 日付文字列
    const dateStr = `${nowJST.getUTCMonth() + 1}/${nowJST.getUTCDate()}`;

    const result = await notifyDailyReport({
      date: dateStr,
      schools: reportSchools,
    });

    return NextResponse.json({ ok: true, notified: result });
  } catch (e) {
    console.error('[cron/daily-material-report] エラー:', e);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
