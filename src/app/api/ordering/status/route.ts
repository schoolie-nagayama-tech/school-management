import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import {
  notifyOrderPlaced,
  notifyOrderDelivered,
  notifyBulkOrderPlaced,
  notifyBulkOrderDelivered,
} from '@/lib/slack';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/ordering/status
 * ステータス更新後にSlack通知を送信
 * Body: { orderIds: string[], newStatus: string }
 */
export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  try {
    const { orderIds, newStatus } = await request.json();

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0 || !newStatus) {
      return NextResponse.json({ error: '無効なリクエスト' }, { status: 400 });
    }

    // 発注 or 発送の通知のみ
    if (newStatus !== 'ordered' && newStatus !== 'delivered') {
      return NextResponse.json({ ok: true, notified: false });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 注文詳細を取得
    const { data: orders, error } = await supabaseAdmin
      .from('material_orders')
      .select(`
        id, quantity, school_id,
        material:materials(name),
        student:students(last_name, first_name)
      `)
      .in('id', orderIds);

    if (error || !orders || orders.length === 0) {
      return NextResponse.json({ ok: true, notified: false });
    }

    // 教室名を取得
    const schoolIds = Array.from(new Set(orders.map((o: Record<string, unknown>) => o.school_id as string)));
    const { data: schools } = await supabaseAdmin
      .from('schools')
      .select('id, name')
      .in('id', schoolIds);
    const schoolNameMap: Record<string, string> = {};
    for (const s of schools || []) {
      schoolNameMap[s.id] = s.name;
    }

    const notifyFn = newStatus === 'ordered' ? notifyOrderPlaced : notifyOrderDelivered;
    const bulkNotifyFn = newStatus === 'ordered' ? notifyBulkOrderPlaced : notifyBulkOrderDelivered;

    if (orders.length === 1) {
      const o = orders[0] as Record<string, unknown>;
      const material = o.material as { name: string } | null;
      const student = o.student as { last_name: string; first_name: string } | null;
      await notifyFn({
        schoolName: schoolNameMap[o.school_id as string] || '不明',
        materialName: material?.name || '不明',
        studentName: student ? `${student.last_name} ${student.first_name}` : '不明',
        quantity: (o.quantity as number) || 1,
      });
    } else {
      // 教室ごとにグループ化して一括通知
      const grouped: Record<string, typeof orders> = {};
      for (const o of orders) {
        const sid = (o as Record<string, unknown>).school_id as string;
        if (!grouped[sid]) grouped[sid] = [];
        grouped[sid].push(o);
      }

      for (const [schoolId, schoolOrders] of Object.entries(grouped)) {
        const items = schoolOrders.map((o: Record<string, unknown>) => {
          const material = o.material as { name: string } | null;
          const student = o.student as { last_name: string; first_name: string } | null;
          return {
            materialName: material?.name || '不明',
            studentName: student ? `${student.last_name} ${student.first_name}` : '不明',
            quantity: (o.quantity as number) || 1,
          };
        });
        await bulkNotifyFn({
          schoolName: schoolNameMap[schoolId] || '不明',
          orderCount: schoolOrders.length,
          items,
        });
      }
    }

    return NextResponse.json({ ok: true, notified: true });
  } catch (e) {
    console.error('[api/ordering/status] Slack通知エラー:', e);
    return NextResponse.json({ ok: true, notified: false });
  }
}
