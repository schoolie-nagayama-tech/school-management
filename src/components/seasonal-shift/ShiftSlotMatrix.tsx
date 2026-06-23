'use client';

export type SlotSettingRow = {
  slot_date: string;
  time_slot: string;
  is_open: boolean;
};

function generateDateRange(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function getDayOfWeek(date: Date): number {
  return date.getDay();
}

function getDefaultIsOpen(date: Date): boolean {
  const day = getDayOfWeek(date);
  if (day === 0) return false;
  if (day === 6) return false;
  return true;
}

function formatSlotDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseTimeSlotLabel(slot: string): { left: string; right: string } {
  const idx = slot.indexOf('-');
  if (idx === -1) return { left: slot, right: '' };
  return { left: slot.slice(0, idx + 1), right: slot.slice(idx + 1) };
}

function ToggleButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-5 h-5 rounded-full bg-gray-300 hover:bg-gray-400 transition-colors duration-150 flex items-center justify-center shrink-0"
      aria-label={title}
    />
  );
}

export interface ShiftSlotMatrixProps {
  startDate: string;
  endDate: string;
  timeSlots: string[];
  value: SlotSettingRow[];
  onChange: (slots: SlotSettingRow[]) => void;
}

export function ShiftSlotMatrix({
  startDate,
  endDate,
  timeSlots,
  value,
  onChange,
}: ShiftSlotMatrixProps) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dateRange = generateDateRange(start, end);

  const valueMap = new Map<string, boolean>();
  value.forEach((s) => valueMap.set(`${s.slot_date}|${s.time_slot}`, s.is_open));

  function getIsOpen(d: Date, timeSlot: string): boolean {
    const key = `${formatSlotDate(d)}|${timeSlot}`;
    if (valueMap.has(key)) return valueMap.get(key)!;
    return getDefaultIsOpen(d);
  }

  function setSlot(d: Date, timeSlot: string, isOpen: boolean) {
    const key = `${formatSlotDate(d)}|${timeSlot}`;
    const next = new Map(valueMap);
    next.set(key, isOpen);
    emitChange(next);
  }

  function emitChange(map: Map<string, boolean>) {
    const rows: SlotSettingRow[] = [];
    dateRange.forEach((d) => {
      timeSlots.forEach((timeSlot) => {
        if (getDayOfWeek(d) === 0) return;
        const k = `${formatSlotDate(d)}|${timeSlot}`;
        rows.push({
          slot_date: formatSlotDate(d),
          time_slot: timeSlot,
          is_open: map.get(k) ?? getDefaultIsOpen(d),
        });
      });
    });
    onChange(rows);
  }

  function toggleCell(d: Date, timeSlot: string) {
    if (getDayOfWeek(d) === 0) return;
    const current = getIsOpen(d, timeSlot);
    setSlot(d, timeSlot, !current);
  }

  function toggleColumn(timeSlot: string) {
    const slotsInColumn = dateRange.filter((d) => getDayOfWeek(d) !== 0);
    const allChecked = slotsInColumn.every((d) => getIsOpen(d, timeSlot));
    const newValue = !allChecked;
    const next = new Map(valueMap);
    slotsInColumn.forEach((d) => next.set(`${formatSlotDate(d)}|${timeSlot}`, newValue));
    emitChange(next);
  }

  function toggleRow(d: Date) {
    if (getDayOfWeek(d) === 0) return;
    const slotsInRow = timeSlots;
    const allChecked = slotsInRow.every((ts) => getIsOpen(d, ts));
    const newValue = !allChecked;
    const next = new Map(valueMap);
    slotsInRow.forEach((ts) => next.set(`${formatSlotDate(d)}|${ts}`, newValue));
    emitChange(next);
  }

  if (!startDate || !endDate || timeSlots.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-[#1f2937]">開講コマ設定</h3>
      <p className="text-xs text-[#6b7280]">
        チェックが入っているコマが開講、外れているコマは休校です。土曜日はデフォルトで全て休校です。
      </p>
      <p className="text-xs text-[#6b7280]">日曜日は常に休校のため表示しません。</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#e5e7eb]">
              <th className="px-1 py-2 text-left font-medium text-[#1f2937] w-20" />
              {timeSlots.map((slot) => {
                const { left, right } = parseTimeSlotLabel(slot);
                return (
                  <th
                    key={slot}
                    className="px-1 py-2 text-center font-medium text-[#1f2937] min-w-[72px]"
                  >
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
            {dateRange.map((d) => {
              const day = getDayOfWeek(d);
              const isSunday = day === 0;
              const dateStr = formatSlotDate(d);
              const label = d.toLocaleDateString('ja-JP', {
                month: 'numeric',
                day: 'numeric',
                weekday: 'short',
              });
              return (
                <tr key={dateStr} className="border-b border-[#e5e7eb]/60">
                  <td className="px-1 py-2 text-[#1f2937]">
                    <div className="flex items-center gap-1">
                      {!isSunday && (
                        <ToggleButton onClick={() => toggleRow(d)} title="この行を一括トグル" />
                      )}
                      <span>{label}</span>
                    </div>
                  </td>
                  {timeSlots.map((slot) => {
                    if (isSunday) {
                      return (
                        <td key={slot} className="px-1 py-2 text-center text-[#9ca3af] text-xs">
                          -
                        </td>
                      );
                    }
                    const isOpen = getIsOpen(d, slot);
                    return (
                      <td key={slot} className="px-1 py-2 text-center">
                        <label className="inline-flex items-center justify-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isOpen}
                            onChange={() => toggleCell(d, slot)}
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
