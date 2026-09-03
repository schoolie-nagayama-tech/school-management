'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import type { TimeSlot, ZoukomaSettings, PeriodConfig } from '@/types/forms/zoukoma';

/** ローカル日付で YYYY-MM-DD を返す（toISOString は UTC 変換するため JST では前日になり、
 *  getDay() で取った曜日と1日ずれてしまうので使わない） */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD 文字列をローカル日付として Date に戻す。new Date(str) だと UTC 解釈になる */
function parseLocalDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 期間設定が未登録のときに使うデフォルト時限（平日のみ・土日なし） */
const DEFAULT_PERIODS_FALLBACK: PeriodConfig[] = [
  {
    code: '5',
    start_time: '16:20',
    end_time: '17:50',
    available_saturday: false,
    available_sunday: false,
    available_weekday: true,
  },
  {
    code: '6',
    start_time: '17:55',
    end_time: '19:25',
    available_saturday: false,
    available_sunday: false,
    available_weekday: true,
  },
  {
    code: '7',
    start_time: '19:30',
    end_time: '21:00',
    available_saturday: false,
    available_sunday: false,
    available_weekday: true,
  },
];

/** 増コマフォームで表示する日程のデフォルト週数（保護者側で増減可能） */
export const DEFAULT_WEEKS = 3;

/** 設定から指定週数分の全スロットを生成（SlotTable 外からも利用可能）。
 *  numWeeks 未指定時は従来どおり3週間。保護者が「+1週間」した場合は呼び出し側で週数を渡す。 */
export function generateAllSlots(
  settings: ZoukomaSettings,
  numWeeks: number = DEFAULT_WEEKS
): TimeSlot[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDaysAhead = settings.schedule?.min_days_ahead ?? 0;
  const minDate = new Date(today);
  minDate.setDate(today.getDate() + minDaysAhead);

  const startDate = new Date(today);
  const slots: TimeSlot[] = [];

  const periodsToUse: PeriodConfig[] = settings.schedule?.periods?.length
    ? settings.schedule.periods
    : DEFAULT_PERIODS_FALLBACK;

  // 表示日数 = 週数 × 7。週数は最低1週間を保証
  const totalDays = Math.max(1, numWeeks) * 7;

  for (let day = 0; day < totalDays; day++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + day);
    const dayOfWeek = date.getDay();
    const dayName = DAY_NAMES[dayOfWeek];

    const isSunday = dayOfWeek === 0;
    const isSaturday = dayOfWeek === 6;
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isBeforeMinDate = date < minDate;

    periodsToUse.forEach((periodConfig) => {
      const period = parseInt(periodConfig.code, 10);
      const satOk = periodConfig.available_saturday ?? false;
      const sunOk = periodConfig.available_sunday ?? false;
      const weekdayOk = periodConfig.available_weekday ?? false;
      const shouldShow = (isSunday && sunOk) || (isSaturday && satOk) || (isWeekday && weekdayOk);

      if (!shouldShow) return;

      const slotId = `${toLocalDateStr(date)}_${period}`;
      const timeRange = `${periodConfig.start_time}–${periodConfig.end_time}`;
      const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
      const label = `${dateStr}(${dayName}) ${period}限 ${timeRange}`;

      slots.push({
        id: slotId,
        date: toLocalDateStr(date),
        dayOfWeek: dayName,
        period,
        label,
        timeRange,
        isAvailable: !isBeforeMinDate,
      });
    });
  }

  return slots;
}

/** 受付リードタイム（min_days_ahead）を過ぎていて、実際に選べる枠だけを返す。
 *  以前は isAvailable を生成しておきながら表側では無視しており、管理画面のプレビュー
 *  （SlotPreview はグレーアウトする）と保護者の見え方が食い違っていた。 */
export function selectableSlots(
  settings: ZoukomaSettings,
  numWeeks: number = DEFAULT_WEEKS
): TimeSlot[] {
  return generateAllSlots(settings, numWeeks).filter((s) => s.isAvailable);
}

interface WeekGroup {
  label: string;
  dates: string[];
}

/** 日程を週（月曜始まり）でまとめる。日付は昇順で渡すこと */
function groupDatesByWeek(dates: string[]): WeekGroup[] {
  const mmdd = (d: string) => {
    const dt = parseLocalDateStr(d);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  };
  const weeks: WeekGroup[] = [];
  let cur: string[] = [];
  for (const d of dates) {
    if (parseLocalDateStr(d).getDay() === 1 && cur.length > 0) {
      weeks.push({ label: `${mmdd(cur[0])}〜${mmdd(cur[cur.length - 1])}`, dates: cur });
      cur = [];
    }
    cur.push(d);
  }
  if (cur.length > 0) {
    weeks.push({ label: `${mmdd(cur[0])}〜${mmdd(cur[cur.length - 1])}`, dates: cur });
  }
  return weeks;
}

