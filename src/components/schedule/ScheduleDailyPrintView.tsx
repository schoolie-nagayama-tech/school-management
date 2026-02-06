'use client';

import React from 'react';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr + 'Z');
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${dateStr} (${week})`;
}

function groupByTeacher(
  entries: ScheduleEntry[],
  date: string,
  slotId: string
): Map<string, ScheduleEntry[]> {
  const filtered = entries.filter(
    (e) =>
      e.entry_date === date &&
      e.time_slot_id === slotId &&
      e.status !== 'cancelled' &&
      e.status !== 'transferred_out'
  );
  const byTeacher = new Map<string, ScheduleEntry[]>();
  for (const entry of filtered) {
    const tid = entry.teacher_id;
    if (!byTeacher.has(tid)) byTeacher.set(tid, []);
    byTeacher.get(tid)!.push(entry);
  }
  return byTeacher;
}

export interface ScheduleDailyPrintViewProps {
  weekDates: string[];
  timeSlots: ScheduleTimeSlot[];
  entries: ScheduleEntry[];
  schoolName?: string;
  /** 指定時はその日付のみ出力（日付横の印刷アイコン用） */
  singleDate?: string;
}

export function ScheduleDailyPrintView({
  weekDates,
  timeSlots,
  entries,
  schoolName = '',
  singleDate,
}: ScheduleDailyPrintViewProps) {
  const datesToShow = singleDate ? [singleDate] : weekDates;
  return (
    <div id="schedule-daily-print" className="hidden print:block bg-white text-black">
      {datesToShow.map((dateStr) => {
        const groupsBySlot = timeSlots.map((slot) => ({
          slot,
          groups: groupByTeacher(entries, dateStr, slot.id),
        }));

        return (
          <div
            key={dateStr}
            className="p-4"
            style={{ pageBreakAfter: 'always' }}
          >
            <h2 className="text-base font-bold mb-2">
              {formatDateHeader(dateStr)}
              {schoolName ? ` — ${schoolName}` : ''}
            </h2>
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="text-left py-1 w-20">コマ</th>
                  <th className="text-left py-1">講師・生徒</th>
                </tr>
              </thead>
              <tbody>
                {groupsBySlot.map(({ slot, groups }) => (
                  <tr key={slot.id} className="border-b border-gray-200 align-top">
                    <td className="py-1 pr-2 font-medium">
                      {slot.slot_number}限
                      <div className="text-[9px] text-gray-500">
                        {slot.start_time?.slice(0, 5)}〜{slot.end_time?.slice(0, 5)}
                      </div>
                    </td>
                    <td className="py-1">
                      {Array.from(groups.entries()).map(([teacherId, slotEntries]) => {
                        const teacher = slotEntries[0]?.teacher;
                        const name =
                          teacher?.display_name || teacher?.email || teacherId;
                        return (
                          <div key={teacherId} className="mb-1">
                            <span className="font-medium">{name}</span>
                            <ul className="ml-3 list-disc text-[9px]">
                              {slotEntries.map((e) => {
                                const studentName = e.student
                                  ? `${e.student.last_name}${e.student.first_name}`
                                  : e.student_id;
                                const subj = (e.subjects ?? [])
                                  ?.map((s: { name?: string }) => s?.name)
                                  .filter(Boolean)
                                  .join('/');
                                return (
                                  <li key={e.id}>
                                    {studentName}
                                    {subj ? ` (${subj})` : ''}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        );
                      })}
                      {groups.size === 0 && (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
