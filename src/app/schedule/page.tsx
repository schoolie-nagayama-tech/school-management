'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { ContextHelp } from '@/components/help/ContextHelp';
import { Button, Loading } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import dynamic from 'next/dynamic';

const WeeklyScheduleGrid = dynamic(
  () => import('@/components/schedule').then((m) => m.WeeklyScheduleGrid),
  { ssr: false }
);
const TransferModeBar = dynamic(
  () => import('@/components/schedule').then((m) => m.TransferModeBar),
  { ssr: false }
);
const ScheduleDailyPrintView = dynamic(
  () => import('@/components/schedule').then((m) => m.ScheduleDailyPrintView),
  { ssr: false }
);
const ScheduleToolbar = dynamic(
  () => import('@/components/schedule').then((m) => m.ScheduleToolbar),
  { ssr: false }
);
const ScheduleDialogs = dynamic(
  () => import('@/components/schedule').then((m) => m.ScheduleDialogs),
  { ssr: false }
);
const ScheduleDriftBanner = dynamic(
  () => import('@/components/schedule/ScheduleDriftBanner').then((m) => m.ScheduleDriftBanner),
  { ssr: false }
);
const BoothAssignmentModal = dynamic(
  () => import('@/components/schedule/BoothAssignmentModal').then((m) => m.BoothAssignmentModal),
  { ssr: false }
);
const PendingTransfersBoard = dynamic(
  () => import('@/components/schedule/PendingTransfersBoard').then((m) => m.PendingTransfersBoard),
  { ssr: false }
);
const KoushuControlPanel = dynamic(
  () => import('@/components/schedule/KoushuControlPanel').then((m) => m.KoushuControlPanel),
  { ssr: false }
);
const TestPrepPlacementPanel = dynamic(
  () => import('@/components/schedule/TestPrepPlacementPanel').then((m) => m.TestPrepPlacementPanel),
  { ssr: false }
);
const ScheduleLegend = dynamic(
  () => import('@/components/schedule/ScheduleLegend').then((m) => m.ScheduleLegend),
  { ssr: false }
);
const PlacementAvailabilityStrip = dynamic(
  () => import('@/components/schedule/PlacementAvailabilityStrip').then((m) => m.PlacementAvailabilityStrip),
  { ssr: false }
);
const GroupLaneGrid = dynamic(
  () => import('@/components/schedule/GroupLaneGrid').then((m) => m.GroupLaneGrid),
  { ssr: false }
);
const GroupKomaFormModal = dynamic(
  () => import('@/components/schedule/GroupKomaFormModal').then((m) => m.GroupKomaFormModal),
  { ssr: false }
);
import { fetchWithAuth } from '@/lib/api/auth';
import { useMasterData } from '@/contexts/MasterDataContext';
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
  getMonthlyTransferUsage,
} from '@/lib/api/schedule';
import { reassignTeacherFromToday } from '@/lib/api/pattern-matching';
import { logScheduleChange } from '@/lib/api/schedule-change-logs';
import type { ScheduleEntry, ScheduleEntryFormData, ScheduleTimeSlot, SchoolClassCapacityFormData } from '@/types/schedule';
import { getClassCapacity, DEFAULT_CLASS_CAPACITY } from '@/lib/api/school-class-capacity';
import type { School, Student, Subject } from '@/types/database';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { Clock, BookOpen, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';
import {
  getKoushuScheduledCounts,
  type KoushuEnrollment,
} from '@/lib/api/seasonalCourses';
import { getKoushuPeriods, type KoushuPeriodInfo } from '@/lib/api/koushu-period';
import {
  hasZoukomaForm,
  getZoukomaPlacementProgress,
  type ZoukomaAvailableSlot,
} from '@/lib/api/zoukoma-placement';
import type { ScheduleMatchProposal } from '@/types/schedule-match';

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
  const { schools: masterSchools, subjects: masterSubjects } = useMasterData();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolIdLocal, setSelectedSchoolIdLocal] = useState<string>('');
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [timeSlotsCount, setTimeSlotsCount] = useState(0);
  const [patternsCount, setPatternsCount] = useState(0);
  // 初期ロード完了フラグ：これが true になるまで「コマ時間未設定」「通塾日程未登録」のカードを抑制する。
  // count=0 のままだと初期描画で誤って未設定カードがチラつく問題を防ぐ。
  const [bootstrapped, setBootstrapped] = useState(false);
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
      /** D&D 制約チェックに使用 */
      gender?: 'male' | 'female' | 'other' | null;
    }>
  >([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [students, setStudents] = useState<Awaited<ReturnType<typeof getStudents>>>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const regularPatternsRef = useRef<Awaited<ReturnType<typeof getRegularPatterns>>>([]);

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
  // 担当未決定エントリに講師カードを D&D したときの確定待ち状態。
  // floating action bar で「このコマだけ」「毎週このコマ」のワンクリック選択を表示する。
  const [pendingAssignment, setPendingAssignment] = useState<{
    entryId: string;
    teacherId: string;
    teacherName: string;
    studentName: string;
    dateLabel: string;
    regularPatternId: string | null;
  } | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);

  // 振替上限超過時の確認待ち状態。
  // 「警告 → 一拍置く → もう一度で実行」フロー用。
  // null = 通常、{...} = 「もう一度クリックで実行」モード
  const [transferOverLimitConfirm, setTransferOverLimitConfirm] = useState<{
    entryId: string;
    targetDate: string;
    targetSlotId: string;
    targetTeacherId: string;
    studentName: string;
    usage: { limit: number; used: number; monthLabel: string };
  } | null>(null);
  const [emptyTeacherSlots, setEmptyTeacherSlots] = useState<Record<string, string[]>>({});
  // 通常シフトから「この曜日この時間帯に出勤可能」と提出した講師IDを byDayOfWeek で保持。
  // 各セル描画時に「曜日 → 出勤可能講師ID 一覧」を引いて空き枠として並べる。
  const [shiftByDow, setShiftByDow] = useState<Map<number, string[]>>(new Map());
  // 講師欠勤マップ（コマ単位）。キー: `${date}|${timeSlotId}|${userId}`
  const [absenceKeySet, setAbsenceKeySet] = useState<Set<string>>(new Set());
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
  // ブース番号設定モーダル：印刷時に講師名の隣に表示される番号を編集する
  const [boothAssignDate, setBoothAssignDate] = useState<string | null>(null);
  // 印刷ビューに渡す日次のブース番号マップ。印刷直前にフェッチして埋める
  const [printBoothMap, setPrintBoothMap] = useState<Map<string, Map<string, number>>>(new Map());

  // 講習配置モード
  //   placingKoushuStudent: 配置中の生徒情報（クリックで空きセルに講習コマを追加するモード）
  //   koushuPanelRefreshKey: 配置成功時にインクリメント→パネル側の残数を再フェッチ
  const [placingKoushuStudent, setPlacingKoushuStudent] = useState<{
    studentId: string;
    subjectIds: string[];
  } | null>(null);
  const [koushuPanelRefreshKey, setKoushuPanelRefreshKey] = useState(0);
  const [scheduleSettingsOpen, setScheduleSettingsOpen] = useState(false);
  const [scheduleGenerateConfirmOpen, setScheduleGenerateConfirmOpen] = useState(false);
  const [scheduleGenerateHasExisting, setScheduleGenerateHasExisting] = useState(false);
  const [scheduleGenerateLoading, setScheduleGenerateLoading] = useState(false);

  // ---- 講習モード ----
  // 講習選択は「course_prep_periods (春期/夏期/冬期 × 年)」ベース。
  // seasonal_courses は座席表とは独立した「生徒別プラン」を扱うテーブルなのでここでは使わない。
  const [koushuList, setKoushuList] = useState<KoushuPeriodInfo[]>([]);
  const [selectedKoushu, setSelectedKoushu] = useState<KoushuPeriodInfo | null>(null);
  const [koushuEnrollments, setKoushuEnrollments] = useState<Map<string, KoushuEnrollment>>(new Map());
  const [koushuScheduledCounts, setKoushuScheduledCounts] = useState<Map<string, number>>(new Map());
  // マッチングの下書き提案（座席表に★で重ねる用）
  const [koushuDraftProposals, setKoushuDraftProposals] = useState<ScheduleMatchProposal[]>([]);

  // ---- 追加授業（テスト対策）モード ----
  // 増コマ(zoukoma)フォーム回答を正典に、座席表へ test_prep コマを落とし込む。
  // 「期間」は意識せず、全申込を1つの一覧として扱う。講習モードと排他。
  const [hasTestPrep, setHasTestPrep] = useState(false); // 増コマフォームが設定済みか（モード表示の判定）
  const [testPrepActive, setTestPrepActive] = useState(false); // テスト対策モードON/OFF
  // 配置中の生徒・科目と、その生徒の通塾可能枠（座席表セル強調用）
  const [placingTestPrep, setPlacingTestPrep] = useState<{
    studentId: string;
    subjectId: string;
    subjectName: string;
    availableKeys: Set<string>;   // `${date}_${slotId}`（時限がコマに対応付いた枠）
    datesWithMapping: Set<string>; // 対応付いた枠を持つ日付
    availableDates: Set<string>;  // 通塾可能日（対応付け不可時の日単位フォールバック）
    /** ストリップ構築に使う生の利用可能スロット（buildTestPrepPlacementStrip に渡す） */
    rawSlots: import('@/lib/api/zoukoma-placement').ZoukomaAvailableSlot[];
  } | null>(null);
  const [zoukomaPanelRefreshKey, setZoukomaPanelRefreshKey] = useState(0);

  // ---- 配置ストリップ（出席可能日程ドットマトリクス） ----
  // 配置モード中（講習 / テスト対策）に生徒の出席可能日程をストリップ表示するためのデータ
  const [stripData, setStripData] = useState<import('@/lib/api/placement-availability').PlacementStripData | null>(null);
  const [stripLoading, setStripLoading] = useState(false);

  const router = useRouter();

  // 授業生徒数設定（個別の1講師あたり上限・教室座席数・集団上限）。schoolId 変更時に読み込み、未設定校は DEFAULT。
  const [capacity, setCapacity] = useState<SchoolClassCapacityFormData>(DEFAULT_CLASS_CAPACITY);

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
    // 講師欠勤マップを並行取得（座席表の講師カード欠勤表示用）
    void (async () => {
      try {
        const { getTeacherAbsences } = await import('@/lib/api/teacher-absences');
        const { keySet } = await getTeacherAbsences(schoolId, weekStartStr, weekEndStr);
        setAbsenceKeySet(keySet);
      } catch {
        /* noop: 欠勤取得失敗は座席表表示に影響させない */
      }
    })();
    try {
      const [initialList, closed] = await Promise.all([
        getScheduleEntries(schoolId, weekStartStr, weekEndStr),
        getClosedDays(schoolId, { from: weekStartStr, to: weekEndStr }),
      ]);
      let list = initialList;
      const patterns = regularPatternsRef.current;
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
            // transferred_out（振替元）も「枠は確保済み」とみなす。
            // これを除外すると振替済みの枠が「空き」判定になり、再生成で重複エントリが
            // 生まれ、振替を戻した時に同じ生徒が2件出るバグになる (N-4)。
            .filter(
              (e) =>
                e.status === 'scheduled' ||
                e.status === 'completed' ||
                e.status === 'transferred_out'
            )
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
    if (masterSchools.length > 0) {
      const ids = getSelectedSchoolIds();
      const filtered = ids.length > 0 ? masterSchools.filter((s) => ids.includes(s.id)) : masterSchools;
      setSchools(filtered);
      if (filtered.length > 0 && !selectedSchoolIdLocal) {
        setSelectedSchoolIdLocal(filtered[0].id);
      }
    }
  }, [masterSchools, getSelectedSchoolIds, selectedSchoolIdLocal]);

  useEffect(() => {
    if (!schoolId) return;
    setSubjects(masterSubjects);
    Promise.all([
      getActiveTimeSlots(schoolId),
      getRegularPatterns(schoolId),
      fetchWithAuth('/api/admin/users?role=teacher').then((r) => r.json()).then((d) => d.users || []),
    ])
      .then(([slots, patterns, users]) => {
        setTimeSlots(slots);
        setTimeSlotsCount(slots.length);
        setPatternsCount(patterns.length);
        regularPatternsRef.current = patterns;
        setTeachers(users);
      })
      .catch(() => {
        setTimeSlotsCount(0);
        setPatternsCount(0);
      })
      .finally(() => {
        setBootstrapped(true);
      });
  }, [schoolId, masterSubjects]);

  // 教室を切り替えた瞬間に古い「未設定」カードが出ないよう、school 変更時にフラグをリセット
  useEffect(() => {
    setBootstrapped(false);
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    getStudents(undefined, [schoolId]).then(setStudents).catch(() => setStudents([]));
  }, [schoolId]);

  // 「現在有効な講師の出勤可能曜日」を期間付きで取得。
  // - 第1優先: teacher_availability_periods (manual > regular_shift)
  // - フォールバック: 上記が空のときのみ生のシフト提出 (getCurrentTeacherShifts) で代用
  //   ※ period が未同期な過渡期データを取りこぼさないため
  useEffect(() => {
    if (!schoolId) {
      setShiftByDow(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { getAvailabilityDayMap } = await import('@/lib/api/teacher-availability');
        const asOf = weekStartStr;
        const { byDayOfWeek } = await getAvailabilityDayMap(schoolId, asOf);

        if (byDayOfWeek.size > 0) {
          if (!cancelled) setShiftByDow(byDayOfWeek);
          return;
        }
        // period が1件もなければ旧APIにフォールバック
        const { getCurrentTeacherShifts } = await import('@/lib/api/teacher-shifts');
        const fallback = await getCurrentTeacherShifts(schoolId, asOf);
        if (!cancelled) setShiftByDow(fallback.byDayOfWeek);
      } catch (e) {
        console.warn('Shift availability fetch failed:', e);
        if (!cancelled) setShiftByDow(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId, weekStartStr]);

  // 講習期間リストをロード（schoolId 変更時）
  // course_prep_periods から「設定済み（start/end あり）」を全部表示
  useEffect(() => {
    if (!schoolId) { setKoushuList([]); return; }
    getKoushuPeriods(schoolId).then(setKoushuList).catch(() => setKoushuList([]));
  }, [schoolId]);

  // 追加授業（テスト対策）モードを出すか：増コマフォームが設定済みかで判定（schoolId 変更時）
  useEffect(() => {
    if (!schoolId) { setHasTestPrep(false); return; }
    hasZoukomaForm(schoolId).then(setHasTestPrep).catch(() => setHasTestPrep(false));
  }, [schoolId]);

  // 授業生徒数設定をロード（schoolId 変更時）。失敗・未設定はデフォルト値で動かす。
  useEffect(() => {
    if (!schoolId) { setCapacity(DEFAULT_CLASS_CAPACITY); return; }
    getClassCapacity(schoolId)
      .then((c) => setCapacity(c ?? DEFAULT_CLASS_CAPACITY))
      .catch(() => setCapacity(DEFAULT_CLASS_CAPACITY));
  }, [schoolId]);

  // 講習期間選択時: 該当 season の全 seasonal_courses から enrollments を集約
  // 同生徒が複数コース申込なら koma_count を合算
  const handleKoushuSelect = useCallback(async (period: KoushuPeriodInfo | null) => {
    setSelectedKoushu(period);
    // 講習と追加授業（テスト対策）は排他。講習を選んだら追加授業モードを解除。
    if (period) {
      setTestPrepActive(false);
      setPlacingTestPrep(null);
    }
    if (!period) {
      setKoushuEnrollments(new Map());
      setKoushuScheduledCounts(new Map());
      setKoushuDraftProposals([]);
      return;
    }
    // 講習モードに入ったら期間内の週へジャンプ（今日が期間内なら今週、そうでなければ期間開始週）。
    // 通常授業の週（6月など）に居たまま講習配置しようとして「置けない」事故を防ぐ。
    {
      const todayJst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
      const jumpStr =
        todayJst >= period.schedule_start_date && todayJst <= period.schedule_end_date
          ? todayJst
          : period.schedule_start_date;
      setWeekStart(getWeekStart(new Date(jumpStr + 'T12:00:00')));
    }
    // 申込は期間(school + season)で直接取得（コース依存を廃止）。個別のみ座席表モード対象。
    const { getKoushuEnrollmentsForPeriod } = await import('@/lib/api/seasonalCourses');
    const all = await getKoushuEnrollmentsForPeriod(period.school_id, period.season);
    const enrollMap = new Map<string, KoushuEnrollment>();
    for (const e of all) {
      if (e.formation !== 'individual') continue;
      // (school, season, student, formation) は一意なので生徒ごとに1行
      enrollMap.set(e.student_id, e);
    }
    setKoushuEnrollments(enrollMap);

    if (enrollMap.size > 0) {
      const counts = await getKoushuScheduledCounts(
        schoolId,
        period.schedule_start_date,
        period.schedule_end_date,
        Array.from(enrollMap.keys()),
        'individual'
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

  // 配置ストリップデータの構築。配置モード切り替え・refreshKey 変更時に再取得。
  // 失敗しても座席表本体に影響しないよう、エラーは warn + null で飲み込む。
  useEffect(() => {
    if (!schoolId) { setStripData(null); return; }

    // 個別コマのスロット一覧（formation !== 'group'）。useMemo の individualSlots は
    // この useEffect より後で宣言されているため、timeSlots からインラインでフィルタする。
    const indivSlotList = timeSlots
      .filter((s) => s.formation !== 'group')
      .map((s) => ({
        id: s.id,
        slot_number: s.slot_number,
        start_time: s.start_time ?? '',
      }));

    // 講習配置モード
    if (placingKoushuStudent && selectedKoushu) {
      let cancelled = false;
      setStripLoading(true);
      import('@/lib/api/placement-availability').then(({ buildKoushuPlacementStrip }) =>
        buildKoushuPlacementStrip(
          schoolId,
          placingKoushuStudent.studentId,
          { schedule_start_date: selectedKoushu.schedule_start_date, schedule_end_date: selectedKoushu.schedule_end_date },
          indivSlotList
        )
      ).then((data) => {
        if (!cancelled) { setStripData(data); setStripLoading(false); }
      }).catch((e) => {
        console.warn('PlacementStrip build failed (koushu):', e);
        if (!cancelled) { setStripData(null); setStripLoading(false); }
      });
      return () => { cancelled = true; };
    }

    // テスト対策配置モード
    if (placingTestPrep) {
      let cancelled = false;
      setStripLoading(true);
      import('@/lib/api/placement-availability').then(({ buildTestPrepPlacementStrip }) =>
        buildTestPrepPlacementStrip(
          schoolId,
          placingTestPrep.studentId,
          placingTestPrep.rawSlots,
          indivSlotList
        )
      ).then((data) => {
        if (!cancelled) { setStripData(data); setStripLoading(false); }
      }).catch((e) => {
        console.warn('PlacementStrip build failed (test_prep):', e);
        if (!cancelled) { setStripData(null); setStripLoading(false); }
      });
      return () => { cancelled = true; };
    }

    // どちらでもなければ非表示
    setStripData(null);
  // koushuPanelRefreshKey / zoukomaPanelRefreshKey を依存に含め、配置成功後に再構築
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, placingKoushuStudent, placingTestPrep, selectedKoushu, timeSlots, koushuPanelRefreshKey, zoukomaPanelRefreshKey]);

  // NOTE: 以前は window focus / visibilitychange で自動 refreshEntries していたが、
  // 「定期的に再読み込みが入って描画が重い」というフィードバックを受けて撤去。
  // 他画面（マッチング等）の変更を取り込みたい場合は、ツールバーの「再取得」ボタンや
  // 週の切替で明示的にリロードする運用とする。

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

  const handleAddStudent = useCallback(
    async (date: string, slotId: string, teacherId: string) => {
      // 講習配置モード中なら通常モーダルではなく直接生成
      if (placingKoushuStudent && schoolId) {
        try {
          const { createScheduleEntry } = await import('@/lib/api/schedule');
          await createScheduleEntry(schoolId, date, slotId, {
            teacher_id: teacherId,
            student_id: placingKoushuStudent.studentId,
            subject_ids: placingKoushuStudent.subjectIds,
            seat_label: '',
            note: '',
            kind: 'koushu',
            formation: 'individual',
          });
          success('講習コマを配置しました');
          await refreshEntries();
          setKoushuPanelRefreshKey((k) => k + 1);
        } catch (e) {
          toastError(e instanceof Error ? e.message : '配置に失敗しました');
        }
        return;
      }
      // 通常モード：生徒選択モーダルを開く
      setAddTarget({ date, slotId, teacherId });
    },
    [placingKoushuStudent, schoolId, success, refreshEntries, toastError]
  );

  // ---- 集団コマの手動作成（Phase 3） ----
  const [groupKomaTarget, setGroupKomaTarget] = useState<{ date: string; slotId: string } | null>(null);

  const handleCreateGroupKoma = useCallback((date: string, slotId: string) => {
    setGroupKomaTarget({ date, slotId });
  }, []);

  // 集団コマを作成：選択生徒ごとに schedule_entries(kind='koushu', formation='group') を作る
  const handleSubmitGroupKoma = useCallback(
    async (data: { teacherId: string; subjectIds: string[]; studentIds: string[] }) => {
      if (!groupKomaTarget || !schoolId) return;
      const { createScheduleEntry } = await import('@/lib/api/schedule');
      for (const studentId of data.studentIds) {
        await createScheduleEntry(schoolId, groupKomaTarget.date, groupKomaTarget.slotId, {
          teacher_id: data.teacherId,
          student_id: studentId,
          subject_ids: data.subjectIds,
          seat_label: '',
          note: '',
          kind: 'koushu',
          formation: 'group',
        });
      }
      success('集団コマを作成しました');
      await refreshEntries();
      setKoushuPanelRefreshKey((k) => k + 1);
    },
    [groupKomaTarget, schoolId, success, refreshEntries]
  );

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

  /** 日付横の # アイコン: ブース番号設定モーダルを開く */
  const handleBoothAssign = useCallback((dateStr: string) => {
    setBoothAssignDate(dateStr);
  }, []);

  // 印刷日が決まったら、その日のブース割当をフェッチして印刷ビューに渡す。
  // 番号設定モーダルで保存→閉じた直後に印刷した場合も、最新値を取得して反映できる。
  useEffect(() => {
    if (!printDay || !schoolId) return;
    let cancelled = false;
    (async () => {
      try {
        const { getBoothNoMapForDate } = await import('@/lib/api/schedule-daily-booth');
        const map = await getBoothNoMapForDate(schoolId, printDay);
        if (!cancelled) {
          setPrintBoothMap((prev) => {
            const next = new Map(prev);
            next.set(printDay, map);
            return next;
          });
        }
      } catch (e) {
        // 取得失敗時は番号無しで印刷（後方互換）
        console.warn('Failed to fetch booth assignments for print:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [printDay, schoolId]);

  useEffect(() => {
    if (!printDay) return;
    const doPrint = () => {
      window.print();
    };
    const onAfterPrint = () => {
      setPrintDay(null);
    };
    // ブース番号フェッチが間に合うよう少し長めに待つ
    const t = setTimeout(doPrint, 300);
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

  // 講習モードの2レーン分割: 個別レーン=既存グリッド、集団レーン=GroupLaneGrid。
  // formation でコマ時間を分け、個別グリッドには個別コマだけ渡す（集団コマが個別グリッドに混ざらないように）。
  const individualSlots = useMemo(() => timeSlots.filter((t) => t.formation !== 'group'), [timeSlots]);
  const groupSlots = useMemo(() => timeSlots.filter((t) => t.formation === 'group'), [timeSlots]);
  // 集団の講習エントリ（個別申込フィルタとは独立に、期間内の集団コマを全部出す）
  const groupEntries = useMemo(
    () => entriesWithSubjects.filter((e) => e.kind === 'koushu' && e.formation === 'group'),
    [entriesWithSubjects]
  );

  // 下書き提案を「擬似エントリ」に変換して個別グリッドに重ねる（isDraft=true で★/破線表示）。
  const subjectById = useMemo(() => new Map(masterSubjects.map((s) => [s.id, s.name])), [masterSubjects]);
  const koushuDraftEntries = useMemo<ScheduleEntry[]>(() => {
    if (!selectedKoushu) return [];
    return koushuDraftProposals
      .filter((p) => p.formation === 'individual')
      .map((p) => ({
        id: `draft-${p.id}`,
        school_id: p.school_id,
        entry_date: p.proposal_date,
        time_slot_id: p.time_slot_id,
        teacher_id: p.teacher_id,
        student_id: p.student_id,
        subject_ids: p.subject_ids,
        seat_label: null,
        regular_pattern_id: null,
        kind: 'koushu',
        formation: 'individual',
        attendance_status: null,
        status: 'scheduled',
        created_at: '',
        updated_at: '',
        student: p.student,
        teacher: p.teacher
          ? { id: p.teacher.id, display_name: p.teacher.display_name, email: p.teacher.email }
          : undefined,
        subjects: (p.subject_ids || [])
          .map((id) => (subjectById.has(id) ? { id, name: subjectById.get(id)! } : null))
          .filter((x): x is { id: string; name: string } => !!x),
        isDraft: true,
      }));
  }, [selectedKoushu, koushuDraftProposals, subjectById]);

  // 個別グリッドに渡すエントリ。講習モードでは下書き擬似エントリを重ねる。
  const individualGridEntries = useMemo(
    () => (selectedKoushu ? [...displayEntries, ...koushuDraftEntries] : displayEntries),
    [selectedKoushu, displayEntries, koushuDraftEntries]
  );

  // 講習の手動配置（落とし込み）：配置モード中、空きセルクリックで担当未決定の講習コマを作成。
  const handleKoushuPlace = useCallback(
    async (date: string, slotId: string) => {
      if (!placingKoushuStudent || !schoolId) return;
      if (closedDates.includes(date)) { toastError('休講日には配置できません'); return; }
      try {
        const { createKoushuPlacement } = await import('@/lib/api/schedule');
        await createKoushuPlacement(schoolId, date, slotId, placingKoushuStudent.studentId, placingKoushuStudent.subjectIds);
        success('講習コマを配置しました（担当未決定）');
        await refreshEntries();
        setKoushuPanelRefreshKey((k) => k + 1);
      } catch (e) {
        // なぜ配置できないかを明示（過去日付・時間重複など）
        toastError(e instanceof Error ? e.message : '配置できませんでした');
      }
    },
    [placingKoushuStudent, schoolId, closedDates, success, refreshEntries, toastError]
  );

  // 配置モード中の各セルの配置可否（緑=可 / 淡色=不可）。通塾可能表データが入れば生徒別に絞る余地あり。
  const getKoushuPlaceability = useCallback(
    (date: string, slotId: string): { ok: boolean; reason: string | null } => {
      if (!placingKoushuStudent) return { ok: false, reason: null };
      if (closedDates.includes(date)) return { ok: false, reason: '休講日' };
      const todayJst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
      if (date < todayJst) return { ok: false, reason: '過去の日付' };
      const sid = placingKoushuStudent.studentId;
      const dup = entriesWithSubjects.some(
        (e) => e.student_id === sid && e.entry_date === date && e.time_slot_id === slotId
          && e.status !== 'cancelled' && e.status !== 'transferred_out'
      );
      if (dup) return { ok: false, reason: 'この生徒は既にこのコマに配置済み' };
      return { ok: true, reason: null };
    },
    [placingKoushuStudent, closedDates, entriesWithSubjects]
  );

  // 配置モード中、講師カードをクリック→その講師で講習コマを配置（出勤可能講師カード=生徒0人含む）
  const handleKoushuPlaceWithTeacher = useCallback(
    async (date: string, slotId: string, teacherId: string) => {
      if (!placingKoushuStudent || !schoolId) return;
      if (closedDates.includes(date)) { toastError('休講日には配置できません'); return; }
      try {
        const { createKoushuPlacement } = await import('@/lib/api/schedule');
        await createKoushuPlacement(schoolId, date, slotId, placingKoushuStudent.studentId, placingKoushuStudent.subjectIds, teacherId);
        success('講習コマを配置しました');
        await refreshEntries();
        setKoushuPanelRefreshKey((k) => k + 1);
      } catch (e) {
        toastError(e instanceof Error ? e.message : '配置できませんでした');
      }
    },
    [placingKoushuStudent, schoolId, closedDates, success, refreshEntries, toastError]
  );

  // ===== 追加授業（テスト対策）モード =====

  // 追加授業（テスト対策）モードのON/OFF。講習モードと排他。最初の通塾可能日へジャンプ。
  const handleTestPrepToggle = useCallback(async (active: boolean) => {
    setTestPrepActive(active);
    setPlacingTestPrep(null);
    if (!active) return;
    // 講習モードは解除
    setSelectedKoushu(null);
    setKoushuEnrollments(new Map());
    setKoushuScheduledCounts(new Map());
    setKoushuDraftProposals([]);
    // 申込（全期間）の最初の通塾可能日へジャンプ（今日が枠より前なら最初の枠週へ）
    try {
      const map = await getZoukomaPlacementProgress(schoolId, masterSubjects);
      const dates: string[] = [];
      Array.from(map.values()).forEach((r) => r.availableSlots.forEach((s) => dates.push(s.date)));
      if (dates.length > 0) {
        const todayJst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
        dates.sort();
        const jump = dates.find((d) => d >= todayJst) ?? dates[0];
        setWeekStart(getWeekStart(new Date(jump + 'T12:00:00')));
      }
    } catch {
      /* ジャンプ失敗は致命的でない */
    }
  }, [schoolId, masterSubjects]);

  // 配置モード開始：生徒の通塾可能枠を座席表コマ(time_slot)に対応付けて強調用セットを作る。
  const handleStartTestPrepPlacement = useCallback(
    (studentId: string, subjectId: string, subjectName: string, slots: ZoukomaAvailableSlot[]) => {
      // 同じ生徒・科目を再クリックでモード解除
      if (placingTestPrep?.studentId === studentId && placingTestPrep?.subjectId === subjectId) {
        setPlacingTestPrep(null);
        return;
      }
      // 個別コマの開始時刻(HH:MM)→slotId マップ
      const timeToSlotId = new Map<string, string>();
      for (const t of timeSlots) {
        if (t.formation === 'group') continue;
        if (t.start_time) timeToSlotId.set(t.start_time.slice(0, 5), t.id);
      }
      const availableKeys = new Set<string>();
      const datesWithMapping = new Set<string>();
      const availableDates = new Set<string>();
      for (const s of slots) {
        availableDates.add(s.date);
        const slotId = s.startTime ? timeToSlotId.get(s.startTime.slice(0, 5)) : undefined;
        if (slotId) {
          availableKeys.add(`${s.date}_${slotId}`);
          datesWithMapping.add(s.date);
        }
      }
      setPlacingTestPrep({ studentId, subjectId, subjectName, availableKeys, datesWithMapping, availableDates, rawSlots: slots });
    },
    [placingTestPrep, timeSlots]
  );

  // 配置モード中の各セルの配置可否（通塾可能枠か＝強調表示の判定）
  const getTestPrepPlaceability = useCallback(
    (date: string, slotId: string): { ok: boolean; reason: string | null } => {
      if (!placingTestPrep) return { ok: false, reason: null };
      if (closedDates.includes(date)) return { ok: false, reason: '休講日' };
      const todayJst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
      if (date < todayJst) return { ok: false, reason: '過去の日付' };
      // 通塾可能枠か：時限が対応付いた日は枠一致、対応付かない日は日単位で許可
      const okAvail = placingTestPrep.datesWithMapping.has(date)
        ? placingTestPrep.availableKeys.has(`${date}_${slotId}`)
        : placingTestPrep.availableDates.has(date);
      if (!okAvail) return { ok: false, reason: 'この生徒が通塾できる枠ではありません' };
      const sid = placingTestPrep.studentId;
      const dup = entriesWithSubjects.some(
        (e) => e.student_id === sid && e.entry_date === date && e.time_slot_id === slotId
          && e.status !== 'cancelled' && e.status !== 'transferred_out'
      );
      if (dup) return { ok: false, reason: 'この生徒は既にこのコマに配置済み' };
      return { ok: true, reason: null };
    },
    [placingTestPrep, closedDates, entriesWithSubjects]
  );

  // 空きセルクリックで test_prep コマを配置（担当未決定）
  const handleTestPrepPlace = useCallback(
    async (date: string, slotId: string) => {
      if (!placingTestPrep || !schoolId) return;
      if (closedDates.includes(date)) { toastError('休講日には配置できません'); return; }
      try {
        const { createTestPrepPlacement } = await import('@/lib/api/schedule');
        await createTestPrepPlacement(schoolId, date, slotId, placingTestPrep.studentId, [placingTestPrep.subjectId]);
        success('テスト対策コマを配置しました（担当未決定）');
        await refreshEntries();
        setZoukomaPanelRefreshKey((k) => k + 1);
      } catch (e) {
        toastError(e instanceof Error ? e.message : '配置できませんでした');
      }
    },
    [placingTestPrep, schoolId, closedDates, success, refreshEntries, toastError]
  );

  // 講師カードクリックでその講師の test_prep コマを配置
  const handleTestPrepPlaceWithTeacher = useCallback(
    async (date: string, slotId: string, teacherId: string) => {
      if (!placingTestPrep || !schoolId) return;
      if (closedDates.includes(date)) { toastError('休講日には配置できません'); return; }
      try {
        const { createTestPrepPlacement } = await import('@/lib/api/schedule');
        await createTestPrepPlacement(schoolId, date, slotId, placingTestPrep.studentId, [placingTestPrep.subjectId], teacherId);
        success('テスト対策コマを配置しました');
        await refreshEntries();
        setZoukomaPanelRefreshKey((k) => k + 1);
      } catch (e) {
        toastError(e instanceof Error ? e.message : '配置できませんでした');
      }
    },
    [placingTestPrep, schoolId, closedDates, success, refreshEntries, toastError]
  );

  // 座席表グリッドへ渡す「配置モード」プロップは講習/テスト対策を一本化（排他なのでどちらか有効）
  const gridPlacing = !!placingKoushuStudent || !!placingTestPrep;
  const gridGetPlaceability = placingTestPrep ? getTestPrepPlaceability : getKoushuPlaceability;
  const gridPlace = placingTestPrep ? handleTestPrepPlace : handleKoushuPlace;
  const gridPlaceWithTeacher = placingTestPrep ? handleTestPrepPlaceWithTeacher : handleKoushuPlaceWithTeacher;

  // 週移動（座席表の左右端の縦長アイコンからも操作できるように）
  const goPrevWeek = useCallback(() => {
    setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
  }, []);
  const goNextWeek = useCallback(() => {
    setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });
  }, []);

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
          await logScheduleChange({
            school_id: schoolId,
            actor_user_id: profile?.id ?? null,
            action_type: 'transfer_revert',
            entry_id: entry.id,
            student_id: entry.student_id,
            before_teacher_id: entry.teacher_id ?? null,
            after_teacher_id: null,
            affected_date: entry.entry_date,
            affected_slot_id: entry.time_slot_id,
            description: '振替を取消',
          });
          success('元の授業に戻しました');
          refreshEntries();
          return;
        }
      }
      // 同日・同時間帯 → 移動（振替ではない）
      const isSameSlot =
        entry.entry_date === targetDate && entry.time_slot_id === targetSlotId;
      if (isSameSlot) {
        // 【未定 → 講師確定】の D&D は「このコマだけ / 毎週このコマ」を確認する。
        // 即時 moveScheduleEntry で write してしまうと「今後ずっと続くのか今回だけか」
        // が分からないまま固定化される事故が起きるため、必ず確認 floating bar 経由にする。
        if (!entry.teacher_id && targetTeacherId) {
          const teacher = teachers.find((t) => t.id === targetTeacherId);
          if (teacher) {
            const studentName = entry.student
              ? `${entry.student.last_name ?? ''}${entry.student.first_name ?? ''}`.trim() || '生徒'
              : '生徒';
            const slot = timeSlots.find((s) => s.id === targetSlotId);
            const slotLabel = slot ? `${slot.slot_number}限` : '';
            const dateLabel = `${targetDate.slice(5).replace('-', '/')} ${slotLabel}`;
            setPendingAssignment({
              entryId: entry.id,
              teacherId: targetTeacherId,
              teacherName: teacher.display_name || teacher.email || '講師',
              studentName,
              dateLabel,
              regularPatternId: entry.regular_pattern_id ?? null,
            });
            return;
          }
        }
        await moveScheduleEntry(entry.id, targetDate, targetSlotId, targetTeacherId);
        await logScheduleChange({
          school_id: schoolId,
          actor_user_id: profile?.id ?? null,
          action_type: 'entry_reassign',
          entry_id: entry.id,
          student_id: entry.student_id,
          before_teacher_id: entry.teacher_id ?? null,
          after_teacher_id: targetTeacherId,
          affected_date: targetDate,
          affected_slot_id: targetSlotId,
          description: '同日内の担当講師を変更（移動）',
        });
        success('授業を移動しました');
        refreshEntries();
        return;
      }
      // 別日または別コマ → 振替
      // 月内振替上限を事前チェック。上限以上に達してたら確認モードへ。
      // 「警告 → もう一度クリックで実行」フロー (transferOverLimitConfirm が立つ)。
      const isAlreadyConfirmed =
        transferOverLimitConfirm?.entryId === entry.id &&
        transferOverLimitConfirm?.targetDate === targetDate &&
        transferOverLimitConfirm?.targetSlotId === targetSlotId &&
        transferOverLimitConfirm?.targetTeacherId === targetTeacherId;
      if (!isAlreadyConfirmed) {
        const usage = await getMonthlyTransferUsage(entry.student_id, entry.entry_date);
        if (usage.used >= usage.limit) {
          const studentName = entry.student
            ? `${entry.student.last_name ?? ''}${entry.student.first_name ?? ''}`.trim() || '生徒'
            : '生徒';
          setTransferOverLimitConfirm({
            entryId: entry.id,
            targetDate,
            targetSlotId,
            targetTeacherId,
            studentName,
            usage,
          });
          toastError(
            `${studentName} は ${usage.monthLabel} の振替が ${usage.used}/${usage.limit} 件で既に上限。もう一度ドラッグすれば例外で登録できます`
          );
          return;
        }
      }
      await createTransferEntry(
        schoolId,
        entry.id,
        targetDate,
        targetSlotId,
        targetTeacherId,
        null
      );
      await logScheduleChange({
        school_id: schoolId,
        actor_user_id: profile?.id ?? null,
        action_type: 'transfer_create',
        entry_id: entry.id,
        student_id: entry.student_id,
        before_teacher_id: entry.teacher_id ?? null,
        after_teacher_id: targetTeacherId,
        affected_date: entry.entry_date,
        affected_slot_id: entry.time_slot_id,
        description: `${entry.entry_date} → ${targetDate} へ振替`,
      });
      success('振替を登録しました');
      setTransferOverLimitConfirm(null);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
    }
  }, [entriesWithSubjects, entries, schoolId, success, refreshEntries, toastError, teachers, timeSlots, transferOverLimitConfirm, profile?.id]);

  // 出勤可能講師カードを担当未決定エントリにD&Dしたとき：
  // - 即時には確定せず、画面下に「このコマだけ / 毎週このコマ」の選択バーを出す
  // - 選択でハードな更新（DB書き込み）に進む
  const handleTeacherDropOnUnassigned = useCallback(
    (params: { teacherId: string; entryId: string; date: string; slotId: string }) => {
      const entry = entriesWithSubjects.find((e) => e.id === params.entryId);
      if (!entry) return;
      const teacher = teachers.find((t) => t.id === params.teacherId);
      if (!teacher) return;
      const studentName = entry.student
        ? `${entry.student.last_name ?? ''}${entry.student.first_name ?? ''}`.trim() || '生徒'
        : '生徒';
      const slot = timeSlots.find((s) => s.id === params.slotId);
      const slotLabel = slot ? `${slot.slot_number}限` : '';
      const dateLabel = `${params.date.slice(5).replace('-', '/')} ${slotLabel}`;
      setPendingAssignment({
        entryId: params.entryId,
        teacherId: params.teacherId,
        teacherName: teacher.display_name || teacher.email || '講師',
        studentName,
        dateLabel,
        regularPatternId: (entry as ScheduleEntry).regular_pattern_id ?? null,
      });
    },
    [entriesWithSubjects, teachers, timeSlots]
  );

  // 「このコマだけ」: schedule_entries 1行だけ teacher_id を埋める
  const confirmAssignTransient = useCallback(async () => {
    if (!pendingAssignment) return;
    setIsAssigning(true);
    try {
      const beforeEntry = entriesWithSubjects.find((e) => e.id === pendingAssignment.entryId);
      await updateScheduleEntry(pendingAssignment.entryId, {
        teacher_id: pendingAssignment.teacherId,
      });
      // 履歴ログ：このコマだけ割当 / 担当変更
      if (schoolId && beforeEntry) {
        await logScheduleChange({
          school_id: schoolId,
          actor_user_id: profile?.id ?? null,
          action_type: beforeEntry.teacher_id ? 'entry_reassign' : 'entry_assign',
          entry_id: pendingAssignment.entryId,
          student_id: beforeEntry.student_id,
          before_teacher_id: beforeEntry.teacher_id ?? null,
          after_teacher_id: pendingAssignment.teacherId,
          affected_date: beforeEntry.entry_date,
          affected_slot_id: beforeEntry.time_slot_id,
          description: `${pendingAssignment.dateLabel} のみ ${pendingAssignment.teacherName} に割当`,
        });
      }
      success(`${pendingAssignment.dateLabel}のみ ${pendingAssignment.teacherName} に割当`);
      setPendingAssignment(null);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
      // 書き込みが実際には成功している場合（一過性の通信エラー等）に備え、画面を実DBと同期させる。
      // これにより「エラーは出たが座席に入っていない」状態が残らない。
      setPendingAssignment(null);
      refreshEntries();
    } finally {
      setIsAssigning(false);
    }
  }, [pendingAssignment, success, toastError, refreshEntries, entriesWithSubjects, schoolId, profile?.id]);

  // 「毎週このコマ」: 通塾日程パターンと未来エントリを一括更新
  const confirmAssignPermanent = useCallback(async () => {
    if (!pendingAssignment) return;
    if (!pendingAssignment.regularPatternId) {
      // パターン紐付き無し → 「このコマだけ」と同等動作にフォールバック
      await confirmAssignTransient();
      return;
    }
    setIsAssigning(true);
    try {
      const beforeEntry = entriesWithSubjects.find((e) => e.id === pendingAssignment.entryId);
      // 期間概念を活かした割当：未配置は単純上書き、A→B 変更は当日から期間分割。
      const result = await reassignTeacherFromToday(
        pendingAssignment.regularPatternId,
        pendingAssignment.teacherId,
        schoolId!
      );
      // 当日漏れ防止：ドロップ対象エントリ自体を確実に直接更新する。
      // （split 時は新パターンに付け替え済みだが、念のため teacher_id を確実化）
      await updateScheduleEntry(pendingAssignment.entryId, {
        teacher_id: pendingAssignment.teacherId,
      });
      // 履歴ログ：パターン割当（恒久）
      if (schoolId && beforeEntry) {
        await logScheduleChange({
          school_id: schoolId,
          actor_user_id: profile?.id ?? null,
          action_type: 'pattern_assign',
          pattern_id: pendingAssignment.regularPatternId,
          entry_id: pendingAssignment.entryId,
          student_id: beforeEntry.student_id,
          before_teacher_id: beforeEntry.teacher_id ?? null,
          after_teacher_id: pendingAssignment.teacherId,
          affected_date: beforeEntry.entry_date,
          affected_slot_id: beforeEntry.time_slot_id,
          description: `毎週このコマを ${pendingAssignment.teacherName} に割当（${result.entriesUpdated}件のコマも更新）`,
        });
      }
      success(
        `${pendingAssignment.studentName} の毎週分に ${pendingAssignment.teacherName} を割当（${result.entriesUpdated}件のコマも更新）`
      );
      setPendingAssignment(null);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
      // 書き込みが実際には成功している場合に備え、画面を実DBと同期させる
      setPendingAssignment(null);
      refreshEntries();
    } finally {
      setIsAssigning(false);
    }
  }, [pendingAssignment, success, toastError, refreshEntries, confirmAssignTransient, entriesWithSubjects, schoolId, profile?.id]);

  // 講師欠勤トグル（コマ単位）。欠勤なら解除、出勤なら欠勤登録。生徒は触らない。
  const handleToggleAbsence = useCallback(
    async (date: string, slotId: string, teacherId: string) => {
      if (!schoolId) return;
      const { markTeacherAbsent, unmarkTeacherAbsent, absenceKey } = await import(
        '@/lib/api/teacher-absences'
      );
      const key = absenceKey(date, slotId, teacherId);
      const isAbsent = absenceKeySet.has(key);
      try {
        if (isAbsent) {
          await unmarkTeacherAbsent(teacherId, date, slotId);
          setAbsenceKeySet((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          success('出勤に戻しました');
        } else {
          await markTeacherAbsent({
            schoolId,
            userId: teacherId,
            date,
            timeSlotId: slotId,
            createdBy: profile?.id ?? null,
          });
          setAbsenceKeySet((prev) => new Set(prev).add(key));
          success('欠勤として登録しました');
        }
      } catch (e) {
        toastError((e as Error).message);
      }
    },
    [schoolId, absenceKeySet, profile?.id, success, toastError]
  );

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
      // 削除後もこの講師を「出勤可能・授業なし」のグレーカードとして残す。
      // entries から消えるとカードごと消えてしまうため、emptyTeacherSlots に明示追加して
      // isAvailableOnly 表示（グレーアウト）を維持する。
      const cellKey = `${date}-${slotId}`;
      setEmptyTeacherSlots((prev) => {
        const next = { ...prev };
        const arr = next[cellKey] ?? [];
        if (!arr.includes(teacherId)) next[cellKey] = [...arr, teacherId];
        return next;
      });
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
        <Loading size="md" />
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

  // 右上の入口ボタン（講習モード切替・報告書）
  // 「講習」は座席表内の講習モードを ON/OFF するトグル。
  //  - 講習期間あり: 最初の期間を選択して座席表を講習モードに（選択中なら解除）
  //  - 講習期間なし: 講習管理ページ (/schedule/koushu) へ誘導してまず期間を作ってもらう
  // 講習モードはツールバーの「講習:」セレクトから入る（上部のトグルボタンは廃止）。
  const headerActions = (
    <div className="flex items-center gap-2">
      <Link
        href="/lesson-reports/sample"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border-default rounded-lg bg-white text-text-body hover:bg-surface hover:border-info/40 hover:text-info transition-colors"
        title="授業報告書の見本（ダミー）を開く"
      >
        <FileText className="w-3.5 h-3.5" />
        報告書見本
      </Link>
    </div>
  );

  return (
    <AdminLayout headerTitle="座席表" actions={headerActions}>
      <div className="space-y-6">
        {/* コンテキストヘルプ */}
        <div className="flex justify-end -mb-4">
          <ContextHelp
            searchQuery="座席表"
            topics={[
              {
                title: '座席表の見方',
                description: '日付ごとの時間帯×座席マスを表示します。',
                steps: [
                  '週カレンダーで表示週を切替',
                  '各マスをクリックして生徒を配置',
                  '講習フィルタで講習コマのみ表示も可能',
                ],
              },
              {
                title: '生徒をコマに配置する',
                description: '空きマスに生徒を割り当てます。',
                steps: [
                  '空いているマスをクリック',
                  '生徒選択ダイアログから生徒を選ぶ',
                  '教科を選択して配置を確定',
                ],
              },
              {
                title: '時間帯を設定する',
                description: 'コマの開始・終了時間を管理します。',
                steps: [
                  '「設定」→「コマ時間設定」ページを開く',
                  '時間帯の追加・編集・削除を実行',
                ],
              },
            ]}
          />
        </div>

        {selectedSchoolId === 'all' && (
          <SchoolSwitcher
            schools={schools}
            selectedSchoolId={selectedSchoolIdLocal}
            onChange={setSelectedSchoolIdLocal}
          />
        )}
        <ScheduleToolbar
          weekStart={weekStart}
          weekStartStr={weekStartStr}
          schoolId={schoolId ?? ''}
          visibleDaysOfWeek={visibleDaysOfWeek}
          koushuList={koushuList}
          selectedKoushu={selectedKoushu}
          hasTestPrep={hasTestPrep}
          testPrepActive={testPrepActive}
          onWeekChange={setWeekStart}
          onSettingsOpen={() => setScheduleSettingsOpen(true)}
          onVisibleDaysChange={setVisibleDaysPersist}
          onKoushuSelect={handleKoushuSelect}
          onTestPrepToggle={handleTestPrepToggle}
        />

        {schoolId && (
          <ScheduleDriftBanner
            schoolId={schoolId}
            userId={profile?.id}
            onResynced={refreshEntries}
          />
        )}

        {/* 担当未決定エントリのサマリ：未配置の合計数 + 一括マッチング画面への導線。
            実際の未配置生徒は各 DayCell の下部にミニチップで表示されるので、
            ここは「全体の進捗」と「機械的に決めたい場合の導線」だけ */}
        {(() => {
          const unassignedCount = displayEntries.filter(
            (e) => !e.teacher_id && e.status !== 'cancelled' && e.status !== 'transferred_out'
          ).length;
          if (unassignedCount === 0) return null;
          return (
            <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-warning-subtle/40 border border-warning/30 text-xs print:hidden">
              <span className="text-warning font-semibold flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
                今週の未配置: {unassignedCount} コマ
              </span>
              <span className="text-text-muted">
                各コマ下部のチップを上の講師カードへドラッグして割当
              </span>
              <Link
                href="/schedule/regular-patterns/match"
                className="ml-auto text-info hover:underline font-semibold"
              >
                一括マッチング画面で機械的に決める →
              </Link>
            </div>
          );
        })()}

        {/* 座席表の凡例（バッジ・色の意味）。折りたたみ式。 */}
        <ScheduleLegend />

        {/* 講習選択中はコントロールパネルを表示（マッチング・下書き公開・配置進捗を集約）。
            空きセルクリックで講習コマを追加できる「配置モード」も内包。 */}
        {selectedKoushu && (
          <KoushuControlPanel
            period={selectedKoushu}
            schoolId={schoolId ?? ''}
            executedBy={profile?.id ?? ''}
            onStartPlacement={(studentId, subjectIds) => {
              // 同じ生徒を再クリックでモード解除
              if (placingKoushuStudent?.studentId === studentId) {
                setPlacingKoushuStudent(null);
              } else {
                setPlacingKoushuStudent({ studentId, subjectIds });
              }
            }}
            placingStudentId={placingKoushuStudent?.studentId ?? null}
            placingSubjectId={placingKoushuStudent?.subjectIds?.[0] ?? null}
            subjectNameById={subjectById}
            refreshKey={koushuPanelRefreshKey}
            showGroupProgress={groupSlots.length > 0}
            onDraftsChange={setKoushuDraftProposals}
            onPublished={() => {
              refreshEntries();
              setKoushuPanelRefreshKey((k) => k + 1);
            }}
            onClose={() => {
              setPlacingKoushuStudent(null);
              handleKoushuSelect(null);
            }}
          />
        )}

        {/* 追加授業（テスト対策）モード：増コマ申込（全期間まとめて）の配置パネルを上部に表示。
            生徒の通塾できる枠（増コマフォーム由来）をクリックで test_prep コマを落とし込む。 */}
        {testPrepActive && (
          <TestPrepPlacementPanel
            schoolId={schoolId ?? ''}
            subjects={masterSubjects}
            onStartPlacement={handleStartTestPrepPlacement}
            placingStudentId={placingTestPrep?.studentId ?? null}
            placingSubjectId={placingTestPrep?.subjectId ?? null}
            refreshKey={zoukomaPanelRefreshKey}
            onClose={() => {
              setPlacingTestPrep(null);
              handleTestPrepToggle(false);
            }}
          />
        )}

        {/* 配置モード中: 生徒の出席可能日程をドットマトリクスで表示。
            日付クリックで座席表をその週へジャンプ。講習/テスト対策の両モードに対応。 */}
        {(placingKoushuStudent || placingTestPrep) && (
          <PlacementAvailabilityStrip
            data={stripData}
            loading={stripLoading}
            studentName={(() => {
              const sid = placingKoushuStudent?.studentId ?? placingTestPrep?.studentId ?? '';
              const s = students.find((st) => st.id === sid);
              return s ? `${s.last_name ?? ''} ${s.first_name ?? ''}`.trim() : '';
            })()}
            subjectName={(() => {
              if (placingKoushuStudent) {
                const subId = placingKoushuStudent.subjectIds?.[0];
                return subId ? (subjectById.get(subId) ?? '') : '';
              }
              return placingTestPrep?.subjectName ?? '';
            })()}
            weekStartStr={weekStartStr}
            onDayClick={(date) => setWeekStart(getWeekStart(new Date(date + 'T12:00:00')))}
          />
        )}

        {/* 振替期限切れ間近の督促ボード。
            0件のときは内部で何も描画しないので、空ボードでスペースを食わない */}
        {schoolId && (
          <PendingTransfersBoard
            schoolIds={[schoolId]}
            onSelectEntry={(entry) => {
              // 振替元のあった日付に飛ぶ。週単位で扱う必要があるため、その週の月曜にジャンプ。
              const d = new Date(entry.entry_date + 'T12:00:00');
              const dow = d.getDay();
              const diff = (dow + 6) % 7; // 月曜=0 になるオフセット
              const monday = new Date(d);
              monday.setDate(d.getDate() - diff);
              setWeekStart(monday);
            }}
          />
        )}

        {!schoolId ? (
          <Card>
            <CardContent className="py-8 text-center text-[var(--paragraph)]">
              教室を選択してください。
            </CardContent>
          </Card>
        ) : (
          <>
            {bootstrapped && timeSlotsCount === 0 && (
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
                  <Link href="/settings/time-slots">
                    <Button>コマ時間設定へ</Button>
                  </Link>
                </CardContent>
              </Card>
            )}

            {bootstrapped && timeSlotsCount > 0 && patternsCount === 0 && (
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
                        boothMapByDate={printBoothMap}
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
                    <Loading size="md" />
                  ) : (
                    <div className="print:hidden relative">
                    {/* 左右端の縦長 週移動アイコン。
                        fixed で画面（ビューポート）の縦中央に固定し、スクロールしても
                        常に同じ位置に追従する（長い座席表でもどこからでも週を変えられる）。 */}
                    <button
                      type="button"
                      onClick={goPrevWeek}
                      aria-label="前週へ"
                      title="前週へ"
                      className="fixed left-1 top-1/2 -translate-y-1/2 z-40 w-7 hover:w-12 h-40 flex items-center justify-center rounded-lg bg-white/90 hover:bg-white border border-border-default text-text-muted shadow-md hover:shadow-lg hover:text-text-body transition-all duration-150 print:hidden"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={goNextWeek}
                      aria-label="次週へ"
                      title="次週へ"
                      className="fixed right-1 top-1/2 -translate-y-1/2 z-40 w-7 hover:w-12 h-40 flex items-center justify-center rounded-lg bg-white/90 hover:bg-white border border-border-default text-text-muted shadow-md hover:shadow-lg hover:text-text-body transition-all duration-150 print:hidden"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                    <WeeklyScheduleGrid
                      schoolId={schoolId ?? ''}
                      weekDates={weekDates}
                      timeSlots={selectedKoushu ? individualSlots : timeSlots}
                      entries={individualGridEntries}
                      closedDates={closedDates}
                      teachers={teachers}
                      emptyTeacherSlots={emptyTeacherSlots}
                      shiftAvailableByDow={shiftByDow}
                      maxStudentsPerTeacher={capacity.max_students_per_teacher_individual}
                      transferMode={transferMode}
                      onEmptyTeacherSlotsChange={setEmptyTeacherSlots}
                      onAddTeacher={handleAddTeacher}
                      onAddStudent={handleAddStudent}
                      onRemoveTeacher={handleRemoveTeacher}
                      onStudentClick={handleEntryClick}
                      onTransferClick={handleTransferClickFromCard}
                      onTeacherCardMove={handleTeacherCardMove}
                      onStudentEntryDrop={handleStudentEntryDrop}
                      onTeacherDropOnUnassigned={handleTeacherDropOnUnassigned}
                      onConstraintViolation={(reason) => toastError(reason)}
                      subjectNameById={new Map(masterSubjects.map((s) => [s.id, s.name]))}
                      absenceKeySet={absenceKeySet}
                      onToggleAbsence={handleToggleAbsence}
                      onTransferTargetClick={handleTransferTargetClick}
                      onPrintDay={handlePrintDay}
                      onBoothAssign={handleBoothAssign}
                      onTransferCancel={() => setTransferMode(null)}
                      getKoushuInfo={selectedKoushu ? getKoushuInfo : undefined}
                      koushuPlacing={gridPlacing}
                      getKoushuPlaceability={gridGetPlaceability}
                      onKoushuPlace={gridPlace}
                      onKoushuPlaceWithTeacher={gridPlaceWithTeacher}
                    />
                    {/* 集団レーン（講習モードかつ集団コマ時間がある場合のみ）。集団は手動編成。 */}
                    {selectedKoushu && groupSlots.length > 0 && (
                      <GroupLaneGrid
                        weekDates={weekDates}
                        groupSlots={groupSlots}
                        entries={groupEntries}
                        maxStudentsPerGroup={capacity.max_students_per_group}
                        maxConcurrentGroups={capacity.max_concurrent_groups}
                        closedDates={closedDates}
                        subjectNameById={new Map(masterSubjects.map((s) => [s.id, s.name]))}
                        onCreate={handleCreateGroupKoma}
                        onStudentClick={handleEntryClick}
                      />
                    )}
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

      {/* 日次ブース番号設定モーダル：印刷時に講師名の隣に番号を出すための事前設定 */}
      {boothAssignDate && schoolId && (
        <BoothAssignmentModal
          open={!!boothAssignDate}
          onClose={() => setBoothAssignDate(null)}
          schoolId={schoolId}
          date={boothAssignDate}
          entries={entriesWithSubjects}
          totalSeats={capacity.total_individual_seats}
          onSaved={() => {
            // 保存直後に印刷ビュー用のマップも更新しておく（即印刷ボタンを押されても反映される）
            if (boothAssignDate && schoolId) {
              import('@/lib/api/schedule-daily-booth').then(({ getBoothNoMapForDate }) => {
                getBoothNoMapForDate(schoolId, boothAssignDate).then((map) => {
                  setPrintBoothMap((prev) => {
                    const next = new Map(prev);
                    next.set(boothAssignDate, map);
                    return next;
                  });
                });
              });
            }
          }}
        />
      )}

      {/* 集団コマ作成モーダル（手動編成・Phase 3） */}
      {groupKomaTarget && (() => {
        const slot = groupSlots.find((s) => s.id === groupKomaTarget.slotId) ?? null;
        // 対象日の曜日に出勤可能な講師のみ提示
        const dow = new Date(groupKomaTarget.date + 'T12:00:00').getDay();
        const availIds = new Set(shiftByDow.get(dow) ?? []);
        const availableTeachers = teachers.filter((t) => availIds.has(t.id));
        return (
          <GroupKomaFormModal
            open={!!groupKomaTarget}
            onClose={() => setGroupKomaTarget(null)}
            schoolId={schoolId ?? ''}
            date={groupKomaTarget.date}
            slot={slot}
            subjects={masterSubjects}
            maxStudents={capacity.max_students_per_group}
            availableTeachers={availableTeachers}
            onSubmit={handleSubmitGroupKoma}
          />
        );
      })()}

      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* 担当未決定エントリへの講師D&D後の確定バー。
          このコマだけ / 毎週このコマ のワンクリック選択。 */}
      {pendingAssignment && (
        <div
          className="assign-bar-enter fixed left-1/2 bottom-6 -translate-x-1/2 z-50 print:hidden
                     bg-white border-2 border-info/40 rounded-2xl px-4 py-3
                     flex items-center gap-3 max-w-[min(640px,calc(100%-1.5rem))]"
          style={{ boxShadow: '0 20px 40px -12px rgba(0,0,0,0.35)' }}
          role="dialog"
          aria-label="担当の確定"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-info font-semibold">担当を割当しますか？</div>
            <div className="text-sm font-semibold text-gray-800 truncate">
              {pendingAssignment.studentName}
              <span className="mx-1.5 text-gray-300">→</span>
              <span className="text-info">{pendingAssignment.teacherName}</span>
              <span className="ml-2 text-xs font-normal text-gray-500">
                ({pendingAssignment.dateLabel})
              </span>
            </div>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={confirmAssignTransient}
              disabled={isAssigning}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              title="このコマだけ teacher_id を埋める（パターン未変更、翌週は再び未決定）"
            >
              このコマだけ
            </button>
            <button
              type="button"
              onClick={confirmAssignPermanent}
              disabled={isAssigning || !pendingAssignment.regularPatternId}
              className="px-3 py-1.5 text-xs rounded-lg bg-info text-white hover:bg-info/90 disabled:opacity-50 transition-colors font-semibold"
              title="通塾日程パターンに紐付け、未来のコマも一括更新"
            >
              毎週このコマ
            </button>
            <button
              type="button"
              onClick={() => setPendingAssignment(null)}
              disabled={isAssigning}
              className="px-2 py-1.5 text-xs rounded-lg text-gray-400 hover:text-gray-700 disabled:opacity-50 transition-colors"
              aria-label="キャンセル"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