interface SlotTableProps {
  settings: ZoukomaSettings;
  selectedSlots: string[];
  onChange: (slotIds: string[]) => void;
  disabled?: boolean;
  /** 'available' = 出席可能を選択（従来）, 'unavailable' = 出席できない日にバツ印 */
  mode?: 'available' | 'unavailable';
  /** 表示する週数（保護者側で増減可能）。未指定時はデフォルト3週間 */
  numWeeks?: number;
}

/**
 * 増コマの日程選択。
 *
 * 以前は3列の `<table>` + overflow-x-auto だったが、375px 幅では表の最低幅(約283px)が
 * 中身の幅(255px)を超え、最後の時限が画面外に切れて横スクロールが必要だった。
 * 保護者ポータルはスマホが主戦場なので、講習申込の StepAvailability と同じ
 * 「週アコーディオン + CSS グリッド」に作り替えている。
 *
 * 設計上の要点:
 *  - 時限の列は実データから作る（以前は [5,6,7] 決め打ちで、管理画面で4限をONにすると
 *    枠は生成されるのに画面に出ず、保護者が見ていない枠が「出席可能」として送信されていた）
 *  - その日にその時限が無ければ「－」を出す（固定列を前提にしない）
 *  - 週見出し・日付・時限ラベルはいずれも「まとめて切り替える」ボタン
 */
