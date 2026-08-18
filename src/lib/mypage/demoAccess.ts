import { isSystemAdmin } from '@/lib/utils/roles';

/**
 * 保護者ポータルV2デモに触れるロールか（公開範囲の単一の判定点）。
 *
 * 現在は admin（システム管理者）のみ（ユーザー判断 2026-07-16「一旦見えるのはアドミンのみ」）。
 * requireAdmin 相当（owner も通る）ではなく isSystemAdmin で判定するのは、
 * AppHeader のメニュー表示と API の認可がズレて「メニューに出ないのに API は叩ける」
 * 状態を作らないため。
 *
 * ★ 教室長以上へ開放するとき（V2試用の次段階）は、ここを
 *      return isManagerOrAbove(role);
 *   に変えるだけでよい（AppHeader の導線と /api/portal-demo/start の認可が両方追従する）。
 *   ただし**デモSQL の user_schools 付与も同時に**流すこと
 *   （supabase/demo/portal_v2_demo_data.sql の「manager開放の準備」節。
 *    付与しないと開いた先でデモ教室が見えず空振りする）。
 */
// 引数の型は roles.ts の各ヘルパーと同じ string | null | undefined に合わせる
// （getApiAuth の auth.role が string のため。狭めると API 側で型エラーになる）。
export function canAccessPortalDemo(role: string | null | undefined): boolean {
  return isSystemAdmin(role);
}
