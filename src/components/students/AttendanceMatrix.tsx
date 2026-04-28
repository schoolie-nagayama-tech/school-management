'use client';

import { useState, useEffect, useCallback, useMemo, DragEvent } from 'react';
import { getRegularPatterns, getTimeSlots, deleteRegularPattern } from '@/lib/api/schedule';
import { getSubjects } from '@/lib/api/subjects';
import type { ScheduleRegularPattern, ScheduleTimeSlot } from '@/types/schedule';
import { DAY_OF_WEEK_LABELS, SCHEDULE_PERIOD_LABELS } from '@/types/schedule';
import type { Subject } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { X } from 'lucide-react';

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

// 科目ごとの色
const SUBJECT_COLORS: Record<string, { bg: string; text: string; border: string }> = {};
const COLOR_PALETTE = [
  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300' },
  { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
  { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-300' },
  { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-300' },
  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-300' },
];

function getSubjectColor(subjectId: string, index: number) {
  if (!SUBJECT_COLORS[subjectId]) {
    SUBJECT_COLORS[subjectId] = COLOR_PALETTE[index % COLOR_PALETTE.length];
  }
  return SUBJECT_COLORS[subjectId];
}

export function AttendanceMatrix({ studentId, schoolId, studentGrade, canEdit, onPatternChange }: AttendanceMatrixProps) {
  const [patterns, setPatterns] = useState<ScheduleRegularPattern[]>([]);
  const [timeSlots, setTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!schoolId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const gradeCategory = studentGrade ? gradeToCategory(studentGrade) : undefined;
    // Promise.allSettled にして 1 つ失敗しても他のデータは表示できるように
    const [patsRes, slotsRes, subsRes] = await Promise.allSettled([
      getRegularPatterns(schoolId, { studentId }),
      getTimeSlots(schoolId),
      getSubjects(gradeCategory),
    ]);
    if (patsRes.status === 'fulfilled') {
      setPatterns(patsRes.value);
    } else {
      console.error('Error fetching regular patterns:', patsRes.reason);
    }
    if (slotsRes.status === 'fulfilled') {
      setTimeSlots(slotsRes.value.filter((s) => s.is_active));
    } else {
      console.error('Error fetching time slots:', slotsRes.reason);
    }
    if (subsRes.status === 'fulfilled') {
      setSubjects(subsRes.value);
    } else {
      console.error('Error fetching subjects:', subsRes.reason);
    }
    setIsLoading(false);
  }, [schoolId, studentId, studentGrade]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

  // ドラッグ開始
  const handleDragStart = useCallback((e: DragEvent, subjectId: string) => {
    e.dataTransfer.setData('subjectId', subjectId);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  // ドラッグオーバー
  const handleDragOver = useCallback((e: DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverCell(key);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverCell(null);
  }, []);

  // ドロップ → パターン作成
  const handleDrop = useCallback(
    async (e: DragEvent, dayOfWeek: number, slotId: string) => {
      e.preventDefault();
      setDragOverCell(null);
      if (!canEdit) return;

      const subjectId = e.dataTransfer.getData('subjectId');
      if (!subjectId) return;

      const key = `${dayOfWeek}-${slotId}`;
      const existing = patternMap.get(key);
      if (existing) return; // 既にある場合は無視

      setSaving(key);
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
    [canEdit, patternMap, schoolId, studentId, fetchData, onPatternChange]
  );

  // パターン削除
  const handleRemovePattern = useCallback(
    async (e: React.MouseEvent, dayOfWeek: number, slotId: string) => {
      e.stopPropagation();
      const key = `${dayOfWeek}-${slotId}`;
      const existing = patternMap.get(key);
      if (!existing) return;
      setSaving(key);
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
    return (
      <div className="text-sm text-[#2a2a2a]/80 space-y-2 p-4 bg-[#fff7ed] border border-[#fed7aa] rounded-lg">
        <p className="font-medium">この生徒の教室にコマ時間が登録されていません。</p>
        <p className="text-xs text-[#6b7280]">
          設定 → コマ時間設定 を開くと、現在選択中の教室（ヘッダーの教室）が初期表示されます。
          その教室にコマ時間を登録すると、このマトリクスに反映されます。
        </p>
        <p className="text-[10px] text-[#9ca3af]">
          school_id: <code className="px-1 bg-white rounded">{schoolId || '（なし）'}</code>
        </p>
      </div>
    );
  }

  // 90分科目と45分科目に分類
  const subjects90 = subjects.filter((s) => s.duration_minutes >= 90);
  const subjects45 = subjects.filter((s) => s.duration_minutes < 90);

  return (
    <div className="space-y-3">
      {/* 科目一覧（ドラッグ元）— 表の上に横並び */}
      {canEdit && (
        <div className="space-y-1.5">
          {subjects90.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-gray-400 font-medium w-[36px] flex-shrink-0">90分</span>
              {subjects90.map((sub) => {
                const color = getSubjectColor(sub.id, subjects.indexOf(sub));
                return (
                  <div
                    key={sub.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, sub.id)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded border cursor-grab active:cursor-grabbing select-none ${color.bg} ${color.text} ${color.border}`}
                  >
                    {sub.name}
                  </div>
                );
              })}
            </div>
          )}
          {subjects45.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-gray-400 font-medium w-[36px] flex-shrink-0">45分</span>
              {subjects45.map((sub) => {
                const color = getSubjectColor(sub.id, subjects.indexOf(sub));
                return (
                  <div
                    key={sub.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, sub.id)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded border-2 border-dashed cursor-grab active:cursor-grabbing select-none ${color.bg} ${color.text} ${color.border}`}
                  >
                    {sub.name}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* マトリクス */}
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
                    className={`border border-gray-200 bg-gray-50 px-2 py-1.5 text-center text-[10px] min-w-[56px] ${
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
                  <td className="border border-gray-200 bg-gray-50 px-2 py-1.5 text-[10px] text-gray-500 whitespace-nowrap">
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
                    const isDragOver = dragOverCell === key && !isOn;

                    // 科目名・時間・色を取得
                    const firstSubjectId = pattern?.subject_ids?.[0];
                    const subjectObj = firstSubjectId ? subjects.find((s) => s.id === firstSubjectId) : null;
                    const subjectName = subjectObj?.name ?? (firstSubjectId ? subjectMap.get(firstSubjectId) : null);
                    const is45 = subjectObj ? subjectObj.duration_minutes < 90 : false;
                    const subjectIdx = firstSubjectId ? subjects.findIndex((s) => s.id === firstSubjectId) : 0;
                    const color = firstSubjectId ? getSubjectColor(firstSubjectId, subjectIdx) : null;

                    return (
                      <td
                        key={key}
                        className={`border border-gray-200 px-0.5 py-0.5 text-center transition-[background-color,box-shadow] duration-150 ease-out relative h-[36px] ${
                          isSaving ? 'opacity-50' : ''
                        } ${isDragOver ? 'bg-blue-100 ring-2 ring-inset ring-blue-400' : ''} ${
                          !isOn && !isDragOver ? 'bg-white' : ''
                        }`}
                        onDragOver={(e) => handleDragOver(e, key)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, day, slot.id)}
                      >
                        {isOn && (
                          <div className={`group relative flex flex-col items-center justify-center rounded mx-0.5 px-1 py-0.5 ${is45 ? 'border-2 border-dashed' : 'border'} ${color?.bg ?? 'bg-gray-100'} ${color?.border ?? 'border-gray-300'}`}>
                            <span className={`text-[11px] font-medium leading-tight ${color?.text ?? 'text-gray-600'}`}>
                              {subjectName ?? '●'}
                            </span>
                            {is45 && (
                              <span className="text-[8px] text-gray-400 leading-none">45分</span>
                            )}
                            {canEdit && (
                              <button
                                onClick={(e) => handleRemovePattern(e, day, slot.id)}
                                className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
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
