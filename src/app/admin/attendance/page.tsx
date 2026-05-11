'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle, Button, SelectShadcn as Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Checkbox, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Textarea, Label, Input, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { ChevronLeft, ChevronRight, CheckCircle, ExternalLink, Download, RotateCcw, AlertTriangle, UserMinus, UserPlus, TrendingUp, Send, ArrowUpDown } from 'lucide-react';
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
  getRecentlyRetiredTeachers,
  getNewTeachers,
  getActiveTeacherProfiles,
  reviewAttendanceSheets,
  rejectToTeacher,
  rejectToManager,
  getAdminUsers,
  setKomaChange,
} from '@/lib/api/attendance';
import {
  getCurrentYearMonth,
  getPrevMonth,
  getNextMonth,
  formatYearMonth,
} from '@/lib/utils/date';
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
  teacher: { id: string; name: string } | null;
  teacher_id?: string;
  status: string;
  type_totals: Record<string, {
    name: string;
    unit: string;
    unit_price?: number;
    total: number;
    amount?: number;
  }>;
  grand_total: number;
  total_amount: number;
  prep_days: number;
  work_days: number;
  transport_cost: number;
  admin_note: string | null;
  is_koma_changing: boolean;
  koma_change_from: number | null;
  koma_change_to: number | null;
}

interface TeacherProfile {
  id: string;
  name: string;
  exit_date: string | null;
  created_at: string;
}

type SortOrder = 'name-asc' | 'name-desc' | 'amount-desc';

