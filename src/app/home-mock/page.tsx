'use client';

/**
 * 教室長ダッシュボード モック（検討用・admin 限定のまま据え置き）。
 * 本体は components/dashboard/ClassroomDashboard.tsx に移動済み。
 * 試用向けの本ルートは /dashboard（教室長以上）。こちらは検討・比較用に残す。
 * 判定はリンク側（AppHeader の歯車メニュー）と同じ isSystemAdmin。
 */

import { GuardedClassroomDashboard } from '@/components/dashboard/ClassroomDashboard';
import { isSystemAdmin } from '@/lib/utils/roles';

export default function HomeMockPage() {
  return (
    <GuardedClassroomDashboard
      allowed={isSystemAdmin}
      deniedMessage="このページはシステム管理者のみアクセス可能です"
    />
  );
}
