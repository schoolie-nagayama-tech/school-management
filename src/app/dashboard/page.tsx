'use client';

/**
 * 教室長ダッシュボード（V2試用・教室長以上）。
 * 本体は components/dashboard/ClassroomDashboard.tsx（/home-mock と共通）。
 *
 * パスを /home ではなく /dashboard にした理由: /home は PWA ホーム画面が使用中のため。
 * 判定はリンク側（navConfig の isManagerOrAbove）と同じ関数にする
 * （ズレると「メニューに出ないのに URL 直打ちで開ける」が再発する）。
 */

import { GuardedClassroomDashboard } from '@/components/dashboard/ClassroomDashboard';
import { isManagerOrAbove } from '@/lib/utils/roles';

export default function DashboardPage() {
  return (
    <GuardedClassroomDashboard
      allowed={isManagerOrAbove}
      deniedMessage="このページは教室長以上のみアクセス可能です"
    />
  );
}
