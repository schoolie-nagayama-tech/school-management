'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  LogOut,
  MonitorSmartphone,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useClassroomDevice } from '@/contexts/ClassroomDeviceContext';
import { isClassroomOnlyPath } from '@/lib/classroomDevice';

/**
 * 教室外の端末の講師が教室限定ページを開いたときに全画面でブロックするゲート。
 *
 * 正典: docs/classroom-device-plan.md §2「教室外モードの強制」
 *
 * 設計:
 *   - 判定は ClassroomDeviceContext（役割＋端末マーク）に一本化。パスの線引きは
 *     lib/classroomDevice.ts の CLASSROOM_ONLY_PREFIXES に一本化。ナビの出し分けと同じ
 *     材料を見るので「メニューには無いのに開ける」ズレが生まれない。
 *   - 行き止まりにしないため、教室外でも使える3画面（本日の授業 / 自分の予定 / 出勤簿）
 *     への導線と、閉じ込め防止のログアウトを置く（UnreadBulletinGate と同じ作法）。
 *
 * ★ なりすまし（代理ログイン）中も出す:
 *   UnreadBulletinGate と同じ判断で、なりすまし中も講師本人と同じ体験にする
 *   （管理者が「講師には教室外からこう見える」を確認できる必要があるため）。
 *   ただし端末の判定は /api/device-trust/status がリクエストのクッキーで行うので、
 *   なりすまし対象ではなく **実際に操作している端末** が基準になる。自宅から
 *   なりすませば教室外モード、教室PCからなりすませば教室モードになる（意図どおり）。
 */
export function ClassroomDeviceGate() {
  const pathname = usePathname();
  const { profile, schoolIds, signOut } = useAuth();
  const { schools } = useMasterData();
  const { outsideClassroom } = useClassroomDevice();

  // 自分の出勤簿リンク（AppHeader / navConfig と同じ算出: 担当教室コード + 講師ID）
  const attendanceHref = useMemo(() => {
    const mine = schools.filter((s) => schoolIds.includes(s.id));
    const code = mine[0]?.code;
    if (!code || !profile?.id) return null;
    return `/attendance/${code}/${profile.id}`;
  }, [schools, schoolIds, profile?.id]);

  if (!outsideClassroom || !isClassroomOnlyPath(pathname)) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="教室限定の機能"
      className="modal-overlay fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-6"
    >
      <div className="modal-panel my-6 w-full max-w-lg rounded-xl bg-white shadow-2xl outline-none">
        <div className="flex items-start gap-3 rounded-t-xl border-b border-gray-100 px-6 py-5">
          <MonitorSmartphone className="mt-1 h-8 w-8 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-xl font-bold leading-tight text-text-heading">
              この機能は教室の端末でのみ利用できます
            </h2>
            <p className="mt-2 text-sm text-text-muted">
              生徒の情報を扱う画面は、教室に設置された端末からのみ開けます。
              自宅からは「本日の授業」「自分の予定」「出勤簿」をご利用ください。
            </p>
          </div>
        </div>

        <div className="space-y-2 px-5 py-4">
          <GateLink href="/today" label="本日の授業" icon={<CalendarDays className="h-4 w-4" />} />
          <GateLink
            href="/my-schedule"
            label="自分の予定"
            icon={<CalendarRange className="h-4 w-4" />}
          />
          {attendanceHref && (
            <GateLink
              href={attendanceHref}
              label="出勤簿"
              icon={<CalendarCheck className="h-4 w-4" />}
            />
          )}
        </div>

        <div className="rounded-b-xl border-t border-gray-100 px-5 py-3">
          <p className="mb-2 text-xs text-text-muted">
            教室の端末なのにこの画面が出る場合は、教室長に「教室端末の登録」を依頼してください。
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
            >
              <LogOut className="h-3.5 w-3.5" />
              ログアウト
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ブロック画面から教室外OKページへ戻すための行リンク */
function GateLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm font-medium text-text-heading transition-colors hover:bg-surface"
    >
      <span className="text-text-muted">{icon}</span>
      {label}
    </Link>
  );
}
