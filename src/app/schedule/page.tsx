'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { SelectShadcn as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { Button } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui';
import {
  ScheduleGenerateButton,
  ScheduleCellMenu,
  ScheduleEntryModal,
  TransferModal,
  TeacherDetailModal,
  WeeklyScheduleGrid,
  StudentActionModal,
  AddTeacherModal,
  AddStudentToSlotModal,
  DeleteScheduleEntryModal,
  TransferModeBar,
  ScheduleDailyPrintView,
} from '@/components/schedule';
import { getSchools } from '@/lib/api/schools';
import { getSubjects } from '@/lib/api/subjects';
import { getStudents } from '@/lib/api/students';
import {
  getActiveTimeSlots,
  getRegularPatterns,
  getScheduleEntries,
  getClosedDays,
  generateWeeklySchedule,
  createScheduleEntry,
  updateScheduleEntry,
  moveScheduleEntry,
  recordAttendance,
  deleteScheduleEntry,
  createTransferEntry,
  deleteRegularPattern,
  cancelFutureEntriesByRegularPatternId,
} from '@/lib/api/schedule';
import type { ScheduleEntry, ScheduleEntryFormData, ScheduleTimeSlot } from '@/types/schedule';
import type { School } from '@/types/database';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { Calendar, Settings, Clock, BookOpen } from 'lucide-react';

const DAY_LABELS: { value: number; label: string }[] = [
  { value: 0, label: '日' },
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
];

