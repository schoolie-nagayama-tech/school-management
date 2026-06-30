import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CRON_SECRET = process.env.CRON_SECRET;

function getSupabaseAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * GET /api/cron/withdraw-expired-students
 * 毎日 早朝 4:00 JST にVercel Cronから呼ばれる。
 *
 * 退塾予定日(withdrawal_date)を過ぎた生徒のステータスを自動で 'withdrawn'(退会) に切り替える。
 * 「退塾日の翌日」に切り替わる片方向処理:
 *   - 条件は withdrawal_date < 今日(JST)。退塾日当日はまだ在籍、翌日以降に withdrawn になる。
 *   - 退塾日を未来へ変更・削除しても active に戻すことはしない（手動運用に委ねる。在籍生の誤復活を防ぐ）。
 *   - 既に withdrawn の生徒は対象外（冪等。同日に複数回叩いても二重ログにならない）。
 */
export async function GET(request: NextRequest) {
  // Vercel Cron認証（既存cronと同パターン）
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // JSTの「今日」の日付文字列(YYYY-MM-DD)。退塾日 < 今日 で「翌日以降」を判定する。
    const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayJST = nowJST.toISOString().slice(0, 10);

    // 退塾日を過ぎた在籍/休会の生徒を取得（横断で1000件を超えうるため全件ページング取得）
    const targets = await fetchAllPaged<{
      id: string;
      school_id: string;
      status: string;
      withdrawal_date: string | null;
    }>((from, to) =>
      supabaseAdmin
        .from('students')
        .select('id, school_id, status, withdrawal_date')
        .is('deleted_at', null)
        .neq('status', 'withdrawn')
        .lt('withdrawal_date', todayJST)
        .order('id', { ascending: true })
        .range(from, to)
    ).catch(() => []);

    if (targets.length === 0) {
      return NextResponse.json({ ok: true, switched: 0, date: todayJST });
    }

    // 初回実行では過去分がまとめてヒットしうるため、URL長/挿入件数の制約を避けて
    // 300件ずつチャンク処理する（.in() のURL長対策と同じ閾値）。
    const CHUNK = 300;
    const nowIso = new Date().toISOString();
    let switched = 0;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = targets.slice(i, i + CHUNK);
      const ids = batch.map((s) => s.id);

      // ステータスを withdrawn に更新
      const { error: updateError } = await supabaseAdmin
        .from('students')
        .update({ status: 'withdrawn', updated_at: nowIso })
        .in('id', ids);
      if (updateError) {
        console.error('[cron/withdraw-expired-students] 更新エラー:', updateError);
        return NextResponse.json({ ok: false, error: 'Update failed', switched }, { status: 500 });
      }
      switched += ids.length;

      // 監査ログ（status_changed）。手動編集時の updateStudent と揃えた差分形式で記録。
      const logRows = batch.map((s) => ({
        student_id: s.id,
        school_id: s.school_id,
        action: 'status_changed' as const,
        actor: 'system:cron/withdraw-expired-students',
        diff: {
          status: { old: s.status, new: 'withdrawn' },
          reason: { withdrawal_date: s.withdrawal_date, today: todayJST },
        },
      }));
      const { error: logError } = await supabaseAdmin.from('student_logs').insert(logRows);
      if (logError) {
        // ログ失敗は警告のみ（ステータス更新自体は成功扱い）
        console.warn('[cron/withdraw-expired-students] ログ書き込み失敗:', logError);
      }
    }

    return NextResponse.json({ ok: true, switched, date: todayJST });
  } catch (e) {
    console.error('[cron/withdraw-expired-students] エラー:', e);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
