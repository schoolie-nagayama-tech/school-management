'use client';

import Link from 'next/link';
import { ClipboardCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePendingAttendanceCount } from '@/hooks/usePendingAttendanceCount';

/**
 * 出勤簿の未処理件数を知らせる帯。アラートボードの上に置く。
 *
 * ★ なぜ生徒アラート（AlertBoard）に混ぜないか:
 *   Alert 型は student_id / student_name / grade が必須で、表示も生徒ごとの
 *   グルーピング前提。出勤簿は生徒に紐づかないため、ダミーの生徒IDを入れると
 *   並び順・生徒リンク・グルーピングが壊れる。別枠にして生徒アラートには触れない。
 *
 * ★ 0件のときは何も描画しない（常設の空枠を作らない）。
 */
export function PendingAttendanceNotice() {
  const { profile } = useAuth();
  const count = usePendingAttendanceCount();

  if (count === 0) return null;

  const isManager = profile?.role === 'manager';
  // 教室長は「確認して管理者へ提出する」、管理者・オーナーは「承認する」
  const label = isManager
    ? `講師から提出された出勤簿が${count}件あります`
    : `承認待ちの出勤簿が${count}件あります`;
  const action = isManager ? '確認して管理者へ提出' : '一括承認できます';

  return (
    <Link
      href="/admin/attendance"
      className="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 hover:bg-warning/20 transition-[background-color] duration-150 ease-out"
    >
      <ClipboardCheck className="h-4 w-4 shrink-0 text-warning" aria-hidden />
      <span className="text-sm font-medium text-text-heading">{label}</span>
      <span className="text-xs text-text-muted">{action}</span>
    </Link>
  );
}
