import { notFound } from 'next/navigation';
import { isPortalV2Enabled } from '@/lib/mypage/flag';

export const dynamic = 'force-dynamic';

/**
 * /mypage（保護者ポータルv2）全体の門番。
 *
 * system_settings.portal_v2_enabled が false のときは /mypage 配下すべてを 404 にする
 * （docs/portal-v2-requirements.md §6-2 の「全体スイッチ」= 緊急遮断用）。
 * クローズド期間はここと「招待発行のアドミン限定」の二段構えでアクセスを閉じる。
 *
 * スタッフ用の AppHeader/AdminLayout は使わない（主体分離。保護者・生徒向けの
 * 独立したモバイルファーストのシェルにする）。
 */
export default async function MyPageLayout({ children }: { children: React.ReactNode }) {
  const enabled = await isPortalV2Enabled();
  if (!enabled) {
    // フラグ OFF は「機能が存在しない」として扱う（準備中を見せず 404）。
    notFound();
  }

  return (
    <div className="min-h-screen bg-surface text-text-body">
      <div className="mx-auto w-full max-w-md px-4 py-6">{children}</div>
    </div>
  );
}
