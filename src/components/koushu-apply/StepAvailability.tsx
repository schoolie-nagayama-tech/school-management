'use client';

/**
 * ステップ3: 通える日（週アコーディオン＝案B。決定15）。
 * モック `apply-mock` の AvailWeek を本実装へ移植。全○初期で×を付けさせる方式。
 *
 * モックは「日×固定5コマ」の直積グリッドだったが、本番の開講枠 `availabilitySlots` は
 * 開講している枠だけの実データ（学校・期間によって時間帯構成が変わりうる）。
 * そのため列は「その週で実際に使われている時間帯」の和集合とし、ある日にその時間帯の
 * 枠が無ければセルを「－」（選べない）として出す（固定5コマ前提を置かない）。
 *
 * 設計上の要点（モックのコメントを踏襲）:
 *  - 週は複数同時に開ける（帰省の週と部活の週を見比べたいので単一開閉にしない）
 *  - 週見出しの「まとめて×」で旅行・帰省の週を1タップで落とせる
 *  - 日付ラベル・時間帯ラベルもボタン。その日/その時間帯をまとめて切り替える
 *  - 休講期間（開講枠が存在しない期間）は専用カードで明示する
 */
import { Fragment, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Info, X } from 'lucide-react';
import {
  WEEKDAY,
  cellKey,
  dow,
  gapBetween,
  groupByWeek,
  mmdd,
  timeSlotLabel,
} from './koushuApplyClientUtils';

interface StepAvailabilityProps {
  dates: string[];
  slotsByDate: Map<string, string[]>;
  ng: Set<string>;
  toggleSlot: (key: string) => void;
  toggleDay: (date: string) => void;
  toggleWeek: (weekDates: string[]) => void;
  toggleTimeSlotInWeek: (weekDates: string[], timeSlot: string) => void;
  totalOpenSlots: number;
  okCells: number;
  totalKoma: number;
}

