'use client';

/**
 * 公開面談予約ページ クライアントコンポーネント。
 * /booking/[token] で表示される。ログイン不要。
 *
 * 状態:
 *   loading  → APIで枠を取得中
 *   invalid  → トークン無効（理由ごとにメッセージ差し替え）
 *   ready    → 枠を選択中
 *   confirmed → 予約完了
 */

import { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Clock } from 'lucide-react';

// 曜日表示（0=日〜6=土）
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const;

interface BookingSlot {
  date: string; // 'YYYY-MM-DD'
  startTime: string; // 'HH:mm'
  startIso: string; // ISO 8601
}

interface BookingInfo {
  valid: true;
  schoolName: string;
  guardianName: string;
  purpose: string;
  slots: BookingSlot[];
  calendarConnected: boolean;
}

interface InvalidInfo {
  valid: false;
  reason: 'expired' | 'used' | 'not_found' | 'server_error' | string;
}

type ApiResult = BookingInfo | InvalidInfo;

/** reason に応じた無効メッセージを返す */
function getInvalidMessage(reason: string): string {
  if (reason === 'expired')
    return 'このリンクは期限切れです。お手数ですが教室までお問い合わせください。';
  if (reason === 'used')
    return 'このリンクはすでに予約済みです。お手数ですが教室までお問い合わせください。';
  return 'このリンクは無効です。お手数ですが教室までお問い合わせください。';
}

/** 'YYYY-MM-DD' → 'M月D日(曜)' 形式に変換する */
function formatDateJa(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return `${m}月${d}日(${DAY_NAMES[dow]})`;
}

