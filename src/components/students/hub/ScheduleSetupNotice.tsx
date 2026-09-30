'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { countActiveRegularPatterns } from '@/lib/api/schedule';
import { isTeacher } from '@/lib/utils/roles';

interface ScheduleSetupNoticeProps {
  studentId: string;
}

/**
 * 通塾日程が0件の生徒にだけ出す「通塾セットアップ」への導線（入会オンボーディング）。
 *
 * ★判定と遷移先は生徒詳細モーダル（StudentDetailModal）と同じにしてある:
 *   countActiveRegularPatterns が 0 件 → /students/[id]/onboarding。講師には出さない。
 *   取得が例外で失敗したときは出さない（安全側。モーダルと同じ）。
 * 1件以上なら何も描かない。読み込み中も描かない（出たり消えたりしてガタつかないように）。
 */
export function ScheduleSetupNotice({ studentId }: ScheduleSetupNoticeProps) {
  const { profile } = useAuth();
  const teacher = isTeacher(profile?.role);
  const [hasPatterns, setHasPatterns] = useState<boolean | null>(null);

  useEffect(() => {
    if (teacher) return;
    let cancelled = false;
    setHasPatterns(null);
    countActiveRegularPatterns(studentId)
      .then((n) => {
        if (!cancelled) setHasPatterns(n > 0);
      })
      .catch(() => {
        if (!cancelled) setHasPatterns(true);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, teacher]);

  if (teacher || hasPatterns !== false) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-warning bg-warning-subtle px-3 py-2 text-[13px] text-text-body">
      <span>通塾日程がまだありません</span>
      <Link
        href={`/students/${studentId}/onboarding`}
        className="ml-auto inline-flex items-center gap-[5px] rounded-md border border-border bg-surface px-2.5 py-[5px] text-xs leading-[1.4] text-text-body hover:bg-surface-hover"
      >
        <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
        通塾セットアップ
      </Link>
    </div>
  );
}