export function SlotTable({
  settings,
  selectedSlots,
  onChange,
  disabled = false,
  mode = 'available',
  numWeeks = DEFAULT_WEEKS,
}: SlotTableProps) {
  const isUnavailableMode = mode === 'unavailable';
  const selectedSlotSet = useMemo(() => new Set(selectedSlots), [selectedSlots]);

  // 受付リードタイムを過ぎた（＝実際に選べる）枠だけを扱う
  const slots = useMemo(() => selectableSlots(settings, numWeeks), [settings, numWeeks]);

  const slotsByDate = useMemo(() => {
    const grouped = new Map<string, TimeSlot[]>();
    for (const slot of slots) {
      const list = grouped.get(slot.date);
      if (list) list.push(slot);
      else grouped.set(slot.date, [slot]);
    }
    return grouped;
  }, [slots]);

  const weeks = useMemo(
    () => groupDatesByWeek(Array.from(slotsByDate.keys()).sort()),
    [slotsByDate]
  );

  // 初期は第1週だけ開く。「+1週間」で増えた週は開いた状態で出す
  // （押した直後に何も現れないと、増えたことが伝わらないため）
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  const prevWeekCount = useRef(weeks.length);
  useEffect(() => {
    if (weeks.length > prevWeekCount.current) {
      const from = prevWeekCount.current;
      setOpen((prev) => {
        const next = new Set(prev);
        for (let i = from; i < weeks.length; i++) next.add(i);
        return next;
      });
    }
    prevWeekCount.current = weeks.length;
  }, [weeks.length]);

  const toggleWeekOpen = (wi: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(wi)) next.delete(wi);
      else next.add(wi);
      return next;
    });

  /** その枠が「出席できる」状態か。unavailable モードでは未選択が「出席できる」 */
  const isOn = (slotId: string) =>
    isUnavailableMode ? !selectedSlotSet.has(slotId) : selectedSlotSet.has(slotId);

  /** 複数の枠をまとめて出席できる/できないに倒す */
  const setOn = (slotIds: string[], on: boolean) => {
    if (disabled || slotIds.length === 0) return;
    const shouldSelect = isUnavailableMode ? !on : on;
    const next = new Set(selectedSlotSet);
    for (const id of slotIds) {
      if (shouldSelect) next.add(id);
      else next.delete(id);
    }
    onChange(Array.from(next));
  };

  const toggleSlot = (slotId: string) => setOn([slotId], !isOn(slotId));

  const idsOf = (dates: string[], period?: number) =>
    dates.flatMap((d) =>
      (slotsByDate.get(d) ?? [])
        .filter((s) => period === undefined || s.period === period)
        .map((s) => s.id)
    );

  /** まとめて切替：全部「出席できる」なら✗に、そうでなければ全部出席できるに戻す */
  const toggleGroup = (ids: string[]) => {
    const allOn = ids.length > 0 && ids.every((id) => isOn(id));
    setOn(ids, !allOn);
  };

  if (slots.length === 0) {
    return (
      <div className="rounded-lg border border-[#e5e7eb] bg-[#f9fafb] p-4 text-center">
        <p className="text-xs text-[#6b7280]">
          現在お選びいただける日程がありません。教室までお問い合わせください。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {weeks.map((w, wi) => {
        const weekIds = idsOf(w.dates);
        const onCount = weekIds.filter((id) => isOn(id)).length;
        const allOff = weekIds.length > 0 && onCount === 0;
        const isOpen = open.has(wi);
        // その週で実際に開いている時限の和集合（列見出し）
        const weekPeriods = Array.from(
          new Set(w.dates.flatMap((d) => (slotsByDate.get(d) ?? []).map((s) => s.period)))
        ).sort((a, b) => a - b);

        return (
          <div
            key={w.label}
            className={`rounded-xl border border-[#e5e7eb] overflow-hidden ${
              allOff ? 'bg-[#f9fafb]' : 'bg-white'
            }`}
          >
            <button
              type="button"
              onClick={() => toggleWeekOpen(wi)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
            >
              <span className="min-w-0">
                <span className={`block text-sm ${allOff ? 'text-[#9ca3af]' : 'text-[#1f2937]'}`}>
                  第{wi + 1}週<span className="ml-1.5 text-[11px] text-[#6b7280]">{w.label}</span>
                </span>
                <span className="block text-[11px] mt-0.5 text-[#6b7280]">
                  {allOff
                    ? 'この週は通えない'
                    : onCount === weekIds.length
                      ? `すべて出席できる（${weekIds.length}枠）`
                      : `${onCount}枠 出席できる（${weekIds.length - onCount}枠 ✗）`}
                </span>
              </span>
              <ChevronDown
                className={`w-4 h-4 shrink-0 text-[#6b7280] transition-transform ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isOpen && (
              <div className="px-2 pb-3">
                <button
                  type="button"
                  onClick={() => toggleGroup(weekIds)}
                  disabled={disabled}
                  className="w-full mb-2 py-1.5 rounded-lg border border-[#e5e7eb] text-[11px] text-[#4b5563] active:scale-[0.99] disabled:opacity-40"
                >
                  {allOff ? 'この週をすべて出席できるに戻す' : 'この週はすべて✗にする'}
                </button>

                <div
                  className="grid gap-1"
                  style={{ gridTemplateColumns: `52px repeat(${weekPeriods.length}, 1fr)` }}
                >
                  <div className="text-[9px] text-[#9ca3af] flex items-end justify-center pb-1">
                    一括
                  </div>
                  {weekPeriods.map((p) => {
                    const colIds = idsOf(w.dates, p);
                    const colOff = colIds.length > 0 && colIds.every((id) => !isOn(id));
                    const periodSlot = slots.find((s) => s.period === p);
                    const startTime = periodSlot?.timeRange?.split('–')[0] ?? '';
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => toggleGroup(colIds)}
                        disabled={disabled}
                        className="text-center leading-tight rounded py-0.5 active:scale-95 disabled:opacity-40"
                        title={`${p}限をこの週まとめて切替`}
                      >
                        <span
                          className={`block text-[11px] font-medium ${
                            colOff ? 'text-[#9ca3af] line-through' : 'text-[#1f2937]'
                          }`}
                        >
                          {p}限
                        </span>
                        {startTime && (
                          <span className="block text-[9px] text-[#9ca3af]">{startTime}</span>
                        )}
                      </button>
                    );
                  })}

                  {w.dates.map((d) => {
                    const daySlots = slotsByDate.get(d) ?? [];
                    const dayIds = daySlots.map((s) => s.id);
                    const dayOff = dayIds.length > 0 && dayIds.every((id) => !isOn(id));
                    const dt = parseLocalDateStr(d);
                    const dow = dt.getDay();
                    return (
                      <Fragment key={d}>
                        <button
                          type="button"
                          onClick={() => toggleGroup(dayIds)}
                          disabled={disabled}
                          className={`text-[11px] flex items-center justify-center rounded active:scale-95 disabled:opacity-40 ${
                            dayOff ? 'text-[#9ca3af] line-through bg-[#f3f4f6]' : 'text-[#1f2937]'
                          }`}
                          title="この日をまとめて切替"
                        >
                          {dt.getMonth() + 1}/{dt.getDate()}
                          <span
                            className={
                              dow === 0 ? 'text-[#ef4444]' : dow === 6 ? 'text-[#3b82f6]' : ''
                            }
                          >
                            ({DAY_NAMES[dow]})
                          </span>
                        </button>
                        {weekPeriods.map((p) => {
                          const slot = daySlots.find((s) => s.period === p);
                          if (!slot) {
                            return (
                              <span
                                key={p}
                                className="h-10 rounded-md flex items-center justify-center text-[#d1d5db] text-[11px]"
                              >
                                －
                              </span>
                            );
                          }
                          const on = isOn(slot.id);
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => toggleSlot(slot.id)}
                              disabled={disabled}
                              aria-pressed={!on}
                              aria-label={`${slot.label} を${on ? '✗にする' : '出席できるに戻す'}`}
                              className={`h-10 rounded-md border flex items-center justify-center transition-colors disabled:opacity-40 ${
                                on
                                  ? 'bg-[#ecfdf5] border-[#10b981] text-[#059669]'
                                  : 'bg-[#f3f4f6] border-[#e5e7eb] text-[#9ca3af]'
                              }`}
                              title={slot.label}
                            >
                              {on ? (
                                <Check className="w-3.5 h-3.5" />
                              ) : (
                                <X className="w-3.5 h-3.5" />
                              )}
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
        );
      })}
    </div>
  );
}