function getWeekStart(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function formatWeekLabel(start: Date): string {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${start.getMonth() + 1}/${start.getDate()}〜${end.getMonth() + 1}/${end.getDate()}`;
}

function getWeekDates(weekStart: Date): string[] {
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'Z');
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${week})`;
}

export default function SchedulePage() {
  const { profile, selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolIdLocal, setSelectedSchoolIdLocal] = useState<string>('');
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [timeSlotsCount, setTimeSlotsCount] = useState(0);
  const [patternsCount, setPatternsCount] = useState(0);
  const [generatedCount, setGeneratedCount] = useState<number | null>(null);

  const [timeSlots, setTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [closedDates, setClosedDates] = useState<string[]>([]);
  const [teachers, setTeachers] = useState<
    Array<{
      id: string;
      display_name: string | null;
      email: string | null;
      user_schools?: Array<{ school_id: string; school?: { name: string } }>;
      teachable_subject_ids?: string[] | null;
      available_days_of_week?: number[] | null;
      available_slot_numbers_by_day?: Record<string, number[]> | null;
    }>
  >([]);
  const [subjects, setSubjects] = useState<Awaited<ReturnType<typeof getSubjects>>>([]);
  const [students, setStudents] = useState<Awaited<ReturnType<typeof getStudents>>>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);

  const [actionModalEntry, setActionModalEntry] = useState<ScheduleEntry | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ScheduleEntry | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<{ date: string; slotId: string; teacherId: string } | null>(null);
  const [addTeacherModalOpen, setAddTeacherModalOpen] = useState(false);
  const [addTeacherTarget, setAddTeacherTarget] = useState<{ date: string; slotId: string } | null>(null);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferringEntry, setTransferringEntry] = useState<ScheduleEntry | null>(null);
  const [initialTransferTarget, setInitialTransferTarget] = useState<{ date: string; slotId: string } | null>(null);
  const [transferMode, setTransferMode] = useState<{ sourceEntry: ScheduleEntry } | null>(null);
  const [emptyTeacherSlots, setEmptyTeacherSlots] = useState<Record<string, string[]>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingEntry, setDeletingEntry] = useState<ScheduleEntry | null>(null);
  const [removeTeacherConfirm, setRemoveTeacherConfirm] = useState<{
    date: string;
    slotId: string;
    teacherId: string;
    entryCount: number;
  } | null>(null);
  const [teacherDetailOpen, setTeacherDetailOpen] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<typeof teachers[0] | null>(null);
  const [printDay, setPrintDay] = useState<string | null>(null);

  const MAX_STUDENTS_PER_TEACHER = 2;

  const VISIBLE_DAYS_STORAGE_KEY = 'schedule_visible_days';
  const defaultVisibleDays = [1, 2, 3, 4, 5, 6]; // 月〜土

  const [visibleDaysOfWeek, setVisibleDaysOfWeek] = useState<number[]>(() => {
    if (typeof window === 'undefined') return defaultVisibleDays;
    try {
      const raw = localStorage.getItem(VISIBLE_DAYS_STORAGE_KEY);
      if (!raw) return defaultVisibleDays;
      const parsed = JSON.parse(raw) as number[];
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : defaultVisibleDays;
    } catch {
      return defaultVisibleDays;
    }
  });

  const schoolId = selectedSchoolId && selectedSchoolId !== 'all' ? selectedSchoolId : selectedSchoolIdLocal;

  const weekDatesAll = getWeekDates(weekStart);
  const weekDates = useMemo(() => {
    const days = visibleDaysOfWeek.length > 0 ? visibleDaysOfWeek : defaultVisibleDays;
    return weekDatesAll.filter((d) => {
      const day = new Date(d + 'Z').getUTCDay();
      return days.includes(day);
    });
  }, [weekDatesAll, visibleDaysOfWeek]);

  const setVisibleDaysPersist = useCallback((next: number[]) => {
    setVisibleDaysOfWeek(next);
    try {
      localStorage.setItem(VISIBLE_DAYS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const refreshEntries = useCallback(async () => {
    if (!schoolId) return;
    setEntriesLoading(true);
    try {
      let [list, closed] = await Promise.all([
        getScheduleEntries(schoolId, weekStartStr, weekEndStr),
        getClosedDays(schoolId, { from: weekStartStr, to: weekEndStr }),
      ]);
      // 通塾日程に登録したコマを週スケジュールにデフォルト表示：エントリが0件かつ通塾日程がある場合は自動生成
      if (list.length === 0) {
        const patterns = await getRegularPatterns(schoolId);
        if (patterns.length > 0) {
          await generateWeeklySchedule(schoolId, weekStartStr, profile?.id ?? undefined);
          list = await getScheduleEntries(schoolId, weekStartStr, weekEndStr);
        }
      }
      setEntries(list);
      setClosedDates(closed.map((c) => c.closed_date));
    } catch {
      toastError('スケジュールの取得に失敗しました');
    } finally {
      setEntriesLoading(false);
    }
  }, [schoolId, weekStartStr, weekEndStr, toastError, profile?.id]);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getSchools();
        const ids = getSelectedSchoolIds();
        const filtered = ids.length > 0 ? data.filter((s) => ids.includes(s.id)) : data;
        setSchools(filtered);
        if (filtered.length > 0 && !selectedSchoolIdLocal) {
          setSelectedSchoolIdLocal(filtered[0].id);
        }
      } catch {
        // ignore
      }
    };
    load();
  }, [getSelectedSchoolIds]);

  useEffect(() => {
    if (!schoolId) return;
    Promise.all([
      getActiveTimeSlots(schoolId),
      getRegularPatterns(schoolId),
      getSubjects(),
      fetch('/api/admin/users?role=teacher').then((r) => r.json()).then((d) => d.users || []),
    ])
      .then(([slots, patterns, subj, users]) => {
        setTimeSlots(slots);
        setTimeSlotsCount(slots.length);
        setPatternsCount(patterns.length);
        setSubjects(subj);
        setTeachers(users);
      })
      .catch(() => {
        setTimeSlotsCount(0);
        setPatternsCount(0);
      });
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    getStudents(undefined, [schoolId]).then(setStudents).catch(() => setStudents([]));
  }, [schoolId]);

  useEffect(() => {
    refreshEntries();
  }, [refreshEntries]);

  const handleEntryClick = (entry: ScheduleEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionModalEntry(entry);
  };

  const handleAddTeacher = (date: string, slotId: string) => {
    setAddTeacherTarget({ date, slotId });
    setAddTeacherModalOpen(true);
  };

  const handleAddTeacherSelect = (teacherId: string) => {
    if (!addTeacherTarget) return;
    const cellKey = `${addTeacherTarget.date}-${addTeacherTarget.slotId}`;
    setEmptyTeacherSlots((prev) => ({
      ...prev,
      [cellKey]: [...(prev[cellKey] ?? []), teacherId],
    }));
    setAddTeacherTarget(null);
    setAddTeacherModalOpen(false);
  };

  const handleAddStudent = (date: string, slotId: string, teacherId: string) => {
    setAddTarget({ date, slotId, teacherId });
  };

  const handleRemoveTeacher = (
    date: string,
    slotId: string,
    teacherId: string,
    entryCount: number
  ) => {
    if (entryCount === 0) {
      const cellKey = `${date}-${slotId}`;
      setEmptyTeacherSlots((prev) => {
        const next = { ...prev };
        const arr = (next[cellKey] ?? []).filter((id) => id !== teacherId);
        if (arr.length === 0) delete next[cellKey];
        else next[cellKey] = arr;
        return next;
      });
      return;
    }
    setRemoveTeacherConfirm({ date, slotId, teacherId, entryCount });
  };

  const handleTeacherCardMove = async (
    source: { date: string; slotId: string; teacherId: string },
    target: { date: string; slotId: string }
  ) => {
    const toMove = entries.filter(
      (e) =>
        e.entry_date === source.date &&
        e.time_slot_id === source.slotId &&
        e.teacher_id === source.teacherId &&
        e.status !== 'cancelled' &&
        e.status !== 'transferred_out'
    );
    for (const entry of toMove) {
      await moveScheduleEntry(entry.id, target.date, target.slotId, source.teacherId);
    }
    success('講師カードを移動しました');
    refreshEntries();
  };

  /** 振替モード時: 座席表の講師ブロックをクリックで振替先に選び、即実行 */
  const handleTransferTargetClick = async (
    targetDate: string,
    targetSlotId: string,
    targetTeacherId: string
  ) => {
    if (!transferMode || !schoolId) return;
    const entry = transferMode.sourceEntry;
    try {
      await createTransferEntry(
        schoolId,
        entry.id,
        targetDate,
        targetSlotId,
        targetTeacherId,
        null
      );
      success('振替を登録しました');
      setTransferMode(null);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  /** 日付横の印刷アイコン: その日だけ印刷用ビューを表示して印刷 */
  const handlePrintDay = (dateStr: string) => {
    setPrintDay(dateStr);
  };

  useEffect(() => {
    if (!printDay) return;
    const doPrint = () => {
      window.print();
    };
    const onAfterPrint = () => {
      setPrintDay(null);
    };
    const t = setTimeout(doPrint, 150);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, [printDay]);

  const handleEditClick = () => {
    if (!actionModalEntry) return;
    setEditingEntry(actionModalEntry);
    setEditModalOpen(true);
    setActionModalEntry(null);
  };

  /** 振替モードに切り替え（座席表の講師ブロックをクリックで振替先を選ぶ） */
  const handleTransferFromAction = () => {
    if (!actionModalEntry) return;
    setTransferMode({ sourceEntry: actionModalEntry });
    setActionModalEntry(null);
  };

  const handleAbsentFromAction = async () => {
    const entry = actionModalEntry;
    if (!entry || !profile) return;
    if (!window.confirm('この授業を欠席にしますか？')) return;
    try {
      await recordAttendance(entry.id, 'absent', profile.id);
      success('欠席を記録しました');
      setActionModalEntry(null);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  const handleDeleteClick = () => {
    if (!actionModalEntry) return;
    setDeletingEntry(actionModalEntry);
    setDeleteDialogOpen(true);
    setActionModalEntry(null);
  };

  /** 生徒カードの振替アイコンまたはクリックで振替モードを開始 */
  const handleTransferClickFromCard = (entry: ScheduleEntry) => {
    setTransferringEntry(entry);
    setTransferModalOpen(true);
    setActionModalEntry(null);
  };

  const handleStudentEntryDrop = async (
    entryId: string,
    targetDate: string,
    targetSlotId: string,
    targetTeacherId: string
  ) => {
    const entry = entriesWithSubjects.find((e) => e.id === entryId);
    if (!entry || !schoolId) return;
    if (entry.status === 'cancelled' || entry.status === 'transferred_out') return;
    try {
      await createTransferEntry(
        schoolId,
        entry.id,
        targetDate,
        targetSlotId,
        targetTeacherId,
        null
      );
      success('振替を登録しました');
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  const handleEditSave = async (form: ScheduleEntryFormData) => {
    if (!editingEntry) return;
    if (!canTeacherTeachSubjects(form.teacher_id, form.subject_ids)) {
      toastError('この講師は選択した科目を指導できません。');
      return;
    }
    try {
      await updateScheduleEntry(editingEntry.id, form);
      success('授業を更新しました');
      setEditModalOpen(false);
      setEditingEntry(null);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  const handleAddSave = async (form: ScheduleEntryFormData) => {
    if (!schoolId || !addTarget) return;
    if (!canTeacherTeachSubjects(form.teacher_id, form.subject_ids)) {
      toastError('この講師は選択した科目を指導できません。');
      return;
    }
    try {
      await createScheduleEntry(schoolId, addTarget.date, addTarget.slotId, form);
      success('授業を追加しました');
      const cellKey = `${addTarget.date}-${addTarget.slotId}`;
      setEmptyTeacherSlots((prev) => {
        const next = { ...prev };
        const arr = (next[cellKey] ?? []).filter((id) => id !== form.teacher_id);
        if (arr.length === 0) delete next[cellKey];
        else next[cellKey] = arr;
        return next;
      });
      setAddModalOpen(false);
      setAddTarget(null);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  const handleTransfer = async (
    targetDate: string,
    targetSlotId: string,
    targetTeacherId: string,
    seatLabel?: string | null
  ) => {
    if (!schoolId || !transferringEntry) return;
    try {
      await createTransferEntry(
        schoolId,
        transferringEntry.id,
        targetDate,
        targetSlotId,
        targetTeacherId,
        seatLabel
      );
      success('振替を登録しました');
      setTransferModalOpen(false);
      setTransferringEntry(null);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  const handleDeleteConfirm = async (deleteType: 'single' | 'regular') => {
    if (!deletingEntry) return;
    try {
      if (deleteType === 'single') {
        await deleteScheduleEntry(deletingEntry.id);
        success('この日の授業を削除しました');
      } else if (deletingEntry.regular_pattern_id) {
        await cancelFutureEntriesByRegularPatternId(
          deletingEntry.regular_pattern_id,
          deletingEntry.entry_date
        );
        await deleteRegularPattern(deletingEntry.regular_pattern_id);
        success('通常授業から削除し、今後の授業も取消しました');
      } else {
        await deleteScheduleEntry(deletingEntry.id);
        success('授業を削除しました');
      }
      setDeleteDialogOpen(false);
      setDeletingEntry(null);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  const handleRemoveTeacherConfirm = async () => {
    if (!removeTeacherConfirm) return;
    const { date, slotId, teacherId } = removeTeacherConfirm;
    const toDelete = entries.filter(
      (e) =>
        e.entry_date === date &&
        e.time_slot_id === slotId &&
        e.teacher_id === teacherId &&
        e.status !== 'cancelled' &&
        e.status !== 'transferred_out'
    );
    try {
      for (const entry of toDelete) {
        await deleteScheduleEntry(entry.id);
      }
      success('講師の授業を削除しました');
      setRemoveTeacherConfirm(null);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
    }
  };

  const entriesWithSubjects = useMemo(() => {
    return entries.map((e) => ({
      ...e,
      subjects: (e.subject_ids || [])
        .map((id) => subjects.find((s) => s.id === id))
        .filter(Boolean) as { id: string; name: string }[],
    }));
  }, [entries, subjects]);

  const selectedSchool = schools.find((s) => s.id === schoolId);
  const slotForAdd = addTarget ? timeSlots.find((s) => s.id === addTarget.slotId) : null;

  /** 講師が選択科目を指導可能か。teachable_subject_ids が空/未設定の講師は全科目可 */
  const canTeacherTeachSubjects = (teacherId: string, subjectIds: string[]) => {
    if (subjectIds.length === 0) return true;
    const teacher = teachers.find((t) => t.id === teacherId);
    const allowed = teacher?.teachable_subject_ids;
    if (!allowed || allowed.length === 0) return true;
    return subjectIds.every((id) => allowed.includes(id));
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
        <AccessDenied message="座席表は管理者のみ利用できます。" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="座席表">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-[var(--headline)]">座席表</h1>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={schoolId || ''} onValueChange={(v) => setSelectedSchoolIdLocal(v)}>
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
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const prev = new Date(weekStart);
                  prev.setDate(prev.getDate() - 7);
                  setWeekStart(prev);
                }}
              >
                前週
              </Button>
              <span className="text-sm text-[var(--paragraph)] min-w-[140px] text-center">
                {formatWeekLabel(weekStart)}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const next = new Date(weekStart);
                  next.setDate(next.getDate() + 7);
                  setWeekStart(next);
                }}
              >
                次週
              </Button>
            </div>
            {schoolId && (
              <ScheduleGenerateButton
                schoolId={schoolId}
                weekStartDate={weekStartStr}
                userId={profile.id}
                onGenerated={(count) => {
                  setGeneratedCount(count);
                  success(`スケジュールを生成しました（${count}件）`);
                  refreshEntries();
                }}
              />
            )}
            {schoolId && (
              <span className="text-sm text-[var(--paragraph)]">設定:</span>
            )}
            {schoolId && (
              <>
                <Link href="/schedule/settings/time-slots">
                  <Button variant="secondary" size="sm">
                    <Settings className="mr-2 h-4 w-4" />
                    コマ時間設定
                  </Button>
                </Link>
                <Link href="/schedule/settings/closed-days">
                  <Button variant="secondary" size="sm">
                    休講日設定
                  </Button>
                </Link>
                <span className="text-sm text-[var(--paragraph)] ml-1">表示曜日:</span>
                <div className="flex flex-wrap items-center gap-1">
                  {DAY_LABELS.map((d) => (
                    <label
                      key={d.value}
                      className="flex items-center gap-1 text-xs cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={visibleDaysOfWeek.includes(d.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setVisibleDaysPersist([...visibleDaysOfWeek, d.value].sort((a, b) => a - b));
                          } else {
                            setVisibleDaysPersist(visibleDaysOfWeek.filter((x) => x !== d.value));
                          }
                        }}
                        className="rounded border-[var(--stroke)]"
                      />
                      <span className="text-[var(--headline)]">{d.label}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {!schoolId ? (
          <Card>
            <CardContent className="py-8 text-center text-[var(--paragraph)]">
              教室を選択してください。
            </CardContent>
          </Card>
        ) : (
          <>
            {timeSlotsCount === 0 && (
              <Card className="border-[var(--primary)]/40 bg-[var(--primary-subtle)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[var(--headline)]">
                    <Clock className="h-5 w-5" />
                    コマ時間が未設定です
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[var(--paragraph)] mb-4">
                    座席表を利用するには、まずコマ時間を設定してください。
                  </p>
                  <Link href="/schedule/settings/time-slots">
                    <Button>コマ時間設定へ</Button>
                  </Link>
                </CardContent>
              </Card>
            )}

            {timeSlotsCount > 0 && patternsCount === 0 && (
              <Card className="border-[var(--primary)]/40 bg-[var(--primary-subtle)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[var(--headline)]">
                    <BookOpen className="h-5 w-5" />
                    通塾日程が未登録です
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[var(--paragraph)] mb-4">
                    スケジュールを生成するには、通塾日程を登録してください。
                  </p>
                  <Link href="/schedule/regular-patterns">
                    <Button>通塾日程へ</Button>
                  </Link>
                </CardContent>
              </Card>
            )}

            {timeSlotsCount > 0 && patternsCount > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <CardTitle>
                      週間座席表
                      {selectedSchool && (
                        <span className="text-base font-normal text-[var(--paragraph)] ml-2">
                          {selectedSchool.name} 通常期
                        </span>
                      )}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="schedule-print">
                  <div className="flex flex-wrap gap-4 mb-4 no-print">
                    <Link href="/schedule/regular-patterns">
                      <Button variant="secondary" size="sm">
                        通塾日程
                      </Button>
                    </Link>
                  </div>
                  {/* 日付横の印刷アイコンで指定した日だけ印刷時表示 */}
                  {printDay && timeSlotsCount > 0 && patternsCount > 0 && (
                    <div className="hidden print:block">
                      <ScheduleDailyPrintView
                        weekDates={[printDay]}
                        timeSlots={timeSlots}
                        entries={entriesWithSubjects}
                        schoolName={selectedSchool?.name}
                        singleDate={printDay}
                      />
                    </div>
                  )}
                  {transferMode && (
                    <TransferModeBar
                      entry={transferMode.sourceEntry}
                      slotLabel={
                        transferMode.sourceEntry.time_slot
                          ? `${transferMode.sourceEntry.time_slot.slot_number}限`
                          : undefined
                      }
                      onCancel={() => setTransferMode(null)}
                    />
                  )}
                  {entriesLoading ? (
                    <div className="py-8 text-center text-[var(--paragraph)]">読み込み中...</div>
                  ) : (
                    <div className="print:hidden">
                    <WeeklyScheduleGrid
                      schoolId={schoolId ?? ''}
                      weekDates={weekDates}
                      timeSlots={timeSlots}
                      entries={entriesWithSubjects}
                      closedDates={closedDates}
                      teachers={teachers}
                      emptyTeacherSlots={emptyTeacherSlots}
                      maxStudentsPerTeacher={MAX_STUDENTS_PER_TEACHER}
                      transferMode={transferMode}
                      onEmptyTeacherSlotsChange={setEmptyTeacherSlots}
                      onAddTeacher={handleAddTeacher}
                      onAddStudent={handleAddStudent}
                      onRemoveTeacher={handleRemoveTeacher}
                      onStudentClick={handleEntryClick}
                      onTransferClick={handleTransferClickFromCard}
                      onTeacherCardMove={handleTeacherCardMove}
                      onStudentEntryDrop={handleStudentEntryDrop}
                      onTransferTargetClick={handleTransferTargetClick}
                      onPrintDay={handlePrintDay}
                      onTransferCancel={() => setTransferMode(null)}
                    />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <StudentActionModal
        open={!!actionModalEntry}
        onClose={() => setActionModalEntry(null)}
        entry={actionModalEntry}
        timeSlot={
          actionModalEntry
            ? timeSlots.find((s) => s.id === actionModalEntry.time_slot_id) ?? null
            : null
        }
        onTransfer={handleTransferFromAction}
        onAbsent={handleAbsentFromAction}
        onEdit={handleEditClick}
        onDelete={handleDeleteClick}
      />

      <AddTeacherModal
        open={addTeacherModalOpen}
        onClose={() => {
          setAddTeacherModalOpen(false);
          setAddTeacherTarget(null);
        }}
        teachers={teachers}
        schoolId={schoolId ?? ''}
        onSelect={handleAddTeacherSelect}
      />

      <ScheduleEntryModal
        open={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setEditingEntry(null);
        }}
        mode="edit"
        date={editingEntry?.entry_date ?? ''}
        slot={editingEntry?.time_slot ?? null}
        entry={editingEntry}
        teachers={teachers}
        students={students}
        subjects={subjects}
        schoolId={schoolId ?? ''}
        onSave={handleEditSave}
      />

      <AddStudentToSlotModal
        isOpen={!!addTarget}
        onClose={() => {
          setAddModalOpen(false);
          setAddTarget(null);
        }}
        date={addTarget?.date ?? ''}
        dayOfWeek={
          addTarget?.date
            ? new Date(addTarget.date + 'Z').getUTCDay()
            : 0
        }
        timeSlot={
          addTarget
            ? timeSlots.find((s) => s.id === addTarget.slotId) ?? ({} as ScheduleTimeSlot)
            : ({} as ScheduleTimeSlot)
        }
        teacherId={addTarget?.teacherId ?? ''}
        teacherName={
          addTarget
            ? teachers.find((t) => t.id === addTarget.teacherId)?.display_name ||
              teachers.find((t) => t.id === addTarget.teacherId)?.email ||
              '—'
            : '—'
        }
        schoolId={schoolId ?? ''}
        subjects={subjects}
        onSuccess={() => {
          refreshEntries();
          setAddTarget(null);
          setAddModalOpen(false);
        }}
      />

      <TransferModal
        open={transferModalOpen}
        onClose={() => {
          setTransferModalOpen(false);
          setTransferringEntry(null);
          setInitialTransferTarget(null);
        }}
        entry={transferringEntry}
        teachers={teachers}
        timeSlots={timeSlots}
        schoolId={schoolId ?? ''}
        weekStart={weekStartStr}
        weekEnd={weekEndStr}
        closedDates={closedDates}
        initialTargetDate={initialTransferTarget?.date}
        initialTargetSlotId={initialTransferTarget?.slotId}
        onTransfer={handleTransfer}
      />

      <TeacherDetailModal
        open={teacherDetailOpen}
        onClose={() => {
          setTeacherDetailOpen(false);
          setSelectedTeacher(null);
        }}
        teacher={selectedTeacher}
        subjects={subjects}
      />

      <DeleteScheduleEntryModal
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setDeletingEntry(null);
        }}
        entry={deletingEntry}
        timeSlot={
          deletingEntry
            ? timeSlots.find((s) => s.id === deletingEntry.time_slot_id) ?? null
            : null
        }
        onConfirm={handleDeleteConfirm}
      />

      <AlertDialog
        open={!!removeTeacherConfirm}
        onOpenChange={(open) => !open && setRemoveTeacherConfirm(null)}
        overlayClassName="z-[100]"
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>講師カードを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTeacherConfirm?.entryCount
                ? `この講師の授業が${removeTeacherConfirm.entryCount}件すべて削除されます。`
                : '講師カードを削除します。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRemoveTeacherConfirm(null)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveTeacherConfirm}
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
