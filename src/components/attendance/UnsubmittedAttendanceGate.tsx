'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarClock, ExternalLink, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import {
  getUnsubmittedAttendanceSheets,
  type UnsubmittedAttendanceTarget,
} from '@/lib/api/attendance';
import { getCurrentYearMonth, getPrevMonth, formatYearMonth } from '@/lib/utils/date';

/** その年月の末日（'YYYY-MM-DD'）。在籍判定の境界に使う */
function monthEndDate(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${yearMonth}-${String(last).padStart(2, '0')}`;
}

/**
 * 前月の出勤簿が未提出の講師に対して、全画面でブロッキング表示するゲート。
 *
 * 背景: 提出を忘れたまま業務を進める講師がいて、給与計算のたびに督促していた。
 * 連絡掲示板の未読ゲート（UnreadBulletinGate）と同じ考え方で、
 * 提出するまで他の画面を触れないようにする。
 *
 * 仕様:
 *   - 対象は講師のみ。前月末より後に作られたアカウント（その月にはまだ居なかった）は対象外。
 *   - 未提出＝出勤簿が無い / draft / rejected。submitted 以降は本人の手を離れているので出さない。
 *   - 出勤簿ページ（/attendance/**）だけは通す。ここで「提出」を押させるため。
 *     それ以外の画面では ESC・背景クリックで閉じられない（抜け道を作らない）。
 *   - 閉じ込め防止として「ログアウト」だけは許可する（未読ゲートと同じ）。
 *   - 提出/取り下げ時に window イベント 'attendance-submitted' が飛ぶので、それで判定し直す。
 */
export function UnsubmittedAttendanceGate() {
  const { profile, schoolIds, signOut } = useAuth();
  const { schools } = useMasterData();
  const pathname = usePathname();
  const [targets, setTargets] = useState<UnsubmittedAttendanceTarget[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // 判定対象は「前月」。月初に前月分を締めるので、月が変わればそのまま次の対象になる。
  const targetMonth = useMemo(() => getPrevMonth(getCurrentYearMonth()), []);

  const isTeacher = profile?.role === 'teacher';
  // 前月末より後に入ったアカウントは前月の出勤簿を持たないので対象外にする
  // （hire_date は未設定の講師がいるため、確実に入っている created_at で見る）。
  const existedInTargetMonth = profile?.created_at
    ? profile.created_at.slice(0, 10) <= monthEndDate(targetMonth)
    : true;

  // 教室IDは「担当教室」を使う（画面の教室選択で義務が変わるものではないため）。
  const schoolIdsKey = schoolIds.join(',');

  const check = useCallback(async () => {
    if (!isTeacher || !profile?.id || !existedInTargetMonth || schoolIds.length === 0) {
      setTargets([]);
      return;
    }
    const list = await getUnsubmittedAttendanceSheets(profile.id, schoolIds, targetMonth);
    setTargets(list);
    // schoolIds は毎回新しい配列になりうるので、内容を表す key を依存に使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTeacher, profile?.id, existedInTargetMonth, schoolIdsKey, targetMonth]);

  useEffect(() => {
    check();
  }, [check]);

  // 提出・取り下げの直後に判定し直す（出勤簿ページから飛んでくるイベント）
  useEffect(() => {
    const handler = () => check();
    window.addEventListener('attendance-submitted', handler);
    return () => window.removeEventListener('attendance-submitted', handler);
  }, [check]);

  // 出勤簿ページから他の画面へ移ったときも取り直す。
  // ゲートはレイアウトに常駐していて再マウントされないため、これが無いと
  // 提出済みなのに古い判定のままブロックし続けてしまう。
  const onAttendancePage = pathname?.startsWith('/attendance/') ?? false;
  const wasOnAttendanceRef = useRef(onAttendancePage);
  useEffect(() => {
    if (wasOnAttendanceRef.current && !onAttendancePage) check();
    wasOnAttendanceRef.current = onAttendancePage;
  }, [onAttendancePage, check]);

  const open = targets.length > 0 && !onAttendancePage;

  // ゲート表示中は背面ページのスクロールを止め、ダイアログへフォーカスを移す
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const schoolOf = (id: string) => schools.find((s) => s.id === id) ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="前月の出勤簿が未提出"
      className="modal-overlay fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-6"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal-panel my-6 w-full max-w-xl rounded-xl bg-white shadow-2xl outline-none"
      >
        {/* ヘッダー: 未読ゲートと同じく白地＋濃色テキスト。責める見た目にしない */}
        <div className="flex items-start gap-3 rounded-t-xl border-b border-gray-100 bg-white px-6 py-5">
          <CalendarClock className="mt-1 h-8 w-8 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-2xl font-bold leading-tight text-text-heading">
              {formatYearMonth(targetMonth)}の出勤簿が未提出です
            </h2>
            <p className="mt-2 text-base text-text-muted">
              出勤簿を開いて内容を確認し、「提出」を押してください。提出すると通常画面に戻ります。
            </p>
          </div>
        </div>

        {/* 未提出の教室ごとの導線。掛け持ちでなければ1件だけ */}
        <div className="space-y-3 px-5 py-4">
          {targets.map((t) => {
            const school = schoolOf(t.schoolId);
            const href = school
              ? `/attendance/${school.code}/${profile?.id}?ym=${targetMonth}`
              : null;
            return (
              <div
                key={t.schoolId}
                className="rounded-lg border border-gray-300 bg-white p-4 shadow-sm"
              >
                {schoolIds.length > 1 && school && (
                  <p className="mb-1 text-xs text-gray-500">{school.name}</p>
                )}
                <p className="mb-3 text-sm text-text-muted">
                  {t.status === 'rejected'
                    ? '差し戻されています。内容を直して、もう一度提出してください。'
                    : '入力内容を確認してから提出してください。'}
                </p>
                {href ? (
                  <Link
                    href={href}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:opacity-90"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {formatYearMonth(targetMonth)}の出勤簿を開く
                  </Link>
                ) : (
                  // 教室コード未設定などで導線が作れないケース。ここから動けないので連絡先を示す
                  <p className="text-sm text-text-muted">
                    教室コードが未設定のため出勤簿を開けません。教室長にご連絡ください。
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* フッター: 閉じ込め防止のログアウトのみ（提出せずに閉じる抜け道は置かない） */}
        <div className="flex items-center justify-end rounded-b-xl border-t border-gray-100 px-5 py-3">
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
  );
}
