'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getRegularPatterns, getTimeSlots, deleteRegularPattern } from '@/lib/api/schedule';
import type { ScheduleRegularPattern, ScheduleTimeSlot } from '@/types/schedule';
import { DAY_OF_WEEK_LABELS, SCHEDULE_PERIOD_LABELS } from '@/types/schedule';
import { supabase } from '@/lib/supabase';

interface AttendanceMatrixProps {
  studentId: string;
  schoolId: string;
  canEdit: boolean;
  onPatternChange?: () => void;
}

// 月〜土 (1-6)。日曜(0)は除外
const WEEKDAYS = [1, 2, 3, 4, 5, 6];

export function AttendanceMatrix({ studentId, schoolId, canEdit, onPatternChange }: AttendanceMatrixProps) {
  const [patterns, setPatterns] = useState<ScheduleRegularPattern[]>([]);
  const [timeSlots, setTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // "day-slot" key being saved

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [pats, slots] = await Promise.all([
        getRegularPatterns(schoolId, { studentId }),
        getTimeSlots(schoolId),
      ]);
      setPatterns(pats);
      setTimeSlots(slots.filter((s) => s.is_active));
    } catch (err) {
      console.error('Error fetching attendance data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, studentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // パターンを曜日×コマのマップにする (period_type='regular' のみ)
  const patternMap = useMemo(() => {
    const map = new Map<string, ScheduleRegularPattern>();
    for (const p of patterns) {
      if (p.period_type === 'regular') {
        map.set(`${p.day_of_week}-${p.time_slot_id}`, p);
      }
    }
    return map;
  }, [patterns]);

  // 通常期の週回数
  const weeklyCount = useMemo(() => {
    return patterns.filter((p) => p.period_type === 'regular').length;
  }, [patterns]);

  const handleCellClick = useCallback(
    async (dayOfWeek: number, slotId: string) => {
      if (!canEdit) return;
      const key = `${dayOfWeek}-${slotId}`;
      if (saving) return; // 保存中は無視
      setSaving(key);

      const existing = patternMap.get(key);
      try {
        if (existing) {
          // OFF: soft delete
          await deleteRegularPattern(existing.id);
        } else {
          // ON: create pattern without teacher (teacher_id=null)
          // Use supabase directly to avoid ensureUserIsTeacher check
          const { error } = await (supabase as any)
            .from('schedule_regular_patterns')
            .insert({
              school_id: schoolId,
              student_id: studentId,
              day_of_week: dayOfWeek,
              time_slot_id: slotId,
              teacher_id: null,
              subject_ids: [],
              seat_label: null,
              period_type: 'regular',
              is_active: true,
            });
          if (error) throw error;
        }
        await fetchData();
        onPatternChange?.();
      } catch (err) {
        console.error('Error toggling pattern:', err);
      } finally {
        setSaving(null);
      }
    },
    [canEdit, saving, patternMap, schoolId, studentId, fetchData, onPatternChange]
  );

  if (isLoading) {
    return <p className="text-sm text-[#2a2a2a]">読み込み中...</p>;
  }

  if (timeSlots.length === 0) {
    return <p className="text-sm text-[#2a2a2a]/60">コマ時間が未設定です。スケジュール設定からコマ時間を登録してください。</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs w-full">
          <thead>
            <tr>
              <th className="border border-gray-200 bg-gray-50 px-2 py-1.5 text-left text-[10px] text-gray-500 min-w-[80px]">
                コマ
              </th>
              {WEEKDAYS.map((day) => (
                <th
                  key={day}
                  className={`border border-gray-200 bg-gray-50 px-2 py-1.5 text-center text-[10px] min-w-[48px] ${
                    day === 6 ? 'text-blue-500' : 'text-gray-600'
                  }`}
                >
                  {DAY_OF_WEEK_LABELS[day]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timeSlots.map((slot) => (
              <tr key={slot.id}>
                <td className="border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] text-gray-500 whitespace-nowrap">
                  {slot.slot_number}限{' '}
                  <span className="text-gray-400">
                    {slot.start_time?.slice(0, 5)}-{slot.end_time?.slice(0, 5)}
                  </span>
                </td>
                {WEEKDAYS.map((day) => {
                  const key = `${day}-${slot.id}`;
                  const pattern = patternMap.get(key);
                  const isOn = !!pattern;
                  const isSaving = saving === key;

                  return (
                    <td
                      key={key}
                      onClick={() => handleCellClick(day, slot.id)}
                      className={`border border-gray-200 px-1 py-1 text-center transition-colors ${
                        canEdit ? 'cursor-pointer hover:bg-blue-50' : ''
                      } ${isSaving ? 'opacity-50' : ''} ${
                        isOn ? 'bg-blue-100' : 'bg-white'
                      }`}
                    >
                      {isOn && (
                        <div className="flex flex-col items-center">
                          <span className="text-blue-600 text-[11px] font-bold">●</span>
                          {pattern.teacher?.display_name && (
                            <span className="text-[8px] text-gray-500 truncate max-w-[44px]">
                              {pattern.teacher.display_name}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* サマリ */}
      <div className="flex items-center gap-4 text-xs">
        <span className="text-gray-500">
          通常期: <span className="font-bold text-[#1e3a5f]">週{weeklyCount}回</span>
        </span>
        {patterns.filter((p) => p.period_type !== 'regular').length > 0 && (
          <span className="text-gray-400">
            (講習期パターン: {patterns.filter((p) => p.period_type !== 'regular').length}件)
          </span>
        )}
      </div>

      {/* 講習期パターンがある場合にリスト表示 */}
      {patterns.filter((p) => p.period_type !== 'regular').length > 0 && (
        <div className="border-t border-gray-100 pt-2">
          <p className="text-[10px] text-gray-400 mb-1">講習期パターン</p>
          <ul className="space-y-1">
            {patterns
              .filter((p) => p.period_type !== 'regular')
              .map((p) => (
                <li key={p.id} className="text-[11px] text-gray-600 flex gap-2">
                  <span className="inline-flex px-1.5 py-0.5 text-[9px] rounded bg-orange-100 text-orange-600">
                    {SCHEDULE_PERIOD_LABELS[p.period_type]}
                  </span>
                  <span>{DAY_OF_WEEK_LABELS[p.day_of_week]}</span>
                  <span>
                    {p.time_slot
                      ? `${p.time_slot.slot_number}限 ${p.time_slot.start_time?.slice(0, 5)}-${p.time_slot.end_time?.slice(0, 5)}`
                      : '—'}
                  </span>
                  {p.teacher?.display_name && (
                    <span className="text-gray-400">{p.teacher.display_name}</span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
