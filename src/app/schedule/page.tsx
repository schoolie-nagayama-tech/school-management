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
const SwapModeBar = dynamic(() => import('@/components/schedule').then((m) => m.SwapModeBar), {
  ssr: false,
});
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
// Phase P2: 振替の保留プール一覧（個別タブ・通常モード時に表示）。
const HeldTransfersPanel = dynamic(
  () => import('@/components/schedule/HeldTransfersPanel').then((m) => m.HeldTransfersPanel),
  { ssr: false }
);
// Phase P2: 汎用配置モード（振替保留の配置 / 授業追加の配置）中の上部ミニバナー。
const AdhocPlacementBar = dynamic(
  () => import('@/components/schedule/AdhocPlacementBar').then((m) => m.AdhocPlacementBar),
  { ssr: false }
);
const KoushuControlPanel = dynamic(
  () => import('@/components/schedule/KoushuControlPanel').then((m) => m.KoushuControlPanel),
  { ssr: false }
);
const TestPrepPlacementPanel = dynamic(
  () =>
    import('@/components/schedule/TestPrepPlacementPanel').then((m) => m.TestPrepPlacementPanel),
  { ssr: false }
);
const ScheduleLegend = dynamic(
  () => import('@/components/schedule/ScheduleLegend').then((m) => m.ScheduleLegend),
  { ssr: false }
);
const PlacementAvailabilityStrip = dynamic(
  () =>
    import('@/components/schedule/PlacementAvailabilityStrip').then(
      (m) => m.PlacementAvailabilityStrip
    ),
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
const FormationBoard = dynamic(
  () => import('@/components/schedule/FormationBoard').then((m) => m.FormationBoard),
  { ssr: false }
);
const FormationKomaFormModal = dynamic(
  () =>
    import('@/components/schedule/FormationKomaFormModal').then((m) => m.FormationKomaFormModal),
  { ssr: false }
);
// Phase T: ツールバー起点の「授業を追加」モーダル（追加授業・体験授業の単発コマ登録）。
const AddLessonModal = dynamic(
  () => import('@/components/schedule/AddLessonModal').then((m) => m.AddLessonModal),
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
  regenerateCurrentWeekIfNeeded,
  swapScheduleEntries,
} from '@/lib/api/schedule';
import { reassignTeacherFromToday } from '@/lib/api/pattern-matching';
import { markInquiryTrialScheduled } from '@/lib/api/inquiries';
import type { AddLessonPlacementPayload } from '@/components/schedule';
import type { HalfPosition } from '@/types/schedule';
import { canPlaceEntry, type SeatEntryInput } from '@/lib/utils/seatOccupancy';
import type { PendingLesson } from '@/lib/api/pending-lessons';
import { getFormations, getFormationCapacity } from '@/lib/api/schedule-formations';
import { createFormationClassPatterns } from '@/lib/api/formation-patterns';
import type { ScheduleFormation, SchoolFormationCapacity } from '@/types/schedule';
import { logScheduleChange } from '@/lib/api/schedule-change-logs';
import type {
  ScheduleEntry,
  ScheduleEntryFormData,
  ScheduleTimeSlot,
  SchoolClassCapacityFormData,
} from '@/types/schedule';
// Phase A: 形態キーの直書きを定数参照に置換（'individual'/'group' のタイポ検出代替）
import { INDIVIDUAL_FORMATION, GROUP_FORMATION } from '@/types/schedule';
import { getClassCapacity, DEFAULT_CLASS_CAPACITY } from '@/lib/api/school-class-capacity';
import type { School, Student, Subject } from '@/types/database';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { Clock, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';
import { getKoushuScheduledCounts, type KoushuEnrollment } from '@/lib/api/seasonalCourses';
import { getKoushuPeriods, type KoushuPeriodInfo } from '@/lib/api/koushu-period';
import {
  hasZoukomaForm,
  getZoukomaPlacementProgress,
  type ZoukomaAvailableSlot,
} from '@/lib/api/zoukoma-placement';
import type { ScheduleMatchProposal } from '@/types/schedule-match';
import {
  availableUserIdsForInterval,
  type AvailabilityDayMap,
} from '@/lib/api/teacher-availability';

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
      /** 姓（座席表ボードは密度優先で姓のみ表示） */
      last_name?: string | null;
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
  const [addTarget, setAddTarget] = useState<{
    date: string;
    slotId: string;
    teacherId: string;
  } | null>(null);
  const [addTeacherModalOpen, setAddTeacherModalOpen] = useState(false);
  const [addTeacherTarget, setAddTeacherTarget] = useState<{
    date: string;
    slotId: string;
    existingTeacherIds: string[];
  } | null>(null);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferringEntry, setTransferringEntry] = useState<ScheduleEntry | null>(null);
  const [initialTransferTarget, setInitialTransferTarget] = useState<{
    date: string;
    slotId: string;
  } | null>(null);
  const [transferMode, setTransferMode] = useState<{ sourceEntry: ScheduleEntry } | null>(null);
  // §2.12 生徒の入れ替えモード（同コマ・別講師の生徒Aを選択中）。候補クリックで teacher_id を交換。
  const [swapMode, setSwapMode] = useState<{ sourceEntry: ScheduleEntry } | null>(null);
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
  // 講師詳細モーダル用に、byDayOfWeek だけでなく在室区間(intervalsByDayAndUser)も保持する。
  // null = 未取得（読み込み中、または旧APIフォールバック時で区間データが無い）。
  const [availabilityMap, setAvailabilityMap] = useState<AvailabilityDayMap | null>(null);
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
  const [selectedTeacher, setSelectedTeacher] = useState<(typeof teachers)[0] | null>(null);
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
  // Phase T: 「授業を追加」モーダル（追加授業・体験授業の単発コマ登録）の開閉。
  const [addLessonOpen, setAddLessonOpen] = useState(false);

  // ---- Phase P2: 汎用配置モード（振替保留の配置 / 授業追加の座席表配置） ----
  // 講習(placingKoushuStudent)・テスト対策(placingTestPrep)とは独立した第3の配置ステート。
  // gridPlacing 等の三項連鎖に最優先分岐として合流する（既存2モードの挙動は不変）。
  const [placingAdhoc, setPlacingAdhoc] = useState<{
    /** transfer=保留振替の配置（1件で終了） / lesson=授業追加（連続配置） */
    mode: 'transfer' | 'lesson';
    /** バナー・重複チェックに使う対象者名 */
    displayName: string;
    /** バナー表示用の科目名（連結済み・空可） */
    subjectName: string;
    /** これまで登録したコマ数（lesson の連続配置カウント） */
    placedCount: number;
    /** 重複チェック対象の生徒ID（見込み客=inquiry のときは null＝チェックしない） */
    studentId: string | null;
    /** 重複判定から除外する自身のエントリID（振替元。lesson は null） */
    excludeEntryId: string | null;
    // --- transfer 用 ---
    fromEntryId?: string;
    /** 月内振替回数の判定に使う振替元の元日付 */
    sourceEntryDate?: string;
    // --- lesson 用 ---
    inquiryId?: string | null;
    subjectIds?: string[];
    kind?: 'additional' | 'trial';
    ratio?: 1 | 2;
    durationMinutes?: number | null;
    halfPosition?: HalfPosition;
    /** 体験×問合せの trial_at 連動を最初の1件だけ実行するためのフラグ */
    trialMarked?: boolean;
    /** P2改訂: 登録したいコマ数。達したら自動終了。lesson のみ（transfer は常に1件）。 */
    targetCount?: number | null;
    /** P2改訂: 未消化プール由来の再開のとき、その行ID（配置ごとに残数を減らし0で削除）。 */
    pendingLessonId?: string | null;
    // --- 講師カード配置可否（point 4）の判定材料。lesson/transfer 共通 ---
    /** 対象生徒の担当除外講師（見込み客は空）。 */
    excludedTeacherIds?: string[];
    /** 対象生徒の希望講師性別（見込み客は null）。 */
    preferredGender?: 'male' | 'female' | null;
  } | null>(null);
  // 保留プールパネルの再取得トリガ（保留追加・配置確定時にインクリメント）。
  const [heldRefreshKey, setHeldRefreshKey] = useState(0);
  const [scheduleSettingsOpen, setScheduleSettingsOpen] = useState(false);
  const [scheduleGenerateConfirmOpen, setScheduleGenerateConfirmOpen] = useState(false);
  const [scheduleGenerateHasExisting, setScheduleGenerateHasExisting] = useState(false);
  const [scheduleGenerateLoading, setScheduleGenerateLoading] = useState(false);

  // ---- 講習モード ----
  // 講習選択は「course_prep_periods (春期/夏期/冬期 × 年)」ベース。
  // seasonal_courses は座席表とは独立した「生徒別プラン」を扱うテーブルなのでここでは使わない。
  const [koushuList, setKoushuList] = useState<KoushuPeriodInfo[]>([]);
  const [selectedKoushu, setSelectedKoushu] = useState<KoushuPeriodInfo | null>(null);
  const [koushuEnrollments, setKoushuEnrollments] = useState<Map<string, KoushuEnrollment>>(
    new Map()
  );
  const [koushuScheduledCounts, setKoushuScheduledCounts] = useState<Map<string, number>>(
    new Map()
  );
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
    availableKeys: Set<string>; // `${date}_${slotId}`（時限がコマに対応付いた枠）
    datesWithMapping: Set<string>; // 対応付いた枠を持つ日付
    availableDates: Set<string>; // 通塾可能日（対応付け不可時の日単位フォールバック）
    /** ストリップ構築に使う生の利用可能スロット（buildTestPrepPlacementStrip に渡す） */
    rawSlots: import('@/lib/api/zoukoma-placement').ZoukomaAvailableSlot[];
  } | null>(null);
  const [zoukomaPanelRefreshKey, setZoukomaPanelRefreshKey] = useState(0);

  // ---- 配置ストリップ（出席可能日程ドットマトリクス） ----
  // 配置モード中（講習 / テスト対策）に生徒の出席可能日程をストリップ表示するためのデータ
  const [stripData, setStripData] = useState<
    import('@/lib/api/placement-availability').PlacementStripData | null
  >(null);
  const [stripLoading, setStripLoading] = useState(false);

  const router = useRouter();

  // 授業生徒数設定（個別の1講師あたり上限・教室座席数・集団上限）。schoolId 変更時に読み込み、未設定校は DEFAULT。
  const [capacity, setCapacity] = useState<SchoolClassCapacityFormData>(DEFAULT_CLASS_CAPACITY);

  // ---- 指導形態タブ（Phase D） ----
  // 形態マスタ（getFormations, sort_order順）。個別＋ユーザー定義形態でタブを描画する。
  const [formations, setFormations] = useState<ScheduleFormation[]>([]);
  // アクティブな形態タブ。既定=個別（localStorage 永続化はしない方針）。
  const [activeFormation, setActiveFormation] = useState<string>(INDIVIDUAL_FORMATION);
  // アクティブ形態の定員（school_formation_capacity。未設定なら max_students_per_group=8 / max_concurrent_groups=1）。
  const [formationCapacity, setFormationCapacity] = useState<SchoolFormationCapacity | null>(null);
  // クラス枠登録モーダルの対象（セル起点で自動設定）。mode='create'=新規枠 / 'add'=既存クラスへ追加。
  const [formationTarget, setFormationTarget] = useState<{
    date: string;
    slotId: string;
    mode: 'create' | 'add';
    teacherId: string | null;
  } | null>(null);

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

  const schoolId =
    selectedSchoolId && selectedSchoolId !== 'all' ? selectedSchoolId : selectedSchoolIdLocal;

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

  // 座席表の「向き」（既定=転置 日=行）と「列数」（日=列モードのセル内カラム）をユーザー設定として永続化。
  // 既存の表示曜日と同じ localStorage パターンに合わせる。
  const ORIENTATION_STORAGE_KEY = 'schedule_orientation';
  const COL_MODE_STORAGE_KEY = 'schedule_col_mode';
  const [orientation, setOrientation] = useState<'cols' | 'rows'>(() => {
    if (typeof window === 'undefined') return 'rows';
    const raw = localStorage.getItem(ORIENTATION_STORAGE_KEY);
    return raw === 'cols' || raw === 'rows' ? raw : 'rows';
  });
  const [colMode, setColMode] = useState<1 | 2>(() => {
    if (typeof window === 'undefined') return 2;
    return localStorage.getItem(COL_MODE_STORAGE_KEY) === '1' ? 1 : 2;
  });
  const setOrientationPersist = useCallback((next: 'cols' | 'rows') => {
    setOrientation(next);
    try {
      localStorage.setItem(ORIENTATION_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);
  const setColModePersist = useCallback((next: 1 | 2) => {
    setColMode(next);
    try {
      localStorage.setItem(COL_MODE_STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, []);
  // 週内の座席番号（印刷ブース番号）マップ。講師ヘッダーのインライン入力で表示・編集する。
  const [weekBoothMap, setWeekBoothMap] = useState<Map<string, Map<string, number>>>(new Map());

  // 未配置サマリバナーの展開状態。既定=折りたたみ（コンパクトなチップだけ表示）。永続化しない。
  const [unplacedBannerOpen, setUnplacedBannerOpen] = useState(false);

  // sticky ツールバーの実測高さ。転置モードの時限見出し（sticky）が
  // ツールバーの下に正しく貼り付くよう、オフセットとしてグリッドに渡す。
  // 認証ロード中はツールバーが描画されないため、callback ref + state で要素の出現を追跡する。
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  const [stickyOffset, setStickyOffset] = useState(0);
  useEffect(() => {
    if (!toolbarEl || typeof ResizeObserver === 'undefined') return;
    const update = () => setStickyOffset(toolbarEl.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(toolbarEl);
    return () => ro.disconnect();
  }, [toolbarEl]);
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

      // 通塾日程と座席表の同期チェック：未生成の枠があれば自動で再生成（手動作業不要）
      if (patterns.length > 0) {
        const expected = await getExpectedEntryKeysFromPatterns(schoolId, weekStartStr);
        // 【重要】「枠が埋まっているか」は generateWeeklySchedule の生成スキップ条件と
        // 同じ意味論で判定する: 同一 (date-slot-student) に行が1つでもあれば、
        // kind・status を問わず生成対象外（=枠は確保済み）。
        //  - 振替元 transferred_out / cancelled も行が残る限り再生成されない (N-4)
        //  - 講習・テスト対策・追加授業・体験（kind≠regular）も同様に生成スキップされる
        // 以前は status で絞った件数比較（expected.size !== actual.size）だったため、
        // 週に単発コマが1件でもあると常に不一致 → 画面更新のたびに週全体を再生成し、
        // 直前の手動移動（同コマ内の講師変更等）がパターンの講師へ巻き戻される
        // 実バグの原因になった (2026-07-13)。「余分な行」の検知はドリフトバナー
        // （detectScheduleDrift、regular_pattern_id で正しくスコープ済み）が担う。
        const covered = new Set(
          list.map((e) => `${e.entry_date}-${e.time_slot_id}-${e.student_id}`)
        );
        const outOfSync = Array.from(expected).some((k) => !covered.has(k));
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
      const filtered =
        ids.length > 0 ? masterSchools.filter((s) => ids.includes(s.id)) : masterSchools;
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
      fetchWithAuth('/api/admin/users?role=teacher')
        .then((r) => r.json())
        .then((d) => d.users || []),
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
    getStudents(undefined, [schoolId])
      .then(setStudents)
      .catch(() => setStudents([]));
  }, [schoolId]);

  // 「現在有効な講師の出勤可能曜日」を期間付きで取得。
  // - 第1優先: teacher_availability_periods (manual > regular_shift)
  // - フォールバック: 上記が空のときのみ生のシフト提出 (getCurrentTeacherShifts) で代用
  //   ※ period が未同期な過渡期データを取りこぼさないため
  useEffect(() => {
    if (!schoolId) {
      setShiftByDow(new Map());
      setAvailabilityMap(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { getAvailabilityDayMap } = await import('@/lib/api/teacher-availability');
        const asOf = weekStartStr;
        const map = await getAvailabilityDayMap(schoolId, asOf);
        // 講師詳細モーダル(TeacherDetailModal)の在室時間帯表示にそのまま流用する。
        // period が1件も無い教室でも byDayOfWeek/intervalsByDayAndUser は空 Map として
        // 確定して返るため、ここで setAvailabilityMap(map) しておけば
        // モーダル側は「取得中...」ではなく「データなし(—)」を正しく出し分けられる
        // （null=未取得/取得失敗、空Map=取得済みだが対象講師の登録が無い、を区別する）。
        if (!cancelled) setAvailabilityMap(map);

        if (map.byDayOfWeek.size > 0) {
          if (!cancelled) setShiftByDow(map.byDayOfWeek);
          return;
        }
        // period が1件もなければ座席表の空き枠表示(shiftByDow)だけ旧APIにフォールバック
        const { getCurrentTeacherShifts } = await import('@/lib/api/teacher-shifts');
        const fallback = await getCurrentTeacherShifts(schoolId, asOf);
        if (!cancelled) setShiftByDow(fallback.byDayOfWeek);
      } catch (e) {
        console.warn('Shift availability fetch failed:', e);
        if (!cancelled) {
          setShiftByDow(new Map());
          setAvailabilityMap(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId, weekStartStr]);

  // 講習期間リストをロード（schoolId 変更時）
  // course_prep_periods から「設定済み（start/end あり）」を全部表示
  useEffect(() => {
    if (!schoolId) {
      setKoushuList([]);
      return;
    }
    getKoushuPeriods(schoolId)
      .then(setKoushuList)
      .catch(() => setKoushuList([]));
  }, [schoolId]);

  // 追加授業（テスト対策）モードを出すか：増コマフォームが設定済みかで判定（schoolId 変更時）
  useEffect(() => {
    if (!schoolId) {
      setHasTestPrep(false);
      return;
    }
    hasZoukomaForm(schoolId)
      .then(setHasTestPrep)
      .catch(() => setHasTestPrep(false));
  }, [schoolId]);

  // 授業生徒数設定をロード（schoolId 変更時）。失敗・未設定はデフォルト値で動かす。
  useEffect(() => {
    if (!schoolId) {
      setCapacity(DEFAULT_CLASS_CAPACITY);
      return;
    }
    getClassCapacity(schoolId)
      .then((c) => setCapacity(c ?? DEFAULT_CLASS_CAPACITY))
      .catch(() => setCapacity(DEFAULT_CLASS_CAPACITY));
  }, [schoolId]);

  // 指導形態マスタをロード（is_active のみ）。ユーザー定義形態が0件なら形態タブは出ない。
  useEffect(() => {
    getFormations()
      .then(setFormations)
      .catch(() => setFormations([]));
  }, []);

  // アクティブ形態の定員をロード（個別タブでは不要）。schoolId / activeFormation 変更時。
  useEffect(() => {
    if (!schoolId || activeFormation === INDIVIDUAL_FORMATION) {
      setFormationCapacity(null);
      return;
    }
    getFormationCapacity(schoolId, activeFormation)
      .then(setFormationCapacity)
      .catch(() => setFormationCapacity(null));
  }, [schoolId, activeFormation]);

  // 形態タブへ切替時は個別専用の講習/テスト対策モードを解除（形態ボードに残らないように）。
  const handleFormationChange = useCallback((key: string) => {
    setActiveFormation(key);
    if (key !== INDIVIDUAL_FORMATION) {
      setSelectedKoushu(null);
      setKoushuEnrollments(new Map());
      setKoushuScheduledCounts(new Map());
      setKoushuDraftProposals([]);
      setPlacingKoushuStudent(null);
      setTestPrepActive(false);
      setPlacingTestPrep(null);
      setTransferMode(null);
      // Phase P2: 形態ボードは汎用配置の対象外。切替時に配置モードを解除する。
      setPlacingAdhoc(null);
    }
  }, []);

  // 週内の座席番号（ブース番号）を全表示日ぶん取得して講師ヘッダーのインライン入力に反映。
  // 失敗しても座席表本体には影響させない（番号無しで動く）。
  useEffect(() => {
    if (!schoolId || weekDates.length === 0) {
      setWeekBoothMap(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { getBoothNoMapForDate } = await import('@/lib/api/schedule-daily-booth');
        const pairs = await Promise.all(
          weekDates.map(async (d) => [d, await getBoothNoMapForDate(schoolId, d)] as const)
        );
        if (!cancelled) setWeekBoothMap(new Map(pairs));
      } catch (e) {
        console.warn('Failed to fetch weekly booth assignments:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId, weekDates]);

  // 講師ヘッダーの座席番号インライン入力を保存。
  // ブース番号は (school×date) 内で一意。その日の割当セットを読み直し、対象講師だけ更新して置換する。
  const handleSeatNoChange = useCallback(
    async (date: string, teacherId: string, value: string) => {
      if (!schoolId) return;
      try {
        const { getDailyBoothAssignments, setDailyBoothAssignments } =
          await import('@/lib/api/schedule-daily-booth');
        const current = await getDailyBoothAssignments(schoolId, date);
        const map = new Map<string, number>(current.map((a) => [a.teacher_id, a.booth_no]));
        const num = parseInt(value, 10);
        if (!value || Number.isNaN(num)) map.delete(teacherId);
        else map.set(teacherId, num);
        const assignments = Array.from(map.entries()).map(([tid, booth_no]) => ({
          teacher_id: tid,
          booth_no,
        }));
        await setDailyBoothAssignments(schoolId, date, assignments);
        // 週マップ・印刷マップを同期更新
        setWeekBoothMap((prev) => {
          const next = new Map(prev);
          next.set(date, new Map(map));
          return next;
        });
        setPrintBoothMap((prev) => {
          const next = new Map(prev);
          next.set(date, new Map(map));
          return next;
        });
      } catch (e) {
        toastError((e as Error).message);
      }
    },
    [schoolId, toastError]
  );

  // 講習期間選択時: 該当 season の全 seasonal_courses から enrollments を集約
  // 同生徒が複数コース申込なら koma_count を合算
  const handleKoushuSelect = useCallback(
    async (period: KoushuPeriodInfo | null) => {
      setSelectedKoushu(period);
      // 講習と追加授業（テスト対策）は排他。講習を選んだら追加授業モードを解除。
      // Phase P2: 汎用配置モードとも排他（講習に入ったら配置モードを解除）。
      if (period) {
        setTestPrepActive(false);
        setPlacingTestPrep(null);
        setPlacingAdhoc(null);
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
        // 講習の座席表モードは個別のみ対象（集団は GroupLaneGrid で別処理）。ここは現状維持が正しい。
        if (e.formation !== INDIVIDUAL_FORMATION) continue;
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
          // 講習は個別のみ座席表モード対象
          INDIVIDUAL_FORMATION
        );
        setKoushuScheduledCounts(counts);
      } else {
        setKoushuScheduledCounts(new Map());
      }
    },
    [schoolId]
  );

  // 講習モード用: 生徒IDから申し込み情報を返す
  const getKoushuInfo = useCallback(
    (studentId: string) => {
      if (!selectedKoushu) return null;
      const en = koushuEnrollments.get(studentId);
      if (!en) return null;
      return {
        enrolled: en.koma_count,
        scheduled: koushuScheduledCounts.get(studentId) ?? 0,
      };
    },
    [selectedKoushu, koushuEnrollments, koushuScheduledCounts]
  );

  useEffect(() => {
    refreshEntries();
  }, [refreshEntries]);

  // 配置ストリップデータの構築。配置モード切り替え・refreshKey 変更時に再取得。
  // 失敗しても座席表本体に影響しないよう、エラーは warn + null で飲み込む。
  useEffect(() => {
    if (!schoolId) {
      setStripData(null);
      return;
    }

    // 個別コマのスロット一覧。useMemo の individualSlots は
    // この useEffect より後で宣言されているため、timeSlots からインラインでフィルタする。
    // Phase A: 「group 以外」ではなく「individual に一致」で判定。新形態が個別ストリップへ混入するのを防ぐ。
    const indivSlotList = timeSlots
      .filter((s) => s.formation === INDIVIDUAL_FORMATION)
      .map((s) => ({
        id: s.id,
        slot_number: s.slot_number,
        start_time: s.start_time ?? '',
        // 満席判定は講師の在室時間帯との包含で行うため終了時刻も渡す
        end_time: s.end_time ?? '',
      }));

    // 講習配置モード
    if (placingKoushuStudent && selectedKoushu) {
      let cancelled = false;
      setStripLoading(true);
      import('@/lib/api/placement-availability')
        .then(({ buildKoushuPlacementStrip }) =>
          buildKoushuPlacementStrip(
            schoolId,
            placingKoushuStudent.studentId,
            {
              schedule_start_date: selectedKoushu.schedule_start_date,
              schedule_end_date: selectedKoushu.schedule_end_date,
            },
            indivSlotList
          )
        )
        .then((data) => {
          if (!cancelled) {
            setStripData(data);
            setStripLoading(false);
          }
        })
        .catch((e) => {
          console.warn('PlacementStrip build failed (koushu):', e);
          if (!cancelled) {
            setStripData(null);
            setStripLoading(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    // テスト対策配置モード
    if (placingTestPrep) {
      let cancelled = false;
      setStripLoading(true);
      import('@/lib/api/placement-availability')
        .then(({ buildTestPrepPlacementStrip }) =>
          buildTestPrepPlacementStrip(
            schoolId,
            placingTestPrep.studentId,
            placingTestPrep.rawSlots,
            indivSlotList
          )
        )
        .then((data) => {
          if (!cancelled) {
            setStripData(data);
            setStripLoading(false);
          }
        })
        .catch((e) => {
          console.warn('PlacementStrip build failed (test_prep):', e);
          if (!cancelled) {
            setStripData(null);
            setStripLoading(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }

    // どちらでもなければ非表示
    setStripData(null);
    // koushuPanelRefreshKey / zoukomaPanelRefreshKey を依存に含め、配置成功後に再構築
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    schoolId,
    placingKoushuStudent,
    placingTestPrep,
    selectedKoushu,
    timeSlots,
    koushuPanelRefreshKey,
    zoukomaPanelRefreshKey,
  ]);

  // NOTE: 以前は window focus / visibilitychange で自動 refreshEntries していたが、
  // 「定期的に再読み込みが入って描画が重い」というフィードバックを受けて撤去。
  // 他画面（マッチング等）の変更を取り込みたい場合は、ツールバーの「再取得」ボタンや
  // 週の切替で明示的にリロードする運用とする。

  // §2.12 入れ替えの確定。候補（同じ日・同じコマ・別講師・非取消/非振替元・生徒コマ）なら
  // teacher_id を交換して成功トースト＋モード解除。指導科目外等の違反は toast 表示しモード継続。
  const handleSwapTargetClick = useCallback(
    async (target: ScheduleEntry) => {
      if (!swapMode) return;
      const source = swapMode.sourceEntry;
      // 自分自身のクリックは無視（モード継続）。
      if (target.id === source.id) return;
      const isCandidate =
        target.entry_date === source.entry_date &&
        target.time_slot_id === source.time_slot_id &&
        !!target.teacher_id &&
        !!source.teacher_id &&
        target.teacher_id !== source.teacher_id &&
        target.status !== 'cancelled' &&
        target.status !== 'transferred_out' &&
        !!target.student_id;
      if (!isCandidate) {
        // 非候補は軽い警告のみ（モード継続で相手を選び直せる）。
        toastError('入れ替えできる相手は、同じコマの別講師の生徒です');
        return;
      }
      try {
        await swapScheduleEntries(source.id, target.id);
        const nameOf = (en: ScheduleEntry) =>
          en.student ? `${en.student.last_name}${en.student.first_name}` : '生徒';
        const aName = nameOf(source);
        const bName = nameOf(target);
        // 監査ログ（既存の move/transfer と同様、失敗してもメインは成立扱い）。
        // action_type は既存の 'entry_reassign' を流用（新規 action 追加はマイグレを伴うため避ける）。
        if (schoolId) {
          await logScheduleChange({
            school_id: schoolId,
            actor_user_id: profile?.id ?? null,
            action_type: 'entry_reassign',
            entry_id: source.id,
            student_id: source.student_id,
            before_teacher_id: source.teacher_id ?? null,
            after_teacher_id: target.teacher_id ?? null,
            affected_date: source.entry_date,
            affected_slot_id: source.time_slot_id,
            description: `生徒の入れ替え（${aName} ⇄ ${bName}）`,
          });
          await logScheduleChange({
            school_id: schoolId,
            actor_user_id: profile?.id ?? null,
            action_type: 'entry_reassign',
            entry_id: target.id,
            student_id: target.student_id,
            before_teacher_id: target.teacher_id ?? null,
            after_teacher_id: source.teacher_id ?? null,
            affected_date: target.entry_date,
            affected_slot_id: target.time_slot_id,
            description: `生徒の入れ替え（${bName} ⇄ ${aName}）`,
          });
        }
        success(`${aName}と${bName}を入れ替えました`);
        setSwapMode(null);
        refreshEntries();
      } catch (err) {
        // 指導科目外などの検証エラーは理由を出してモード継続。
        toastError(err instanceof Error ? err.message : '入れ替えに失敗しました');
      }
    },
    [swapMode, schoolId, profile?.id, success, refreshEntries, toastError]
  );

  const handleEntryClick = useCallback(
    (entry: ScheduleEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      // §2.12 入れ替えモード中は生徒行クリックを横取りしてスワップ確定に回す。
      // 通常モード（swapMode=null）では従来どおり授業操作モーダルを開く。
      if (swapMode) {
        void handleSwapTargetClick(entry);
        return;
      }
      setActionModalEntry(entry);
    },
    [swapMode, handleSwapTargetClick]
  );

  const handleStudentClickFromAction = useCallback(() => {
    const entry = actionModalEntry;
    if (!entry) return;
    setActionModalEntry(null);
    // Phase T: 体験の見込み客（student_id 無し）は生徒詳細を持たないので何もしない。
    if (!entry.student_id) return;
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

  const handleAddTeacher = useCallback(
    (date: string, slotId: string, existingTeacherIds: string[]) => {
      setAddTeacherTarget({ date, slotId, existingTeacherIds });
      setAddTeacherModalOpen(true);
    },
    []
  );

  const handleAddTeacherSelect = useCallback(
    (teacherId: string) => {
      if (!addTeacherTarget) return;
      const cellKey = `${addTeacherTarget.date}-${addTeacherTarget.slotId}`;
      setEmptyTeacherSlots((prev) => ({
        ...prev,
        [cellKey]: [...(prev[cellKey] ?? []), teacherId],
      }));
      setAddTeacherTarget(null);
      setAddTeacherModalOpen(false);
    },
    [addTeacherTarget]
  );

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
            formation: INDIVIDUAL_FORMATION,
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
  const [groupKomaTarget, setGroupKomaTarget] = useState<{ date: string; slotId: string } | null>(
    null
  );

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
          formation: GROUP_FORMATION,
        });
      }
      success('集団コマを作成しました');
      await refreshEntries();
      setKoushuPanelRefreshKey((k) => k + 1);
    },
    [groupKomaTarget, schoolId, success, refreshEntries]
  );

  const handleRemoveTeacher = useCallback(
    (date: string, slotId: string, teacherId: string, entryCount: number) => {
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
    },
    []
  );

  const handleTeacherCardMove = useCallback(
    async (
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
    },
    [entries, success, refreshEntries]
  );

  /** 振替モード時: 座席表の講師ブロックをクリックで振替先に選び、即実行。同日同時間帯は移動として扱う */
  const handleTransferTargetClick = useCallback(
    async (targetDate: string, targetSlotId: string, targetTeacherId: string) => {
      if (!transferMode || !schoolId) return;
      const entry = transferMode.sourceEntry;
      try {
        const isSameSlot = entry.entry_date === targetDate && entry.time_slot_id === targetSlotId;
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
    },
    [transferMode, schoolId, success, refreshEntries, toastError]
  );

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
    // 形態ボードにはグリッドの講師ブロックが無いため、振替先はモーダルで選ぶ（候補コマは
    // その形態のコマに限定される＝ScheduleDialogs へ渡す timeSlots を形態別にしているため）。
    if (activeFormation !== INDIVIDUAL_FORMATION) {
      setTransferringEntry(actionModalEntry);
      setTransferModalOpen(true);
      setActionModalEntry(null);
      return;
    }
    setTransferMode({ sourceEntry: actionModalEntry });
    setActionModalEntry(null);
  }, [actionModalEntry, activeFormation]);

  // §2.12 入れ替えモードに切り替え（同コマ・別講師の相手を座席表でクリックして交換）。
  // 個別タブのみ・他モード非アクティブ時のみ（onSwapFromAction を渡す条件で担保）。
  const handleSwapFromAction = useCallback(() => {
    if (!actionModalEntry) return;
    setSwapMode({ sourceEntry: actionModalEntry });
    setActionModalEntry(null);
  }, [actionModalEntry]);

  // §2.12 排他の安全網: 入れ替え以外のモードが立ったら入れ替えモードを自動解除する
  // （講習/テスト対策/配置/振替。開始経路が複数あるため個別の解除漏れを一括で吸収）。
  useEffect(() => {
    if (
      swapMode &&
      (transferMode ||
        selectedKoushu ||
        testPrepActive ||
        placingKoushuStudent ||
        placingTestPrep ||
        placingAdhoc)
    ) {
      setSwapMode(null);
    }
  }, [
    swapMode,
    transferMode,
    selectedKoushu,
    testPrepActive,
    placingKoushuStudent,
    placingTestPrep,
    placingAdhoc,
  ]);

  // §2.12 入れ替えは個別タブ専用。形態ボードへ切り替えたら入れ替えモードを解除する
  // （バーは個別ボードにしか出ないため、状態とクリック横取りが残らないように）。
  useEffect(() => {
    if (swapMode && activeFormation !== INDIVIDUAL_FORMATION) setSwapMode(null);
  }, [swapMode, activeFormation]);

  // Phase P2: TransferModal（別週へ振替ダイアログ）から「保留にする」。
  // 振替先を決めずに元コマだけ transferred_out 化し、保留プールへ入れる。
  const handleTransferHold = useCallback(async () => {
    if (!schoolId || !transferringEntry) return;
    try {
      const { holdTransfer } = await import('@/lib/api/schedule');
      await holdTransfer(schoolId, transferringEntry.id);
      success('振替を保留にしました');
      setTransferModalOpen(false);
      setTransferringEntry(null);
      setHeldRefreshKey((k) => k + 1);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
    }
  }, [schoolId, transferringEntry, success, refreshEntries, toastError]);

  // Phase P2: 振替モードバー（座席表クリックで振替先を選ぶモード）から「保留にする」。
  const handleTransferModeHold = useCallback(async () => {
    if (!schoolId || !transferMode) return;
    try {
      const { holdTransfer } = await import('@/lib/api/schedule');
      await holdTransfer(schoolId, transferMode.sourceEntry.id);
      success('振替を保留にしました');
      setTransferMode(null);
      setHeldRefreshKey((k) => k + 1);
      refreshEntries();
    } catch (e) {
      toastError((e as Error).message);
    }
  }, [schoolId, transferMode, success, refreshEntries, toastError]);

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
    return entriesWithSubjects.filter((e) => !!e.student_id && koushuEnrollments.has(e.student_id));
  }, [entriesWithSubjects, selectedKoushu, koushuEnrollments]);

  // 講習モードの2レーン分割: 個別レーン=既存グリッド、集団レーン=GroupLaneGrid。
  // formation でコマ時間を分け、個別グリッドには個別コマだけ渡す（集団コマが個別グリッドに混ざらないように）。
  // Phase A: 「group 以外」ではなく「individual に一致」で判定。新形態が個別グリッドへ混入するのを防ぐ。
  const individualSlots = useMemo(
    () => timeSlots.filter((t) => t.formation === INDIVIDUAL_FORMATION),
    [timeSlots]
  );
  // 集団レーンは講習の集団コマ専用（group 固定）。ユーザー定義形態はここには乗らない（Phase D で別タブ）。
  const groupSlots = useMemo(
    () => timeSlots.filter((t) => t.formation === GROUP_FORMATION),
    [timeSlots]
  );
  // 集団の講習エントリ（個別申込フィルタとは独立に、期間内の集団コマを全部出す）
  const groupEntries = useMemo(
    () => entriesWithSubjects.filter((e) => e.kind === 'koushu' && e.formation === GROUP_FORMATION),
    [entriesWithSubjects]
  );

  // ---- 指導形態タブ（Phase D） ----
  // タブ = 個別 ＋ is_active なユーザー定義形態（group は講習専用レーンなので出さない）。
  const formationTabs = useMemo(
    () => [
      { key: INDIVIDUAL_FORMATION, label: '個別' },
      ...formations
        .filter((f) => !f.is_system && f.is_active)
        .map((f) => ({ key: f.key, label: f.label })),
    ],
    [formations]
  );
  const activeFormationMeta = useMemo(
    () => formations.find((f) => f.key === activeFormation) ?? null,
    [formations, activeFormation]
  );
  const isFormationBoard = activeFormation !== INDIVIDUAL_FORMATION;
  // アクティブ形態のコマ時間（設定画面で登録済みのもの）。
  const formationSlots = useMemo(
    () => timeSlots.filter((t) => t.formation === activeFormation),
    [timeSlots, activeFormation]
  );
  // アクティブ形態の週次エントリ（通塾日程から生成された regular のみ）。
  const formationEntries = useMemo(
    () =>
      entriesWithSubjects.filter((e) => e.formation === activeFormation && e.kind === 'regular'),
    [entriesWithSubjects, activeFormation]
  );
  // 定員（未設定なら 1枠8名・同時1枠）。
  const formationMaxStudents = formationCapacity?.max_students_per_group ?? 8;
  const formationMaxConcurrent = formationCapacity?.max_concurrent_groups ?? 1;

  // 空セルの「＋クラス枠」→ 新規クラス枠モーダル
  const handleFormationCreate = useCallback((date: string, slotId: string) => {
    setFormationTarget({ date, slotId, mode: 'create', teacherId: null });
  }, []);

  // 空席プレースホルダ行 → 既存クラスへ生徒追加モーダル（講師固定）
  const handleFormationAddStudent = useCallback(
    (date: string, slotId: string, teacherId: string | null) => {
      setFormationTarget({ date, slotId, mode: 'add', teacherId });
    },
    []
  );

  // モーダル送信：生徒ごとに formation 付き週次パターンを作成し、当週以降の座席表を再生成。
  const handleSubmitFormationKoma = useCallback(
    async (data: { teacherId: string | null; subjectIds: string[]; studentIds: string[] }) => {
      if (!formationTarget || !schoolId) return;
      const dow = new Date(formationTarget.date + 'T12:00:00').getDay();
      await createFormationClassPatterns({
        schoolId,
        formation: activeFormation,
        timeSlotId: formationTarget.slotId,
        dayOfWeek: dow,
        teacherId: data.teacherId,
        subjectIds: data.subjectIds,
        studentIds: data.studentIds,
        maxStudentsPerGroup: formationMaxStudents,
        maxConcurrentGroups: formationMaxConcurrent,
      });
      success('クラス枠を登録しました');
      // 通塾日程→座席表の反映（今週から4週）＋表示中の週を同期。
      await regenerateCurrentWeekIfNeeded(schoolId, profile?.id);
      await refreshEntries();
    },
    [
      formationTarget,
      schoolId,
      activeFormation,
      formationMaxStudents,
      formationMaxConcurrent,
      success,
      profile?.id,
      refreshEntries,
    ]
  );

  // 下書き提案を「擬似エントリ」に変換して個別グリッドに重ねる（isDraft=true で★/破線表示）。
  const subjectById = useMemo(
    () => new Map(masterSubjects.map((s) => [s.id, s.name])),
    [masterSubjects]
  );
  const koushuDraftEntries = useMemo<ScheduleEntry[]>(() => {
    if (!selectedKoushu) return [];
    return (
      koushuDraftProposals
        // 講習の下書き提案は個別のみ個別グリッドに重ねる（集団は別レーン）
        .filter((p) => p.formation === INDIVIDUAL_FORMATION)
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
          formation: INDIVIDUAL_FORMATION,
          // Phase R: 講習の下書き擬似エントリは常に 1対2・全コマ（講習は半コマ非対象）。
          ratio: 2,
          duration_minutes: null,
          half_position: null,
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
        }))
    );
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
      if (closedDates.includes(date)) {
        toastError('休講日には配置できません');
        return;
      }
      try {
        const { createKoushuPlacement } = await import('@/lib/api/schedule');
        await createKoushuPlacement(
          schoolId,
          date,
          slotId,
          placingKoushuStudent.studentId,
          placingKoushuStudent.subjectIds
        );
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
        (e) =>
          e.student_id === sid &&
          e.entry_date === date &&
          e.time_slot_id === slotId &&
          e.status !== 'cancelled' &&
          e.status !== 'transferred_out'
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
      if (closedDates.includes(date)) {
        toastError('休講日には配置できません');
        return;
      }
      try {
        const { createKoushuPlacement } = await import('@/lib/api/schedule');
        await createKoushuPlacement(
          schoolId,
          date,
          slotId,
          placingKoushuStudent.studentId,
          placingKoushuStudent.subjectIds,
          teacherId
        );
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
  const handleTestPrepToggle = useCallback(
    async (active: boolean) => {
      setTestPrepActive(active);
      setPlacingTestPrep(null);
      if (!active) return;
      // Phase P2: テスト対策に入ったら汎用配置モードを解除（排他）。
      setPlacingAdhoc(null);
      // 講習モードは解除
      setSelectedKoushu(null);
      setKoushuEnrollments(new Map());
      setKoushuScheduledCounts(new Map());
      setKoushuDraftProposals([]);
      // 申込（全期間）の最初の通塾可能日へジャンプ（今日が枠より前なら最初の枠週へ）
      try {
        const map = await getZoukomaPlacementProgress(schoolId, masterSubjects);
        const dates: string[] = [];
        Array.from(map.values()).forEach((r) =>
          r.availableSlots.forEach((s) => dates.push(s.date))
        );
        if (dates.length > 0) {
          const todayJst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
          dates.sort();
          const jump = dates.find((d) => d >= todayJst) ?? dates[0];
          setWeekStart(getWeekStart(new Date(jump + 'T12:00:00')));
        }
      } catch {
        /* ジャンプ失敗は致命的でない */
      }
    },
    [schoolId, masterSubjects]
  );

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
        // 個別コマだけを対象にする（テスト対策は個別レーンへ配置）。新形態が混ざらないよう individual 一致で判定。
        if (t.formation !== INDIVIDUAL_FORMATION) continue;
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
      setPlacingTestPrep({
        studentId,
        subjectId,
        subjectName,
        availableKeys,
        datesWithMapping,
        availableDates,
        rawSlots: slots,
      });
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
        (e) =>
          e.student_id === sid &&
          e.entry_date === date &&
          e.time_slot_id === slotId &&
          e.status !== 'cancelled' &&
          e.status !== 'transferred_out'
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
      if (closedDates.includes(date)) {
        toastError('休講日には配置できません');
        return;
      }
      try {
        const { createTestPrepPlacement } = await import('@/lib/api/schedule');
        await createTestPrepPlacement(schoolId, date, slotId, placingTestPrep.studentId, [
          placingTestPrep.subjectId,
        ]);
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
      if (closedDates.includes(date)) {
        toastError('休講日には配置できません');
        return;
      }
      try {
        const { createTestPrepPlacement } = await import('@/lib/api/schedule');
        await createTestPrepPlacement(
          schoolId,
          date,
          slotId,
          placingTestPrep.studentId,
          [placingTestPrep.subjectId],
          teacherId
        );
        success('テスト対策コマを配置しました');
        await refreshEntries();
        setZoukomaPanelRefreshKey((k) => k + 1);
      } catch (e) {
        toastError(e instanceof Error ? e.message : '配置できませんでした');
      }
    },
    [placingTestPrep, schoolId, closedDates, success, refreshEntries, toastError]
  );

  // ===== Phase P2: 汎用配置モード（振替保留の配置 / 授業追加の配置） =====

  // 配置可否（緑=可 / 淡色=不可）。過去日・休講日・生徒の同一コマ重複をチェック。
  // 振替は excludeEntryId で元コマを除外、lesson×問合せ（見込み客）は生徒重複をスキップ。
  // 休講/過去日の判定は getKoushuPlaceability と同じ実装を流用。
  const getAdhocPlaceability = useCallback(
    (date: string, slotId: string): { ok: boolean; reason: string | null } => {
      if (!placingAdhoc) return { ok: false, reason: null };
      if (closedDates.includes(date)) return { ok: false, reason: '休講日' };
      const todayJst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
      if (date < todayJst) return { ok: false, reason: '過去の日付' };
      const sid = placingAdhoc.studentId;
      if (sid) {
        const dup = entriesWithSubjects.some(
          (e) =>
            e.student_id === sid &&
            e.id !== placingAdhoc.excludeEntryId &&
            e.entry_date === date &&
            e.time_slot_id === slotId &&
            e.status !== 'cancelled' &&
            e.status !== 'transferred_out'
        );
        if (dup) return { ok: false, reason: 'この生徒は既にこのコマに配置済み' };
      }
      return { ok: true, reason: null };
    },
    [placingAdhoc, closedDates, entriesWithSubjects]
  );

  // point 4: 汎用配置モード中、講師カード単位の配置可否（指導科目外/満員/1対1/欠勤/担当除外/希望性別）。
  // 既存 D&D の dropConstraint（TeacherCard 176-）と同基準を per-teacher で計算する。
  // adhoc 専用（gridGetTeacherConstraint 経由）。講習/テスト対策では渡さないので従来挙動不変。
  const getAdhocTeacherConstraint = useCallback(
    (date: string, slotId: string, teacherId: string): { ok: boolean; reason: string | null } => {
      if (!placingAdhoc) return { ok: true, reason: null };
      // 担当未決定カードは背景配置と同義なので制約対象にしない。
      if (teacherId.startsWith('__unassigned__')) return { ok: true, reason: null };
      const teacher = teachers.find((t) => t.id === teacherId);
      if (!teacher) return { ok: true, reason: null };
      // a. 欠勤
      if (absenceKeySet.has(`${date}|${slotId}|${teacherId}`)) {
        return { ok: false, reason: '欠勤' };
      }
      // b. 指導可能科目（teachable が空/未設定なら全科目可）
      const subjIds = placingAdhoc.subjectIds ?? [];
      const teachable = teacher.teachable_subject_ids;
      if (teachable && teachable.length > 0 && subjIds.length > 0) {
        const teachableSet = new Set(teachable);
        if (!subjIds.some((id) => teachableSet.has(id))) {
          return { ok: false, reason: '指導科目外' };
        }
      }
      // c. 席占有（1対1専有・満席・45分半コマ）。canPlaceEntry で判定。
      const active = entriesWithSubjects.filter(
        (e) =>
          e.entry_date === date &&
          e.time_slot_id === slotId &&
          e.teacher_id === teacherId &&
          e.status !== 'cancelled' &&
          e.status !== 'transferred_out'
      );
      const toSeat = (e: (typeof active)[number]): SeatEntryInput => ({
        ratio: e.ratio === 1 ? 1 : 2,
        halfPosition: e.half_position ?? null,
      });
      const incoming: SeatEntryInput = {
        ratio: placingAdhoc.ratio === 1 ? 1 : 2,
        halfPosition: placingAdhoc.halfPosition ?? null,
      };
      if (
        !canPlaceEntry(active.map(toSeat), incoming, capacity.max_students_per_teacher_individual)
      ) {
        return {
          ok: false,
          reason: active.some((e) => e.ratio === 1) ? '1対1のため不可' : '満員',
        };
      }
      // d. 生徒の担当除外・希望性別（見込み客は空/none で素通り）
      if ((placingAdhoc.excludedTeacherIds ?? []).includes(teacherId)) {
        return { ok: false, reason: '担当除外指定' };
      }
      const pref = placingAdhoc.preferredGender;
      if (pref && teacher.gender && teacher.gender !== pref) {
        return { ok: false, reason: `${pref === 'male' ? '男性' : '女性'}講師希望` };
      }
      return { ok: true, reason: null };
    },
    [placingAdhoc, teachers, absenceKeySet, entriesWithSubjects, capacity]
  );

  // 配置確定の共通処理。teacherId=null=セル背景クリック（担当未決定） / 非null=講師カードクリック。
  const doAdhocPlace = useCallback(
    async (date: string, slotId: string, teacherId: string | null) => {
      if (!placingAdhoc || !schoolId) return;
      if (closedDates.includes(date)) {
        toastError('休講日には配置できません');
        return;
      }
      try {
        if (placingAdhoc.mode === 'transfer') {
          if (!placingAdhoc.fromEntryId) return;
          // 月内振替回数チェック。上限超過なら確認（既存フロー同様に例外登録を許す）。
          if (placingAdhoc.studentId) {
            const usage = await getMonthlyTransferUsage(
              placingAdhoc.studentId,
              placingAdhoc.sourceEntryDate
            );
            if (usage.used >= usage.limit) {
              const ok = window.confirm(
                `${placingAdhoc.displayName} は ${usage.monthLabel} の振替が ${usage.used}/${usage.limit} 件で上限です。例外として振替を登録しますか？`
              );
              if (!ok) return;
            }
          }
          const { completeHeldTransfer } = await import('@/lib/api/schedule');
          await completeHeldTransfer(schoolId, placingAdhoc.fromEntryId, date, slotId, teacherId);
          success('振替を登録しました');
          // 振替は1件=1配置。配置後は自動でモード終了し、保留プールを再取得。
          setPlacingAdhoc(null);
          setHeldRefreshKey((k) => k + 1);
          refreshEntries();
          return;
        }

        // lesson モード：授業追加の1コマ配置（連続配置）
        const { createLessonPlacement } = await import('@/lib/api/schedule');
        await createLessonPlacement(schoolId, date, slotId, {
          studentId: placingAdhoc.studentId,
          inquiryId: placingAdhoc.inquiryId ?? null,
          subjectIds: placingAdhoc.subjectIds ?? [],
          teacherId,
          kind: placingAdhoc.kind ?? 'additional',
          ratio: placingAdhoc.ratio,
          durationMinutes: placingAdhoc.durationMinutes ?? null,
          halfPosition: placingAdhoc.halfPosition ?? null,
        });
        // 体験×問合せ（見込み客）は最初の1件登録時のみ trial_at をセット＋体験待ち化。
        const shouldMarkTrial =
          placingAdhoc.kind === 'trial' && !!placingAdhoc.inquiryId && !placingAdhoc.trialMarked;
        if (shouldMarkTrial) {
          const slot = individualSlots.find((s) => s.id === slotId);
          const startTime = slot?.start_time ?? '00:00:00';
          try {
            await markInquiryTrialScheduled(placingAdhoc.inquiryId!, `${date}T${startTime}+09:00`);
          } catch (e) {
            console.warn('問合せの体験予約連動に失敗しました（体験コマは登録済み）:', e);
          }
        }
        // 未消化プール由来の再開なら、この1コマぶんプールの残数を1減らす（0で行削除）。
        if (placingAdhoc.pendingLessonId) {
          try {
            const { decrementPendingLesson } = await import('@/lib/api/pending-lessons');
            await decrementPendingLesson(placingAdhoc.pendingLessonId);
            setHeldRefreshKey((k) => k + 1);
          } catch (e) {
            console.warn('未消化プールの残数更新に失敗しました（コマは配置済み）:', e);
          }
        }
        const newCount = placingAdhoc.placedCount + 1;
        const target = placingAdhoc.targetCount ?? null;
        // 指定コマ数に達したら自動終了。それ以外は連続配置のためモード継続。
        if (target != null && newCount >= target) {
          success(`${target} コマ登録しました`);
          setPlacingAdhoc(null);
          setHeldRefreshKey((k) => k + 1);
          refreshEntries();
          return;
        }
        success('授業を配置しました');
        // バナーの「登録済み n / N コマ」を増やし、体験の trial 連動済みフラグを立てる。
        setPlacingAdhoc((prev) =>
          prev
            ? {
                ...prev,
                placedCount: prev.placedCount + 1,
                trialMarked: prev.trialMarked || shouldMarkTrial,
              }
            : prev
        );
        refreshEntries();
      } catch (e) {
        toastError(e instanceof Error ? e.message : '配置できませんでした');
      }
    },
    [placingAdhoc, schoolId, closedDates, success, toastError, refreshEntries, individualSlots]
  );

  // 「完了」= 配置モード終了。lesson で残数がある場合、未消化プールへ退避する。
  //  - プール由来の再開(pendingLessonId あり)は配置ごとに残数を減らしているので、追加退避は不要。
  //  - 新規(pendingLessonId なし)で placedCount < targetCount のときだけ、残りを新規プール行にする。
  const handleAdhocDone = useCallback(async () => {
    const p = placingAdhoc;
    if (!p) return;
    if (
      p.mode === 'lesson' &&
      !p.pendingLessonId &&
      p.targetCount != null &&
      p.placedCount < p.targetCount &&
      schoolId
    ) {
      const remaining = p.targetCount - p.placedCount;
      try {
        const { createPendingLesson } = await import('@/lib/api/pending-lessons');
        await createPendingLesson({
          schoolId,
          studentId: p.studentId,
          inquiryId: p.inquiryId ?? null,
          subjectId: p.subjectIds?.[0] ?? '',
          kind: p.kind ?? 'additional',
          ratio: p.ratio === 1 ? 1 : 2,
          durationMinutes: p.durationMinutes ?? null,
          halfPosition: p.halfPosition ?? null,
          remainingCount: remaining,
        });
        success(`残り ${remaining} コマを未消化プールに退避しました`);
        setHeldRefreshKey((k) => k + 1);
      } catch (e) {
        toastError(e instanceof Error ? e.message : 'プールへの退避に失敗しました');
      }
    }
    setPlacingAdhoc(null);
  }, [placingAdhoc, schoolId, success, toastError]);

  // セル背景クリック=担当未決定。講師カードクリック=講師指定。
  const handleAdhocPlace = useCallback(
    (date: string, slotId: string) => doAdhocPlace(date, slotId, null),
    [doAdhocPlace]
  );
  const handleAdhocPlaceWithTeacher = useCallback(
    (date: string, slotId: string, teacherId: string) => doAdhocPlace(date, slotId, teacherId),
    [doAdhocPlace]
  );

  // 保留プールの「配置」→ 振替の汎用配置モードを開始（同じ行の再クリックで解除）。
  const handleStartHeldTransferPlacement = useCallback(
    (entry: ScheduleEntry) => {
      if (placingAdhoc?.mode === 'transfer' && placingAdhoc.fromEntryId === entry.id) {
        setPlacingAdhoc(null);
        return;
      }
      // 排他：講習/テスト対策モードを解除してから配置モードに入る。
      setSelectedKoushu(null);
      setKoushuEnrollments(new Map());
      setKoushuScheduledCounts(new Map());
      setKoushuDraftProposals([]);
      setPlacingKoushuStudent(null);
      setTestPrepActive(false);
      setPlacingTestPrep(null);
      setTransferMode(null);
      setSwapMode(null);
      const name = entry.student
        ? `${entry.student.last_name}${entry.student.first_name}`.trim() || '生徒'
        : '生徒';
      const subjName = (entry.subject_ids ?? [])
        .map((id) => subjectById.get(id))
        .filter((n): n is string => !!n)
        .join('・');
      setPlacingAdhoc({
        mode: 'transfer',
        displayName: name,
        subjectName: subjName,
        placedCount: 0,
        studentId: entry.student_id,
        excludeEntryId: entry.id,
        fromEntryId: entry.id,
        sourceEntryDate: entry.entry_date,
        // 講師カード配置可否（point 4）の判定材料を振替元エントリから引き継ぐ。
        subjectIds: entry.subject_ids ?? [],
        ratio: entry.ratio === 1 ? 1 : 2,
        halfPosition: entry.half_position ?? null,
        excludedTeacherIds: entry.student?.excluded_teacher_ids ?? [],
        preferredGender: entry.student?.preferred_teacher_gender ?? null,
      });
    },
    [placingAdhoc, subjectById]
  );

  // 排他：講習/テスト対策/振替モードを解除する共通処理（配置モード開始前に呼ぶ）。
  const clearOtherModes = useCallback(() => {
    setSelectedKoushu(null);
    setKoushuEnrollments(new Map());
    setKoushuScheduledCounts(new Map());
    setKoushuDraftProposals([]);
    setPlacingKoushuStudent(null);
    setTestPrepActive(false);
    setPlacingTestPrep(null);
    setTransferMode(null);
    setSwapMode(null);
  }, []);

  // 「授業を追加」モーダルの Step1 確定 → 授業追加の配置モードを開始。
  const handleStartLessonPlacement = useCallback(
    (payload: AddLessonPlacementPayload) => {
      clearOtherModes();
      // point 4 の判定材料（担当除外・希望性別）は既存生徒のときだけ生徒マスタから引く。
      const stu = payload.studentId ? students.find((s) => s.id === payload.studentId) : null;
      setPlacingAdhoc({
        mode: 'lesson',
        displayName: payload.displayName,
        subjectName: payload.subjectName,
        placedCount: 0,
        studentId: payload.studentId,
        excludeEntryId: null,
        inquiryId: payload.inquiryId,
        subjectIds: [payload.subjectId],
        kind: payload.kind,
        ratio: payload.ratio,
        durationMinutes: payload.durationMinutes,
        halfPosition: payload.halfPosition,
        trialMarked: false,
        targetCount: payload.targetCount,
        pendingLessonId: null,
        excludedTeacherIds: stu?.excluded_teacher_ids ?? [],
        preferredGender: stu?.preferred_teacher_gender ?? null,
      });
      setAddLessonOpen(false);
    },
    [clearOtherModes, students]
  );

  // 未消化プールの「配置」→ 残数を target に授業追加の配置モードを再開する（配置ごとに残数減）。
  const handleStartPendingLessonPlacement = useCallback(
    (pl: PendingLesson) => {
      // 同じプール行を再クリックで解除（トグル）。
      if (placingAdhoc?.mode === 'lesson' && placingAdhoc.pendingLessonId === pl.id) {
        setPlacingAdhoc(null);
        return;
      }
      clearOtherModes();
      const stu = pl.student_id ? students.find((s) => s.id === pl.student_id) : null;
      const displayName = pl.student
        ? `${pl.student.last_name}${pl.student.first_name}`.trim() || '生徒'
        : (pl.inquiry?.student_name ?? '見込み客');
      const subjName = subjectById.get(pl.subject_id) ?? '';
      setPlacingAdhoc({
        mode: 'lesson',
        displayName,
        subjectName: subjName,
        placedCount: 0,
        studentId: pl.student_id,
        excludeEntryId: null,
        inquiryId: pl.inquiry_id,
        subjectIds: [pl.subject_id],
        kind: pl.kind,
        ratio: pl.ratio,
        durationMinutes: pl.duration_minutes,
        halfPosition: pl.half_position,
        trialMarked: false,
        targetCount: pl.remaining_count,
        pendingLessonId: pl.id,
        excludedTeacherIds: stu?.excluded_teacher_ids ?? [],
        preferredGender: stu?.preferred_teacher_gender ?? null,
      });
    },
    [placingAdhoc, clearOtherModes, students, subjectById]
  );

  // 座席表グリッドへ渡す「配置モード」プロップ。優先度: 汎用配置 > テスト対策 > 講習。
  // 三者は排他なので同時に有効にはならないが、汎用配置を最優先分岐にして既存2モードの挙動を保つ。
  const gridPlacing = !!placingKoushuStudent || !!placingTestPrep || !!placingAdhoc;
  const gridGetPlaceability = placingAdhoc
    ? getAdhocPlaceability
    : placingTestPrep
      ? getTestPrepPlaceability
      : getKoushuPlaceability;
  const gridPlace = placingAdhoc
    ? handleAdhocPlace
    : placingTestPrep
      ? handleTestPrepPlace
      : handleKoushuPlace;
  const gridPlaceWithTeacher = placingAdhoc
    ? handleAdhocPlaceWithTeacher
    : placingTestPrep
      ? handleTestPrepPlaceWithTeacher
      : handleKoushuPlaceWithTeacher;
  // point 4: 講師カード単位の配置可否は adhoc 配置中のみ渡す（講習/テスト対策は undefined＝従来挙動）。
  const gridGetTeacherConstraint = placingAdhoc ? getAdhocTeacherConstraint : undefined;

  // 週移動（座席表の左右端の縦長アイコンからも操作できるように）
  const goPrevWeek = useCallback(() => {
    setWeekStart((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() - 7);
      return n;
    });
  }, []);
  const goNextWeek = useCallback(() => {
    setWeekStart((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() + 7);
      return n;
    });
  }, []);

  const handleStudentEntryDrop = useCallback(
    async (entryId: string, targetDate: string, targetSlotId: string, targetTeacherId: string) => {
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
        const isSameSlot = entry.entry_date === targetDate && entry.time_slot_id === targetSlotId;
        if (isSameSlot) {
          // 【未定 → 講師確定】の D&D は「このコマだけ / 毎週このコマ」を確認する。
          // 即時 moveScheduleEntry で write してしまうと「今後ずっと続くのか今回だけか」
          // が分からないまま固定化される事故が起きるため、必ず確認 floating bar 経由にする。
          if (!entry.teacher_id && targetTeacherId) {
            const teacher = teachers.find((t) => t.id === targetTeacherId);
            if (teacher) {
              const studentName = entry.student
                ? `${entry.student.last_name ?? ''}${entry.student.first_name ?? ''}`.trim() ||
                  '生徒'
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
          // 見込み客（student_id 無し）は振替対象外。空文字なら使用量0扱いで先へ進む（実質発生しない経路）。
          const usage = await getMonthlyTransferUsage(entry.student_id ?? '', entry.entry_date);
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
    },
    [
      entriesWithSubjects,
      entries,
      schoolId,
      success,
      refreshEntries,
      toastError,
      teachers,
      timeSlots,
      transferOverLimitConfirm,
      profile?.id,
    ]
  );

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
  }, [
    pendingAssignment,
    success,
    toastError,
    refreshEntries,
    entriesWithSubjects,
    schoolId,
    profile?.id,
  ]);

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
  }, [
    pendingAssignment,
    success,
    toastError,
    refreshEntries,
    confirmAssignTransient,
    entriesWithSubjects,
    schoolId,
    profile?.id,
  ]);

  // 講師欠勤トグル（コマ単位）。欠勤なら解除、出勤なら欠勤登録。生徒は触らない。
  const handleToggleAbsence = useCallback(
    async (date: string, slotId: string, teacherId: string) => {
      if (!schoolId) return;
      const { markTeacherAbsent, unmarkTeacherAbsent, absenceKey } =
        await import('@/lib/api/teacher-absences');
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
  const canTeacherTeachSubjects = useCallback(
    (teacherId: string, subjectIds: string[]) => {
      if (subjectIds.length === 0) return true;
      const teacher = teachers.find((t) => t.id === teacherId);
      const allowed = teacher?.teachable_subject_ids;
      if (!allowed || allowed.length === 0) return true;
      return subjectIds.every((id) => allowed.includes(id));
    },
    [teachers]
  );

  const handleEditSave = useCallback(
    async (form: ScheduleEntryFormData) => {
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
    },
    [editingEntry, canTeacherTeachSubjects, toastError, success, refreshEntries]
  );

  const handleTransfer = useCallback(
    async (
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
    },
    [schoolId, transferringEntry, success, refreshEntries, toastError]
  );

  const handleDeleteConfirm = useCallback(
    async (deleteType: 'single' | 'regular') => {
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
    },
    [deletingEntry, success, refreshEntries, toastError]
  );

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

  const isAdmin =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';
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

  // NOTE: 「報告書見本」は上部の独立ボタンを廃止し、ツールバーの「管理▾」メニュー項目へ移動した（上部圧縮）。
  // fullWidth: 盤面を画面いっぱいに使う（コンテナ幅制限を解除）。盤面セクション自体は
  // さらに負マージンで px-4 を打ち消してフルブリードにする（下の schedule-board-bleed 参照）。

  // コンテキストヘルプ（?）。上部の独立配置をやめ、ツールバーの「管理」ボタンの右へ置く。
  const contextHelp = (
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
          steps: ['「設定」→「コマ時間設定」ページを開く', '時間帯の追加・編集・削除を実行'],
        },
      ]}
    />
  );

  return (
    <AdminLayout headerTitle="座席表" fullWidth>
      {/* 画面コンテンツ一式を print:hidden で包む。印刷時はこの下の #schedule-daily-print
          だけを出す（ツールバー・タブ・凡例・各パネル・盤面はすべて隠す）。AppHeader は
          AppHeader 側で既に print:hidden。日次印刷ビューはこのラッパーの外（下）に置く。 */}
      <div className="space-y-4 print:hidden">
        {selectedSchoolId === 'all' && (
          <SchoolSwitcher
            schools={schools}
            selectedSchoolId={selectedSchoolIdLocal}
            onChange={setSelectedSchoolIdLocal}
          />
        )}
        {/* ツールバー（週ナビ・モード・向き）は作業中に常時必要なので sticky。
            AppHeader は relative（スクロールで流れる）ため top-0 でよい。
            転置モードの時限見出しはこの実測高さぶん下に貼り付く（stickyOffset）。 */}
        <div
          ref={setToolbarEl}
          className="sticky top-0 z-30 -mx-4 px-4 py-1.5 bg-bg/95 backdrop-blur-sm border-b border-border-default print:static print:border-0"
        >
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
            orientation={orientation}
            onOrientationChange={setOrientationPersist}
            colMode={colMode}
            onColModeChange={setColModePersist}
            formationTabs={formationTabs}
            activeFormation={activeFormation}
            onFormationChange={handleFormationChange}
            onAddLesson={() => setAddLessonOpen(true)}
            helpSlot={contextHelp}
          />
        </div>

        {schoolId && !isFormationBoard && (
          <ScheduleDriftBanner
            schoolId={schoolId}
            userId={profile?.id}
            onResynced={refreshEntries}
          />
        )}

        {/* 上部の配置状況チップ行: 未配置サマリ＋振替保留（配置待ちプール）。
            どちらも既定はコンパクトなチップで横並び。展開はフル幅で下に回り込む。個別タブ専用。 */}
        {!isFormationBoard && (
          <div className="flex flex-wrap items-center gap-2">
            {(() => {
              const unassignedCount = displayEntries.filter(
                (e) => !e.teacher_id && e.status !== 'cancelled' && e.status !== 'transferred_out'
              ).length;
              if (unassignedCount === 0) return null;
              if (!unplacedBannerOpen) {
                return (
                  <button
                    type="button"
                    onClick={() => setUnplacedBannerOpen(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-warning-subtle/60 border border-warning/40 text-xs text-warning font-semibold hover:bg-warning-subtle transition-colors print:hidden"
                    title="クリックで詳細（一括マッチング導線）を表示"
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
                    未配置 {unassignedCount}
                    <ChevronRight className="w-3 h-3 opacity-70" />
                  </button>
                );
              }
              return (
                <div className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg bg-warning-subtle/40 border border-warning/30 text-xs print:hidden">
                  <button
                    type="button"
                    onClick={() => setUnplacedBannerOpen(false)}
                    className="text-warning font-semibold flex items-center gap-1.5"
                    title="折りたたむ"
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
                    今週の未配置: {unassignedCount} コマ
                  </button>
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

            {/* 振替の保留（配置待ちプール）: 未配置チップの隣に同テイストの小チップ。
                「配置」で汎用配置モードを開始。0件のときは内部で null を返す。 */}
            {schoolId && !selectedKoushu && !testPrepActive && (
              <HeldTransfersPanel
                schoolIds={[schoolId]}
                refreshKey={heldRefreshKey}
                subjectNameById={subjectById}
                placingEntryId={placingAdhoc?.mode === 'transfer' ? placingAdhoc.fromEntryId : null}
                placingPendingLessonId={
                  placingAdhoc?.mode === 'lesson' ? (placingAdhoc.pendingLessonId ?? null) : null
                }
                onStartPlacement={handleStartHeldTransferPlacement}
                onStartPendingPlacement={handleStartPendingLessonPlacement}
              />
            )}
          </div>
        )}

        {/* 座席表の凡例（バッジ・色の意味）。折りたたみ式。 */}
        <ScheduleLegend />

        {/* Phase P2: 汎用配置モード（振替保留の配置 / 授業追加の配置）中の上部ミニバナー。個別タブ専用。 */}
        {!isFormationBoard && placingAdhoc && (
          <AdhocPlacementBar
            mode={placingAdhoc.mode}
            displayName={placingAdhoc.displayName}
            subjectName={placingAdhoc.subjectName}
            placedCount={placingAdhoc.placedCount}
            targetCount={
              placingAdhoc.mode === 'lesson' ? (placingAdhoc.targetCount ?? undefined) : undefined
            }
            onDone={handleAdhocDone}
          />
        )}

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
        {schoolId && !isFormationBoard && (
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
        ) : isFormationBoard ? (
          /* ===== 形態ボード（小集団・プログラミング等） ===== */
          formationSlots.length === 0 ? (
            <Card className="border-[var(--primary)]/40 bg-[var(--primary-subtle)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-[var(--headline)]">
                  <Clock className="h-5 w-5" />
                  {activeFormationMeta?.label ?? 'この形態'}のコマ時間が未設定です
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[var(--paragraph)] mb-4">
                  この形態のクラス枠を登録するには、まずコマ時間を設定してください。
                </p>
                <Link href="/settings/time-slots">
                  <Button>コマ時間設定へ</Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="schedule-print -mx-4 -mb-6">
              {entriesLoading ? (
                <div className="py-8">
                  <Loading size="md" />
                </div>
              ) : (
                <div className="print:hidden">
                  <FormationBoard
                    weekDates={weekDates}
                    slots={formationSlots}
                    entries={formationEntries}
                    closedDates={closedDates}
                    maxStudentsPerGroup={formationMaxStudents}
                    subjectNameById={new Map(masterSubjects.map((s) => [s.id, s.name]))}
                    addLabel="クラス枠"
                    orientation={orientation}
                    stickyOffset={stickyOffset}
                    onCreate={handleFormationCreate}
                    onAddStudent={handleFormationAddStudent}
                    onStudentClick={handleEntryClick}
                  />
                </div>
              )}
            </div>
          )
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
                  {/* 通塾日程の登録は生徒詳細に一本化した（横断一覧ページは廃止）ため、
                      空状態の導線は生徒管理へ送る。 */}
                  <p className="text-[var(--paragraph)] mb-4">
                    スケジュールを生成するには、生徒詳細から通塾日程を登録してください。
                  </p>
                  <Link href="/students">
                    <Button>生徒管理へ</Button>
                  </Link>
                </CardContent>
              </Card>
            )}

            {timeSlotsCount > 0 && patternsCount > 0 && (
              /* 盤面セクション（フルブリード）: Card の枠に入れず、負マージンで
                 AdminLayout(fullWidth) の px-4 / 下端 py-6 を打ち消して画面いっぱいに広げる。
                 キャンバス色（--sd-canvas）はグリッド側の boardCanvas がページ端まで塗る。 */
              <div className="schedule-print -mx-4 -mb-6">
                {transferMode && (
                  <div className="px-3 pb-2">
                    <TransferModeBar
                      entry={transferMode.sourceEntry}
                      slotLabel={
                        transferMode.sourceEntry.time_slot
                          ? `${transferMode.sourceEntry.time_slot.slot_number}限`
                          : undefined
                      }
                      onCancel={() => setTransferMode(null)}
                      onHold={handleTransferModeHold}
                    />
                  </div>
                )}
                {/* §2.12 生徒の入れ替えモードのバー */}
                {swapMode && (
                  <div className="px-3 pb-2">
                    <SwapModeBar
                      entry={swapMode.sourceEntry}
                      teacherName={
                        swapMode.sourceEntry.teacher?.display_name ??
                        swapMode.sourceEntry.teacher?.email ??
                        undefined
                      }
                      onCancel={() => setSwapMode(null)}
                    />
                  </div>
                )}
                {entriesLoading ? (
                  <div className="py-8">
                    <Loading size="md" />
                  </div>
                ) : (
                  <div className="print:hidden relative">
                    {/* 左右端の週移動。通常は不可視で、画面端の細いホットゾーンに
                        カーソルが近づいたときだけフェードイン。
                        フルブリード化で盤面右端のカード操作（✕・座席番号入力）が画面端
                        ~15px まで迫るため、ホットゾーンは 12px(w-3) に抑えて重なりを避ける。
                        タッチ環境はツールバーの前週/次週で操作できるため問題なし。 */}
                    <div className="group fixed left-0 top-0 bottom-0 w-3 z-40 print:hidden">
                      <button
                        type="button"
                        onClick={goPrevWeek}
                        aria-label="前週へ"
                        title="前週へ"
                        className="absolute left-1 top-1/2 -translate-y-1/2 w-7 hover:w-12 h-40 flex items-center justify-center rounded-lg bg-white/90 hover:bg-white border border-border-default text-text-muted shadow-md hover:shadow-lg hover:text-text-body opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-[opacity,width,background-color,box-shadow,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="group fixed right-0 top-0 bottom-0 w-3 z-40 print:hidden">
                      <button
                        type="button"
                        onClick={goNextWeek}
                        aria-label="次週へ"
                        title="次週へ"
                        className="absolute right-1 top-1/2 -translate-y-1/2 w-7 hover:w-12 h-40 flex items-center justify-center rounded-lg bg-white/90 hover:bg-white border border-border-default text-text-muted shadow-md hover:shadow-lg hover:text-text-body opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-[opacity,width,background-color,box-shadow,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
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
                      swapMode={swapMode}
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
                      getTeacherPlaceConstraint={gridGetTeacherConstraint}
                      orientation={orientation}
                      colMode={colMode}
                      boothMapByDate={weekBoothMap}
                      onSeatNoChange={handleSeatNoChange}
                      stickyOffset={stickyOffset}
                    />
                    {/* 集団レーン（講習モードかつ集団コマ時間がある場合のみ）。集団は手動編成。
                          フルブリード化に伴い、端に張り付かないよう横パディングだけ入れる。 */}
                    {selectedKoushu && groupSlots.length > 0 && (
                      <div className="px-3">
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
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 日次印刷ビュー。画面では hidden、印刷時のみ表示（print:block）。
          上の print:hidden ラッパーの外に置くことで、印刷時にこれだけが出る。
          日付横の印刷アイコンで指定した日（printDay）を1ページに出力する。 */}
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
        // 形態タブでは振替候補コマ・スロットラベルをその形態に限定する
        timeSlots={isFormationBoard ? formationSlots : timeSlots}
        onTransferFromAction={handleTransferFromAction}
        // §2.12 入れ替えは個別タブ・かつ他モード非アクティブのときだけ「入れ替え」ボタンを出す。
        onSwapFromAction={
          activeFormation === INDIVIDUAL_FORMATION &&
          !gridPlacing &&
          !transferMode &&
          !selectedKoushu &&
          !testPrepActive
            ? handleSwapFromAction
            : undefined
        }
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
        onTransferHold={handleTransferHold}
        teacherDetailOpen={teacherDetailOpen}
        onTeacherDetailClose={() => {
          setTeacherDetailOpen(false);
          setSelectedTeacher(null);
        }}
        selectedTeacher={selectedTeacher}
        availabilityMap={availabilityMap}
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

      {/* Phase T→P2: 授業を追加モーダル。Step1（種別・対象者・科目・比率/45分）を選び、
          「座席表から日程を選ぶ」で配置モード（placingAdhoc:'lesson'）を開始する。 */}
      {schoolId && (
        <AddLessonModal
          isOpen={addLessonOpen}
          onClose={() => setAddLessonOpen(false)}
          schoolId={schoolId}
          subjects={masterSubjects}
          onStartPlacement={handleStartLessonPlacement}
        />
      )}

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
      {groupKomaTarget &&
        (() => {
          const slot = groupSlots.find((s) => s.id === groupKomaTarget.slotId) ?? null;
          // 対象コマに出勤可能な講師のみ提示。
          // 集団のコマ時間は個別と別なので、曜日だけで絞ると「その曜日には来るが
          // この時間帯には居ない」講師まで候補に出てしまう。在室区間が取れているときは
          // コマの実時刻で絞り、取れないとき（period 皆無で旧APIフォールバック中など）は
          // 従来どおり曜日粒度に落とす。
          const dow = new Date(groupKomaTarget.date + 'T12:00:00').getDay();
          const availIds =
            availabilityMap && availabilityMap.byDayOfWeek.size > 0 && slot
              ? new Set(
                  availableUserIdsForInterval(availabilityMap, dow, slot.start_time, slot.end_time)
                )
              : new Set(shiftByDow.get(dow) ?? []);
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

      {/* 形態別クラス枠 登録モーダル（Phase C）。セル起点で曜日×コマ自動設定。 */}
      {formationTarget && (
        <FormationKomaFormModal
          open={!!formationTarget}
          onClose={() => setFormationTarget(null)}
          schoolId={schoolId ?? ''}
          formationLabel={activeFormationMeta?.label ?? '形態'}
          date={formationTarget.date}
          slot={formationSlots.find((s) => s.id === formationTarget.slotId) ?? null}
          subjects={masterSubjects}
          maxStudents={formationMaxStudents}
          teachers={teachers
            .filter((t) => t.user_schools?.some((us) => us.school_id === schoolId))
            .map((t) => ({ id: t.id, display_name: t.display_name, email: t.email }))}
          mode={formationTarget.mode}
          lockedTeacherId={formationTarget.teacherId}
          onSubmit={handleSubmitFormationKoma}
        />
      )}

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
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 active:scale-[0.97] disabled:opacity-50 transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
              title="このコマだけ teacher_id を埋める（パターン未変更、翌週は再び未決定）"
            >
              このコマだけ
            </button>
            <button
              type="button"
              onClick={confirmAssignPermanent}
              disabled={isAssigning || !pendingAssignment.regularPatternId}
              className="px-3 py-1.5 text-xs rounded-lg bg-info text-white hover:bg-info/90 active:scale-[0.97] disabled:opacity-50 transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] font-semibold"
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
