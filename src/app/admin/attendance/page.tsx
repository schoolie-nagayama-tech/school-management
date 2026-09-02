'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  FileSignature,
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
  submitAttendanceSheet,
  getLateEarlyList,
  updateAttendanceSheetMeta,
  updateTeacherExitDate,
  updateTeacherHireDate,
  updateTeacherEmployeeNo,
  getRecentlyRetiredTeachers,
  getNewTeachers,
  getContractRenewalTeachers,
  updateTeacherContractRenewalDate,
  type ContractRenewalTeacher,
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
  ATTENDANCE_FLOW_STEPS,
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

/**
 * 振込表示（転置ビュー）の列装飾。1列=1人なので、列を「縦線」と「1列おきの地色」で
 * 仕切り、どの数字が誰のものか一目で追えるようにする。マウスが乗っている列は
 * さらに強く塗って、横に長い表でも視線が隣の人にずれないようにする。
 *
 * 背景をクラスではなく style で当てているのは、TableHead が自前で bg- クラスを
 * 持っており、Tailwind のユーティリティ同士では記述順で優先度が決まらないため。
 */
function transposedColumnStyle(columnIndex: number, isHovered: boolean): CSSProperties {
  if (isHovered) return { backgroundColor: 'var(--info-subtle)' };
  return {
    backgroundColor: columnIndex % 2 === 1 ? 'var(--accent-ink-subtle)' : 'var(--surface)',
  };
}

/** 振込表示の講師列に共通で当てる枠線。列の左に縦線を引いて人の区切りを作る */
const TRANSPOSED_COL_BORDER = 'border-l border-border';

/** 振込表示の「項目」列（左端固定）に共通で当てるクラス。本文列との境目は太い縦線で切る */
const TRANSPOSED_LABEL_CELL =
  'font-medium sticky left-0 bg-surface-raised z-10 border-r-2 border-border-strong';

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

/** 'YYYY-MM-DD' を '8/31' の形にする（チップは横幅が限られるので年は落とす） */
function formatMonthDayJa(date: string): string {
  const [, m, d] = date.split('-');
  if (!m || !d) return date;
  return `${Number(m)}/${Number(d)}`;
}

