'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Button } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import {
  WeeklyScheduleGrid,
  TransferModeBar,
  ScheduleDailyPrintView,
  ScheduleToolbar,
  ScheduleDialogs,
} from '@/components/schedule';
import { fetchWithAuth } from '@/lib/api/auth';
import { getSchools } from '@/lib/api/schools';
import { getSubjects } from '@/lib/api/subjects';
import { getStudents } from '@/lib/api/students';
import {
  getActiveTimeSlots,
  getRegularPatterns,
  getScheduleEntries,
  getClosedDays,
  generateWeeklySchedule,
  hasEntriesForWeek,
  getExpectedEntryKeysFromPatterns,
  updateScheduleEntry,
  moveScheduleEntry,
  recordAttendance,
  deleteScheduleEntry,
  createTransferEntry,
  revertTransferEntry,
  deleteRegularPattern,
  cancelFutureEntriesByRegularPatternId,
} from '@/lib/api/schedule';
import type { ScheduleEntry, ScheduleEntryFormData, ScheduleTimeSlot } from '@/types/schedule';
import type { School, Student } from '@/types/database';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { Clock, BookOpen } from 'lucide-react';
import {
  getSchoolKoushu,
  getKoushuEnrollments,
  getKoushuScheduledCounts,
  type KoushuCourse,
  type KoushuEnrollment,
} from '@/lib/api/seasonalCourses';

function getWeekStart(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** ローカル日付で YYYY-MM-DD を返す（API・表示の週範囲をタイムゾーンでずらさないため） */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekDates(weekStart: Date): string[] {
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    dates.push(toLocalDateStr(d));
  }
  return dates;
}

