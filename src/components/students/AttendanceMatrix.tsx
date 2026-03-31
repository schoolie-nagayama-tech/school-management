'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getRegularPatterns, getTimeSlots, deleteRegularPattern } from '@/lib/api/schedule';
import { getSubjects } from '@/lib/api/subjects';
import type { ScheduleRegularPattern, ScheduleTimeSlot } from '@/types/schedule';
import { DAY_OF_WEEK_LABELS, SCHEDULE_PERIOD_LABELS } from '@/types/schedule';
import type { Subject } from '@/types/database';
import { supabase } from '@/lib/supabase';

interface AttendanceMatrixProps {
  studentId: string;
  schoolId: string;
  studentGrade?: number;
  canEdit: boolean;
  onPatternChange?: () => void;
}

// 月〜土 (1-6)
const WEEKDAYS = [1, 2, 3, 4, 5, 6];

function gradeToCategory(grade: number): 'elementary' | 'middle' | 'high' {
  if (grade <= 6) return 'elementary';
  if (grade <= 9) return 'middle';
  return 'high';
}

export function AttendanceMatrix({ studentId, schoolId, studentGrade, canEdit, onPatternChange }: AttendanceMatrixProps) {
  const [patterns, setPatterns] = useState<ScheduleRegularPattern[]>([]);
  const [timeSlots, setTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  // セル選択メニュー
  const [menuCell, setMenuCell] = useState<{ day: number; slotId: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const gradeCategory = studentGrade ? gradeToCategory(studentGrade) : undefined;
      const [pats, slots, subs] = await Promise.all([
        getRegularPatterns(schoolId, { studentId }),
        getTimeSlots(schoolId),
        getSubjects(gradeCategory),
      ]);
      setPatterns(pats);
      setTimeSlots(slots.filter((s) => s.is_active));
      setSubjects(subs);
    } catch (err) {
      console.error('Error fetching attendance data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, studentId, studentGrade]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // メニュー外クリックで閉じる
  useEffect(() => {
    if (!menuCell) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuCell(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuCell]);

  // 科目IDから科目名のマップ
  const subjectMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of subjects) {
      map.set(s.id, s.name);
    }
    return map;
  }, [subjects]);

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

  // セルクリック → メニュー表示 or 削除
  const handleCellClick = useCallback(
    (dayOfWeek: number, slotId: string) => {
      if (!canEdit) return;
      const key = `${dayOfWeek}-${slotId}`;
      const existing = patternMap.get(key);

      if (existing) {
        // 既存パターン → 削除確認メニュー表示
        setMenuCell({ day: dayOfWeek, slotId });
      } else {
        // 空セル → 科目選択メニュー表示
        setMenuCell({ day: dayOfWeek, slotId });
      }
    },
    [canEdit, patternMap]
  );

  // 科目を選択してパターン作成
  const handleSelectSubject = useCallback(
    async (dayOfWeek: number, slotId: string, subjectId: string) => {
      const key = `${dayOfWeek}-${slotId}`;
      setSaving(key);
      setMenuCell(null);
      try {
        const { error } = await (supabase as any)
          .from('schedule_regular_patterns')
          .insert({
            school_id: schoolId,
            student_id: studentId,
            day_of_week: dayOfWeek,
            time_slot_id: slotId,
            teacher_id: null,
            subject_ids: [subjectId],
            seat_label: null,
            period_type: 'regular',
            is_active: true,
          });
        if (error) throw error;
        await fetchData();
        onPatternChange?.();
      } catch (err) {
        console.error('Error creating pattern:', err);
      } finally {
        setSaving(null);
      }
    },
    [schoolId, studentId, fetchData, onPatternChange]
  );

  // パターン削除
  const handleRemovePattern = useCallback(
    async (dayOfWeek: number, slotId: string) => {
      const key = `${dayOfWeek}-${slotId}`;
      const existing = patternMap.get(key);
      if (!existing) return;
      setSaving(key);
      setMenuCell(null);
      try {
        await deleteRegularPattern(existing.id);
        await fetchData();
        onPatternChange?.();
      } catch (err) {
        console.error('Error deleting pattern:', err);
      } finally {
        setSaving(null);
      }
    },
    [patternMap, fetchData, onPatternChange]
  );

  if (isLoading) {
    return <p className="text-sm text-[#2a2a2a]">読み込み中...</p>;
  }

  if (timeSlots.length === 0) {
    return <p className="text-sm text-[#2a2a2a]/60">コマ時間が未設定です。設定 → コマ時間設定から登録してください。</p>;
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
                  const isMenuOpen = menuCell?.day === day && menuCell?.slotId === slot.id;

                  // 科目名を取得
                  const subjectNames = pattern?.subject_ids
                    ?.map((id) => subjectMap.get(id))
                    .filter(Boolean) as string[] | undefined;

                  return (
                    <td
                      key={key}
                      className={`border border-gray-200 px-1 py-1 text-center transition-colors relative ${
                        canEdit ? 'cursor-pointer hover:bg-blue-50' : ''
                      } ${isSaving ? 'opacity-50' : ''} ${
                        isOn ? 'bg-blue-50' : 'bg-white'
                      }`}
                      onClick={() => handleCellClick(day, slot.id)}
                    >
                      {isOn && (
                        <div className="flex flex-col items-center">
                          <span className="text-blue-700 text-[11px] font-medium leading-tight">
                            {subjectNames && subjectNames.length > 0
                              ? subjectNames.join('/')
                              : '●'}
                          </span>
                          {pattern.teacher?.display_name && (
                            <span className="text-[8px] text-gray-400 truncate max-w-[44px]">
                              {pattern.teacher.display_name}
                            </span>
                          )}
                        </div>
                      )}

                      {/* 科目選択メニュー */}
                      {isMenuOpen && canEdit && (
                        <div
                          ref={menuRef}
                          className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[100px]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {isOn ? (
                            <>
                              <button
                                className="w-full text-left px-3 py-1.5 text-[11px] text-red-500 hover:bg-red-50"
                                onClick={() => handleRemovePattern(day, slot.id)}
                              >
                                削除
                              </button>
                            </>
                          ) : (
                            <>
                              {subjects.map((sub) => (
                                <button
                                  key={sub.id}
                                  className="w-full text-left px-3 py-1.5 text-[11px] text-gray-700 hover:bg-blue-50"
                                  onClick={() => handleSelectSubject(day, slot.id, sub.id)}
                                >
                                  {sub.name}
                                </button>
                              ))}
                              {subjects.length === 0 && (
                                <p className="px-3 py-1.5 text-[11px] text-gray-400">科目がありません</p>
                              )}
                            </>
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