/** 登録済みの人事情報チップ（講師名＋内容＋解除ボタン）。入社日・退職日・コマ給で色だけ変える。 */
function HrChip({
  color,
  name,
  detail,
  onClear,
  clearLabel,
}: {
  color: 'blue' | 'orange' | 'purple' | 'amber';
  name: string;
  detail: string;
  onClear: () => void;
  clearLabel: string;
}) {
  const colorClass = {
    blue: 'bg-blue-600 hover:bg-blue-700',
    orange: 'bg-orange-500 hover:bg-orange-600',
    purple: 'bg-purple-600 hover:bg-purple-700',
    amber: 'bg-amber-600 hover:bg-amber-700',
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
  const searchParams = useSearchParams();
  // グローバルの教室選択に連動（ヘッダーのドロップダウンと同期）
  const { profile, schoolIds: userSchoolIds, selectedSchoolId, setSelectedSchoolId } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();

  const isManager = profile?.role === 'manager';
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';
  // 社員番号はシステム管理者のみ。isAdmin は owner を含むので別に持つ
  // （この画面に講師は入れないため、実質の境界は admin と owner/manager の間）。
  const canSeeEmployeeNo = profile?.role === 'admin';

  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  // 表示中の月は URL(?ym=YYYY-MM) にも持たせる。
  // state だけだと、講師の詳細を開いて戻ったときに初期値（当月）へ戻ってしまい、
  // 前月を確認・編集していた場合に毎回選び直しになる。
  const initialYearMonth = searchParams?.get('ym') || getCurrentYearMonth();
  const [yearMonth, setYearMonth] = useState(initialYearMonth);

  /**
   * 月を切り替える。state と URL(?ym=) を同時に更新する。
   * URL に載せておくことで、講師の詳細から戻ったときに同じ月へ戻れる。
   * 履歴を増やさないよう replace を使う（戻るボタンで月送りを遡らせない）。
   */
  const changeYearMonth = useCallback(
    (next: string) => {
      setYearMonth(next);
      router.replace(`/admin/attendance?ym=${next}`, { scroll: false });
    },
    [router]
  );
  const [attendanceTypes, setAttendanceTypes] = useState<AttendanceType[]>([]);
  const [sheets, setSheets] = useState<SummaryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [rejectingSheet, setRejectingSheet] = useState<SummaryRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectMode, setRejectMode] = useState<'to-teacher' | 'to-manager'>('to-teacher');
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [reopeningSheet, setReopeningSheet] = useState<SummaryRow | null>(null);
  // 代理提出（入力中・差し戻し → 提出済み）の確認ダイアログ
  const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false);
  const [submittingSheet, setSubmittingSheet] = useState<SummaryRow | null>(null);
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
  // 契約更新が近い／過ぎている講師（研修期間の終了日を講師登録で入れたもの）
  const [contractRenewals, setContractRenewals] = useState<ContractRenewalTeacher[]>([]);
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
  // 振込表示でマウスが乗っている講師の列。列全体を塗って「いま誰の数字を見ているか」を示す
  const [hoveredSheetId, setHoveredSheetId] = useState<string | null>(null);
  // デフォルトは社員番号順（出勤簿一覧の標準並び順）
  const [sortOrder, setSortOrder] = useState<SortOrder>('employee');
  // 勤務実績なしの行を隠すか。既定は表示（未入力の講師を見落とさないため）
  // 既定で隠す。未入力の講師も一覧に出す仕様にした結果、勤務していない講師の行が
  // 常に並ぶようになったため、通常は畳んだ状態で見せる（ボタンで出せる）。
  const [hideNoWork, setHideNoWork] = useState(true);

  /**
   * 勤務実績がない（全項目0）行か。
   * 「下にまとめる／隠す」と「前月未提出アラートの対象外にする」の両方で使う。
   * fetch のコールバックからも参照するため、state 宣言の近くに置いている。
   */
  const hasNoWork = (s: SummaryRow) => s.grand_total === 0 && s.total_amount === 0;

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
        contractRenewalResult,
        teacherList,
        adminList,
      ] = await Promise.all([
        getAllAttendanceTypes(schoolIdsForTypes),
        getAttendanceSummary(schoolId, yearMonth, allowedIds),
        getLateEarlyList(schoolId, yearMonth),
        getAttendanceSummary(schoolId, realPrevMonth, allowedIds),
        getRecentlyRetiredTeachers(effectiveSchoolIds, yearMonth),
        getNewTeachers(effectiveSchoolIds, yearMonth),
        getContractRenewalTeachers(effectiveSchoolIds),
        getActiveTeacherProfiles(effectiveSchoolIds),
        getAdminUsers(),
      ]);
      setAttendanceTypes(typesData);
      setSheets(summaryResult as SummaryRow[]);
      setLateEarlyRecords(lateEarlyResult);
      // 前月未提出アラート。未入力の講師も一覧に出す仕様にしたため、そのままだと
      // 「その月は勤務していないので出す物がない」講師まで未提出として名前が挙がる。
      // 実績が1つでもある（＝勤務したのに出していない）人だけを追いかける対象にする。
      setPrevMonthUnsubmitted(
        (prevMonthSummary as SummaryRow[]).filter(
          (s: SummaryRow) => (s.status === 'draft' || s.status === 'rejected') && !hasNoWork(s)
        )
      );
      setRecentlyRetired(retiredResult);
      setNewTeachers(newResult);
      setContractRenewals(contractRenewalResult);
      setAllTeachers(teacherList);
      setAdminUsers(adminList);
      // 提出先は自動で選ばない。以前は先頭の管理者を既定にしていたが、セレクトの表示は
      // 「提出先を選択」のままなのにボタンだけ押せる状態になり、誰宛に出るのか分からなかった。
      // 未選択のままにして、明示的に選ぶまで提出ボタンを無効にする。
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
  /**
   * 承認待ち（提出済み・確認済み）をまとめて承認する。
   * 運用上ほぼ一括で承認するため、行の選択は不要にしている
   * （チェックを付けないとボタンが出ず、気づかれなかった）。
   * 個別に承認したいときは各行の「承認」ボタンを使う。
   */
  const handleBulkApprove = async () => {
    if (!profile) return;
    const targetIds = actionableSheets.map((s) => s.id);
    if (targetIds.length === 0) return;
    try {
      await bulkApproveAttendanceSheets(targetIds, profile.id);
      success(`${targetIds.length}件の出勤簿を承認しました`);
      await fetchData();
    } catch {
      toastError('一括承認に失敗しました');
    }
  };

  // 教室長: 管理者へ一括提出
  /**
   * 教室長 → 管理者へ提出。
   * 対象は表示中の「提出済み」全件（行の選択は不要）。
   * 以前は行のチェックが必須で、提出先を選んでもボタンが出ず「提出できない」状態に見えていた。
   */
  const handleBulkReview = async () => {
    if (!profile || !selectedAdminId) return;
    const targetIds = actionableSheets.map((s) => s.id);
    if (targetIds.length === 0) return;
    try {
      await reviewAttendanceSheets(targetIds, profile.id, selectedAdminId);
      success(`${targetIds.length}件の出勤簿を管理者へ提出しました`);
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
  /**
   * 代理提出（入力中・差し戻し → 提出済み）。
   *
   * ★ 本人が出せない出勤簿を誰かが必ず拾えるようにするための操作。
   *   退職・長期欠勤・提出忘れの出勤簿は、誰も出せないと「入力中」のまま残り
   *   承認フローに乗らない。督促して回るのは教室長なので、ロールでは出し分けない
   *   （出勤簿管理を開けるのは室長以上だけ）。
   * ★ 詳細画面の「代理で提出する」と同じ操作。ここに置いたのは、一覧で
   *   「入力中」を見つけたその場で出せるようにするため。
   */
  const handleSubmitClick = (sheet: SummaryRow) => {
    setSubmittingSheet(sheet);
    setIsSubmitDialogOpen(true);
  };

  const handleSubmitSheet = async () => {
    if (!submittingSheet) return;
    try {
      await submitAttendanceSheet(submittingSheet.id);
      success(`${submittingSheet.teacher?.name ?? '不明'}の出勤簿を提出しました`);
      setIsSubmitDialogOpen(false);
      setSubmittingSheet(null);
      await fetchData();
    } catch {
      toastError('提出に失敗しました');
    }
  };

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
    // 表示中の月を渡す。詳細の「戻る」がこの月の一覧へ返るようにするため。
    router.push(`/admin/attendance/sheets/${sheet.id}?ym=${yearMonth}`);
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

  // 契約更新の解除（＝更新が済んだ）。日付をクリアするとアラートから外れる。
  // 次回の更新日を続けて管理したい場合は、講師の編集画面から入れ直す。
  const handleClearContractRenewal = async (teacherId: string) => {
    try {
      await updateTeacherContractRenewalDate(teacherId, null);
      success('契約更新を済みにしました');
      await fetchData();
    } catch {
      toastError('契約更新の解除に失敗しました');
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
      // 入社日・退職日は管理者だけの操作（教室長には入力欄自体を出していない）
      if (isAdmin && hrHireDate !== snap.hire) {
        await updateTeacherHireDate(hrTeacherId, hrHireDate || null);
      }
      if (isAdmin && hrExitDate !== snap.exit) {
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
   *   社員番号列は admin のときだけ出すので連動させる。
   *   内訳: 教室 / 社員番号 / 講師名 / ステータス
   */
  const leadingColumnCount =
    2 + // 講師名・ステータス（常に出る）
    (showSchoolColumn ? 1 : 0) +
    (canSeeEmployeeNo ? 1 : 0);

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
                  onClick={() => changeYearMonth(getPrevMonth(getCurrentYearMonth()))}
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

        {/* 人事情報カード。
            先月退職・入社3ヶ月は管理者のみ。
            契約更新は研修期間の終了を追いかけるもので、期限を判断するのは教室長なので
            教室長にも出す（更新が済んだら × で消す＝アラートを止める）。 */}
        {((isAdmin && (recentlyRetired.length > 0 || newTeachers.length > 0)) ||
          contractRenewals.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {isAdmin && recentlyRetired.length > 0 && (
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
            {isAdmin && newTeachers.length > 0 && (
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
            {contractRenewals.length > 0 && (
              <Card className="border-amber-300 bg-amber-50/60">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-2 mb-2">
                    <FileSignature className="h-4 w-4 text-amber-700" />
                    <span className="text-sm font-semibold text-amber-900">契約更新</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {contractRenewals.map((t) => (
                      <HrChip
                        key={t.id}
                        color={t.overdue ? 'orange' : 'amber'}
                        name={t.name}
                        detail={`${formatMonthDayJa(t.contract_renewal_date)}${t.overdue ? ' 超過' : ''}`}
                        onClear={() => handleClearContractRenewal(t.id)}
                        clearLabel="契約更新を済みにする"
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-amber-800">
                    研修期間の終了日です。更新が済んだら × を押して消してください。
                    次回の更新日は講師の編集画面から入れ直せます。
                  </p>
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
                    onClick={() => changeYearMonth(getPrevMonth(yearMonth))}
                    className="p-2"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <span className="font-medium min-w-[100px] text-center">
                    {formatYearMonth(yearMonth)}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() => changeYearMonth(getNextMonth(yearMonth))}
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
                      {/* 行の選択は不要。提出先を選べば押せる */}
                      <Button onClick={handleBulkReview} disabled={!selectedAdminId}>
                        <Send className="h-4 w-4 mr-2" />
                        提出済み{actionableCount}件を管理者へ提出
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-text-body">承認待ち: {actionableCount}件</span>
                    {/* 行の選択は不要。個別に承認したいときは各行の「承認」ボタンを使う */}
                    <Button onClick={handleBulkApprove}>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      承認待ち{actionableCount}件を一括承認
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* 提出までの流れ。誰が何をするとステータスがどう進むかを1行で示す。
                ステータス名は ATTENDANCE_STATUS_LABELS と対で、文言を変えるときは両方直すこと。 */}
            <div className="mb-4 rounded-lg border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
                <span className="font-medium text-text-heading">出勤簿の流れ</span>
                {ATTENDANCE_FLOW_STEPS.map((step, i) => (
                  <span key={step.status} className="flex items-center gap-2">
                    {i > 0 && <span className="text-text-muted">→</span>}
                    <span className="flex items-center gap-1.5">
                      <Badge className={ATTENDANCE_STATUS_COLORS[step.status]}>
                        {ATTENDANCE_STATUS_LABELS[step.status]}
                      </Badge>
                      <span className="text-text-muted">{step.actor}</span>
                    </span>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-text-muted">
                内容に不備があれば「差戻」で1つ前に返せます（差し戻された出勤簿は
                <Badge className={`${ATTENDANCE_STATUS_COLORS.rejected} mx-1`}>
                  {ATTENDANCE_STATUS_LABELS.rejected}
                </Badge>
                になり、講師が直して再提出します）。
              </p>
            </div>

            {isLoading ? (
              <Loading size="md" />
            ) : sheets.length === 0 ? (
              <div className="text-center py-8 text-text-body">出勤簿がありません</div>
            ) : isAdmin && isTransposedView ? (
              /* ===== 管理者: 転置ビュー ===== */
              <>
                {/* 日数系の行は名前だけだと取り違えやすいので、集計の定義をその場に置く。
                    定義は getAttendanceSummary（prep_days / work_days）と対。 */}
                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
                  <span>
                    <span className="font-medium text-text-body">準備給日数</span>
                    ＝授業のあった日数（授業の準備に対して払う）
                  </span>
                  <span>
                    <span className="font-medium text-text-body">勤務日数</span>
                    ＝授業・事務を問わず何かしら入力のあった日数
                  </span>
                  <span>
                    <span className="font-medium text-text-body">金額合計</span>
                    ＝単価×コマ数の概算（実支給額ではありません）
                  </span>
                </div>
                <div className="overflow-x-auto" onMouseLeave={() => setHoveredSheetId(null)}>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b-2 border-border-strong">
                        <TableHead className="min-w-[120px] sticky left-0 bg-surface-raised z-20 border-r-2 border-border-strong">
                          項目
                        </TableHead>
                        {sortedSheets.map((sheet, colIndex) => {
                          // 転置ビューでも退職状態バッジを表示する
                          const exitStatusT = getExitStatus(sheet.teacher?.exit_date);
                          return (
                            <TableHead
                              key={sheet.id}
                              className={`text-center min-w-[100px] ${TRANSPOSED_COL_BORDER}`}
                              style={transposedColumnStyle(colIndex, hoveredSheetId === sheet.id)}
                              onMouseEnter={() => setHoveredSheetId(sheet.id)}
                            >
                              <div className="flex flex-col items-center gap-1">
                                <span className="font-medium text-xs">
                                  {sheet.teacher?.name ?? '不明'}
                                </span>
                                {/* 社員番号を講師名の下に小さく表示（システム管理者のみ） */}
                                {canSeeEmployeeNo && sheet.teacher?.employee_no && (
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
                        <TableHead className="text-center font-bold min-w-[80px] border-l-2 border-border-strong">
                          合計
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {/* コマ種別行 */}
                      {displayTypes.map((type) => (
                        <TableRow key={type.id}>
                          <TableCell className={TRANSPOSED_LABEL_CELL}>{type.name}</TableCell>
                          {sortedSheets.map((sheet, colIndex) => {
                            const td = Object.values(sheet.type_totals).find(
                              (t) => t.name === type.name
                            );
                            const value = td?.total || 0;
                            return (
                              <TableCell
                                key={sheet.id}
                                className={`text-center tabular-nums ${TRANSPOSED_COL_BORDER} ${
                                  // 0 は「入力なし」であって読み取る必要がない数字なので薄くする
                                  value === 0 ? 'text-text-faint' : ''
                                }`}
                                style={transposedColumnStyle(colIndex, hoveredSheetId === sheet.id)}
                                onMouseEnter={() => setHoveredSheetId(sheet.id)}
                              >
                                {value}
                                {type.unit === 'hours' ? 'h' : ''}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-center font-medium tabular-nums border-l-2 border-border-strong bg-surface-hover">
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
                      {/* 金額合計。単価×コマ数のざっくり計算で実際の支給額とは一致しないため、
                        参考値として薄く出すだけにして、強調はしない */}
                      <TableRow>
                        <TableCell className={`${TRANSPOSED_LABEL_CELL} text-text-muted`}>
                          金額合計
                          <span className="ml-1 text-[10px] font-normal text-text-faint">概算</span>
                        </TableCell>
                        {sortedSheets.map((sheet, colIndex) => (
                          <TableCell
                            key={sheet.id}
                            className={`text-right text-xs text-text-muted tabular-nums ${TRANSPOSED_COL_BORDER}`}
                            style={transposedColumnStyle(colIndex, hoveredSheetId === sheet.id)}
                            onMouseEnter={() => setHoveredSheetId(sheet.id)}
                          >
                            ¥{sheet.total_amount.toLocaleString()}
                          </TableCell>
                        ))}
                        <TableCell className="text-right text-xs text-text-muted tabular-nums border-l-2 border-border-strong bg-surface-hover">
                          ¥{sortedSheets.reduce((s, r) => s + r.total_amount, 0).toLocaleString()}
                        </TableCell>
                      </TableRow>
                      {/* 準備給日数（＝授業があった日数） */}
                      <TableRow>
                        <TableCell className={TRANSPOSED_LABEL_CELL}>準備給日数</TableCell>
                        {sortedSheets.map((sheet, colIndex) => (
                          <TableCell
                            key={sheet.id}
                            className={`text-center tabular-nums ${TRANSPOSED_COL_BORDER}`}
                            style={transposedColumnStyle(colIndex, hoveredSheetId === sheet.id)}
                            onMouseEnter={() => setHoveredSheetId(sheet.id)}
                          >
                            {sheet.prep_days}日
                          </TableCell>
                        ))}
                        <TableCell className="text-center font-medium tabular-nums border-l-2 border-border-strong bg-surface-hover">
                          {sortedSheets.reduce((s, r) => s + r.prep_days, 0)}日
                        </TableCell>
                      </TableRow>
                      {/* 勤務日数（＝授業・事務を問わず何かしら勤務した日数） */}
                      <TableRow>
                        <TableCell className={TRANSPOSED_LABEL_CELL}>勤務日数</TableCell>
                        {sortedSheets.map((sheet, colIndex) => (
                          <TableCell
                            key={sheet.id}
                            className={`text-center tabular-nums ${TRANSPOSED_COL_BORDER}`}
                            style={transposedColumnStyle(colIndex, hoveredSheetId === sheet.id)}
                            onMouseEnter={() => setHoveredSheetId(sheet.id)}
                          >
                            {sheet.work_days}日
                          </TableCell>
                        ))}
                        <TableCell className="text-center font-medium tabular-nums border-l-2 border-border-strong bg-surface-hover">
                          {sortedSheets.reduce((s, r) => s + r.work_days, 0)}日
                        </TableCell>
                      </TableRow>
                      {/* 交通費 (editable) */}
                      <TableRow>
                        <TableCell className={TRANSPOSED_LABEL_CELL}>交通費</TableCell>
                        {sortedSheets.map((sheet, colIndex) => (
                          <TableCell
                            key={sheet.id}
                            className={TRANSPOSED_COL_BORDER}
                            style={transposedColumnStyle(colIndex, hoveredSheetId === sheet.id)}
                            onMouseEnter={() => setHoveredSheetId(sheet.id)}
                          >
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
                        <TableCell className="text-right font-medium tabular-nums border-l-2 border-border-strong bg-surface-hover">
                          ¥{sortedSheets.reduce((s, r) => s + r.transport_cost, 0).toLocaleString()}
                        </TableCell>
                      </TableRow>
                      {/* 備考 (editable) */}
                      <TableRow>
                        <TableCell className={TRANSPOSED_LABEL_CELL}>備考</TableCell>
                        {sortedSheets.map((sheet, colIndex) => (
                          <TableCell
                            key={sheet.id}
                            className={TRANSPOSED_COL_BORDER}
                            style={transposedColumnStyle(colIndex, hoveredSheetId === sheet.id)}
                            onMouseEnter={() => setHoveredSheetId(sheet.id)}
                          >
                            <Input
                              value={sheet.admin_note || ''}
                              onChange={(e) => handleAdminNoteChange(sheet.id, e.target.value)}
                              placeholder="備考"
                              className="h-7 text-sm min-w-[80px]"
                            />
                          </TableCell>
                        ))}
                        <TableCell className="border-l-2 border-border-strong bg-surface-hover" />
                      </TableRow>
                      {/* 操作行 */}
                      <TableRow className="border-t-2 border-border-strong">
                        <TableCell className={TRANSPOSED_LABEL_CELL}>操作</TableCell>
                        {sortedSheets.map((sheet, colIndex) => (
                          <TableCell
                            key={sheet.id}
                            className={TRANSPOSED_COL_BORDER}
                            style={transposedColumnStyle(colIndex, hoveredSheetId === sheet.id)}
                            onMouseEnter={() => setHoveredSheetId(sheet.id)}
                          >
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
                        <TableCell className="border-l-2 border-border-strong bg-surface-hover" />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : (
              /* ===== 通常テーブル ===== */
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {/* 見出しは折り返すと3行に崩れて表が読みにくくなるため、すべて1行に固定する */}
                      {showSchoolColumn && (
                        <TableHead className="whitespace-nowrap">教室</TableHead>
                      )}
                      {canSeeEmployeeNo && (
                        <TableHead className="min-w-[60px] whitespace-nowrap">社員番号</TableHead>
                      )}
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
                          {showSchoolColumn && (
                            <TableCell className="whitespace-nowrap">
                              {sheet.school?.name ?? ''}
                            </TableCell>
                          )}
                          {canSeeEmployeeNo && (
                            <TableCell className="text-sm text-gray-500 tabular-nums">
                              {/* 社員番号インライン編集（システム管理者のみ）。Enterで確定（blur）。 */}
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
                            </TableCell>
                          )}
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
                              {(sheet.status === 'draft' || sheet.status === 'rejected') && (
                                <Button
                                  size="sm"
                                  onClick={() => handleSubmitClick(sheet)}
                                  className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                >
                                  <Send className="h-3 w-3 mr-1" />
                                  提出
                                </Button>
                              )}
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

        {/* 講師の人事・コマ給。
            入社日・退職日・コマ給変更はいずれも「1人の講師に対する設定」なので、
            講師を1回選べば3つともまとめて編集できる1フォームに統合している。

            ★ コマ給の改定は教室長も行うのでカード自体は教室長以上に出す。
              入社日・退職日は人事情報なので管理者のみ（カード内で出し分ける）。 */}
        {(isAdmin || isManager) && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">
                {isAdmin ? '講師の人事・コマ給' : '講師のコマ給'}
              </CardTitle>
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
                  {isAdmin
                    ? '講師を選ぶと、入社日・退職日・コマ給変更をまとめて登録できます。'
                    : '講師を選ぶと、コマ給の改定を登録できます。'}
                </p>
              ) : (
                <div className="space-y-3 border-l-2 border-border pl-4">
                  {/* 入社日・退職日は user_profiles の値なので月に依存しない。
                      人事情報なので教室長には出さない（コマ給の改定だけ任せる）。 */}
                  {isAdmin && (
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
                  )}

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
              {((isAdmin && (hireDateTeachers.length > 0 || exitDateTeachers.length > 0)) ||
                komaChangingTeachers.length > 0) && (
                <div className="space-y-1.5 border-t border-border pt-3">
                  {isAdmin && hireDateTeachers.length > 0 && (
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
                  {isAdmin && exitDateTeachers.length > 0 && (
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
      {/* Header / Footer は DialogContent の外に置く（中に入れるとスクロール領域に巻き込まれ、
          タイトルが上端で切れ、ボタンが画面外に出る）。幅は Dialog の size で決まる。 */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogHeader>
          <DialogTitle>
            {rejectMode === 'to-teacher' ? '講師に差し戻し' : '教室長に差し戻し'}
          </DialogTitle>
        </DialogHeader>
        <DialogContent>
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
        </DialogContent>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setIsRejectDialogOpen(false)}>
            キャンセル
          </Button>
          <Button variant="danger" onClick={handleReject}>
            差し戻す
          </Button>
        </DialogFooter>
      </Dialog>

      {/* 承認取消確認ダイアログ */}
      {/* 代理提出の確認。誰の分を出すのかを明示する（本人以外の操作なので取り違えを防ぐ） */}
      <AlertDialog open={isSubmitDialogOpen} onOpenChange={setIsSubmitDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {submittingSheet?.teacher?.name ?? 'この講師'}さんの出勤簿を提出しますか？
            </AlertDialogTitle>
            <AlertDialogDescription>
              本人の代わりに「提出済み」にします。退職・提出忘れなどで本人が出せない出勤簿を承認フローに乗せるための操作です。提出後も内容は編集できます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsSubmitDialogOpen(false)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmitSheet}>提出する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
