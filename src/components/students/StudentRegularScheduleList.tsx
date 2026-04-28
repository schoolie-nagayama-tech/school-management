'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui';
import { Pencil, Trash2, Calendar } from 'lucide-react';
import { RegularScheduleFormModal } from './RegularScheduleFormModal';
import { fetchWithAuth } from '@/lib/api/auth';
import {
  getRegularPatterns,
  getActiveTimeSlots,
  deleteRegularPattern,
  regenerateCurrentWeekIfNeeded,
} from '@/lib/api/schedule';
import { getSubjects } from '@/lib/api/subjects';
import type { ScheduleRegularPattern, ScheduleTimeSlot } from '@/types/schedule';
import { DAY_OF_WEEK_LABELS, SCHEDULE_PERIOD_LABELS } from '@/types/schedule';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';

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
  /** モーダル内で使用する場合: 編集クリック時に親がフォームを表示し、その前に外側モーダルを閉じる */
  onOpenEditForm?: (context: {
    pattern: ScheduleRegularPattern;
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
  studentName: _studentName,
  studentGrade,
  onRefresh,
  onOpenAddForm,
  onOpenEditForm,
}: StudentRegularScheduleListProps) {
  const { profile } = useAuth();
  const { success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [patterns, setPatterns] = useState<ScheduleRegularPattern[]>([]);
  const [timeSlots, setTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [subjects, setSubjects] = useState<Awaited<ReturnType<typeof getSubjects>>>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPattern, setEditingPattern] = useState<ScheduleRegularPattern | null>(null);

  // 通常期（生徒管理の「通塾日程」列と一致させる）と講習期を分割
  const regularPatterns = patterns.filter((p) => p.period_type === 'regular');
  const kousyuPatterns = patterns.filter((p) => p.period_type !== 'regular');

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
      const usersRes = await fetchWithAuth('/api/admin/users?role=teacher');
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
    if (onOpenEditForm) {
      onOpenEditForm({ pattern, timeSlots, teachers, subjects });
    } else {
      setEditingPattern(pattern);
      setFormOpen(true);
    }
  };

  const handleDelete = async (pattern: ScheduleRegularPattern) => {
    if (!(await confirm({ title: '削除確認', description: 'この通塾日程を削除しますか？', confirmLabel: '削除', variant: 'danger' }))) return;
    try {
      await deleteRegularPattern(pattern.id);
      await regenerateCurrentWeekIfNeeded(schoolId, profile?.id);
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
          className="bg-[#1e3a5f] hover:bg-[#2a4a6f] transition-colors duration-150"
        >
          + 通塾日程を追加
        </Button>
      </div>

      {regularPatterns.length === 0 ? (
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
                <th className="px-4 py-2 text-right font-medium text-[var(--headline)]">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {regularPatterns.map((p) => (
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
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(p)}
                        className="text-[var(--paragraph)] hover:text-[var(--primary)] transition-colors duration-150"
                        aria-label="編集"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(p)}
                        className="text-[var(--paragraph)] hover:text-[#c62828] transition-colors duration-150"
                        aria-label="削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {regularPatterns.length > 0 && (
        <p className="text-xs text-[var(--paragraph-light)]">
          <Calendar className="inline h-4 w-4 mr-1" />週{regularPatterns.length}回通塾
        </p>
      )}

      {/* 講習期パターン（春期・夏期・冬期）は別セクションで表示 */}
      {kousyuPatterns.length > 0 && (
        <div className="border-t border-[var(--stroke)] pt-3 mt-4">
          <p className="text-xs font-medium text-[var(--headline)] mb-2">
            講習期パターン（{kousyuPatterns.length}件）
          </p>
          <ul className="space-y-1">
            {kousyuPatterns.map((p) => (
              <li key={p.id} className="text-xs text-[var(--paragraph)] flex flex-wrap items-center gap-2">
                <span className="inline-flex px-1.5 py-0.5 text-[10px] rounded bg-orange-100 text-orange-700 border border-orange-200">
                  {SCHEDULE_PERIOD_LABELS[p.period_type] ?? p.period_type}
                </span>
                <span>{DAY_OF_WEEK_LABELS[p.day_of_week] ?? '—'}</span>
                <span>{slotLabel(p.time_slot)}</span>
                {p.teacher?.display_name && (
                  <span className="text-[var(--paragraph-light)]">{p.teacher.display_name}</span>
                )}
                <span>
                  {(p.subject_ids ?? [])
                    .map((id) => subjects.find((s) => s.id === id)?.name)
                    .filter(Boolean)
                    .join('・') || '—'}
                </span>
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleEdit(p)}
                    className="text-[var(--paragraph)] hover:text-[var(--primary)]"
                    aria-label="編集"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(p)}
                    className="text-[var(--paragraph)] hover:text-[#c62828]"
                    aria-label="削除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ConfirmDialog}

      {(!onOpenAddForm || !onOpenEditForm) && (
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