export default function AttendanceManagementPage() {
  const router = useRouter();
  const { profile, schoolIds: userSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();

  const isManager = profile?.role === 'manager';
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';

  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('all');
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
  const [recentlyRetired, setRecentlyRetired] = useState<{ id: string; name: string; exit_date: string | null }[]>([]);
  const [newTeachers, setNewTeachers] = useState<{ id: string; name: string; created_at: string }[]>([]);
  const [retiringTeacherId, setRetiringTeacherId] = useState<string>('');
  const [retiringExitDate, setRetiringExitDate] = useState<string>('');

  // コマ給変更入力
  const [komaChangeTeacherId, setKomaChangeTeacherId] = useState<string>('');
  const [komaChangeFrom, setKomaChangeFrom] = useState<string>('');
  const [komaChangeTo, setKomaChangeTo] = useState<string>('');

  // 教室長: 提出先管理者
  const [adminUsers, setAdminUsers] = useState<{ id: string; name: string }[]>([]);
  const [selectedAdminId, setSelectedAdminId] = useState<string>('');

  // 管理者: 転置ビュー・並べ替え
  const [isTransposedView, setIsTransposedView] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>('name-asc');

  const { schools: masterSchools } = useMasterData();

  const allowedSchools = useMemo(
    () => schools.filter((s) => userSchoolIds.includes(s.id)),
    [schools, userSchoolIds]
  );

  useEffect(() => {
    if (masterSchools.length > 0) setSchools(masterSchools);
  }, [masterSchools]);

  useEffect(() => {
    if (allowedSchools.length === 1 && selectedSchoolId === 'all') {
      setSelectedSchoolId(allowedSchools[0].id);
    }
  }, [allowedSchools, selectedSchoolId]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const schoolId = selectedSchoolId === 'all' ? null : selectedSchoolId;
      const schoolIdsForTypes =
        schoolId ? [schoolId] : (userSchoolIds.length > 0 ? userSchoolIds : undefined);
      const allowedIds = schoolId ? undefined : (userSchoolIds.length > 0 ? userSchoolIds : undefined);
      const realPrevMonth = getPrevMonth(getCurrentYearMonth());
      const effectiveSchoolIds = schoolId ? [schoolId] : (userSchoolIds.length > 0 ? userSchoolIds : []);

      const [typesData, summaryResult, lateEarlyResult, prevMonthSummary, retiredResult, newResult, teacherList, adminList] = await Promise.all([
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
      if (adminList.length > 0 && !selectedAdminId) {
        setSelectedAdminId(adminList[0].id);
      }
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Failed to fetch data:', err);
      toastError('データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [selectedSchoolId, yearMonth, userSchoolIds, toastError, selectedAdminId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (selectedSchoolId === 'all') {
      setSelectedSchool(null);
    } else {
      setSelectedSchool(allowedSchools.find((s) => s.id === selectedSchoolId) || null);
    }
  }, [selectedSchoolId, allowedSchools]);

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
    setSheets((prev) => prev.map((s) => s.id === sheetId ? { ...s, transport_cost: numVal } : s));
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
    setSheets((prev) => prev.map((s) => s.id === sheetId ? { ...s, admin_note: value || null } : s));
    if (noteTimers.current[sheetId]) clearTimeout(noteTimers.current[sheetId]);
    noteTimers.current[sheetId] = setTimeout(async () => {
      try {
        await updateAttendanceSheetMeta(sheetId, { admin_note: value || null });
      } catch {
        toastError('備考の保存に失敗しました');
      }
    }, 800);
  };

  // 退職日の設定
  const handleSetExitDate = async () => {
    if (!retiringTeacherId || !retiringExitDate) return;
    try {
      await updateTeacherExitDate(retiringTeacherId, retiringExitDate);
      const teacher = allTeachers.find((t) => t.id === retiringTeacherId);
      success(`${teacher?.name ?? '不明'}の退職日を設定しました`);
      setRetiringTeacherId('');
      setRetiringExitDate('');
      await fetchData();
    } catch {
      toastError('退職日の設定に失敗しました');
    }
  };

  // コマ給変更を登録
  const handleSetKomaChange = async () => {
    if (!komaChangeTeacherId) return;
    const fromVal = parseInt(komaChangeFrom);
    const toVal = parseInt(komaChangeTo);
    if (!fromVal || !toVal || fromVal <= 0 || toVal <= 0) {
      toastError('旧コマ給と新コマ給を入力してください');
      return;
    }
    const effectiveSchoolIds = selectedSchoolId === 'all'
      ? userSchoolIds
      : [selectedSchoolId];
    try {
      await setKomaChange(komaChangeTeacherId, yearMonth, effectiveSchoolIds, fromVal, toVal);
      const teacher = allTeachers.find((t) => t.id === komaChangeTeacherId);
      success(`${teacher?.name ?? '不明'}のコマ給変更を登録しました（¥${fromVal.toLocaleString()}→¥${toVal.toLocaleString()}）`);
      setKomaChangeTeacherId('');
      setKomaChangeFrom('');
      setKomaChangeTo('');
      await fetchData();
    } catch {
      toastError('コマ給変更の登録に失敗しました');
    }
  };

  // コマ給変更を解除
  const handleClearKomaChange = async (sheet: SummaryRow) => {
    if (!sheet.teacher?.id && !sheet.teacher_id) return;
    const teacherId = sheet.teacher?.id || sheet.teacher_id!;
    const effectiveSchoolIds = selectedSchoolId === 'all'
      ? userSchoolIds
      : [selectedSchoolId];
    try {
      await setKomaChange(teacherId, yearMonth, effectiveSchoolIds, null, null);
      success(`${sheet.teacher?.name ?? '不明'}のコマ給変更を解除しました`);
      await fetchData();
    } catch {
      toastError('解除に失敗しました');
    }
  };

  // 並べ替え済みシート
  const sortedSheets = useMemo(() => {
    const copy = [...sheets];
    switch (sortOrder) {
      case 'name-asc':
        return copy.sort((a, b) => (a.teacher?.name ?? '').localeCompare(b.teacher?.name ?? '', 'ja'));
      case 'name-desc':
        return copy.sort((a, b) => (b.teacher?.name ?? '').localeCompare(a.teacher?.name ?? '', 'ja'));
      case 'amount-desc':
        return copy.sort((a, b) => b.total_amount - a.total_amount);
      default:
        return copy;
    }
  }, [sheets, sortOrder]);

  const cycleSortOrder = () => {
    setSortOrder((prev) => {
      if (prev === 'name-asc') return 'name-desc';
      if (prev === 'name-desc') return 'amount-desc';
      return 'name-asc';
    });
  };

  const sortLabel = sortOrder === 'name-asc' ? '名前 昇順' : sortOrder === 'name-desc' ? '名前 降順' : '金額 降順';

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

    const typeNames = Array.from(new Set(
      sheets.flatMap((row) => Object.values(row.type_totals).map((t) => t.name))
    ));

    const hasSchoolColumn = selectedSchoolId === 'all';
    const headers = hasSchoolColumn
      ? ['教室', '講師名', 'ステータス', ...typeNames, '合計', '金額合計', '準備給日数', '勤務日数', '交通費', '備考']
      : ['講師名', 'ステータス', ...typeNames, '合計', '金額合計', '準備給日数', '勤務日数', '交通費', '備考'];

    const rows = sheets.map((row) => {
      const typeCols = typeNames.map((name) => {
        const typeData = Object.values(row.type_totals).find((t) => t.name === name);
        return typeData?.total || 0;
      });
      const base = hasSchoolColumn
        ? [row.school?.name || '', row.teacher?.name || '', ATTENDANCE_STATUS_LABELS[row.status as keyof typeof ATTENDANCE_STATUS_LABELS] || '']
        : [row.teacher?.name || '', ATTENDANCE_STATUS_LABELS[row.status as keyof typeof ATTENDANCE_STATUS_LABELS] || ''];
      return [...base, ...typeCols, row.grand_total, row.total_amount, row.prep_days, row.work_days, row.transport_cost, row.admin_note || ''];
    });

    downloadCSV(
      [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join('\n'),
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
    rows.push(['金額合計', ...sortedSheets.map((s) => s.total_amount), sortedSheets.reduce((s, r) => s + r.total_amount, 0)]);
    rows.push(['準備給日数', ...sortedSheets.map((s) => s.prep_days), sortedSheets.reduce((s, r) => s + r.prep_days, 0)]);
    rows.push(['勤務日数', ...sortedSheets.map((s) => s.work_days), sortedSheets.reduce((s, r) => s + r.work_days, 0)]);
    rows.push(['交通費', ...sortedSheets.map((s) => s.transport_cost), sortedSheets.reduce((s, r) => s + r.transport_cost, 0)]);
    rows.push(['備考', ...sortedSheets.map((s) => s.admin_note || ''), '']);

    downloadCSV(
      [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join('\n'),
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
      [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join('\n'),
      `遅刻早退一覧_${yearMonth}.csv`
    );
  };

  const showSchoolColumn = selectedSchoolId === 'all';

  const formatLateEarlyDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
    return `${date.getMonth() + 1}/${date.getDate()}(${dayLabels[date.getDay()]})`;
  };

  const displayTypes = attendanceTypes.filter((type, index, self) =>
    index === self.findIndex((t) => t.name === type.name)
  );

  const komaChangingSheets = sheets.filter((s) => s.is_koma_changing);
  const [ym_y, ym_m] = yearMonth.split('-').map(Number);
  const monthEndDate = `${yearMonth}-${new Date(ym_y, ym_m, 0).getDate()}`;

  return (
    <AdminLayout headerTitle="講師勤怠">
      <div className="space-y-6">
        {/* 未提出アラート */}
        {prevMonthUnsubmitted.length > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                前月（{formatYearMonth(getPrevMonth(getCurrentYearMonth()))}）の出勤簿が未提出の講師が{prevMonthUnsubmitted.length}名います
              </p>
              <p className="text-xs text-amber-800 mt-1 break-all">
                {prevMonthUnsubmitted.map((s) => s.teacher?.name ?? '不明').join('、')}
              </p>
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={() => setYearMonth(getPrevMonth(getCurrentYearMonth()))}>
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
                      <Badge key={t.id} className="bg-red-600 text-white">{t.name}</Badge>
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
                      <Badge key={t.id} className="bg-blue-600 text-white">{t.name}</Badge>
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
                <div className="relative w-48">
                  <Select value={selectedSchoolId} onValueChange={(v) => setSelectedSchoolId(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="教室を選択">
                        {selectedSchoolId === 'all' ? '全教室' : allowedSchools.find((s) => s.id === selectedSchoolId)?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {allowedSchools.length > 1 && <SelectItem value="all">全教室</SelectItem>}
                      {allowedSchools.map((school) => (
                        <SelectItem key={school.id} value={school.id}>{school.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={() => setYearMonth(getPrevMonth(yearMonth))} className="p-2">
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <span className="font-medium min-w-[100px] text-center">{formatYearMonth(yearMonth)}</span>
                  <Button variant="ghost" onClick={() => setYearMonth(getNextMonth(yearMonth))} className="p-2">
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
                    <span className="text-sm text-text-body">
                      提出済み: {actionableCount}件
                    </span>
                    <div className="flex items-center gap-2">
                      <Select value={selectedAdminId} onValueChange={setSelectedAdminId}>
                        <SelectTrigger className="w-48">
                          <SelectValue placeholder="提出先を選択" />
                        </SelectTrigger>
                        <SelectContent>
                          {adminUsers.map((u) => (
                            <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
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
                    <span className="text-sm text-text-body">
                      承認待ち: {actionableCount}件
                    </span>
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
              <div className="flex justify-center py-8">
                <div className="text-text-body">読み込み中...</div>
              </div>
            ) : sheets.length === 0 ? (
              <div className="text-center py-8 text-text-body">出勤簿がありません</div>
            ) : isAdmin && isTransposedView ? (
              /* ===== 管理者: 転置ビュー ===== */
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[120px] sticky left-0 bg-surface-raised z-10">項目</TableHead>
                      {sortedSheets.map((sheet) => (
                        <TableHead key={sheet.id} className="text-center min-w-[100px]">
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-medium text-xs">{sheet.teacher?.name ?? '不明'}</span>
                            {sheet.is_koma_changing && (
                              <Badge className="bg-purple-600 text-white text-[9px] px-1">
                                コマ¥{(sheet.koma_change_from ?? 0).toLocaleString()}→¥{(sheet.koma_change_to ?? 0).toLocaleString()}
                              </Badge>
                            )}
                            <Badge className={`text-[10px] ${ATTENDANCE_STATUS_COLORS[sheet.status as AttendanceSheetStatus]}`}>
                              {ATTENDANCE_STATUS_LABELS[sheet.status as AttendanceSheetStatus]}
                            </Badge>
                          </div>
                        </TableHead>
                      ))}
                      <TableHead className="text-center font-bold min-w-[80px]">合計</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* コマ種別行 */}
                    {displayTypes.map((type) => (
                      <TableRow key={type.id}>
                        <TableCell className="font-medium sticky left-0 bg-surface-raised z-10">{type.name}</TableCell>
                        {sortedSheets.map((sheet) => {
                          const td = Object.values(sheet.type_totals).find((t) => t.name === type.name);
                          return (
                            <TableCell key={sheet.id} className="text-center">
                              {td?.total || 0}{type.unit === 'hours' ? 'h' : ''}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center font-medium">
                          {sortedSheets.reduce((sum, sheet) => {
                            const td = Object.values(sheet.type_totals).find((t) => t.name === type.name);
                            return sum + (td?.total || 0);
                          }, 0)}{type.unit === 'hours' ? 'h' : ''}
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
                      <TableCell className="font-medium sticky left-0 bg-surface-raised z-10">準備給日数</TableCell>
                      {sortedSheets.map((sheet) => (
                        <TableCell key={sheet.id} className="text-center">{sheet.prep_days}日</TableCell>
                      ))}
                      <TableCell className="text-center font-medium">
                        {sortedSheets.reduce((s, r) => s + r.prep_days, 0)}日
                      </TableCell>
                    </TableRow>
                    {/* 勤務日数 */}
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-surface-raised z-10">勤務日数</TableCell>
                      {sortedSheets.map((sheet) => (
                        <TableCell key={sheet.id} className="text-center">{sheet.work_days}日</TableCell>
                      ))}
                      <TableCell className="text-center font-medium">
                        {sortedSheets.reduce((s, r) => s + r.work_days, 0)}日
                      </TableCell>
                    </TableRow>
                    {/* 交通費 (editable) */}
                    <TableRow>
                      <TableCell className="font-medium sticky left-0 bg-surface-raised z-10">交通費</TableCell>
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
                      <TableCell className="font-medium sticky left-0 bg-surface-raised z-10">備考</TableCell>
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
                      <TableCell className="font-medium sticky left-0 bg-gray-50 z-10">操作</TableCell>
                      {sortedSheets.map((sheet) => (
                        <TableCell key={sheet.id}>
                          <div className="flex flex-col gap-1 items-center">
                            <Button variant="secondary" size="sm" onClick={() => handleViewDetail(sheet)} className="text-xs w-full">
                              詳細
                            </Button>
                            {sheet.status === 'reviewed' && (
                              <>
                                <Button size="sm" onClick={() => handleApprove(sheet)} className="text-green-600 hover:text-green-700 hover:bg-green-50 text-xs w-full">
                                  承認
                                </Button>
                                <Button variant="danger" size="sm" onClick={() => handleRejectClick(sheet, 'to-manager')} className="text-xs w-full">
                                  差戻
                                </Button>
                              </>
                            )}
                            {sheet.status === 'submitted' && (
                              <Button size="sm" onClick={() => handleApprove(sheet)} className="text-green-600 hover:text-green-700 hover:bg-green-50 text-xs w-full">
                                承認
                              </Button>
                            )}
                            {sheet.status === 'approved' && (
                              <Button variant="secondary" size="sm" onClick={() => handleReopenClick(sheet)} className="text-xs w-full">
                                <RotateCcw className="h-3 w-3 mr-1" />取消
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
                      {showSchoolColumn && <TableHead>教室</TableHead>}
                      <TableHead>講師名</TableHead>
                      <TableHead className="text-center">ステータス</TableHead>
                      {displayTypes.map((type) => (
                        <TableHead key={type.id} className="text-center">{type.name}</TableHead>
                      ))}
                      <TableHead className="text-center">合計</TableHead>
                      <TableHead className="text-right">金額</TableHead>
                      <TableHead className="text-center">準備給日数</TableHead>
                      <TableHead className="text-center">勤務日数</TableHead>
                      <TableHead className="text-center">交通費</TableHead>
                      <TableHead className="min-w-[120px]">備考</TableHead>
                      <TableHead className="min-w-[200px]">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sheets.map((sheet) => (
                      <TableRow key={sheet.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(sheet.id)}
                            onCheckedChange={() => toggleSelect(sheet.id)}
                            disabled={!actionableStatuses.includes(sheet.status)}
                          />
                        </TableCell>
                        {showSchoolColumn && <TableCell>{sheet.school?.name ?? ''}</TableCell>}
                        <TableCell className="font-medium">
                          <span>{sheet.teacher?.name ?? '不明'}</span>
                          {sheet.is_koma_changing && (
                            <Badge className="ml-1 bg-purple-600 text-white text-[10px] px-1">
                              ¥{(sheet.koma_change_from ?? 0).toLocaleString()}→¥{(sheet.koma_change_to ?? 0).toLocaleString()}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className={ATTENDANCE_STATUS_COLORS[sheet.status as AttendanceSheetStatus]}>
                            {ATTENDANCE_STATUS_LABELS[sheet.status as AttendanceSheetStatus]}
                          </Badge>
                        </TableCell>
                        {displayTypes.map((type) => {
                          const typeData = Object.values(sheet.type_totals).find((t) => t.name === type.name);
                          return (
                            <TableCell key={type.id} className="text-center">
                              {typeData?.total || 0}{type.unit === 'hours' ? 'h' : ''}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center font-medium">{sheet.grand_total}</TableCell>
                        <TableCell className="text-right">¥{sheet.total_amount.toLocaleString()}</TableCell>
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
                            <Button variant="secondary" size="sm" onClick={() => handleViewDetail(sheet)}>
                              詳細
                            </Button>
                            {isManager && sheet.status === 'submitted' && (
                              <Button variant="danger" size="sm" onClick={() => handleRejectClick(sheet, 'to-teacher')}>
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
                                <Button variant="danger" size="sm" onClick={() => handleRejectClick(sheet, 'to-manager')}>
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
                              <Button variant="secondary" size="sm" onClick={() => handleReopenClick(sheet)}>
                                <RotateCcw className="h-3 w-3 mr-1" />取消
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* 合計行 */}
                    <TableRow className="bg-gray-100 font-medium">
                      <TableCell colSpan={showSchoolColumn ? 4 : 3}>合計</TableCell>
                      {displayTypes.map((type) => (
                        <TableCell key={type.id} className="text-center">
                          {sheets.reduce((sum, row) => {
                            const typeData = Object.values(row.type_totals).find((t) => t.name === type.name);
                            return sum + (typeData?.total || 0);
                          }, 0)}{type.unit === 'hours' ? 'h' : ''}
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

        {/* 退職予定・コマ給変更 (admin only) */}
        {isAdmin && (
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">退職予定・コマ給変更</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 退職予定 */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">今月末退職の講師を登録</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={retiringTeacherId} onValueChange={setRetiringTeacherId}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="講師を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {allTeachers.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="date"
                    value={retiringExitDate || monthEndDate}
                    onChange={(e) => setRetiringExitDate(e.target.value)}
                    className="w-40"
                  />
                  <Button size="sm" onClick={handleSetExitDate} disabled={!retiringTeacherId}>登録</Button>
                </div>
                {allTeachers.some((t) => t.exit_date && t.exit_date.startsWith(yearMonth)) && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {allTeachers
                      .filter((t) => t.exit_date && t.exit_date.startsWith(yearMonth))
                      .map((t) => (
                        <Badge key={t.id} className="bg-orange-500 text-white">
                          {t.name}（{t.exit_date}）
                        </Badge>
                      ))}
                  </div>
                )}
              </div>

              {/* コマ給変更 */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">コマ給変更の講師を登録</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={komaChangeTeacherId} onValueChange={setKomaChangeTeacherId}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="講師を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {allTeachers.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-text-body">¥</span>
                    <Input
                      type="number"
                      min="0"
                      value={komaChangeFrom}
                      onChange={(e) => setKomaChangeFrom(e.target.value)}
                      placeholder="旧"
                      className="w-24 text-right"
                    />
                    <span className="text-sm text-text-body">→ ¥</span>
                    <Input
                      type="number"
                      min="0"
                      value={komaChangeTo}
                      onChange={(e) => setKomaChangeTo(e.target.value)}
                      placeholder="新"
                      className="w-24 text-right"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSetKomaChange}
                    disabled={!komaChangeTeacherId || !komaChangeFrom || !komaChangeTo}
                  >
                    登録
                  </Button>
                </div>
                {komaChangingSheets.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {Array.from(
                      new Map(
                        komaChangingSheets.map((s) => [
                          s.teacher?.id || s.teacher_id || s.id,
                          s,
                        ])
                      ).values()
                    ).map((s) => (
                      <div key={s.id} className="inline-flex items-center gap-1 bg-purple-600 text-white rounded-md px-2 py-1 text-xs">
                        <TrendingUp className="h-3 w-3" />
                        <span className="font-medium">{s.teacher?.name ?? '不明'}</span>
                        <span>
                          ¥{(s.koma_change_from ?? 0).toLocaleString()}→¥{(s.koma_change_to ?? 0).toLocaleString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleClearKomaChange(s)}
                          className="ml-1 hover:bg-purple-700 rounded px-1"
                          aria-label="解除"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
                  <span className="text-text-body font-normal text-sm ml-2">（{lateEarlyRecords.length}件）</span>
                )}
              </CardTitle>
              <Button variant="secondary" onClick={handleExportLateEarlyCSV} disabled={lateEarlyRecords.length === 0}>
                <Download className="mr-2 h-4 w-4" />
                CSVエクスポート
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="text-text-body">読み込み中...</div>
              </div>
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
                        <TableCell className="text-red-600 font-medium">{record.late_early}</TableCell>
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
            <Button variant="secondary" onClick={() => setIsRejectDialogOpen(false)}>キャンセル</Button>
            <Button variant="danger" onClick={handleReject}>差し戻す</Button>
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
            <AlertDialogCancel onClick={() => setIsReopenDialogOpen(false)}>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleReopen}>取り消す</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