/** ISO文字列 → 'M月D日(曜) HH:mm' 形式に変換する */
function formatDateTimeJa(iso: string): string {
  const d = new Date(iso);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dow = DAY_NAMES[d.getDay()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${month}月${day}日(${dow}) ${hh}:${mm}`;
}

/** slots を日付('YYYY-MM-DD')ごとにグルーピングする */
function groupByDate(slots: BookingSlot[]): Map<string, BookingSlot[]> {
  const map = new Map<string, BookingSlot[]>();
  for (const slot of slots) {
    const arr = map.get(slot.date) ?? [];
    arr.push(slot);
    map.set(slot.date, arr);
  }
  return map;
}

interface BookingClientProps {
  token: string;
}

export default function BookingClient({ token }: BookingClientProps) {
  // 画面のステート: loading / invalid / ready / confirming / confirmed
  const [phase, setPhase] = useState<'loading' | 'invalid' | 'ready' | 'confirming' | 'confirmed'>(
    'loading'
  );
  const [info, setInfo] = useState<BookingInfo | null>(null);
  const [invalidReason, setInvalidReason] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);
  const [confirmedAt, setConfirmedAt] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [schoolNameForComplete, setSchoolNameForComplete] = useState('');

  /** APIから枠情報を取得する（再取得にも使う） */
  const fetchInfo = useCallback(async () => {
    setSelectedSlot(null);
    setConfirmError('');
    try {
      const res = await fetch(`/api/booking/${token}`);
      const data: ApiResult = await res.json();
      if (!data.valid) {
        setInvalidReason((data as InvalidInfo).reason ?? 'not_found');
        setPhase('invalid');
        return;
      }
      setInfo(data as BookingInfo);
      setSchoolNameForComplete((data as BookingInfo).schoolName);
      setPhase('ready');
    } catch {
      setInvalidReason('server_error');
      setPhase('invalid');
    }
  }, [token]);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  /** 「この日時で予約する」ボタン処理 */
  const handleConfirm = async () => {
    if (!selectedSlot) return;
    setPhase('confirming');
    setConfirmError('');
    try {
      const res = await fetch(`/api/booking/${token}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotStart: selectedSlot.startIso }),
      });
      if (res.status === 409) {
        // その枠は埋まった → エラー表示して枠を再取得
        setConfirmError('申し訳ありません、その枠はすでに埋まりました。別の日時をお選びください。');
        await fetchInfo();
        setPhase('ready');
        return;
      }
      if (res.status === 410) {
        // トークン無効・期限切れ
        setInvalidReason('expired');
        setPhase('invalid');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setConfirmError(
          (body as { error?: string }).error ?? '予約に失敗しました。もう一度お試しください。'
        );
        setPhase('ready');
        return;
      }
      // 成功
      setConfirmedAt(selectedSlot.startIso);
      setPhase('confirmed');
    } catch {
      setConfirmError('通信エラーが発生しました。もう一度お試しください。');
      setPhase('ready');
    }
  };

  // ── ローディング ──
  if (phase === 'loading') {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#f8f9fa]">
        <p className="text-sm text-[#6b7280]">読み込み中...</p>
      </div>
    );
  }

  // ── 無効トークン ──
  if (phase === 'invalid') {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[#f8f9fa]">
        <Header schoolName="" />
        <main className="flex-1 flex items-center justify-center px-5 py-10">
          <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-[#e5e7eb] p-8 text-center">
            <p className="text-sm text-[#374151] leading-relaxed">
              {getInvalidMessage(invalidReason)}
            </p>
          </div>
        </main>
      </div>
    );
  }

  // ── 予約完了 ──
  if (phase === 'confirmed') {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-[#f8f9fa]">
        <Header schoolName={schoolNameForComplete} />
        <main className="flex-1 flex items-center justify-center px-5 py-10">
          <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-[#e5e7eb] p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-[#d1fae5] flex items-center justify-center mx-auto mb-4">
              <CalendarDays className="w-6 h-6 text-[#059669]" />
            </div>
            <h2 className="text-base font-bold text-[#1a1a1a] mb-3">ご予約ありがとうございます</h2>
            <p className="text-sm text-[#374151] leading-relaxed">
              <span className="font-semibold text-[#1a1a1a]">{formatDateTimeJa(confirmedAt)}</span>{' '}
              にお待ちしております。
            </p>
            {schoolNameForComplete && (
              <p className="text-xs text-[#6b7280] mt-3">{schoolNameForComplete}</p>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ── 枠選択・確認中 ──
  const slotsByDate = groupByDate(info?.slots ?? []);
  const isConfirming = phase === 'confirming';

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#f8f9fa]">
      <Header schoolName={info?.schoolName ?? ''} />

      <main
        className="flex-1 max-w-lg mx-auto w-full px-4 sm:px-5 py-6"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >
        {/* タイトル */}
        <h2 className="text-base font-bold text-[#1a1a1a] mb-1">
          面談（教室見学・学習相談）のご予約
        </h2>
        {info?.guardianName && <p className="text-sm text-[#6b7280] mb-5">{info.guardianName}様</p>}

        {/* カレンダー未連携の注記 */}
        {info && !info.calendarConnected && (
          <div className="mb-4 p-3 bg-[#fffbeb] border border-[#fcd34d] rounded-xl text-xs text-[#92400e]">
            カレンダー連携がないため、空き判定は教室が設定した受付枠のみです。ご了承ください。
          </div>
        )}

        {/* エラーメッセージ */}
        {confirmError && (
          <div className="mb-4 p-3 bg-[#fef2f2] border border-[#fca5a5] rounded-xl text-sm text-[#b91c1c]">
            {confirmError}
          </div>
        )}

        {/* 枠一覧 */}
        {slotsByDate.size === 0 ? (
          <div className="bg-white rounded-2xl border border-[#e5e7eb] p-8 text-center">
            <p className="text-sm text-[#6b7280] leading-relaxed">
              現在予約可能な枠がありません。お手数ですが教室までお問い合わせください。
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {Array.from(slotsByDate.entries()).map(([date, daySlots], index) => (
              // stagger-item: 日付グループカードを 40ms 刻みでフェードイン
              <div
                key={date}
                className="stagger-item bg-white rounded-2xl border border-[#e5e7eb] overflow-hidden"
                style={{ '--stagger-index': Math.min(index, 7) } as React.CSSProperties}
              >
                {/* 日付見出し */}
                <div className="px-4 py-3 bg-[#f9fafb] border-b border-[#e5e7eb]">
                  <p className="text-sm font-semibold text-[#1a1a1a]">{formatDateJa(date)}</p>
                </div>
                {/* 時刻ボタン */}
                <div className="px-4 py-3 flex flex-wrap gap-2">
                  {daySlots.map((slot) => {
                    const isSelected = selectedSlot?.startIso === slot.startIso;
                    return (
                      <button
                        key={slot.startIso}
                        type="button"
                        onClick={() => {
                          // 同じ枠をもう一度押したら選択解除
                          setSelectedSlot(isSelected ? null : slot);
                          setConfirmError('');
                        }}
                        disabled={isConfirming}
                        className={`
                          flex items-center gap-1.5 px-4 py-2 rounded-xl border text-sm font-medium
                          transition-[transform,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]
                          active:scale-[0.97]
                          ${
                            isSelected
                              ? 'bg-[#1a1a1a] text-white border-[#1a1a1a]'
                              : 'bg-white text-[#374151] border-[#d1d5db] hover:border-[#1a1a1a]'
                          }
                          disabled:opacity-50 disabled:cursor-not-allowed
                        `}
                      >
                        <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                        {slot.startTime}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 選択中の枠の確認ボタン */}
        {selectedSlot && (
          <div className="mt-6 bg-white rounded-2xl border border-[#e5e7eb] p-5">
            <p className="text-sm text-[#374151] mb-4">
              <span className="font-semibold text-[#1a1a1a]">
                {formatDateJa(selectedSlot.date)} {selectedSlot.startTime}
              </span>{' '}
              を選択中
            </p>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isConfirming}
              className="w-full py-3 rounded-xl bg-[#1a1a1a] text-white text-sm font-semibold hover:bg-[#333] active:scale-[0.97] transition-[transform,background-color,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConfirming ? '予約処理中...' : 'この日時で予約する'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

/** 公開ページの共通ヘッダー（inquiry/[schoolCode] と同トーン） */
function Header({ schoolName }: { schoolName: string }) {
  return (
    <header
      className="bg-white border-b border-[#e5e7eb]"
      style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
    >
      <div className="max-w-lg mx-auto px-5 py-4 sm:py-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#1a1a1a] flex items-center justify-center flex-shrink-0">
            <CalendarDays className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-[#1a1a1a] truncate leading-tight">
              {schoolName || '学習塾'}
            </h1>
            <p className="text-xs text-[#6b7280] mt-0.5">面談予約</p>
          </div>
        </div>
      </div>
    </header>
  );
}
