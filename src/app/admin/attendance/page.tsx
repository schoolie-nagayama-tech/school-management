'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle, Button, SelectShadcn as Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Checkbox, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Textarea, Label, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { ChevronLeft, ChevronRight, CheckCircle, ExternalLink, Download, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { useMasterData } from '@/contexts/MasterDataContext';
import {
  getAttendanceSummary,
  getAllAttendanceTypes,
  approveAttendanceSheet,
  rejectAttendanceSheet,
  bulkApproveAttendanceSheets,
  reopenAttendanceSheet,
  getLateEarlyList,
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
}

export default function AttendanceManagementPage() {
  const router = useRouter();
  const { profile, schoolIds: userSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();

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
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [reopeningSheet, setReopeningSheet] = useState<SummaryRow | null>(null);
  const [lateEarlyRecords, setLateEarlyRecords] = useState<LateEarlyRecord[]>([]);

  const { schools: masterSchools } = useMasterData();

  // アクセス可能な教室のみ（他教室の出勤簿を見せない）
  // useMemo 化して参照安定化（以前は毎レンダー新配列で effects が毎回走っていた）
  const allowedSchools = useMemo(
    () => schools.filter((s) => userSchoolIds.includes(s.id)),
    [schools, userSchoolIds]
  );

  // 教室一覧をコンテキストから取得
  useEffect(() => {
    if (masterSchools.length > 0) setSchools(masterSchools);
  }, [masterSchools]);

  // アクセス可能な教室が1つのときはその教室を初期選択
  useEffect(() => {
    if (allowedSchools.length === 1 && selectedSchoolId === 'all') {
      setSelectedSchoolId(allowedSchools[0].id);
    }
  }, [allowedSchools, selectedSchoolId]);

  // 出勤簿一覧 + 勤怠種別を取得（初回 & 承認/差戻し後の refetch 両方で使用）
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const schoolId = selectedSchoolId === 'all' ? null : selectedSchoolId;
      const schoolIdsForTypes =
        schoolId ? [schoolId] : (userSchoolIds.length > 0 ? userSchoolIds : undefined);
      const allowedIds = schoolId ? undefined : (userSchoolIds.length > 0 ? userSchoolIds : undefined);
      const [typesData, summaryResult, lateEarlyResult] = await Promise.all([
        getAllAttendanceTypes(schoolIdsForTypes),
        getAttendanceSummary(schoolId, yearMonth, allowedIds),
        getLateEarlyList(schoolId, yearMonth),
      ]);
      setAttendanceTypes(typesData);
      setSheets(summaryResult);
      setLateEarlyRecords(lateEarlyResult);
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

  // 教室変更時（selectedSchoolの更新）
  useEffect(() => {
    if (selectedSchoolId === 'all') {
      setSelectedSchool(null);
    } else {
      setSelectedSchool(allowedSchools.find((s) => s.id === selectedSchoolId) || null);
    }
  }, [selectedSchoolId, allowedSchools]);

  const handleSchoolChange = (schoolId: string) => {
    setSelectedSchoolId(schoolId);
  };

  // 選択切り替え
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // 全選択（承認待ちのみ）
  const toggleSelectAll = () => {
    const submittedSheets = sheets.filter((s) => s.status === 'submitted');
    if (selectedIds.size === submittedSheets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(submittedSheets.map((s) => s.id)));
    }
  };

  // 個別承認
  const handleApprove = async (sheet: SummaryRow) => {
    if (!profile) return;

    try {
      await approveAttendanceSheet(sheet.id, profile.id);
      success(`${sheet.teacher?.name ?? '不明'}の出勤簿を承認しました`);
      await fetchData();
    } catch (error) {
      console.error('Failed to approve:', error);
      toastError('承認に失敗しました');
    }
  };

  // 修正ダイアログを開く
  const handleRejectClick = (sheet: SummaryRow) => {
    setRejectingSheet(sheet);
    setRejectReason('');
    setIsRejectDialogOpen(true);
  };

  // 修正実行
  const handleReject = async () => {
    if (!rejectingSheet) return;

    try {
      await rejectAttendanceSheet(rejectingSheet.id, rejectReason);
      success(`${rejectingSheet.teacher?.name ?? '不明'}の出勤簿を修正しました`);
      setIsRejectDialogOpen(false);
      setRejectingSheet(null);
      await fetchData();
    } catch (error) {
      console.error('Failed to reject:', error);
      toastError('修正に失敗しました');
    }
  };

  // 承認取消ダイアログを開く
  const handleReopenClick = (sheet: SummaryRow) => {
    setReopeningSheet(sheet);
    setIsReopenDialogOpen(true);
  };

  // 承認取消実行
  const handleReopen = async () => {
    if (!reopeningSheet) return;

    try {
      await reopenAttendanceSheet(reopeningSheet.id);
      success(`${reopeningSheet.teacher?.name ?? '不明'}の出勤簿の承認を取り消しました`);
      setIsReopenDialogOpen(false);
      setReopeningSheet(null);
      await fetchData();
    } catch (error) {
      console.error('Failed to reopen:', error);
      toastError('承認取消に失敗しました');
    }
  };

  // 一括承認
  const handleBulkApprove = async () => {
    if (!profile || selectedIds.size === 0) return;

    try {
      await bulkApproveAttendanceSheets(Array.from(selectedIds), profile.id);
      success(`${selectedIds.size}件の出勤簿を承認しました`);
      setSelectedIds(new Set());
      await fetchData();
    } catch (error) {
      console.error('Failed to bulk approve:', error);
      toastError('一括承認に失敗しました');
    }
  };

  // 詳細画面へ
  const handleViewDetail = (sheet: SummaryRow) => {
    router.push(`/admin/attendance/sheets/${sheet.id}`);
  };

  // ポータルを開く
  const handleOpenPortal = () => {
    if (!selectedSchool?.code) return;
    window.open(`/attendance/${selectedSchool.code}`, '_blank');
  };

  // CSVエクスポート
  const handleExportCSV = () => {
    if (sheets.length === 0) {
      toastError('エクスポートするデータがありません');
      return;
    }

    const typeNames = Array.from(new Set(
      sheets.flatMap((row) =>
        Object.values(row.type_totals).map((t) => t.name)
      )
    ));

    const hasSchoolColumn = selectedSchoolId === 'all';
    const headers = hasSchoolColumn
      ? ['教室', '講師名', 'ステータス', ...typeNames, '合計', '金額合計']
      : ['講師名', 'ステータス', ...typeNames, '合計', '金額合計'];

    const rows = sheets.map((row) => {
      const typeCols = typeNames.map((name) => {
        const typeData = Object.values(row.type_totals).find((t) => t.name === name);
        return typeData?.total || 0;
      });

      const base = hasSchoolColumn
        ? [row.school?.name || '', row.teacher?.name || '', ATTENDANCE_STATUS_LABELS[row.status as keyof typeof ATTENDANCE_STATUS_LABELS] || '']
        : [row.teacher?.name || '', ATTENDANCE_STATUS_LABELS[row.status as keyof typeof ATTENDANCE_STATUS_LABELS] || ''];
      return [...base, ...typeCols, row.grand_total, row.total_amount];
    });

    const totalRow: string[] = hasSchoolColumn ? ['合計', '', ''] : ['合計', ''];
    typeNames.forEach((name) => {
      const total = sheets.reduce((sum, row) => {
        const typeData = Object.values(row.type_totals).find((t) => t.name === name);
        return sum + (typeData?.total || 0);
      }, 0);
      totalRow.push(total.toString());
    });
    totalRow.push(sheets.reduce((sum, row) => sum + row.grand_total, 0).toString());
    totalRow.push(sheets.reduce((sum, row) => sum + row.total_amount, 0).toString());

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
      totalRow.join(','),
    ].join('\n');

    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `出勤簿集計_${yearMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    success('CSVをダウンロードしました');
  };

  const submittedCount = sheets.filter((s) => s.status === 'submitted').length;
  const showSchoolColumn = selectedSchoolId === 'all';

  // 遅刻早退の日付フォーマット
  const formatLateEarlyDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
    return `${date.getMonth() + 1}/${date.getDate()}(${dayLabels[date.getDay()]})`;
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
    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `遅刻早退一覧_${yearMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    success('CSVをダウンロードしました');
  };

  // 表示用の種別リスト（重複排除）
  const displayTypes = attendanceTypes.filter((type, index, self) =>
    index === self.findIndex((t) => t.name === type.name)
  );

  return (
    <AdminLayout headerTitle="講師勤怠">
      <div className="space-y-6">
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

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <CardTitle>出勤簿一覧</CardTitle>
              <div className="flex items-center gap-4">
                <div className="relative w-48">
                  <Select value={selectedSchoolId} onValueChange={handleSchoolChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="教室を選択">
                        {selectedSchoolId === 'all' ? '全教室' : allowedSchools.find((s) => s.id === selectedSchoolId)?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {allowedSchools.length > 1 && (
                        <SelectItem value="all">全教室</SelectItem>
                      )}
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
            {submittedCount > 0 && (
              <div className="mb-4 flex items-center gap-4">
                <span className="text-sm text-[#4b5563]">
                  提出済み: {submittedCount}件
                </span>
                {selectedIds.size > 0 && (
                  <Button onClick={handleBulkApprove}>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    選択した{selectedIds.size}件を一括承認
                  </Button>
                )}
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="text-[#4b5563]">読み込み中...</div>
              </div>
            ) : sheets.length === 0 ? (
              <div className="text-center py-8 text-[#4b5563]">
                出勤簿がありません
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={
                            submittedCount > 0 &&
                            selectedIds.size === submittedCount
                          }
                          onCheckedChange={toggleSelectAll}
                          disabled={submittedCount === 0}
                        />
                      </TableHead>
                      {showSchoolColumn && <TableHead>教室</TableHead>}
                      <TableHead>講師名</TableHead>
                      <TableHead className="text-center">ステータス</TableHead>
                      {displayTypes.map((type) => (
                        <TableHead key={type.id} className="text-center">
                          {type.name}
                        </TableHead>
                      ))}
                      <TableHead className="text-center">合計</TableHead>
                      <TableHead className="text-right">金額</TableHead>
                      <TableHead className="min-w-[240px]">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sheets.map((sheet) => (
                      <TableRow key={sheet.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(sheet.id)}
                            onCheckedChange={() => toggleSelect(sheet.id)}
                            disabled={sheet.status !== 'submitted'}
                          />
                        </TableCell>
                        {showSchoolColumn && (
                          <TableCell>{sheet.school?.name ?? ''}</TableCell>
                        )}
                        <TableCell className="font-medium">
                          {sheet.teacher?.name ?? '不明'}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className={ATTENDANCE_STATUS_COLORS[sheet.status as AttendanceSheetStatus]}>
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
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleViewDetail(sheet)}
                            >
                              詳細
                            </Button>
                            {sheet.status === 'submitted' && (
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
                                  onClick={() => handleRejectClick(sheet)}
                                >
                                  修正
                                </Button>
                              </>
                            )}
                            {sheet.status === 'approved' && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleReopenClick(sheet)}
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                承認取消
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
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 遅刻・早退一覧 */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <CardTitle>
                遅刻・早退一覧
                {lateEarlyRecords.length > 0 && (
                  <span className="text-[#4b5563] font-normal text-sm ml-2">
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
              <div className="flex justify-center py-8">
                <div className="text-[#4b5563]">読み込み中...</div>
              </div>
            ) : lateEarlyRecords.length === 0 ? (
              <div className="text-center py-8 text-[#4b5563]">
                遅刻・早退のデータがありません
              </div>
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
                        {showSchoolColumn && (
                          <TableCell>{record.sheet?.school?.name}</TableCell>
                        )}
                        <TableCell className="font-medium">
                          {record.sheet?.teacher?.name}
                        </TableCell>
                        <TableCell className="text-red-600 font-medium">
                          {record.late_early}
                        </TableCell>
                        <TableCell className="text-[#4b5563]">
                          {record.note || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 修正ダイアログ */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>出勤簿を修正</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-[#4b5563] mb-4">
              {rejectingSheet?.teacher?.name ?? '不明'}の出勤簿を修正します。
            </p>
            <div className="space-y-2">
              <Label htmlFor="reason">修正理由（任意）</Label>
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
            <Button
              variant="secondary"
              onClick={() => setIsRejectDialogOpen(false)}
            >
              キャンセル
            </Button>
            <Button variant="danger" onClick={handleReject}>
              修正する
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
              承認を取り消すと、提出済みの状態に戻ります。その後、編集・承認・差し戻しを選択できます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsReopenDialogOpen(false)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleReopen}>
              取り消す
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
