import { notFound } from 'next/navigation';
import { isPortalV2Enabled } from '@/lib/mypage/flag';
import { getPortalContext } from '@/lib/mypage/supabase';
import { DemoBanner } from './DemoBanner';

export const dynamic = 'force-dynamic';

/**
 * /mypage（保護者ポータルv2）全体の門番。
 *
 * system_settings.portal_v2_enabled が false のときは /mypage 配下すべてを 404 にする
 * （docs/portal-v2-requirements.md §6-2 の「全体スイッチ」= 緊急遮断用）。
 * クローズド期間はここと「招待発行のアドミン限定」の二段構えでアクセスを閉じる。
 *
 * ★ デモの例外（フラグを ON にしないための設計）:
 *   本番で教室長に触ってもらうためにフラグを ON にすると、/mypage/login が
 *   一般公開されてしまう（＝クローズドの前提が壊れる）。そこでフラグは
 *   「クローズド公開の門番」として据え置いたまま、署名済みの demo クレームを持つ
 *   セッションだけを通す。デモは発行時にダミーデータ専用と検証済み（api/portal-demo/start）
 *   かつ RLS で紐づけ生徒しか見えないため、実データには到達しない。
 *
 * スタッフ用の AppHeader/AdminLayout は使わない（主体分離。保護者・生徒向けの
 * 独立したモバイルファーストのシェルにする）。
 */
export default async function MyPageLayout({ children }: { children: React.ReactNode }) {
  const [enabled, ctx] = await Promise.all([isPortalV2Enabled(), getPortalContext()]);
  const isDemo = ctx?.claims.demo === true;

  if (!enabled && !isDemo) {
    // フラグ OFF は「機能が存在しない」として扱う（準備中を見せず 404）。
    notFound();
  }

  return (
    <div className="min-h-screen bg-surface text-text-body">
      <div className="mx-auto w-full max-w-md px-4 py-6">
        {isDemo && <DemoBanner />}
        {children}
      </div>
    </div>
  );
}