export default function SchedulePage() {
  const { profile, isLoading: authLoading, selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolIdLocal, setSelectedSchoolIdLocal] = useState<string>('');
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [timeSlotsCount, setTimeSlotsCount] = useState(0);
  const [patternsCount, setPatternsCount] = useState(0);
  const [, setGeneratedCount] = useState<number | null>(null);

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
  const [studentDetailStudent, setStudentDetailStudent] = useState<Student | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ScheduleEntry | null>(null);
  const [, setAddModalOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<{ date: string; slotId: string; teacherId: string } | null>(null);
  const [addTeacherModalOpen, setAddTeacherModalOpen] = useState(false);
  const [addTeacherTarget, setAddTeacherTarget] = useState<{ date: string; slotId: string; existingTeacherIds: string[] } | null>(null);
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
  const [scheduleSettingsOpen, setScheduleSettingsOpen] = useState(false);
  const [scheduleGenerateConfirmOpen, setScheduleGenerateConfirmOpen] = useState(false);
  const [scheduleGenerateHasExisting, setScheduleGenerateHasExisting] = useState(false);
  const [scheduleGenerateLoading, setScheduleGenerateLoading] = useState(false);

  // ---- 講習モード ----
  const [koushuList, setKoushuList] = useState<KoushuCourse[]>([]);
  const [selectedKoushu, setSelectedKoushu] = useState<KoushuCourse | null>(null);
  const [koushuEnrollments, setKoushuEnrollments] = useState<Map<string, KoushuEnrollment>>(new Map());
  const [koushuScheduledCounts, setKoushuScheduledCounts] = useState<Map<string, number>>(new Map());

  const router = useRouter();

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

  const weekDatesAll = useMemo(() => getWeekDates(weekStart), [weekStart]);
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
  const weekStartStr = toLocalDateStr(weekStart);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndStr = toLocalDateStr(weekEnd);

  const refreshEntries = useCallback(async () => {
    if (!schoolId) return;
    setEntriesLoading(true);
    try {
      const [initialList, closed] = await Promise.all([
        getScheduleEntries(schoolId, weekStartStr, weekEndStr),
        getClosedDays(schoolId, { from: weekStartStr, to: weekEndStr }),
      ]);
      let list = initialList;
      const patterns = await getRegularPatterns(schoolId);
      // 通塾日程に登録したコマを週スケジュールにデフォルト表示：エントリが0件かつ通塾日程がある場合は自動生成
      if (list.length === 0 && patterns.length > 0) {
        await generateWeeklySchedule(schoolId, weekStartStr, profile?.id ?? undefined);
        list = await getScheduleEntries(schoolId, weekStartStr, weekEndStr);
      }
      setEntries(list);
      setClosedDates(closed.map((c) => c.closed_date));

      // 通塾日程と座席表の同期チェック：不一致なら自動で再生成（手動作業不要）
      if (patterns.length > 0) {
        const expected = await getExpectedEntryKeysFromPatterns(schoolId, weekStartStr);
        const actual = new Set(
          list
            .filter((e) => e.status === 'scheduled' || e.status === 'completed')
            .map((e) => `${e.entry_date}-${e.time_slot_id}-${e.student_id}`)
        );
        const outOfSync =
          expected.size !== actual.size ||
          Array.from(expected).some((k) => !actual.has(k));
        if (outOfSync) {
          await generateWeeklySchedule(schoolId, weekStartStr, profile?.id ?? undefined);
          list = await getScheduleEntries(schoolId, weekStartStr, weekEndStr);
          setEntries(list);
        }
      }
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
      fetchWithAuth('/api/admin/users?role=teacher').then((r) => r.json()).then((d) => d.users || []),
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

  // 講習リストをロード（schoolId 変更時）
  useEffect(() => {
    if (!schoolId) { setKoushuList([]); return; }
    getSchoolKoushu(schoolId).then(setKoushuList).catch(() => setKoushuList([]));
  }, [schoolId]);

  // 講習モード選択時: 申し込みデータ + 期間スケジュール済み数を取得
  const handleKoushuSelect = useCallback(async (course: KoushuCourse | null) => {
    setSelectedKoushu(course);
    if (!course) {
      setKoushuEnrollments(new Map());
      setKoushuScheduledCounts(new Map());
      return;
    }
    const enrollments = await getKoushuEnrollments(course.id);
    const enrollMap = new Map(enrollments.map((e) => [e.student_id, e]));
    setKoushuEnrollments(enrollMap);
    if (course.start_date && course.end_date && enrollMap.size > 0) {
      const counts = await getKoushuScheduledCounts(
        schoolId,
        course.start_date,
        course.end_date,
        Array.from(enrollMap.keys())
      );
      setKoushuScheduledCounts(counts);
    } else {
      setKoushuScheduledCounts(new Map());
    }
  }, [schoolId]);

  // 講習モード用: 生徒IDから申し込み情報を返す
  const getKoushuInfo = useCallback((studentId: string) => {
    if (!selectedKoushu) return null;
    const en = koushuEnrollments.get(studentId);
    if (!en) return null;
    return {
      enrolled: en.koma_count,
      scheduled: koushuScheduledCounts.get(studentId) ?? 0,
    };
  }, [selectedKoushu, koushuEnrollments, koushuScheduledCounts]);

  useEffect(() => {
    refreshEntries();
  }, [refreshEntries]);

  const handleEntryClick = useCallback((entry: ScheduleEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionModalEntry(entry);
  }, []);

  const handleStudentClickFromAction = useCallback(() => {
    const entry = actionModalEntry;
    if (!entry) return;
    setActionModalEntry(null);
    const found = students.find((s) => s.id === entry.student_id);
    if (found) {
      setStudentDetailStudent(found);
    } else {
      toastError('生徒情報の取得に失敗しました');
    }
  }, [actionModalEntry, students, toastError]);

  const handleTeacherClickFromAction = useCallback(() => {
    const entry = actionModalEntry;
    if (!entry) return;
    setActionModalEntry(null);
    router.push(`/admin/teachers/${entry.teacher_id}`);
  }, [actionModalEntry, router]);

  const handleAddTeacher = useCallback((date: string, slotId: string, existingTeacherIds: string[]) => {
    setAddTeacherTarget({ date, slotId, existingTeacherIds });
    setAddTeacherModalOpen(true);
  }, []);

  const handleAddTeacherSelect = useCallback((teacherId: string) => {
    if (!addTeacherTarget) return;
    const cellKey = `${addTeacherTarget.date}-${addTeacherTarget.slotId}`;
    setEmptyTeacherSlots((prev) => ({
      ...prev,
      [cellKey]: [...(prev[cellKey] ?? []), teacherId],
    }));
    setAddTeacherTarget(null);
    setAddTeacherModalOpen(false);
  }, [addTeacherTarget]);

  const handleAddStudent = useCallback((date: string, slotId: string, teacherId: string) => {
    setAddTarget({ date, slotId, teacherId });
  }, []);

  const handleRemoveTeacher = useCallback((
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
  }, []);

  const handleTeacherCardMove = useCallback(async (
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
  }, [entries, success, refreshEntries]);

  /** 振替モード時: 座席表の講師ブロックをクリックで振替先に選び、即実行。同日同時間帯は移動として扱う */
  const handleTransferTargetClick = useCallback(async (
    targetDate: string,
    targetSlotId: string,
    targetTeacherId: string
  ) => {
    if (!transferMode || !schoolId) return;
    const entry = transferMode.sourceEntry;
    try {
      const isSameSlot =
        entry.entry_date === targetDate && entry.time_slot_id === targetSlotId;
      if (isSameSlot) {
        await moveScheduleEntry(entry.id, targetDate, targetSlotId, targetTeacherId);
        success('授業を移動しました');
      } else {
        await createTransferEntry(
          schoolId,
          entry.id,
          targetDate,
          targetSlotId,
          targetTeacherId,
          null
        );
        success('振替を登録しました');
      }
      setTransferMode(null);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
    }
  }, [transferMode, schoolId, success, refreshEntries, toastError]);

  /** 日付横の印刷アイコン: その日だけ印刷用ビューを表示して印刷 */
  const handlePrintDay = useCallback((dateStr: string) => {
    setPrintDay(dateStr);
  }, []);

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

  useEffect(() => {
    if (!scheduleGenerateConfirmOpen || !schoolId || !weekStartStr) return;
    let cancelled = false;
    setScheduleGenerateLoading(true);
    hasEntriesForWeek(schoolId, weekStartStr)
      .then((exists) => {
        if (!cancelled) setScheduleGenerateHasExisting(exists);
      })
      .finally(() => {
        if (!cancelled) setScheduleGenerateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scheduleGenerateConfirmOpen, schoolId, weekStartStr]);

  const handleScheduleGenerateConfirm = useCallback(async () => {
    if (!schoolId || !weekStartStr) return;
    setScheduleGenerateLoading(true);
    try {
      const result = await generateWeeklySchedule(schoolId, weekStartStr, profile?.id ?? undefined);
      setScheduleGenerateConfirmOpen(false);
      setGeneratedCount(result.entries_created);
      success(`スケジュールを生成しました（${result.entries_created}件）`);
      refreshEntries();
    } finally {
      setScheduleGenerateLoading(false);
    }
  }, [schoolId, weekStartStr, profile?.id, success, refreshEntries]);

  const handleEditClick = useCallback(() => {
    if (!actionModalEntry) return;
    setEditingEntry(actionModalEntry);
    setEditModalOpen(true);
    setActionModalEntry(null);
  }, [actionModalEntry]);

  /** 振替モードに切り替え（座席表の講師ブロックをクリックで振替先を選ぶ） */
  const handleTransferFromAction = useCallback(() => {
    if (!actionModalEntry) return;
    setTransferMode({ sourceEntry: actionModalEntry });
    setActionModalEntry(null);
  }, [actionModalEntry]);

  const handleAbsentFromAction = useCallback(async () => {
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
  }, [actionModalEntry, profile, success, refreshEntries, toastError]);

  const handleDeleteClick = useCallback(() => {
    if (!actionModalEntry) return;
    setDeletingEntry(actionModalEntry);
    setDeleteDialogOpen(true);
    setActionModalEntry(null);
  }, [actionModalEntry]);

  /** 振替先授業を通常の授業に戻す（振替取り消し） */
  const handleRevertTransfer = useCallback(async () => {
    const entry = actionModalEntry;
    if (!entry || entry.status !== 'transferred_in') return;
    if (!window.confirm('この振替を元に戻し、通常の授業に戻しますか？')) return;
    try {
      await revertTransferEntry(entry.id);
      success('通常の授業に戻しました');
      setActionModalEntry(null);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
    }
  }, [actionModalEntry, success, refreshEntries, toastError]);

  /** 生徒カードの振替アイコンまたはクリックで振替モードを開始 */
  const handleTransferClickFromCard = useCallback((entry: ScheduleEntry) => {
    setTransferringEntry(entry);
    setTransferModalOpen(true);
    setActionModalEntry(null);
  }, []);

  const entriesWithSubjects = useMemo(() => {
    return entries.map((e) => ({
      ...e,
      subjects: (e.subject_ids || [])
        .map((id) => subjects.find((s) => s.id === id))
        .filter(Boolean) as { id: string; name: string }[],
    }));
  }, [entries, subjects]);

  // 講習モード: 講習登録済み生徒のみにフィルタリング
  const displayEntries = useMemo(() => {
    if (!selectedKoushu || koushuEnrollments.size === 0) return entriesWithSubjects;
    return entriesWithSubjects.filter((e) => koushuEnrollments.has(e.student_id));
  }, [entriesWithSubjects, selectedKoushu, koushuEnrollments]);

  const handleStudentEntryDrop = useCallback(async (
    entryId: string,
    targetDate: string,
    targetSlotId: string,
    targetTeacherId: string
  ) => {
    const entry = entriesWithSubjects.find((e) => e.id === entryId);
    if (!entry || !schoolId) return;
    if (entry.status === 'cancelled' || entry.status === 'transferred_out') return;
    try {
      // 振替先を元のセル（振替元）にドロップ → 振替取り消し
      if (entry.status === 'transferred_in' && entry.transfer_from_id) {
        const fromEntry = entries.find((e) => e.id === entry.transfer_from_id);
        if (
          fromEntry &&
          fromEntry.entry_date === targetDate &&
          fromEntry.time_slot_id === targetSlotId &&
          fromEntry.teacher_id === targetTeacherId
        ) {
          await revertTransferEntry(entry.id);
          success('元の授業に戻しました');
          refreshEntries();
          return;
        }
      }
      // 同日・同時間帯 → 移動（振替ではない）
      const isSameSlot =
        entry.entry_date === targetDate && entry.time_slot_id === targetSlotId;
      if (isSameSlot) {
        await moveScheduleEntry(entry.id, targetDate, targetSlotId, targetTeacherId);
        success('授業を移動しました');
        refreshEntries();
        return;
      }
      // 別日または別コマ → 振替
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
  }, [entriesWithSubjects, entries, schoolId, success, refreshEntries, toastError]);

  const selectedSchool = useMemo(() => schools.find((s) => s.id === schoolId), [schools, schoolId]);

  /** 講師が選択科目を指導可能か。teachable_subject_ids が空/未設定の講師は全科目可 */
  const canTeacherTeachSubjects = useCallback((teacherId: string, subjectIds: string[]) => {
    if (subjectIds.length === 0) return true;
    const teacher = teachers.find((t) => t.id === teacherId);
    const allowed = teacher?.teachable_subject_ids;
    if (!allowed || allowed.length === 0) return true;
    return subjectIds.every((id) => allowed.includes(id));
  }, [teachers]);

  const handleEditSave = useCallback(async (form: ScheduleEntryFormData) => {
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
  }, [editingEntry, canTeacherTeachSubjects, toastError, success, refreshEntries]);

  const handleTransfer = useCallback(async (
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
  }, [schoolId, transferringEntry, success, refreshEntries, toastError]);

  const handleDeleteConfirm = useCallback(async (deleteType: 'single' | 'regular') => {
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
  }, [deletingEntry, success, refreshEntries, toastError]);

  const handleRemoveTeacherConfirm = useCallback(async () => {
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
  }, [removeTeacherConfirm, entries, success, refreshEntries, toastError]);

  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';
  if (authLoading || !profile) {
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
        <ScheduleToolbar
          weekStart={weekStart}
          weekStartStr={weekStartStr}
          schoolId={schoolId ?? ''}
          visibleDaysOfWeek={visibleDaysOfWeek}
          koushuList={koushuList}
          selectedKoushu={selectedKoushu}
          onWeekChange={setWeekStart}
          onSettingsOpen={() => setScheduleSettingsOpen(true)}
          onVisibleDaysChange={setVisibleDaysPersist}
          onKoushuSelect={handleKoushuSelect}
        />

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
                <CardContent className="schedule-print pt-6">
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
                      entries={displayEntries}
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
                      getKoushuInfo={selectedKoushu ? getKoushuInfo : undefined}
                    />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <ScheduleDialogs
        schoolId={schoolId ?? ''}
        profileId={profile?.id}
        scheduleSettingsOpen={scheduleSettingsOpen}
        onScheduleSettingsChange={setScheduleSettingsOpen}
        onScheduleGenerateOpen={() => setScheduleGenerateConfirmOpen(true)}
        scheduleGenerateConfirmOpen={scheduleGenerateConfirmOpen}
        onScheduleGenerateConfirmChange={setScheduleGenerateConfirmOpen}
        scheduleGenerateLoading={scheduleGenerateLoading}
        scheduleGenerateHasExisting={scheduleGenerateHasExisting}
        onScheduleGenerateConfirm={handleScheduleGenerateConfirm}
        actionModalEntry={actionModalEntry}
        onActionModalClose={() => setActionModalEntry(null)}
        timeSlots={timeSlots}
        onTransferFromAction={handleTransferFromAction}
        onRevertTransfer={handleRevertTransfer}
        onAbsentFromAction={handleAbsentFromAction}
        onEditClick={handleEditClick}
        onDeleteClick={handleDeleteClick}
        onStudentClickFromAction={handleStudentClickFromAction}
        onTeacherClickFromAction={handleTeacherClickFromAction}
        studentDetailStudent={studentDetailStudent}
        onStudentDetailClose={() => setStudentDetailStudent(null)}
        addTeacherModalOpen={addTeacherModalOpen}
        onAddTeacherClose={() => {
          setAddTeacherModalOpen(false);
          setAddTeacherTarget(null);
        }}
        teachers={teachers}
        addTeacherExistingIds={addTeacherTarget?.existingTeacherIds ?? []}
        onAddTeacherSelect={handleAddTeacherSelect}
        editModalOpen={editModalOpen}
        onEditModalClose={() => {
          setEditModalOpen(false);
          setEditingEntry(null);
        }}
        editingEntry={editingEntry}
        students={students}
        subjects={subjects}
        onEditSave={handleEditSave}
        addTarget={addTarget}
        onAddTargetClose={() => {
          setAddModalOpen(false);
          setAddTarget(null);
        }}
        onAddSuccess={() => {
          refreshEntries();
          setAddTarget(null);
          setAddModalOpen(false);
        }}
        transferModalOpen={transferModalOpen}
        onTransferModalClose={() => {
          setTransferModalOpen(false);
          setTransferringEntry(null);
          setInitialTransferTarget(null);
        }}
        transferringEntry={transferringEntry}
        weekStartStr={weekStartStr}
        weekEndStr={weekEndStr}
        closedDates={closedDates}
        initialTransferTarget={initialTransferTarget}
        onTransfer={handleTransfer}
        teacherDetailOpen={teacherDetailOpen}
        onTeacherDetailClose={() => {
          setTeacherDetailOpen(false);
          setSelectedTeacher(null);
        }}
        selectedTeacher={selectedTeacher}
        deleteDialogOpen={deleteDialogOpen}
        onDeleteDialogClose={() => {
          setDeleteDialogOpen(false);
          setDeletingEntry(null);
        }}
        deletingEntry={deletingEntry}
        onDeleteConfirm={handleDeleteConfirm}
        removeTeacherConfirm={removeTeacherConfirm}
        onRemoveTeacherConfirmClose={() => setRemoveTeacherConfirm(null)}
        onRemoveTeacherConfirm={handleRemoveTeacherConfirm}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
