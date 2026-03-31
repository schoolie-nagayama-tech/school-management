'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { SelectShadcn as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui';
import { RegularPatternForm, RegularPatternTable } from '@/components/schedule';
import { useToast } from '@/hooks/useToast';
import { fetchWithAuth } from '@/lib/api/auth';
import { getSchools } from '@/lib/api/schools';
import { getSubjects } from '@/lib/api/subjects';
import { getStudents } from '@/lib/api/students';
import {
  getTimeSlots,
  getRegularPatterns,
  createRegularPattern,
  updateRegularPattern,
  deleteRegularPattern,
  regenerateCurrentWeekIfNeeded,
} from '@/lib/api/schedule';
import type { ScheduleRegularPattern, ScheduleRegularPatternFormData } from '@/types/schedule';
import type { School } from '@/types/database';
import type { Subject } from '@/types/database';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';

export default function RegularPatternsPage() {
  const searchParams = useSearchParams();
  const studentIdFromUrl = searchParams.get('studentId') ?? undefined;
  const schoolIdFromUrl = searchParams.get('schoolId') ?? undefined;
  const { profile, getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [patterns, setPatterns] = useState<ScheduleRegularPattern[]>([]);
  const [timeSlots, setTimeSlots] = useState<Awaited<ReturnType<typeof getTimeSlots>>>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [students, setStudents] = useState<Awaited<ReturnType<typeof getStudents>>>([]);
  const [teachers, setTeachers] = useState<
    Array<{
      id: string;
      display_name: string | null;
      email: string | null;
      user_schools?: Array<{ school_id: string }>;
      teachable_subject_ids?: string[] | null;
      available_days_of_week?: number[] | null;
      available_slot_numbers_by_day?: Record<string, number[]> | null;
    }>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPattern, setEditingPattern] = useState<ScheduleRegularPattern | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingPattern, setDeletingPattern] = useState<ScheduleRegularPattern | null>(null);
  const [dayFilter, setDayFilter] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<string>('regular');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getSchools();
        const ids = getSelectedSchoolIds();
        const filtered = ids.length > 0 ? data.filter((s) => ids.includes(s.id)) : data;
        setSchools(filtered);
        if (filtered.length > 0 && !selectedSchoolId) {
          const initial = schoolIdFromUrl && filtered.some((s) => s.id === schoolIdFromUrl)
            ? schoolIdFromUrl
            : filtered[0].id;
          setSelectedSchoolId(initial);
        }
      } catch {
        toastError('教室の取得に失敗しました');
      }
    };
    load();
  }, [getSelectedSchoolIds, toastError, schoolIdFromUrl]);

  useEffect(() => {
    const load = async () => {
      try {
        const [subjData] = await Promise.all([getSubjects()]);
        setSubjects(subjData);
      } catch {
        toastError('科目の取得に失敗しました');
      }
    };
    load();
  }, [toastError]);

  useEffect(() => {
    if (!selectedSchoolId) return;
    setIsLoading(true);
    Promise.all([
      getRegularPatterns(selectedSchoolId, {
        studentId: studentIdFromUrl,
        dayOfWeek: dayFilter === 'all' ? undefined : parseInt(dayFilter, 10),
        periodType: periodFilter === 'all' ? undefined : periodFilter,
      }),
      getTimeSlots(selectedSchoolId),
      getStudents(undefined, [selectedSchoolId]),
      fetchWithAuth('/api/admin/users?role=teacher').then((r) => r.json()).then((d) => d.users || []),
    ])
      .then(([p, t, s, users]) => {
        setPatterns(p);
        setTimeSlots(t);
        setStudents(s);
        setTeachers(users);
      })
      .catch(() => toastError('データの取得に失敗しました'))
      .finally(() => setIsLoading(false));
  }, [selectedSchoolId, studentIdFromUrl, dayFilter, periodFilter, toastError]);

  const subjectNames: Record<string, string> = {};
  subjects.forEach((s) => {
    subjectNames[s.id] = s.name;
  });

  const canTeacherTeachSubjects = (teacherId: string, subjectIds: string[]) => {
    if (subjectIds.length === 0) return true;
    const teacher = teachers.find((t) => t.id === teacherId);
    const allowed = teacher?.teachable_subject_ids;
    if (!allowed || allowed.length === 0) return false; // 空 or null = 指導可能科目なし
    return subjectIds.every((id) => allowed.includes(id));
  };

  const handleSave = async (form: ScheduleRegularPatternFormData) => {
    if (!selectedSchoolId) return;
    if (form.teacher_id && !canTeacherTeachSubjects(form.teacher_id, form.subject_ids || [])) {
      toastError('この講師は選択した科目を指導できません。');
      return;
    }
    try {
      if (editingPattern) {
        await updateRegularPattern(editingPattern.id, form);
        await regenerateCurrentWeekIfNeeded(selectedSchoolId, profile?.id);
        success('通塾日程を更新しました');
      } else {
        await createRegularPattern(selectedSchoolId, form);
        await regenerateCurrentWeekIfNeeded(selectedSchoolId, profile?.id);
        success('通塾日程を追加しました');
      }
      const p = await getRegularPatterns(selectedSchoolId, {
        studentId: studentIdFromUrl,
        dayOfWeek: dayFilter === 'all' ? undefined : parseInt(dayFilter, 10),
        periodType: periodFilter === 'all' ? undefined : periodFilter,
      });
      setPatterns(p);
      setFormOpen(false);
      setEditingPattern(null);
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  const handleDeleteClick = (p: ScheduleRegularPattern) => {
    setDeletingPattern(p);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingPattern) return;
    try {
      await deleteRegularPattern(deletingPattern.id);
      await regenerateCurrentWeekIfNeeded(selectedSchoolId!, profile?.id);
      success('通塾日程を削除しました');
      const data = await getRegularPatterns(selectedSchoolId!, {
        studentId: studentIdFromUrl,
        dayOfWeek: dayFilter === 'all' ? undefined : parseInt(dayFilter, 10),
        periodType: periodFilter === 'all' ? undefined : periodFilter,
      });
      setPatterns(data);
      setDeleteDialogOpen(false);
      setDeletingPattern(null);
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';
  if (!profile) {
    return (
      <AdminLayout headerTitle="座席表">
        <div className="py-8 text-center text-[var(--paragraph)]">読み込み中...</div>
      </AdminLayout>
    );
  }
  if (!isAdmin) {
    return (
      <AdminLayout headerTitle="座席表">
        <AccessDenied message="座席表の設定は管理者のみ利用できます。" />
      </AdminLayout>
    );
  }

  const selectedSchool = schools.find((s) => s.id === selectedSchoolId);

  return (
    <AdminLayout headerTitle="座席表">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/schedule" className="text-sm text-[var(--paragraph)] hover:text-[var(--primary)]">
              ← 座席表に戻る
            </Link>
            <h1 className="text-2xl font-bold text-[var(--headline)]">通塾日程</h1>
          </div>
          <div className="flex items-center gap-4">
            <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="教室を選択">
                  {selectedSchool?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {schools.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dayFilter} onValueChange={setDayFilter}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全曜日</SelectItem>
                {[1, 2, 3, 4, 5, 6].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {['月', '火', '水', '木', '金', '土'][d - 1]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={periodFilter} onValueChange={setPeriodFilter}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全期間</SelectItem>
                <SelectItem value="regular">通常期</SelectItem>
                <SelectItem value="spring">春期</SelectItem>
                <SelectItem value="summer">夏期</SelectItem>
                <SelectItem value="winter">冬期</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>通塾日程一覧</CardTitle>
            <p className="text-sm text-[var(--paragraph-light)] mt-1">
              通塾日程の変更は座席表に自動で反映されます。手動での生成は不要です。
            </p>
          </CardHeader>
          <CardContent>
            <RegularPatternTable
              patterns={patterns}
              subjectNames={subjectNames}
              onEdit={(p) => {
                setEditingPattern(p);
                setFormOpen(true);
              }}
              onDelete={handleDeleteClick}
              onAdd={() => {
                setEditingPattern(null);
                setFormOpen(true);
              }}
              isLoading={isLoading}
            />
          </CardContent>
        </Card>
      </div>

      <RegularPatternForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingPattern(null);
        }}
        onSubmit={handleSave}
        editingPattern={editingPattern}
        timeSlots={timeSlots}
        teachers={teachers}
        students={students}
        subjects={subjects}
        selectedSchoolId={selectedSchoolId}
        initialStudentId={studentIdFromUrl}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>通塾日程を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              削除すると無効化され、一覧に表示されなくなります。既に生成されたスケジュールには影響しません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-[#d9376e] text-white hover:bg-[#c02d5a]"
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
