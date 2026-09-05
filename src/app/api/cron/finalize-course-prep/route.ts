import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, buildSnapshotPayload } from '@/lib/server/coursePrepBatch';
import { requireCronAuth } from '@/lib/cron-auth';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 終了からこの日数以内に終わった期だけを自動確定する。
 *
 * 導入時に「昔の期」までまとめて確定してしまうと、すでに痩せた数字
 * （退塾で消えた生徒・組み替え後の通塾パターン）を"確定"として焼き付けてしまう。
 * 古い期は確定済みにせず、未保存のまま見えている方がまだ正しい。
 */
const FINALIZE_WINDOW_DAYS = 45;

/**
 * GET /api/cron/finalize-course-prep
 * 毎日 早朝 JST にVercel Cronから呼ばれる。
 *
 * 講習期間の終了日を過ぎていて、まだ確定保存されていない期を自動で確定保存する。
 * 進捗表の数字はライブデータから再計算され続けるため（退塾で行が消える、通塾パターンの
 * 組み替えでコマ数が変わる等）、期が終わったら早めに入力を凍結しないと実績が残らない。
 *
 * - 冪等: 既にスナップショットがある期は対象外。同日に複数回叩いても上書きしない。
 * - 退塾cronとの実行順に依存しない: 生徒取得側が「期間中に在籍していた生徒」で
 *   絞るようになっているため、先に withdrawn になっていても中身は欠けない。
 * - 手動の「取り直し」は上書きするが、この自動確定は上書きしない（人の判断を消さない）。
 *
 * 設計: docs/koushu-progress-snapshot-plan.md
 */
export async function GET(request: NextRequest) {
  // Vercel Cron認証（CRON_SECRET 未設定なら拒否＝フェイルクローズド）
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // JSTの「今日」。終了日 < 今日 で「終了した期」を判定する（終了日当日はまだ確定しない）。
    const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayJST = nowJST.toISOString().slice(0, 10);
    const windowStart = new Date(nowJST.getTime() - FINALIZE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    // 終了済みの期（直近ぶんのみ）。期の数は教室×3期/年なので少なく、ページング不要。
    const { data: periods, error: periodError } = await supabaseAdmin
      .from('course_prep_periods')
      .select('school_id, season, year, schedule_end_date')
      .not('schedule_end_date', 'is', null)
      .lt('schedule_end_date', todayJST)
      .gte('schedule_end_date', windowStart);

    if (periodError) {
      console.error('[cron/finalize-course-prep] 期の取得エラー:', periodError);
      return NextResponse.json({ ok: false, error: 'Period query failed' }, { status: 500 });
    }
    if (!periods || periods.length === 0) {
      return NextResponse.json({ ok: true, saved: 0, skipped: 0, date: todayJST });
    }

    // 既に確定済みの期を引いて差集合を取る（PostgREST で anti-join できないためJS側で突き合わせる）。
    const { data: existing } = await supabaseAdmin
      .from('course_prep_snapshots')
      .select('school_id, season, year');
    const savedKeys = new Set(
      (existing || []).map(
        (s: { school_id: string; season: string; year: number }) =>
          `${s.school_id}:${s.season}:${s.year}`
      )
    );

    const targets = periods.filter(
      (p: { school_id: string; season: string; year: number }) =>
        !savedKeys.has(`${p.school_id}:${p.season}:${p.year}`)
    );

    let saved = 0;
    let skipped = 0;
    const errors: string[] = [];

    // 教室ごとに順番に処理する。1件失敗しても残りは続ける（1校の設定漏れで全校が止まらないように）。
    for (const p of targets as { school_id: string; season: string; year: number }[]) {
      const label = `${p.school_id}/${p.season}/${p.year}`;
      try {
        const { payload, studentCount } = await buildSnapshotPayload(
          supabaseAdmin,
          p.school_id,
          p.season,
          p.year
        );

        // 中身が無い期を「確定済み」にすると、空のまま二度と取り直されない状態になる。
        // 未保存のまま残して、人が気づけるようにする。
        if (studentCount === 0 || payload.items.length === 0) {
          skipped++;
          continue;
        }

        const { error } = await supabaseAdmin.from('course_prep_snapshots').insert({
          school_id: p.school_id,
          season: p.season,
          year: p.year,
          payload,
          summary: null,
          student_count: studentCount,
          captured_by: null,
          capture_reason: 'auto',
        });
        // unique 制約違反 = 走っている間に誰かが手動確定した。上書きしないので成功扱い。
        if (error && error.code !== '23505') {
          errors.push(`${label}: ${error.message}`);
          continue;
        }
        saved++;
      } catch (e) {
        errors.push(`${label}: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }

    if (errors.length > 0) {
      console.warn('[cron/finalize-course-prep] 一部失敗:', errors);
    }
    return NextResponse.json({ ok: true, saved, skipped, errors, date: todayJST });
  } catch (e) {
    captureApiError(e, {
      route: 'GET /api/cron/finalize-course-prep',
    });
    console.error('[cron/finalize-course-prep] エラー:', e);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