export function StepAvailability({
  dates,
  slotsByDate,
  ng,
  toggleSlot,
  toggleDay,
  toggleWeek,
  toggleTimeSlotInWeek,
  totalOpenSlots,
  okCells,
  totalKoma,
}: StepAvailabilityProps) {
  const weeks = useMemo(() => groupByWeek(dates), [dates]);
  // 初期は第1週だけ開く。以降は保護者が開いた週を保持する
  const [open, setOpen] = useState<Set<number>>(new Set([0]));
  const toggleWeekOpen = (wi: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(wi)) next.delete(wi);
      else next.add(wi);
      return next;
    });

  if (dates.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--stroke)] p-4 text-center">
        <p className="text-xs text-[var(--paragraph)]">
          現在、通える日の入力枠が設定されていません。教室にご確認ください。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-info bg-info-subtle p-3 flex gap-2">
        <Info className="w-4 h-4 text-info shrink-0 mt-0.5" />
        <p className="text-xs text-[var(--headline)] leading-relaxed">
          小集団・プログラミングの開催枠は自動で回避されます（個別の授業はその時間に入りません）。
        </p>
      </div>

      <div className="rounded-lg bg-warning-subtle border border-warning p-3">
        <p className="text-xs text-[var(--headline)] leading-relaxed">
          <strong>最初はすべて「通える」</strong>になっています。
          旅行・部活・習い事などで来られない枠を選んで×にしてください。
        </p>
      </div>

      <div
        className={`rounded-lg p-3 flex items-center justify-between ${
          okCells >= totalKoma * 2 ? 'bg-success-subtle' : 'bg-danger-subtle'
        }`}
      >
        <span className="text-xs text-[var(--headline)]">通える枠</span>
        <span className="text-sm font-semibold text-[var(--headline)] tabular-nums">
          {okCells}枠 <span className="text-xs font-normal">/ 全{totalOpenSlots}枠</span>
        </span>
      </div>

      <div className="space-y-2">
        {weeks.map((w, wi) => {
          const total = w.dates.reduce((n, d) => n + (slotsByDate.get(d)?.length ?? 0), 0);
          const ngCount = w.dates.reduce(
            (n, d) => n + (slotsByDate.get(d) ?? []).filter((ts) => ng.has(cellKey(d, ts))).length,
            0
          );
          const isOpen = open.has(wi);
          const allNg = total > 0 && ngCount === total;
          // その週で実際に使われている時間帯の和集合（列見出し）
          const weekTimeSlots = Array.from(
            new Set(w.dates.flatMap((d) => slotsByDate.get(d) ?? []))
          ).sort();

          const prev = weeks[wi - 1];
          const gap = prev ? gapBetween(prev.dates[prev.dates.length - 1], w.dates[0]) : null;

          return (
            <Fragment key={w.label}>
              {gap && <ClosedWeekCard from={gap.from} to={gap.to} />}
              <div
                className={`rounded-xl border border-[var(--stroke)] overflow-hidden ${
                  allNg ? 'bg-gray-50' : 'bg-white'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleWeekOpen(wi)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span
                      className={`block text-sm ${allNg ? 'text-gray-400' : 'text-[var(--headline)]'}`}
                    >
                      第{wi + 1}週
                      <span className="ml-1.5 text-[11px] text-[var(--paragraph)]">{w.label}</span>
                    </span>
                    <span className="block text-[11px] mt-0.5">
                      {allNg ? (
                        <span className="text-[var(--paragraph)]">この週は通えない</span>
                      ) : ngCount > 0 ? (
                        <span className="text-warning">
                          {total - ngCount}枠 通える（{ngCount}枠 ×）
                        </span>
                      ) : (
                        <span className="text-success">すべて通える（{total}枠）</span>
                      )}
                    </span>
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 shrink-0 text-[var(--paragraph)] transition-transform ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="px-2.5 pb-3">
                    <button
                      type="button"
                      onClick={() => toggleWeek(w.dates)}
                      className="w-full mb-2 py-1.5 rounded-lg border border-[var(--stroke)] text-[11px] text-[var(--headline)] active:scale-[0.99]"
                    >
                      {allNg
                        ? 'この週をすべて「通える」に戻す'
                        : 'この週はすべて通えない（旅行・帰省）'}
                    </button>

                    <div
                      className="grid gap-1"
                      style={{
                        gridTemplateColumns: `46px repeat(${weekTimeSlots.length}, 1fr)`,
                      }}
                    >
                      <div className="text-[9px] text-[var(--paragraph)] flex items-end justify-center pb-1">
                        一括
                      </div>
                      {weekTimeSlots.map((ts) => {
                        const colDates = w.dates.filter((d) =>
                          (slotsByDate.get(d) ?? []).includes(ts)
                        );
                        const colNg =
                          colDates.length > 0 && colDates.every((d) => ng.has(cellKey(d, ts)));
                        return (
                          <button
                            key={ts}
                            type="button"
                            onClick={() => toggleTimeSlotInWeek(w.dates, ts)}
                            className={`text-center leading-tight rounded py-0.5 active:scale-95 ${
                              colNg ? 'bg-gray-100' : ''
                            }`}
                            title="この時間帯をこの週まとめて切替"
                          >
                            <span
                              className={`block text-[10px] ${
                                colNg ? 'text-gray-400 line-through' : 'text-[var(--headline)]'
                              }`}
                            >
                              {timeSlotLabel(ts)}
                            </span>
                          </button>
                        );
                      })}

                      {w.dates.map((d) => {
                        const daySlots = slotsByDate.get(d) ?? [];
                        const dayNg =
                          daySlots.length > 0 && daySlots.every((ts) => ng.has(cellKey(d, ts)));
                        return (
                          <Fragment key={d}>
                            <button
                              type="button"
                              onClick={() => toggleDay(d)}
                              className={`text-[11px] flex items-center justify-center rounded active:scale-95 ${
                                dayNg
                                  ? 'text-gray-400 line-through bg-gray-100'
                                  : 'text-[var(--headline)] hover:bg-gray-50'
                              }`}
                              title="この日をまとめて切替"
                            >
                              {Number(d.slice(8, 10))}
                              <span className={dow(d) === 6 ? 'text-blue-500' : ''}>
                                ({WEEKDAY[dow(d)]})
                              </span>
                            </button>
                            {weekTimeSlots.map((ts) => {
                              const isSlotOpen = daySlots.includes(ts);
                              if (!isSlotOpen) {
                                return (
                                  <span
                                    key={ts}
                                    className="h-10 rounded-md flex items-center justify-center text-gray-300 text-[11px]"
                                  >
                                    －
                                  </span>
                                );
                              }
                              const on = !ng.has(cellKey(d, ts));
                              return (
                                <button
                                  key={ts}
                                  type="button"
                                  onClick={() => toggleSlot(cellKey(d, ts))}
                                  aria-pressed={!on}
                                  className={`h-10 rounded-md text-[11px] font-medium border transition-colors flex items-center justify-center ${
                                    on
                                      ? 'bg-success-subtle border-success text-success'
                                      : 'bg-gray-100 border-[var(--stroke)] text-gray-400'
                                  }`}
                                >
                                  {on ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                                </button>
                              );
                            })}
                          </Fragment>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>

      {okCells < totalKoma * 2 && (
        <div className="rounded-lg border border-warning bg-warning-subtle p-3 flex gap-2">
          <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--headline)]">
            通える枠が申込コマ数に対して少なめです。ご希望どおりに組めない場合があります。
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 週と週の間に空いた休講期間（お盆など）を1枚のカードで出す。
 * 開講枠だけを並べると休講期間が丸ごと消え、保護者からは「入力し忘れ？」に見えるため、
 * 選べない期間であることを明示する。
 */
function ClosedWeekCard({ from, to }: { from: string; to: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--stroke)] bg-gray-50 px-3 py-2.5">
      <p className="text-xs text-[var(--paragraph)]">
        {mmdd(from)}〜{mmdd(to)} は休講のため授業がありません
      </p>
    </div>
  );
}
