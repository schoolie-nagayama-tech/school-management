'use client';

const DAY_LABELS: Record<number, string> = {
  1: '月',
  2: '火',
  3: '水',
  4: '木',
  5: '金',
  6: '土',
};

const DAYS = [1, 2, 3, 4, 5, 6] as const;

export type RegularSlotSettingRow = {
  day_of_week: number;
  time_slot: string;
  is_open: boolean;
};

function parseTimeSlotLabel(slot: string): { left: string; right: string } {
  const idx = slot.indexOf('-');
  if (idx === -1) return { left: slot, right: '' };
  return { left: slot.slice(0, idx + 1), right: slot.slice(idx + 1) };
}

function ToggleButton({
  onClick,
  title,
}: {
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-5 h-5 rounded-full bg-gray-300 hover:bg-gray-400 transition-colors flex items-center justify-center shrink-0"
      aria-label={title}
    />
  );
}

export interface RegularShiftSlotMatrixProps {
  timeSlots: string[];
  value: RegularSlotSettingRow[];
  onChange: (slots: RegularSlotSettingRow[]) => void;
  mode: 'settings' | 'submission';
  /** For submission mode: slot settings from the setting (defines which slots are open) */
  slotSettings?: RegularSlotSettingRow[];
}

export function RegularShiftSlotMatrix({
  timeSlots,
  value,
  onChange,
  mode,
  slotSettings,
}: RegularShiftSlotMatrixProps) {
  const valueMap = new Map<string, boolean>();
  value.forEach((s) => valueMap.set(`${s.day_of_week}|${s.time_slot}`, s.is_open));

  const slotSettingsMap = new Map<string, boolean>();
  if (slotSettings) {
    slotSettings.forEach((s) => slotSettingsMap.set(`${s.day_of_week}|${s.time_slot}`, s.is_open));
  }

  function getIsOpen(day: number, timeSlot: string): boolean {
    const key = `${day}|${timeSlot}`;
    if (valueMap.has(key)) return valueMap.get(key)!;
    // Default: weekdays open, Saturday closed
    if (day === 6) return false;
    return true;
  }

  function isSlotOpen(day: number, timeSlot: string): boolean {
    if (mode === 'settings') return true;
    const key = `${day}|${timeSlot}`;
    if (slotSettingsMap.has(key)) return slotSettingsMap.get(key)!;
    return false;
  }

  function emitChange(map: Map<string, boolean>) {
    const rows: RegularSlotSettingRow[] = [];
    DAYS.forEach((day) => {
      timeSlots.forEach((timeSlot) => {
        const k = `${day}|${timeSlot}`;
        rows.push({
          day_of_week: day,
          time_slot: timeSlot,
          is_open: map.get(k) ?? (mode === 'settings' ? (day !== 6) : false),
        });
      });
    });
    onChange(rows);
  }

  function toggleCell(day: number, timeSlot: string) {
    if (mode === 'submission' && !isSlotOpen(day, timeSlot)) return;
    const key = `${day}|${timeSlot}`;
    const current = getIsOpen(day, timeSlot);
    const next = new Map(valueMap);
    next.set(key, !current);
    emitChange(next);
  }

  function toggleColumn(timeSlot: string) {
    const daysInColumn = mode === 'submission'
      ? DAYS.filter((d) => isSlotOpen(d, timeSlot))
      : [...DAYS];
    const allChecked = daysInColumn.every((d) => getIsOpen(d, timeSlot));
    const newValue = !allChecked;
    const next = new Map(valueMap);
    daysInColumn.forEach((d) => next.set(`${d}|${timeSlot}`, newValue));
    emitChange(next);
  }

  function toggleRow(day: number) {
    const slotsInRow = mode === 'submission'
      ? timeSlots.filter((ts) => isSlotOpen(day, ts))
      : timeSlots;
    const allChecked = slotsInRow.every((ts) => getIsOpen(day, ts));
    const newValue = !allChecked;
    const next = new Map(valueMap);
    slotsInRow.forEach((ts) => next.set(`${day}|${ts}`, newValue));
    emitChange(next);
  }

  if (timeSlots.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-[#1f2937]">
        {mode === 'settings' ? '開講コマ設定' : '出勤可能日時'}
      </h3>
      <p className="text-xs text-[#6b7280]">
        {mode === 'settings'
          ? 'チェックが入っているコマが開講、外れているコマは休校です。土曜日はデフォルトで全て休校です。'
          : '出勤可能なコマにチェックを入れてください。丸ボタンで曜日・時間帯を一括で選択できます。'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#e5e7eb]">
              <th className="px-1 py-2 text-left font-medium text-[#1f2937] w-20" />
              {timeSlots.map((slot) => {
                const { left, right } = parseTimeSlotLabel(slot);
                return (
                  <th key={slot} className="px-1 py-2 text-center font-medium text-[#1f2937] min-w-[72px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-xs">{left}</span>
                      <span className="text-xs text-[#6b7280]">{right}</span>
                      <div className="mt-1 flex justify-center">
                        <ToggleButton
                          onClick={() => toggleColumn(slot)}
                          title="この列を一括トグル"
                        />
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day) => {
              const label = DAY_LABELS[day];
              return (
                <tr key={day} className="border-b border-[#e5e7eb]/60">
                  <td className="px-1 py-2 text-[#1f2937]">
                    <div className="flex items-center gap-1">
                      <ToggleButton
                        onClick={() => toggleRow(day)}
                        title="この行を一括トグル"
                      />
                      <span className="font-medium">{label}</span>
                    </div>
                  </td>
                  {timeSlots.map((slot) => {
                    const open = isSlotOpen(day, slot);
                    if (mode === 'submission' && !open) {
                      return (
                        <td key={slot} className="px-1 py-2 text-center text-[#9ca3af] text-xs">
                          -
                        </td>
                      );
                    }
                    const checked = getIsOpen(day, slot);
                    return (
                      <td key={slot} className="px-1 py-2 text-center">
                        <label className="inline-flex items-center justify-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCell(day, slot)}
                            className="w-4 h-4 text-[#3b82f6] rounded cursor-pointer"
                          />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
