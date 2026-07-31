'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  SelectShadcn as Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Textarea,
  Label,
  Input,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Loading,
} from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  ExternalLink,
  Download,
  RotateCcw,
  AlertTriangle,
  UserMinus,
  UserPlus,
  Send,
  ArrowUpDown,
} from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { useMasterData } from '@/contexts/MasterDataContext';
import {
  getAttendanceSummary,
  getAllAttendanceTypes,
  approveAttendanceSheet,
  bulkApproveAttendanceSheets,
  reopenAttendanceSheet,
  getLateEarlyList,
  updateAttendanceSheetMeta,
  updateTeacherExitDate,
  updateTeacherHireDate,
  updateTeacherEmployeeNo,
  getRecentlyRetiredTeachers,
  getNewTeachers,
  getActiveTeacherProfiles,
  reviewAttendanceSheets,
  rejectToTeacher,
  rejectToManager,
  getAdminUsers,
  setKomaChange,
} from '@/lib/api/attendance';
import { getCurrentYearMonth, getPrevMonth, getNextMonth, formatYearMonth } from '@/lib/utils/date';
import { useAuth } from '@/contexts/AuthContext';
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_COLORS,
  type AttendanceType,
  type AttendanceSheetStatus,
} from '@/types/attendance';
import type { School } from '@/types/database';

interface LateEarlyRecord {
  id: string;
  date: string;
  late_early: string | null;
  note: string | null;
  sheet: {
    id: string;
    teacher: { id: string; name: string } | null;
    school: { id: string; name: string } | null;
  };
}

interface SummaryRow {
  id: string;
  school: { id: string; name: string; code?: string | null } | null;
  /** teacher.employee_no は出勤簿一覧の並び順（社員番号順）に使用。exit_date は退職状態バッジ表示に使用 */
  teacher: {
    id: string;
    name: string;
    employee_no?: string | null;
    exit_date?: string | null;
  } | null;
  teacher_id?: string;
  status: string;
  type_totals: Record<
    string,
    {
      name: string;
      unit: string;
      unit_price?: number;
      total: number;
      amount?: number;
    }
  >;
  grand_total: number;
  total_amount: number;
  prep_days: number;
  work_days: number;
  transport_cost: number;
  admin_note: string | null;
  is_koma_changing: boolean;
  /** コマ給変更(1対2) */
  koma_change_from: number | null;
  koma_change_to: number | null;
  /** コマ給変更(1対1) */
  koma_change_from_1to1: number | null;
  koma_change_to_1to1: number | null;
}

interface TeacherProfile {
  id: string;
  name: string;
  exit_date: string | null;
  /** 入社日。入社3ヶ月アラートの判定に使う（NULL=未設定＝対象外） */
  hire_date: string | null;
  created_at: string;
}

/** コマ給変更バッジの本文。1対2・1対1のうち設定されている枠だけを "1対2 ¥2,000→¥2,200" 形式で並べる。 */
function komaChangeLabels(sheet: {
  koma_change_from: number | null;
  koma_change_to: number | null;
  koma_change_from_1to1: number | null;
  koma_change_to_1to1: number | null;
}): string[] {
  const labels: string[] = [];
  if (sheet.koma_change_from !== null && sheet.koma_change_to !== null) {
    labels.push(
      `1対2 ¥${sheet.koma_change_from.toLocaleString()}→¥${sheet.koma_change_to.toLocaleString()}`
    );
  }
  if (sheet.koma_change_from_1to1 !== null && sheet.koma_change_to_1to1 !== null) {
    labels.push(
      `1対1 ¥${sheet.koma_change_from_1to1.toLocaleString()}→¥${sheet.koma_change_to_1to1.toLocaleString()}`
    );
  }
  return labels;
}

type SortOrder = 'employee' | 'name-asc' | 'name-desc' | 'amount-desc';

// exit_date(YYYY-MM-DD)から退職状態を返すヘルパー。
// - null/未設定   → null（表示なし）
// - 今日より前   → 'retired'（退職済み）
// - 今日以降     → 'leaving'（退職予定）
// ローカル日付で比較するため new Date(`${d}T00:00:00`) を使う
function getExitStatus(exitDate: string | null | undefined): 'retired' | 'leaving' | null {
  if (!exitDate) return null;
  const exitLocal = new Date(`${exitDate}T00:00:00`);
  const todayLocal = new Date();
  todayLocal.setHours(0, 0, 0, 0);
  return exitLocal < todayLocal ? 'retired' : 'leaving';
}

// exit_date の月/日を "M/D" 形式で返す（退職予定バッジの日付表示用）
function formatExitMonthDay(exitDate: string): string {
  const d = new Date(`${exitDate}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 社員番号での並び替え。数値化できれば数値順、できなければ文字列順、未設定は末尾、最後に姓でフォールバック
function compareByEmployeeNo(a: SummaryRow, b: SummaryRow): number {
  const ea = (a.teacher?.employee_no ?? '').trim();
  const eb = (b.teacher?.employee_no ?? '').trim();
  if (!ea && !eb) return (a.teacher?.name ?? '').localeCompare(b.teacher?.name ?? '', 'ja');
  if (!ea) return 1;
  if (!eb) return -1;
  const na = Number(ea),
    nb = Number(eb);
  const bothNum = Number.isFinite(na) && Number.isFinite(nb) && ea !== '' && eb !== '';
  if (bothNum && na !== nb) return na - nb;
  if (bothNum) return (a.teacher?.name ?? '').localeCompare(b.teacher?.name ?? '', 'ja');
  return ea.localeCompare(eb, 'ja');
}

/** 登録済みの人事情報チップ（講師名＋内容＋解除ボタン）。入社日・退職日・コマ給で色だけ変える。 */
function HrChip({
  color,
  name,
  detail,
  onClear,
  clearLabel,
}: {
  color: 'blue' | 'orange' | 'purple';
  name: string;
  detail: string;
  onClear: () => void;
  clearLabel: string;
}) {
  const colorClass = {
    blue: 'bg-blue-600 hover:bg-blue-700',
    orange: 'bg-orange-500 hover:bg-orange-600',
    purple: 'bg-purple-600 hover:bg-purple-700',
  }[color];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-white whitespace-nowrap ${colorClass.split(' ')[0]}`}
    >
      <span className="font-medium">{name}</span>
      <span className="opacity-90">{detail}</span>
      <button
        type="button"
        onClick={onClear}
        className={`ml-0.5 rounded px-1 ${colorClass.split(' ')[1]}`}
        aria-label={clearLabel}
      >
        ×
      </button>
    </span>
  );
}

