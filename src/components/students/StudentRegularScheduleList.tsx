'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui';
import { RegularScheduleFormModal } from './RegularScheduleFormModal';
import {
  getRegularPatterns,
  getActiveTimeSlots,
  deleteRegularPattern,
} from '@/lib/api/schedule';
import { getSubjects } from '@/lib/api/subjects';
import type { ScheduleRegularPattern, ScheduleTimeSlot } from '@/types/schedule';
import { DAY_OF_WEEK_LABELS, SCHEDULE_PERIOD_LABELS } from '@/types/schedule';
import { useToast } from '@/hooks/useToast';

interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
}

export interface StudentRegularScheduleListProps {
  studentId: string;
  schoolId: string;
  studentName: string;
  /** 該当学年の科目だけ表示するため（1-12） */
  studentGrade?: number;
  onRefresh?: () => void;
  /** モーダル内で使用する場合: 追加クリック時に親がフォームを表示し、その前に外側モーダルを閉じる */
  onOpenAddForm?: (context: {
    timeSlots: ScheduleTimeSlot[];
    teachers: TeacherOption[];
    subjects: Awaited<ReturnType<typeof getSubjects>>;
  }) => void;
}

function slotLabel(slot: ScheduleTimeSlot | undefined): string {
  if (!slot) return '—';
  return `${slot.slot_number}限 ${slot.start_time?.slice(0, 5) ?? ''}-${slot.end_time?.slice(0, 5) ?? ''}`;
}

export function StudentRegularScheduleList({
  studentId,
  schoolId,
  studentName,
  studentGrade,
  onRefresh,
  onOpenAddForm,
}: StudentRegularScheduleListProps) {
  const { success, error: toastError } = useToast();
  const [patterns, setPatterns] = useState<ScheduleRegularPattern[]>([]);
  const [timeSlots, setTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [subjects, setSubjects] = useState<Awaited<ReturnType<typeof getSubjects>>>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPattern, setEditingPattern] = useState<ScheduleRegularPattern | null>(null);

  const fetchData = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const [pats, slots, subj] = await Promise.all([
        getRegularPatterns(schoolId, { studentId }),
        getActiveTimeSlots(schoolId),
        getSubjects(),
      ]);
      setPatterns(pats);
      setTimeSlots(slots);
      setSubjects(subj);
      const usersRes = await fetch('/api/admin/users?role=teacher');
      const usersData = await usersRes.json();
      const users = usersData.users ?? [];
      setTeachers(users);
    } catch {
      setPatterns([]);
    } finally {
      setLoading(false);
    }
  }, [schoolId, studentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAdd = () => {
    setEditingPattern(null);
    if (onOpenAddForm) {
      onOpenAddForm({ timeSlots, teachers, subjects });
    } else {
      setFormOpen(true);
    }
  };

  const handleEdit = (pattern: ScheduleRegularPattern) => {
    setEditingPattern(pattern);
    setFormOpen(true);
  };

  const handleDelete = async (pattern: ScheduleRegularPattern) => {
    if (!confirm('この通塾日程を削除しますか？')) return;
    try {
      await deleteRegularPattern(pattern.id);
      success('通塾日程を削除しました');
      fetchData();
      onRefresh?.();
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  const handleFormSuccess = () => {
    fetchData();
    onRefresh?.();
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-[var(--paragraph)]">
        読み込み中...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <Button
          onClick={handleAdd}
          className="bg-[#1e3a5f] hover:bg-[#2a4a6f]"
        >
          + 通塾日程を追加
        </Button>
      </div>

      {patterns.length === 0 ? (
        <p className="text-sm text-[var(--paragraph)] py-4">
          通塾日程がありません。「+ 通塾日程を追加」から登録してください。
        </p>
      ) : (
        <div className="overflow-x-auto border border-[var(--stroke)] rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--surface)] border-b border-[var(--stroke)]">
                <th className="px-4 py-2 text-left font-medium text-[var(--headline)]">
                  曜日
                </th>
                <th className="px-4 py-2 text-left font-medium text-[var(--headline)]">
                  コマ
                </th>
                <th className="px-4 py-2 text-left font-medium text-[var(--headline)]">
                  講師
                </th>
                <th className="px-4 py-2 text-left font-medium text-[var(--headline)]">
                  科目
                </th>
                <th className="px-4 py-2 text-left font-medium text-[var(--headline)]">
                  期間
                </th>
                <th className="px-4 py-2 text-right font-medium text-[var(--headline)]">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-[var(--stroke)] last:border-b-0"
                >
                  <td className="px-4 py-2 text-[var(--paragraph)]">
                    {DAY_OF_WEEK_LABELS[p.day_of_week] ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-[var(--paragraph)]">
                    {slotLabel(p.time_slot)}
                  </td>
                  <td className="px-4 py-2 text-[var(--paragraph)]">
                    {p.teacher?.display_name || p.teacher?.email || '—'}
                  </td>
                  <td className="px-4 py-2 text-[var(--paragraph)]">
                    {(p.subject_ids ?? [])
                      .map((id) => subjects.find((s) => s.id === id)?.name)
                      .filter(Boolean)
                      .join('・') || '—'}
                  </td>
                  <td className="px-4 py-2 text-[var(--paragraph)]">
                    {SCHEDULE_PERIOD_LABELS[p.period_type] ?? p.period_type}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(p)}
                        className="text-[var(--paragraph)] hover:text-[var(--primary)]"
                        aria-label="編集"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        className="text-[var(--paragraph)] hover:text-[#c62828]"
                        aria-label="削除"
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {patterns.length > 0 && (
        <p className="text-xs text-[var(--paragraph-light)]">
          📅 週{patterns.length}回通塾
        </p>
      )}

      {!onOpenAddForm && (
        <RegularScheduleFormModal
          open={formOpen}
          onClose={() => {
            setFormOpen(false);
            setEditingPattern(null);
          }}
          studentId={studentId}
          schoolId={schoolId}
          studentGrade={studentGrade}
          pattern={editingPattern}
          timeSlots={timeSlots}
          teachers={teachers}
          subjects={subjects}
          onSuccess={handleFormSuccess}
        />
      )}
    </div>
  );
}
