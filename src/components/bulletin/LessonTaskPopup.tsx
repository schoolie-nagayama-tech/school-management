'use client';

/**
 * 掲示板AIアシスト: 授業中に講師へ出すお願い。
 *
 * 正典: docs/bulletin-ai-assist.html §3
 *
 * ★カードに書くのは「やること1行」と「その場所へのリンク」だけ。
 *   内申なら9科の入力欄をここに置けるが、作業は13種ある。同じことを13回作るのは現実的でなく、
 *   種別が増えるたびにUIを足す作りになる。リンクなら種別が増えても1行で済む。
 *
 * ★行き先は「開いた瞬間に作業が始められる場所」まで含める（種別→行き先は taskLink.ts）。
 *   「生徒管理を開いてください」で止めると、生徒を探す→タブを選ぶ→学期を選ぶ、で授業が終わる。
 *
 * ★叩くのは1コマにつき最大2回だけ。1/3・2/3 の照合の時刻に合わせて時計を仕掛ける。
 *   数分おきに問い合わせると、出さないと決まっている授業でもDBを何十回も引くことになる。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/auth';
import { checkpointAt, CUTOFF_MINUTES_BEFORE_END } from '@/lib/bulletin/popupTiming';
import type { BulletinPopupResponse } from '@/lib/bulletin/apiTypes';

/** コマの時間が引けなかったときに使う既定（APIと同じ1コマ80分） */
const DEFAULT_LESSON_MINUTES = 80;

interface LessonTaskPopupProps {
  /** いま開いているコマ */
  scheduleEntryId: string;
  /** 授業日 YYYY-MM-DD。今日でなければ何もしない */
  lessonDate: string;
  /** コマの開始・終了 'HH:MM' または 'HH:MM:SS' */
  startTime: string | null;
  endTime: string | null;
  /** 45分授業などコマと違う長さのとき。あればこちらを優先する */
  durationMinutes?: number | null;
  /**
   * 45分授業がコマのどちら側を使うか。
   * ★'second' のときはコマの開始時刻に授業はまだ始まっていない。ここを見ないと経過が45分ずれる。
   */
  halfPosition?: 'first' | 'second' | null;
}

export function LessonTaskPopup({
  scheduleEntryId,
  lessonDate,
  startTime,
  endTime,
  durationMinutes,
  halfPosition,
}: LessonTaskPopupProps) {
  const [card, setCard] = useState<BulletinPopupResponse | null>(null);
  /** 一度出したら、この画面ではもう出さない（サーバー側も1コマ1件で弾く） */
  const doneRef = useRef(false);

  const probe = useCallback(
    async (elapsedMinutes: number) => {
      if (doneRef.current) return;
      try {
        const res = await fetchWithAuth('/api/ai/bulletin/popup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduleEntryId, elapsedMinutes }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as BulletinPopupResponse;
        if (json.show) {
          doneRef.current = true;
          setCard(json);
        }
      } catch {
        // ★授業中に壊れたカードを出すより黙るほうがよい。失敗は握りつぶす
      }
    },
    [scheduleEntryId]
  );

  useEffect(() => {
    const start = lessonStartAt(lessonDate, startTime, durationMinutes, halfPosition);
    if (!start) return;

    const total = lessonMinutes(startTime, endTime, durationMinutes);
    const elapsedNow = Math.round((Date.now() - start.getTime()) / 60_000);

    // 授業が終わっている／まだ始まっていない
    if (elapsedNow > total || elapsedNow < -total) return;

    const timers: ReturnType<typeof setTimeout>[] = [];

    // いま照合の時刻の中にいるなら、その場で1回聞く（授業の途中でフォームを開いた場合）
    if (elapsedNow >= 0 && checkpointAt(elapsedNow, total)) {
      void probe(elapsedNow);
    }

    // これから来る 1/3・2/3 に時計を仕掛ける。★この2回以外は叩かない
    for (const at of [total / 3, (total * 2) / 3]) {
      const minutes = Math.round(at);
      // 残りが足りない時刻には仕掛けない（生徒が帰ってしまえば聞けない）
      if (total - minutes < CUTOFF_MINUTES_BEFORE_END) continue;
      const delay = start.getTime() + minutes * 60_000 - Date.now();
      if (delay <= 0) continue;
      timers.push(setTimeout(() => void probe(minutes), delay));
    }

    return () => timers.forEach(clearTimeout);
  }, [lessonDate, startTime, endTime, durationMinutes, halfPosition, probe]);

  if (!card || !card.show) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 right-4 z-40 rounded-xl border border-ink/35 bg-surface p-3.5 shadow-lg sm:left-auto sm:w-[330px]"
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-[15px] font-bold leading-snug text-text-heading">
          {card.actionText}
        </p>
        <button
          type="button"
          onClick={() => setCard(null)}
          aria-label="閉じる"
          className="-mr-1 -mt-1 shrink-0 rounded p-1 text-text-faint transition-colors hover:bg-surface-hover hover:text-text-body"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* AIの一言は補足。講師が読むのは上の1行なので小さく添える */}
      {card.message && (
        <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{card.message}</p>
      )}

      <div className="mt-2.5 flex gap-2">
        {/* ★行き先が決められない種別はボタンを出さない（押しても何も始まらないボタンを置かない） */}
        {card.href && (
          <a
            href={card.href}
            className="flex-1 rounded-lg bg-ink px-3.5 py-2 text-center text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            {card.linkLabel}
          </a>
        )}
        <button
          type="button"
          onClick={() => setCard(null)}
          className="shrink-0 rounded-lg border border-border px-3.5 py-2 text-[13px] text-text-muted transition-colors hover:bg-surface-hover"
        >
          できない
        </button>
      </div>
    </div>
  );
}

/** 授業の開始時刻。今日でなければ null（過去のコマの報告書を開いても何も出さない） */
function lessonStartAt(
  lessonDate: string,
  startTime: string | null,
  durationMinutes?: number | null,
  halfPosition?: 'first' | 'second' | null
): Date | null {
  if (!startTime) return null;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;
  if (lessonDate !== todayStr) return null;

  const at = new Date(`${lessonDate}T${startTime.slice(0, 5)}:00`);
  if (Number.isNaN(at.getTime())) return null;

  // 45分授業がコマの後半を使うなら、実際に始まるのはコマ開始の45分後
  if (durationMinutes === 45 && halfPosition === 'second') {
    at.setMinutes(at.getMinutes() + 45);
  }
  return at;
}

/** 授業の長さ（分）。duration_minutes があればそちらを優先する */
function lessonMinutes(
  startTime: string | null,
  endTime: string | null,
  durationMinutes?: number | null
): number {
  if (durationMinutes && durationMinutes > 0) return durationMinutes;
  if (!startTime || !endTime) return DEFAULT_LESSON_MINUTES;
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const diff = toMin(endTime) - toMin(startTime);
  return diff > 0 ? diff : DEFAULT_LESSON_MINUTES;
}
