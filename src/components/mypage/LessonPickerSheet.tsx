'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import type { PortalScheduleEntryDto, PortalTimeSlotDto } from '@/types/mypage-schedule';

/**
 * 「どの授業の連絡か」を予定から選ぶシート。
 *
 * チャットの「欠席・遅刻」「振替希望」は日付を手入力する作りだった。保護者はスマホで
 * 打つうえ、教室に無いコマを書かれると確認の往復が発生する。実際に入っている授業を
 * 出して選んでもらえば、日付・時限・講師まで確定した状態で連絡が届く。
 *
 * 選んだあとの入力は AbsenceSheet（予定ビューから開くのと同じシート）に渡す。
 * 締切・振替上限の判定と送信はすべて向こうに寄せてあり、ここでは何も判断しない。
 */

const DOW_JP = ['日', '月', '火', '水', '木', '金', '土'];

/** 'YYYY-MM-DD' → '7月16日(水)'。 */
function formatDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日(${DOW_JP[dow]})`;
}

/** JST の今日 'YYYY-MM-DD'。 */
function todayJst(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

/** 'YYYY-MM-DD' に日数を足す。 */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** 連絡できるコマだけ残す。済んだ授業・取消・振替で移動済みのコマは選ばせない。 */
function isContactable(e: PortalScheduleEntryDto): boolean {
  return e.status === 'scheduled' || e.status === 'transferred_in';
}

/** 先の予定を何日ぶん出すか。長すぎると選ぶのが大変になるので4週間。 */
const RANGE_DAYS = 27;

export function LessonPickerSheet({
  studentId,
  title,
  onPick,
  onClose,
  onNoLessons,
}: {
  studentId: string;
  /** シートの見出し（「欠席・遅刻の連絡」など呼び出し元の文言をそのまま出す）。 */
  title: string;
  onPick: (entry: PortalScheduleEntryDto, timeSlots: PortalTimeSlotDto[]) => void;
  onClose: () => void;
  /** 予定が1件も無いとき（従来の日付入力フォームへ逃がすため）。 */
  onNoLessons?: () => void;
}) {
  const [entries, setEntries] = useState<PortalScheduleEntryDto[]>([]);
  const [timeSlots, setTimeSlots] = useState<PortalTimeSlotDto[]>([]);
  const [loading, setLoading] = useState(true);

  const from = useMemo(() => todayJst(), []);
  const to = useMemo(() => addDays(from, RANGE_DAYS), [from]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/mypage/schedule?studentId=${encodeURIComponent(studentId)}&from=${from}&to=${to}`
        );
        const json = await res.json();
        if (cancelled) return;
        setEntries(res.ok ? (json.entries ?? []) : []);
        setTimeSlots(res.ok ? (json.timeSlots ?? []) : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, from, to]);

  const contactable = useMemo(() => entries.filter(isContactable), [entries]);

  return (
    <Modal isOpen onClose={onClose} title={title} size="md">
      <div className="space-y-3">
        <p className="text-sm text-text-body">どの授業のご連絡ですか？</p>

        {loading ? (
          <p className="py-8 text-center text-sm text-text-muted">読み込み中…</p>
        ) : contactable.length === 0 ? (
          <div className="space-y-3">
            <p className="py-4 text-center text-sm text-text-muted">
              これから4週間のご予定が見つかりませんでした。
            </p>
            {onNoLessons && (
              <Button variant="secondary" className="w-full" onClick={onNoLessons}>
                日付を入力して連絡する
              </Button>
            )}
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {contactable.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onPick(e, timeSlots)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface-raised px-3 py-3 text-left transition-colors hover:border-ink hover:bg-surface-hover"
              >
                <CalendarDays className="h-4 w-4 flex-shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-text-heading">
                    {formatDayLabel(e.entryDate)}
                    {e.slotLabel ? ` ${e.slotLabel}` : ''}
                  </span>
                  {e.subjectNames.length > 0 && (
                    <span className="block text-xs text-text-muted">
                      {e.subjectNames.join('・')}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </Modal>
  );
}