export default function AttendanceManagementPage() {
  const router = useRouter();
  // グローバルの教室選択に連動（ヘッダーのドロップダウンと同期）
  const { profile, schoolIds: userSchoolIds, selectedSchoolId, setSelectedSchoolId } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();

  const isManager = profile?.role === 'manager';
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';

  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [attendanceTypes, setAttendanceTypes] = useState<AttendanceType[]>([]);
  const [sheets, setSheets] = useState<SummaryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [rejectingSheet, setRejectingSheet] = useState<SummaryRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectMode, setRejectMode] = useState<'to-teacher' | 'to-manager'>('to-teacher');
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [reopeningSheet, setReopeningSheet] = useState<SummaryRow | null>(null);
  const [lateEarlyRecords, setLateEarlyRecords] = useState<LateEarlyRecord[]>([]);
  const [prevMonthUnsubmitted, setPrevMonthUnsubmitted] = useState<SummaryRow[]>([]);

  // 人事関連 (admin)
  const [allTeachers, setAllTeachers] = useState<TeacherProfile[]>([]);
  const [recentlyRetired, setRecentlyRetired] = useState<
    { id: string; name: string; exit_date: string | null }[]
  >([]);
  const [newTeachers, setNewTeachers] = useState<{ id: string; name: string; hire_date: string }[]>(
    []
  );
  // 人事・コマ給の登録フォーム。入社日・退職日・コマ給変更は「1人の講師に対する設定」なので、
  // 講師を1回選べば3つともまとめて編集・保存できる1フォームに統合している。
  const [hrTeacherId, setHrTeacherId] = useState<string>('');
  const [hrHireDate, setHrHireDate] = useState<string>('');
  const [hrExitDate, setHrExitDate] = useState<string>('');
  // コマ給変更は指導形態ごと（1対2 / 1対1）に旧→新を持つ
  const [komaChangeFrom, setKomaChangeFrom] = useState<string>('');
  const [komaChangeTo, setKomaChangeTo] = useState<string>('');
  const [komaChangeFrom1to1, setKomaChangeFrom1to1] = useState<string>('');
  const [komaChangeTo1to1, setKomaChangeTo1to1] = useState<string>('');
  // 読み込み時の値。保存時に「変わった項目だけ」書くために比較用として持つ
  const [hrSnapshot, setHrSnapshot] = useState<string>('');
  const [isSavingHr, setIsSavingHr] = useState(false);

  // 教室長: 提出先管理者
  const [adminUsers, setAdminUsers] = useState<{ id: string; name: string }[]>([]);
  const [selectedAdminId, setSelectedAdminId] = useState<string>('');

  // 管理者: 転置ビュー・並べ替え
  const [isTransposedView, setIsTransposedView] = useState(false);
  // デフォルトは社員番号順（出勤簿一覧の標準並び順）
  const [sortOrder, setSortOrder] = useState<SortOrder>('employee');
  // 勤務実績なしの行を隠すか。既定は表示（未入力の講師を見落とさないため）
  const [hideNoWork, setHideNoWork] = useState(false);

  const { schools: masterSchools } = useMasterData();

  const allowedSchools = useMemo(
    () => schools.filter((s) => userSchoolIds.includes(s.id)),
    [schools, userSchoolIds]
  );

  useEffect(() => {
    if (masterSchools.length > 0) setSchools(masterSchools);
  }, [masterSchools]);

  const fetchData = useCallback(async () => {
    // グローバル教室選択の初期化待ち（initialState isLoading=true なので false に戻す）
    if (selectedSchoolId === null) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const schoolId = selectedSchoolId === 'all' ? null : selectedSchoolId;
      const schoolIdsForTypes = schoolId
        ? [schoolId]
        : userSchoolIds.length > 0
          ? userSchoolIds
          : undefined;
      const allowedIds = schoolId
        ? undefined
        : userSchoolIds.length > 0
          ? userSchoolIds
          : undefined;
      const realPrevMonth = getPrevMonth(getCurrentYearMonth());
      const effectiveSchoolIds = schoolId
        ? [schoolId]
        : userSchoolIds.length > 0
          ? userSchoolIds
          : [];

      const [
        typesData,
        summaryResult,
        lateEarlyResult,
        prevMonthSummary,
        retiredResult,
        newResult,
        teacherList,
        adminList,
      ] = await Promise.all([
        getAllAttendanceTypes(schoolIdsForTypes),
        getAttendanceSummary(schoolId, yearMonth, allowedIds),
        getLateEarlyList(schoolId, yearMonth),
        getAttendanceSummary(schoolId, realPrevMonth, allowedIds),
        getRecentlyRetiredTeachers(effectiveSchoolIds, yearMonth),
        getNewTeachers(effectiveSchoolIds, yearMonth),
        getActiveTeacherProfiles(effectiveSchoolIds),
        getAdminUsers(),
      ]);
      setAttendanceTypes(typesData);
      setSheets(summaryResult as SummaryRow[]);
      setLateEarlyRecords(lateEarlyResult);
      setPrevMonthUnsubmitted(
        (prevMonthSummary as SummaryRow[]).filter(
          (s: SummaryRow) => s.status === 'draft' || s.status === 'rejected'
        )
      );
      setRecentlyRetired(retiredResult);
      setNewTeachers(newResult);
      setAllTeachers(teacherList);
      setAdminUsers(adminList);
      // 未選択時のみデフォルト管理者を設定。関数型 setState で現在値を参照することで
      // selectedAdminId を依存配列から外し、初回ロード時の二重フェッチを防ぐ
      if (adminList.length > 0) {
        setSelectedAdminId((prev) => prev || adminList[0].id);
      }
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Failed to fetch data:', err);
      toastError('データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [selectedSchoolId, yearMonth, userSchoolIds, toastError]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!selectedSchoolId || selectedSchoolId === 'all') {
      setSelectedSchool(null);
    } else {
      setSelectedSchool(allowedSchools.find((s) => s.id === selectedSchoolId) || null);
    }
  }, [selectedSchoolId, allowedSchools]);

  // 講師を選んだら、その講師の登録済みの値をフォームへ読み込む。
  // コマ給変更は2枠まとめて上書きするため、既存値を出しておかないと
  // 「1対1だけ後から足す」操作で 1対2 の設定が消える。
  useEffect(() => {
    if (!hrTeacherId) {
      setHrSnapshot('');
      return;
    }
    const teacher = allTeachers.find((t) => t.id === hrTeacherId);
    const existing = sheets.find((s) => (s.teacher?.id || s.teacher_id) === hrTeacherId);
    const num = (v: number | null | undefined) => (v != null ? String(v) : '');
    const next = {
      hire: teacher?.hire_date ?? '',
      exit: teacher?.exit_date ?? '',
      f2: num(existing?.koma_change_from),
      t2: num(existing?.koma_change_to),
      f1: num(existing?.koma_change_from_1to1),
      t1: num(existing?.koma_change_to_1to1),
    };
    setHrHireDate(next.hire);
    setHrExitDate(next.exit);
    setKomaChangeFrom(next.f2);
    setKomaChangeTo(next.t2);
    setKomaChangeFrom1to1(next.f1);
    setKomaChangeTo1to1(next.t1);
    setHrSnapshot(JSON.stringify(next));
  }, [hrTeacherId, allTeachers, sheets]);

  // 未保存の変更があるか（保存ボタンの活性判定に使う）
  const hrCurrent = JSON.stringify({
    hire: hrHireDate,
    exit: hrExitDate,
    f2: komaChangeFrom,
    t2: komaChangeTo,
    f1: komaChangeFrom1to1,
    t1: komaChangeTo1to1,
  });
  const hrDirty = !!hrTeacherId && !!hrSnapshot && hrCurrent !== hrSnapshot;

  // ロール別の対象ステータス
  const actionableStatuses = isManager ? ['submitted'] : ['submitted', 'reviewed'];
  const actionableSheets = sheets.filter((s) => actionableStatuses.includes(s.status));
  const actionableCount = actionableSheets.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === actionableSheets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(actionableSheets.map((s) => s.id)));
    }
  };

  // 管理者: 承認
  const handleApprove = async (sheet: SummaryRow) => {
    if (!profile) return;
    try {
      await approveAttendanceSheet(sheet.id, profile.id);
      success(`${sheet.teacher?.name ?? '不明'}の出勤簿を承認しました`);
      await fetchData();
    } catch {
      toastError('承認に失敗しました');
    }
  };

  // 管理者: 一括承認
  const handleBulkApprove = async () => {
    if (!profile || selectedIds.size === 0) return;
    try {
      await bulkApproveAttendanceSheets(Array.from(selectedIds), profile.id);
      success(`${selectedIds.size}件の出勤簿を承認しました`);
      setSelectedIds(new Set());
      await fetchData();
    } catch {
      toastError('一括承認に失敗しました');
    }
  };

  // 教室長: 管理者へ一括提出
  const handleBulkReview = async () => {
    if (!profile || selectedIds.size === 0 || !selectedAdminId) return;
    try {
      await reviewAttendanceSheets(Array.from(selectedIds), profile.id, selectedAdminId);
      success(`${selectedIds.size}件の出勤簿を管理者へ提出しました`);
      setSelectedIds(new Set());
      await fetchData();
    } catch {
      toastError('提出に失敗しました');
    }
  };

  // 差し戻し
  const handleRejectClick = (sheet: SummaryRow, mode: 'to-teacher' | 'to-manager') => {
    setRejectingSheet(sheet);
    setRejectMode(mode);
    setRejectReason('');
    setIsRejectDialogOpen(true);
  };

  const handleReject = async () => {
    if (!rejectingSheet) return;
    try {
      if (rejectMode === 'to-teacher') {
        await rejectToTeacher(rejectingSheet.id, rejectReason);
        success(`${rejectingSheet.teacher?.name ?? '不明'}の出勤簿を講師に差し戻しました`);
      } else {
        await rejectToManager(rejectingSheet.id, rejectReason);
        success(`${rejectingSheet.teacher?.name ?? '不明'}の出勤簿を教室長に差し戻しました`);
      }
      setIsRejectDialogOpen(false);
      setRejectingSheet(null);
      await fetchData();
    } catch {
      toastError('差し戻しに失敗しました');
    }
  };

  // 承認取消
  const handleReopenClick = (sheet: SummaryRow) => {
    setReopeningSheet(sheet);
    setIsReopenDialogOpen(true);
  };

  const handleReopen = async () => {
    if (!reopeningSheet) return;
    try {
      await reopenAttendanceSheet(reopeningSheet.id);
      success(`${reopeningSheet.teacher?.name ?? '不明'}の出勤簿の承認を取り消しました`);
      setIsReopenDialogOpen(false);
      setReopeningSheet(null);
      await fetchData();
    } catch {
      toastError('承認取消に失敗しました');
    }
  };

  const handleViewDetail = (sheet: SummaryRow) => {
    router.push(`/admin/attendance/sheets/${sheet.id}`);
  };

  const handleOpenPortal = () => {
    if (!selectedSchool?.code) return;
    window.open(`/attendance/${selectedSchool.code}`, '_blank');
  };

  // 交通費の更新（デバウンス付き）
  const transportTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const handleTransportCostChange = (sheetId: string, value: string) => {
    const numVal = parseInt(value) || 0;
    setSheets((prev) => prev.map((s) => (s.id === sheetId ? { ...s, transport_cost: numVal } : s)));
    if (transportTimers.current[sheetId]) clearTimeout(transportTimers.current[sheetId]);
    transportTimers.current[sheetId] = setTimeout(async () => {
      try {
        await updateAttendanceSheetMeta(sheetId, { transport_cost: numVal });
      } catch {
        toastError('交通費の保存に失敗しました');
      }
    }, 800);
  };

  // 備考の更新（デバウンス付き）
  const noteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const handleAdminNoteChange = (sheetId: string, value: string) => {
    setSheets((prev) =>
      prev.map((s) => (s.id === sheetId ? { ...s, admin_note: value || null } : s))
    );
    if (noteTimers.current[sheetId]) clearTimeout(noteTimers.current[sheetId]);
    noteTimers.current[sheetId] = setTimeout(async () => {
      try {
        await updateAttendanceSheetMeta(sheetId, { admin_note: value || null });
      } catch {
        toastError('備考の保存に失敗しました');
      }
    }, 800);
  };

  // 社員番号のインライン編集（フォーカスを外したタイミングで保存）。
  // 入力中の並び替え（社員番号順ソート）を避けるため、保存は onBlur で行う。
  const handleEmployeeNoBlur = async (sheet: SummaryRow, raw: string) => {
    const teacherId = sheet.teacher?.id || sheet.teacher_id;
    if (!teacherId) return;
    // 全角数字を半角へ正規化
    const normalized = raw
      .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .trim();
    const current = sheet.teacher?.employee_no ?? '';
    if (normalized === current) return; // 変更なしなら何もしない
    try {
      await updateTeacherEmployeeNo(teacherId, normalized || null);
      // 同じ講師の全シート行（全校舎表示時など）に反映 → 社員番号順ソートも更新される
      setSheets((prev) =>
        prev.map((s) =>
          (s.teacher?.id || s.teacher_id) === teacherId && s.teacher
            ? { ...s, teacher: { ...s.teacher, employee_no: normalized || null } }
            : s
        )
      );
      success('社員番号を更新しました');
    } catch {
      toastError('社員番号の保存に失敗しました');
    }
  };

  // 退職日の解除（exit_date を null にクリアする）
  const handleClearExitDate = async (teacherId: string) => {
    try {
      await updateTeacherExitDate(teacherId, null);
      success('退職日を解除しました');
      await fetchData();
    } catch {
      toastError('退職日の解除に失敗しました');
    }
  };

  // 入社日の解除（hire_date を null にクリアする）
  const handleClearHireDate = async (teacherId: string) => {
    try {
      await updateTeacherHireDate(teacherId, null);
      success('入社日を解除しました');
      await fetchData();
    } catch {
      toastError('入社日の解除に失敗しました');
    }
  };

  // 人事・コマ給フォームの保存。入社日・退職日・コマ給変更のうち、変更があった項目だけ書き込む。
  const handleSaveHr = async () => {
    if (!hrTeacherId || !hrSnapshot) return;
    const snap = JSON.parse(hrSnapshot) as Record<string, string>;
    // コマ給は旧・新が揃って初めて有効。片方だけの入力は「変更なし」として捨てる。
    const parsePair = (from: string, to: string): [number | null, number | null] => {
      const f = parseInt(from);
      const t = parseInt(to);
      if (!f || !t || f <= 0 || t <= 0) return [null, null];
      return [f, t];
    };
    const teacherName = allTeachers.find((t) => t.id === hrTeacherId)?.name ?? '不明';
    setIsSavingHr(true);
    try {
      if (hrHireDate !== snap.hire) {
        await updateTeacherHireDate(hrTeacherId, hrHireDate || null);
      }
      if (hrExitDate !== snap.exit) {
        await updateTeacherExitDate(hrTeacherId, hrExitDate || null);
      }
      const komaDirty =
        komaChangeFrom !== snap.f2 ||
        komaChangeTo !== snap.t2 ||
        komaChangeFrom1to1 !== snap.f1 ||
        komaChangeTo1to1 !== snap.t1;
      if (komaDirty) {
        const [from1to2, to1to2] = parsePair(komaChangeFrom, komaChangeTo);
        const [from1to1, to1to1] = parsePair(komaChangeFrom1to1, komaChangeTo1to1);
        const effectiveSchoolIds =
          !selectedSchoolId || selectedSchoolId === 'all' ? userSchoolIds : [selectedSchoolId];
        await setKomaChange(hrTeacherId, yearMonth, effectiveSchoolIds, {
          from_1to2: from1to2,
          to_1to2: to1to2,
          from_1to1: from1to1,
          to_1to1: to1to1,
        });
      }
      success(`${teacherName}の設定を保存しました`);
      await fetchData();
    } catch {
      toastError('保存に失敗しました');
    } finally {
      setIsSavingHr(false);
    }
  };

  // コマ給変更を解除（1対2・1対1の両枠を解除）
  const handleClearKomaChange = async (sheet: SummaryRow) => {
    if (!sheet.teacher?.id && !sheet.teacher_id) return;
    const teacherId = sheet.teacher?.id || sheet.teacher_id!;
    const effectiveSchoolIds =
      !selectedSchoolId || selectedSchoolId === 'all' ? userSchoolIds : [selectedSchoolId];
    try {
      await setKomaChange(teacherId, yearMonth, effectiveSchoolIds, {
        from_1to2: null,
        to_1to2: null,
        from_1to1: null,
        to_1to1: null,
      });
      success(`${sheet.teacher?.name ?? '不明'}のコマ給変更を解除しました`);
      await fetchData();
    } catch {
      toastError('解除に失敗しました');
    }
  };

  // 並べ替え済みシート
  /**
   * 勤務実績がない（全項目0）行か。
   * 未入力の講師も一覧に出す仕様にしたため、実際には勤務していない講師の行も並ぶ。
   * 給与確認のときに邪魔にならないよう、下にまとめる／隠すの判定に使う。
   */
  const hasNoWork = (s: SummaryRow) => s.grand_total === 0 && s.total_amount === 0;

  const noWorkCount = useMemo(() => sheets.filter(hasNoWork).length, [sheets]);

  const sortedSheets = useMemo(() => {
    // 実績なしを隠す（既定は全件表示）
    const base = hideNoWork ? sheets.filter((s) => !hasNoWork(s)) : sheets;
    const copy = [...base];
    // 並び順に関わらず、実績なしは常に下へ。中の順序は選択中の並び順を保つ。
    const withGroup = (list: SummaryRow[]) =>
      list.sort((a, b) => Number(hasNoWork(a)) - Number(hasNoWork(b)));
    switch (sortOrder) {
      case 'employee':
        // 社員番号順（数値優先・NULL末尾・姓フォールバック）
        return withGroup(copy.sort(compareByEmployeeNo));
      case 'name-asc':
        return withGroup(
          copy.sort((a, b) => (a.teacher?.name ?? '').localeCompare(b.teacher?.name ?? '', 'ja'))
        );
      case 'name-desc':
        return withGroup(
          copy.sort((a, b) => (b.teacher?.name ?? '').localeCompare(a.teacher?.name ?? '', 'ja'))
        );
      case 'amount-desc':
        return withGroup(copy.sort((a, b) => b.total_amount - a.total_amount));
      default:
        return withGroup(copy);
    }
  }, [sheets, sortOrder, hideNoWork]);

  const cycleSortOrder = () => {
    // employee → name-asc → name-desc → amount-desc → employee の順で循環
    setSortOrder((prev) => {
      if (prev === 'employee') return 'name-asc';
      if (prev === 'name-asc') return 'name-desc';
      if (prev === 'name-desc') return 'amount-desc';
      return 'employee';
    });
  };

  const sortLabel =
    sortOrder === 'employee'
      ? '社員番号順'
      : sortOrder === 'name-asc'
        ? '名前 昇順'
        : sortOrder === 'name-desc'
          ? '名前 降順'
          : '金額 降順';

  // CSVエクスポート
  const handleExportCSV = () => {
    if (sheets.length === 0) {
      toastError('エクスポートするデータがありません');
      return;
    }

    if (isAdmin && isTransposedView) {
      handleExportTransposedCSV();
      return;
    }

    const typeNames = Array.from(
      new Set(sheets.flatMap((row) => Object.values(row.type_totals).map((t) => t.name)))
    );

    const hasSchoolColumn = selectedSchoolId === 'all';
    const headers = hasSchoolColumn
      ? [
          '教室',
          '講師名',
          'ステータス',
          ...typeNames,
          '合計',
          '金額合計',
          '準備給日数',
          '勤務日数',
          '交通費',
          '備考',
        ]
      : [
          '講師名',
          'ステータス',
          ...typeNames,
          '合計',
          '金額合計',
          '準備給日数',
          '勤務日数',
          '交通費',
          '備考',
        ];

    const rows = sheets.map((row) => {
      const typeCols = typeNames.map((name) => {
        const typeData = Object.values(row.type_totals).find((t) => t.name === name);
        return typeData?.total || 0;
      });
      const base = hasSchoolColumn
        ? [
            row.school?.name || '',
            row.teacher?.name || '',
            ATTENDANCE_STATUS_LABELS[row.status as keyof typeof ATTENDANCE_STATUS_LABELS] || '',
          ]
        : [
            row.teacher?.name || '',
            ATTENDANCE_STATUS_LABELS[row.status as keyof typeof ATTENDANCE_STATUS_LABELS] || '',
          ];
      return [
        ...base,
        ...typeCols,
        row.grand_total,
        row.total_amount,
        row.prep_days,
        row.work_days,
        row.transport_cost,
        row.admin_note || '',
      ];
    });

    downloadCSV(
      [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join(
        '\n'
      ),
      `出勤簿集計_${yearMonth}.csv`
    );
  };

  // 管理者: 転置CSV
  const handleExportTransposedCSV = () => {
    const teachers = sortedSheets.map((s) => s.teacher?.name || '不明');
    const headers = ['項目', ...teachers, '合計'];

    const rows: (string | number)[][] = [];
    displayTypes.forEach((type) => {
      rows.push([
        type.name,
        ...sortedSheets.map((sheet) => {
          const td = Object.values(sheet.type_totals).find((t) => t.name === type.name);
          return td?.total || 0;
        }),
        sortedSheets.reduce((sum, sheet) => {
          const td = Object.values(sheet.type_totals).find((t) => t.name === type.name);
          return sum + (td?.total || 0);
        }, 0),
      ]);
    });
    rows.push([
      '金額合計',
      ...sortedSheets.map((s) => s.total_amount),
      sortedSheets.reduce((s, r) => s + r.total_amount, 0),
    ]);
    rows.push([
      '準備給日数',
      ...sortedSheets.map((s) => s.prep_days),
      sortedSheets.reduce((s, r) => s + r.prep_days, 0),
    ]);
    rows.push([
      '勤務日数',
      ...sortedSheets.map((s) => s.work_days),
      sortedSheets.reduce((s, r) => s + r.work_days, 0),
    ]);
    rows.push([
      '交通費',
      ...sortedSheets.map((s) => s.transport_cost),
      sortedSheets.reduce((s, r) => s + r.transport_cost, 0),
    ]);
    rows.push(['備考', ...sortedSheets.map((s) => s.admin_note || ''), '']);

    downloadCSV(
      [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join(
        '\n'
      ),
      `出勤簿集計_転置_${yearMonth}.csv`
    );
  };

  const downloadCSV = (csvContent: string, filename: string) => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    success('CSVをダウンロードしました');
  };

  // 遅刻早退のCSVエクスポート
  const handleExportLateEarlyCSV = () => {
    if (lateEarlyRecords.length === 0) {
      toastError('エクスポートするデータがありません');
      return;
    }
    const headers = ['日付', '教室', '講師名', '遅刻早退', '備考'];
    const rows = lateEarlyRecords.map((record) => [
      formatLateEarlyDate(record.date),
      record.sheet?.school?.name || '',
      record.sheet?.teacher?.name || '',
      record.late_early || '',
      record.note || '',
    ]);
    downloadCSV(
      [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join(
        '\n'
      ),
      `遅刻早退一覧_${yearMonth}.csv`
    );
  };

  const showSchoolColumn = !selectedSchoolId || selectedSchoolId === 'all';

  /**
   * 通常テーブルで「コマ種別列より前」にある列数（チェックボックス / 教室 / 社員番号 / 講師名 / ステータス）。
   *
   * ★ 合計行の colSpan をこの定数から引くこと。ヘッダーに列を足したのに合計行の
   *   colSpan を直し忘れると、合計行だけ1列ぶん横にずれる（社員番号列の追加で実際に起きた）。
   *   数字を直書きすると次に列が増えたとき同じ事故になる。
   */
  const leadingColumnCount = showSchoolColumn ? 5 : 4;

  const formatLateEarlyDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
    return `${date.getMonth() + 1}/${date.getDate()}(${dayLabels[date.getDay()]})`;
  };

  const displayTypes = attendanceTypes.filter(
    (type, index, self) => index === self.findIndex((t) => t.name === type.name)
  );

  const [ym_y, ym_m] = yearMonth.split('-').map(Number);
  const monthEndDate = `${yearMonth}-${String(new Date(ym_y, ym_m, 0).getDate()).padStart(2, '0')}`;

  // 「登録済み」一覧の元データ。入社日・退職日は講師単位、コマ給変更は当月シート単位（講師で重複排除）
  const hireDateTeachers = allTeachers.filter((t) => !!t.hire_date);
  const exitDateTeachers = allTeachers.filter((t) => !!t.exit_date);
  const komaChangingTeachers = Array.from(
    new Map(
      sheets
        .filter((s) => s.is_koma_changing)
        .map((s) => [s.teacher?.id || s.teacher_id || s.id, s])
    ).values()
  );

  return (
    <AdminLayout headerTitle="講師勤怠">
      <div className="space-y-6">
        {/* 未提出アラート */}
        {prevMonthUnsubmitted.length > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                前月（{formatYearMonth(getPrevMonth(getCurrentYearMonth()))}
                ）の出勤簿が未提出の講師が{prevMonthUnsubmitted.length}名います
              </p>
              <p className="text-xs text-amber-800 mt-1 break-all">
                {prevMonthUnsubmitted.map((s) => s.teacher?.name ?? '不明').join('、')}
              </p>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setYearMonth(getPrevMonth(getCurrentYearMonth()))}
                >
                  前月を表示
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">出勤簿管理</h1>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleExportCSV} disabled={sheets.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              CSVエクスポート
            </Button>
            {selectedSchool && (
              <Button variant="secondary" onClick={handleOpenPortal}>
                <ExternalLink className="h-4 w-4 mr-2" />
                勤怠ポータルを開く
              </Button>
            )}
          </div>
        </div>

        {/* 人事情報カード (admin only) */}
        {isAdmin && (recentlyRetired.length > 0 || newTeachers.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recentlyRetired.length > 0 && (
              <Card className="border-red-200 bg-red-50/50">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-2 mb-2">
                    <UserMinus className="h-4 w-4 text-red-600" />
                    <span className="text-sm font-semibold text-red-900">先月退職</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recentlyRetired.map((t) => (
                      <Badge key={t.id} className="bg-red-600 text-white">
                        {t.name}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            {newTeachers.length > 0 && (
              <Card className="border-blue-200 bg-blue-50/50">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-2 mb-2">
                    <UserPlus className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-semibold text-blue-900">入社3ヶ月</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {newTeachers.map((t) => (
                      <Badge key={t.id} className="bg-blue-600 text-white">
                        {t.name}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* メインテーブル */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <CardTitle>出勤簿一覧</CardTitle>
              <div className="flex items-center gap-4">
                {/* 管理者: 表示切替・並べ替え */}
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant={isTransposedView ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => setIsTransposedView(!isTransposedView)}
                    >
                      {isTransposedView ? '通常表示' : '振込表示'}
                    </Button>
                    {isTransposedView && (
                      <Button variant="secondary" size="sm" onClick={cycleSortOrder}>
                        <ArrowUpDown className="h-3 w-3 mr-1" />
                        {sortLabel}
                      </Button>
                    )}
                  </div>
                )}
                {/* 未入力の講師も一覧に出す仕様のため、勤務実績なしの行を畳めるようにする。
                    教室長も使うので isAdmin の外に置く。 */}
                {noWorkCount > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setHideNoWork((v) => !v)}
                    title="全項目が0の講師（未入力・勤務なし）の行を隠します"
                  >
                    {hideNoWork
                      ? `実績なしを表示（${noWorkCount}名）`
                      : `実績なしを隠す（${noWorkCount}名）`}
                  </Button>
                )}
                <div className="relative w-48">
                  <Select
                    value={selectedSchoolId ?? 'all'}
                    onValueChange={(v) => setSelectedSchoolId(v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="教室を選択">
                        {!selectedSchoolId || selectedSchoolId === 'all'
                          ? '全教室'
                          : allowedSchools.find((s) => s.id === selectedSchoolId)?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {allowedSchools.length > 1 && <SelectItem value="all">全教室</SelectItem>}
                      {allowedSchools.map((school) => (
                        <SelectItem key={school.id} value={school.id}>
                          {school.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setYearMonth(getPrevMonth(yearMonth))}
                    className="p-2"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <span className="font-medium min-w-[100px] text-center">
                    {formatYearMonth(yearMonth)}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() => setYearMonth(getNextMonth(yearMonth))}
                    className="p-2"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* 一括操作バー */}
            {actionableCount > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-4">
                {isManager ? (
                  <>
                    <span className="text-sm text-text-body">提出済み: {actionableCount}件</span>
                    <div className="flex items-center gap-2">
                      <Select value={selectedAdminId} onValueChange={setSelectedAdminId}>
                        <SelectTrigger className="w-48">
                          <SelectValue placeholder="提出先を選択" />
                        </SelectTrigger>
                        <SelectContent>
                          {adminUsers.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedIds.size > 0 && (
                        <Button onClick={handleBulkReview} disabled={!selectedAdminId}>
                          <Send className="h-4 w-4 mr-2" />
                          選択した{selectedIds.size}件を管理者へ提出
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-text-body">承認待ち: {actionableCount}件</span>
                    {selectedIds.size > 0 && (
                      <Button onClick={handleBulkApprove}>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        選択した{selectedIds.size}件を一括承認
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}

            {isLoading ? (
              <Loading size="md" />
            ) : sheets.length === 0 ? (
              <div className="text-center py-8 text-text-body">出勤簿がありません</div>
            ) : isAdmin && isTransposedView ? (
              /* ===== 管理者: 転置ビュー ===== */
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[120px] sticky left-0 bg-surface-raised z-10">
                        項目
                      </TableHead>
                      {sortedSheets.map((sheet) => {
                        // 転置ビューでも退職状態バッジを表示する
                        const exitStatusT = getExitStatus(sheet.teacher?.exit_date);
                        return (
                          <TableHead key={sheet.id} className="text-center min-w-[100px]">
                            <div className="flex flex-col items-center gap-1">
                              <span className="font-medium text-xs">
                                {sheet.teacher?.name ?? '不明'}
                              </span>
                              {/* 社員番号を講師名の下に小さく表示 */}
                              {sheet.teacher?.employee_no && (
                                <span className="text-[10px] text-gray-400 tabular-nums">
                                  {sheet.teacher.employee_no}
                                </span>
                              )}
                              {komaChangeLabels(sheet).map((label) => (
                                <Badge
                                  key={label}
                                  className="bg-purple-600 text-white text-[9px] px-1"
                                >
                                  {label}
                                </Badge>
                              ))}
                              {/* 退職状態バッジ（転置ビュー用） */}
                              {exitStatusT === 'leaving' && sheet.teacher?.exit_date && (
                                <Badge className="bg-orange-500 text-white text-[9px] px-1">
                                  退職予定 {formatExitMonthDay(sheet.teacher.exit_date)}
                                </Badge>
                              )}
                              {exitStatusT === 'retired' && (
                                <Badge className="bg-gray-400 text-white text-[9px] px-1">
                                  退職
                                </Badge>
                              )}
                              <Badge
                                className={`text-[10px] ${ATTENDANCE_STATUS_COLORS[sheet.status as AttendanceSheetStatus]}`}
                              >
                                {ATTENDANCE_STATUS_LABELS[sheet.status as AttendanceSheetStatus]}
                              </Badge>
                            </div>
                          </TableHead>
                        );
                      })}
                      <TableHead className="text-center font-bold min-w-[80px]">合計</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* コマ種別行 */}
                    {displayTypes.map((type) => (
                      <TableRow key={type.id}>
                        <TableCell className="font-medium sticky left-0 bg-surface-raised z-10">
                          {type.name}
                        </TableCell>
                        {sortedSheets.map((sheet) => {
                          const td = Object.values(sheet.type_totals).find(
                            (t) => t.name === type.name
                          );
                          return (
                            <TableCell key={sheet.id} className="text-center">
                              {td?.total || 0}
                              {type.unit === 'hours' ? 'h' : ''}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center font-medium">
                          {sortedSheets.reduce((sum, sheet) => {
                            const td = Object.values(sheet.type_totals).find(
                              (t) => t.name === type.name
                            );
                            return sum + (td?.total || 0);
                          }, 0)}
                          {type.unit === 'hours' ? 'h' : ''}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* 金額合計 */}
                    <TableRow className="bg-gray-50 font-medium">
                      <TableCell className="sticky left-0 bg-gray-50 z-10">金額合計</TableCell>
                      {sortedSheets.map((sheet) => (
                        <TableCell key={sheet.id} className="text-right">
                          ¥{sheet.total_amount.toLocaleString()}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-bold">
                        ¥{sortedSheets.reduce((s, r) => s + r.total_amount, 0).toLocaleString()}
                      </TableCell>
                    </TableRow>
                    {/* 準備給日数 */}
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-surface-raised z-10">
                        準備給日数
                      </TableCell>
                      {sortedSheets.map((sheet) => (
                        <TableCell key={sheet.id} className="text-center">
                          {sheet.prep_days}日
                        </TableCell>
                      ))}
                      <TableCell className="text-center font-medium">
                        {sortedSheets.reduce((s, r) => s + r.prep_days, 0)}日
                      </TableCell>
                    </TableRow>
                    {/* 勤務日数 */}
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-surface-raised z-10">
                        勤務日数
                      </TableCell>
                      {sortedSheets.map((sheet) => (
                        <TableCell key={sheet.id} className="text-center">
                          {sheet.work_days}日
                        </TableCell>
                      ))}
                      <TableCell className="text-center font-medium">
                        {sortedSheets.reduce((s, r) => s + r.work_days, 0)}日
                      </TableCell>
                    </TableRow>
                    {/* 交通費 (editable) */}
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-surface-raised z-10">
                        交通費
                      </TableCell>
                      {sortedSheets.map((sheet) => (
                        <TableCell key={sheet.id}>
                          <Input
                            type="number"
                            min="0"
                            value={sheet.transport_cost || ''}
                            onChange={(e) => handleTransportCostChange(sheet.id, e.target.value)}
                            placeholder="0"
                            className="w-20 h-7 text-sm text-right mx-auto"
                          />
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium">
                        ¥{sortedSheets.reduce((s, r) => s + r.transport_cost, 0).toLocaleString()}
                      </TableCell>
                    </TableRow>
                    {/* 備考 (editable) */}
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-surface-raised z-10">
                        備考
                      </TableCell>
                      {sortedSheets.map((sheet) => (
                        <TableCell key={sheet.id}>
                          <Input
                            value={sheet.admin_note || ''}
                            onChange={(e) => handleAdminNoteChange(sheet.id, e.target.value)}
                            placeholder="備考"
                            className="h-7 text-sm min-w-[80px]"
                          />
                        </TableCell>
                      ))}
                      <TableCell />
                    </TableRow>
                    {/* 操作行 */}
                    <TableRow className="bg-gray-50">
                      <TableCell className="font-medium sticky left-0 bg-gray-50 z-10">
                        操作
                      </TableCell>
                      {sortedSheets.map((sheet) => (
                        <TableCell key={sheet.id}>
                          <div className="flex flex-col gap-1 items-center">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleViewDetail(sheet)}
                              className="text-xs w-full"
                            >
                              詳細
                            </Button>
                            {sheet.status === 'reviewed' && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => handleApprove(sheet)}
                                  className="text-green-600 hover:text-green-700 hover:bg-green-50 text-xs w-full"
                                >
                                  承認
                                </Button>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => handleRejectClick(sheet, 'to-manager')}
                                  className="text-xs w-full"
                                >
                                  差戻
                                </Button>
                              </>
                            )}
                            {sheet.status === 'submitted' && (
                              <Button
                                size="sm"
                                onClick={() => handleApprove(sheet)}
                                className="text-green-600 hover:text-green-700 hover:bg-green-50 text-xs w-full"
                              >
                                承認
                              </Button>
                            )}
                            {sheet.status === 'approved' && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleReopenClick(sheet)}
                                className="text-xs w-full"
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                取消
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      ))}
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ) : (
              /* ===== 通常テーブル ===== */
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={actionableCount > 0 && selectedIds.size === actionableCount}
                          onCheckedChange={toggleSelectAll}
                          disabled={actionableCount === 0}
                        />
                      </TableHead>
                      {/* 見出しは折り返すと3行に崩れて表が読みにくくなるため、すべて1行に固定する */}
                      {showSchoolColumn && (
                        <TableHead className="whitespace-nowrap">教室</TableHead>
                      )}
                      <TableHead className="min-w-[60px] whitespace-nowrap">社員番号</TableHead>
                      <TableHead className="whitespace-nowrap">講師名</TableHead>
                      <TableHead className="text-center whitespace-nowrap">ステータス</TableHead>
                      {displayTypes.map((type) => (
                        <TableHead key={type.id} className="text-center whitespace-nowrap">
                          {type.name}
                        </TableHead>
                      ))}
                      <TableHead className="text-center whitespace-nowrap">合計</TableHead>
                      <TableHead className="text-right whitespace-nowrap">金額</TableHead>
                      <TableHead className="text-center whitespace-nowrap">準備給日数</TableHead>
                      <TableHead className="text-center whitespace-nowrap">勤務日数</TableHead>
                      <TableHead className="text-center whitespace-nowrap">交通費</TableHead>
                      <TableHead className="min-w-[120px] whitespace-nowrap">備考</TableHead>
                      <TableHead className="min-w-[200px] whitespace-nowrap">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* sortedSheets を使う（実績なしを下にまとめる／隠す指定を通常表示にも効かせる） */}
                    {sortedSheets.map((sheet) => {
                      // 退職状態を計算してグレーアウトや退職バッジの表示に使う
                      const exitStatus = getExitStatus(sheet.teacher?.exit_date);
                      return (
                        <TableRow
                          key={sheet.id}
                          className={exitStatus === 'retired' ? 'opacity-60' : undefined}
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(sheet.id)}
                              onCheckedChange={() => toggleSelect(sheet.id)}
                              disabled={!actionableStatuses.includes(sheet.status)}
                            />
                          </TableCell>
                          {showSchoolColumn && (
                            <TableCell className="whitespace-nowrap">
                              {sheet.school?.name ?? ''}
                            </TableCell>
                          )}
                          <TableCell className="text-sm text-gray-500 tabular-nums">
                            {isAdmin ? (
                              // 社員番号インライン編集（admin/owner のみ）。Enterで確定（blur）。
                              <Input
                                key={`emp-${sheet.id}-${sheet.teacher?.employee_no ?? ''}`}
                                defaultValue={sheet.teacher?.employee_no ?? ''}
                                onBlur={(e) => handleEmployeeNoBlur(sheet, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                }}
                                disabled={!sheet.teacher?.id && !sheet.teacher_id}
                                placeholder="—"
                                inputMode="numeric"
                                className="w-16 h-7 text-center mx-auto"
                              />
                            ) : (
                              (sheet.teacher?.employee_no ?? '—')
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            {/* 講師名は1行に固定し、バッジは名前の下に折り返す（名前自体が2行に割れるのを防ぐ） */}
                            <div className="whitespace-nowrap">{sheet.teacher?.name ?? '不明'}</div>
                            {(sheet.is_koma_changing || exitStatus) && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {komaChangeLabels(sheet).map((label) => (
                                  <Badge
                                    key={label}
                                    className="bg-purple-600 text-white text-[10px] px-1"
                                  >
                                    {label}
                                  </Badge>
                                ))}
                                {/* 退職状態バッジ: 退職予定はオレンジ、退職済みはグレー */}
                                {exitStatus === 'leaving' && sheet.teacher?.exit_date && (
                                  <Badge className="bg-orange-500 text-white text-[10px] px-1">
                                    退職予定 {formatExitMonthDay(sheet.teacher.exit_date)}
                                  </Badge>
                                )}
                                {exitStatus === 'retired' && (
                                  <Badge className="bg-gray-400 text-white text-[10px] px-1">
                                    退職
                                  </Badge>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              className={
                                ATTENDANCE_STATUS_COLORS[sheet.status as AttendanceSheetStatus]
                              }
                            >
                              {ATTENDANCE_STATUS_LABELS[sheet.status as AttendanceSheetStatus]}
                            </Badge>
                          </TableCell>
                          {displayTypes.map((type) => {
                            const typeData = Object.values(sheet.type_totals).find(
                              (t) => t.name === type.name
                            );
                            return (
                              <TableCell key={type.id} className="text-center">
                                {typeData?.total || 0}
                                {type.unit === 'hours' ? 'h' : ''}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-center font-medium">
                            {sheet.grand_total}
                          </TableCell>
                          <TableCell className="text-right">
                            ¥{sheet.total_amount.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-center">{sheet.prep_days}日</TableCell>
                          <TableCell className="text-center">{sheet.work_days}日</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              value={sheet.transport_cost || ''}
                              onChange={(e) => handleTransportCostChange(sheet.id, e.target.value)}
                              placeholder="0"
                              className="w-20 h-7 text-sm text-right"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={sheet.admin_note || ''}
                              onChange={(e) => handleAdminNoteChange(sheet.id, e.target.value)}
                              placeholder="備考"
                              className="h-7 text-sm min-w-[100px]"
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleViewDetail(sheet)}
                              >
                                詳細
                              </Button>
                              {isManager && sheet.status === 'submitted' && (
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => handleRejectClick(sheet, 'to-teacher')}
                                >
                                  差戻
                                </Button>
                              )}
                              {isAdmin && sheet.status === 'reviewed' && (
                                <>
                                  <Button
                                    size="sm"
                                    onClick={() => handleApprove(sheet)}
                                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                  >
                                    承認
                                  </Button>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => handleRejectClick(sheet, 'to-manager')}
                                  >
                                    差戻
                                  </Button>
                                </>
                              )}
                              {isAdmin && sheet.status === 'submitted' && (
                                <Button
                                  size="sm"
                                  onClick={() => handleApprove(sheet)}
                                  className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                >
                                  承認
                                </Button>
                              )}
                              {isAdmin && sheet.status === 'approved' && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleReopenClick(sheet)}
                                >
                                  <RotateCcw className="h-3 w-3 mr-1" />
                                  取消
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {/* 合計行 */}
                    <TableRow className="bg-gray-100 font-medium">
                      <TableCell colSpan={leadingColumnCount}>合計</TableCell>
                      {displayTypes.map((type) => (
                        <TableCell key={type.id} className="text-center">
                          {sheets.reduce((sum, row) => {
                            const typeData = Object.values(row.type_totals).find(
                              (t) => t.name === type.name
                            );
                            return sum + (typeData?.total || 0);
                          }, 0)}
                          {type.unit === 'hours' ? 'h' : ''}
                        </TableCell>
                      ))}
                      <TableCell className="text-center">
                        {sheets.reduce((sum, row) => sum + row.grand_total, 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        ¥{sheets.reduce((sum, row) => sum + row.total_amount, 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-center">
                        {sheets.reduce((sum, row) => sum + row.prep_days, 0)}日
                      </TableCell>
                      <TableCell className="text-center">
                        {sheets.reduce((sum, row) => sum + row.work_days, 0)}日
                      </TableCell>
                      <TableCell className="text-right">
                        ¥{sheets.reduce((sum, row) => sum + row.transport_cost, 0).toLocaleString()}
                      </TableCell>
                      <TableCell />
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 講師の人事・コマ給 (admin only)。
            入社日・退職日・コマ給変更はいずれも「1人の講師に対する設定」なので、
            講師を1回選べば3つともまとめて編集できる1フォームに統合している。 */}
        {isAdmin && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">講師の人事・コマ給</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-sm font-medium">講師</Label>
                <Select value={hrTeacherId} onValueChange={setHrTeacherId}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="講師を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {allTeachers.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hrTeacherId && (
                  <Button size="sm" onClick={handleSaveHr} disabled={!hrDirty || isSavingHr}>
                    {isSavingHr ? '保存中...' : '保存'}
                  </Button>
                )}
              </div>

              {!hrTeacherId ? (
                <p className="text-xs text-text-faint">
                  講師を選ぶと、入社日・退職日・コマ給変更をまとめて登録できます。
                </p>
              ) : (
                <div className="space-y-3 border-l-2 border-border pl-4">
                  {/* 入社日・退職日は user_profiles の値なので月に依存しない */}
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <div className="flex items-center gap-2">
                      <Label className="w-14 text-sm text-text-body">入社日</Label>
                      <Input
                        type="date"
                        value={hrHireDate}
                        onChange={(e) => setHrHireDate(e.target.value)}
                        className="w-40"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="w-14 text-sm text-text-body">退職日</Label>
                      <Input
                        type="date"
                        value={hrExitDate}
                        onChange={(e) => setHrExitDate(e.target.value)}
                        className="w-40"
                      />
                      {!hrExitDate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={() => setHrExitDate(monthEndDate)}
                        >
                          今月末
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* コマ給変更は当月のシートに紐づくので、対象月を明示する */}
                  <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                    <Label className="w-14 text-sm text-text-body pt-2">コマ給</Label>
                    <div className="space-y-2">
                      {(
                        [
                          [
                            '1対2',
                            komaChangeFrom,
                            setKomaChangeFrom,
                            komaChangeTo,
                            setKomaChangeTo,
                          ],
                          [
                            '1対1',
                            komaChangeFrom1to1,
                            setKomaChangeFrom1to1,
                            komaChangeTo1to1,
                            setKomaChangeTo1to1,
                          ],
                        ] as const
                      ).map(([label, fromVal, setFrom, toVal, setTo]) => (
                        <div key={label} className="flex items-center gap-1">
                          <span className="w-10 text-sm text-text-body">{label}</span>
                          <span className="text-sm text-text-body">¥</span>
                          <Input
                            type="number"
                            min="0"
                            value={fromVal}
                            onChange={(e) => setFrom(e.target.value)}
                            placeholder="旧"
                            className="w-24 text-right"
                          />
                          <span className="text-sm text-text-body">→ ¥</span>
                          <Input
                            type="number"
                            min="0"
                            value={toVal}
                            onChange={(e) => setTo(e.target.value)}
                            placeholder="新"
                            className="w-24 text-right"
                          />
                        </div>
                      ))}
                      <p className="text-xs text-text-faint">
                        {formatYearMonth(yearMonth)}
                        の変更として登録します。変更があった指導形態だけ入力してください。
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 登録済みの一覧。誰に何が入っているかを一目で見せ、× で解除する。
                  入社日・退職日は全講師分（未来月の退職日も確認できる）、コマ給変更は当月分。 */}
              {(hireDateTeachers.length > 0 ||
                exitDateTeachers.length > 0 ||
                komaChangingTeachers.length > 0) && (
                <div className="space-y-1.5 border-t border-border pt-3">
                  {hireDateTeachers.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="w-14 text-xs text-text-faint">入社日</span>
                      {hireDateTeachers.map((t) => (
                        <HrChip
                          key={t.id}
                          color="blue"
                          name={t.name}
                          detail={t.hire_date!}
                          onClear={() => handleClearHireDate(t.id)}
                          clearLabel="入社日を解除"
                        />
                      ))}
                    </div>
                  )}
                  {exitDateTeachers.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="w-14 text-xs text-text-faint">退職日</span>
                      {exitDateTeachers.map((t) => (
                        <HrChip
                          key={t.id}
                          color="orange"
                          name={t.name}
                          detail={t.exit_date!}
                          onClear={() => handleClearExitDate(t.id)}
                          clearLabel="退職日を解除"
                        />
                      ))}
                    </div>
                  )}
                  {komaChangingTeachers.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="w-14 text-xs text-text-faint">コマ給</span>
                      {komaChangingTeachers.map((s) => (
                        <HrChip
                          key={s.id}
                          color="purple"
                          name={s.teacher?.name ?? '不明'}
                          detail={komaChangeLabels(s).join('・')}
                          onClear={() => handleClearKomaChange(s)}
                          clearLabel="コマ給変更を解除"
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 遅刻・早退一覧 */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <CardTitle>
                遅刻・早退一覧
                {lateEarlyRecords.length > 0 && (
                  <span className="text-text-body font-normal text-sm ml-2">
                    （{lateEarlyRecords.length}件）
                  </span>
                )}
              </CardTitle>
              <Button
                variant="secondary"
                onClick={handleExportLateEarlyCSV}
                disabled={lateEarlyRecords.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                CSVエクスポート
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Loading size="md" />
            ) : lateEarlyRecords.length === 0 ? (
              <div className="text-center py-8 text-text-body">遅刻・早退のデータがありません</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日付</TableHead>
                      {showSchoolColumn && <TableHead>教室</TableHead>}
                      <TableHead>講師名</TableHead>
                      <TableHead>遅刻早退</TableHead>
                      <TableHead>備考</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lateEarlyRecords.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell>{formatLateEarlyDate(record.date)}</TableCell>
                        {showSchoolColumn && <TableCell>{record.sheet?.school?.name}</TableCell>}
                        <TableCell className="font-medium">{record.sheet?.teacher?.name}</TableCell>
                        <TableCell className="text-red-600 font-medium">
                          {record.late_early}
                        </TableCell>
                        <TableCell className="text-text-body">{record.note || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 差し戻しダイアログ */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {rejectMode === 'to-teacher' ? '講師に差し戻し' : '教室長に差し戻し'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-text-body mb-4">
              {rejectingSheet?.teacher?.name ?? '不明'}の出勤簿を
              {rejectMode === 'to-teacher' ? '講師' : '教室長'}に差し戻します。
            </p>
            <div className="space-y-2">
              <Label htmlFor="reason">差し戻し理由（任意）</Label>
              <Textarea
                id="reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="修正が必要な箇所を記入してください"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsRejectDialogOpen(false)}>
              キャンセル
            </Button>
            <Button variant="danger" onClick={handleReject}>
              差し戻す
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 承認取消確認ダイアログ */}
      <AlertDialog open={isReopenDialogOpen} onOpenChange={setIsReopenDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>承認を取り消しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              承認を取り消すと、確認済みの状態に戻ります。その後、編集・承認・差し戻しを選択できます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsReopenDialogOpen(false)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleReopen}>取り消す</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
