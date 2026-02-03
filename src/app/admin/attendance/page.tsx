'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle, Button, SelectShadcn as Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Checkbox, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Textarea, Label } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, Eye, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { getSchools } from '@/lib/api/schools';
import {
  getAttendanceSheetList,
  getActiveAttendanceTypes,
  approveAttendanceSheet,
  rejectAttendanceSheet,
  bulkApproveAttendanceSheets,
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

interface SheetWithTotals {
  id: string;
  teacher_id: string;
  school_id: string;
  year_month: string;
  status: AttendanceSheetStatus;
  submitted_at: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  teacher: { id: string; name: string };
  approved_by_user: { id: string; display_name: string } | null;
  type_totals: Record<string, { name: string; unit: string; total: number }>;
  grand_total: number;
}

export default function AttendanceManagementPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();

  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [attendanceTypes, setAttendanceTypes] = useState<AttendanceType[]>([]);
  const [sheets, setSheets] = useState<SheetWithTotals[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [rejectingSheet, setRejectingSheet] = useState<SheetWithTotals | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // 教室一覧を取得
  useEffect(() => {
    async function fetchSchools() {
      try {
        const data = await getSchools();
        setSchools(data);
        if (data.length > 0) {
          setSelectedSchoolId(data[0].id);
          setSelectedSchool(data[0]);
        }
      } catch (error) {
        console.error('Failed to fetch schools:', error);
        toastError('教室の取得に失敗しました');
      }
    }
    fetchSchools();
  }, [toastError]);

  // 出勤簿一覧を取得
  useEffect(() => {
    async function fetchData() {
      if (!selectedSchoolId) return;

      setIsLoading(true);
      try {
        const [typesData, sheetsData] = await Promise.all([
          getActiveAttendanceTypes(selectedSchoolId),
          getAttendanceSheetList(selectedSchoolId, yearMonth),
        ]);
        setAttendanceTypes(typesData);
        setSheets(sheetsData);
        setSelectedIds(new Set());
      } catch (error) {
        console.error('Failed to fetch data:', error);
        toastError('データの取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [selectedSchoolId, yearMonth, toastError]);

  // 教室変更時
  const handleSchoolChange = (schoolId: string) => {
    setSelectedSchoolId(schoolId);
    const school = schools.find((s) => s.id === schoolId);
    setSelectedSchool(school || null);
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
  const handleApprove = async (sheet: SheetWithTotals) => {
    if (!profile) return;

    try {
      await approveAttendanceSheet(sheet.id, profile.id);
      success(`${sheet.teacher.name}の出勤簿を承認しました`);

      // 一覧を再取得
      const data = await getAttendanceSheetList(selectedSchoolId, yearMonth);
      setSheets(data);
    } catch (error) {
      console.error('Failed to approve:', error);
      toastError('承認に失敗しました');
    }
  };

  // 修正ダイアログを開く
  const handleRejectClick = (sheet: SheetWithTotals) => {
    setRejectingSheet(sheet);
    setRejectReason('');
    setIsRejectDialogOpen(true);
  };

  // 修正実行
  const handleReject = async () => {
    if (!rejectingSheet) return;

    try {
      await rejectAttendanceSheet(rejectingSheet.id, rejectReason);
      success(`${rejectingSheet.teacher.name}の出勤簿を修正しました`);
      setIsRejectDialogOpen(false);
      setRejectingSheet(null);

      // 一覧を再取得
      const data = await getAttendanceSheetList(selectedSchoolId, yearMonth);
      setSheets(data);
    } catch (error) {
      console.error('Failed to reject:', error);
      toastError('修正に失敗しました');
    }
  };

  // 一括承認
  const handleBulkApprove = async () => {
    if (!profile || selectedIds.size === 0) return;

    try {
      await bulkApproveAttendanceSheets(Array.from(selectedIds), profile.id);
      success(`${selectedIds.size}件の出勤簿を承認しました`);
      setSelectedIds(new Set());

      // 一覧を再取得
      const data = await getAttendanceSheetList(selectedSchoolId, yearMonth);
      setSheets(data);
    } catch (error) {
      console.error('Failed to bulk approve:', error);
      toastError('一括承認に失敗しました');
    }
  };

  // 詳細画面へ
  const handleViewDetail = (sheet: SheetWithTotals) => {
    router.push(`/admin/attendance/sheets/${sheet.id}`);
  };

  // ポータルを開く
  const handleOpenPortal = () => {
    if (!selectedSchool?.code) return;
    window.open(`/attendance/${selectedSchool.code}`, '_blank');
  };

  const submittedCount = sheets.filter((s) => s.status === 'submitted').length;

  return (
    <AdminLayout headerTitle="講師勤怠">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">出勤簿管理</h1>
          {selectedSchool && (
            <Button variant="secondary" onClick={handleOpenPortal}>
              <ExternalLink className="h-4 w-4 mr-2" />
              勤怠ポータルを開く
            </Button>
          )}
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
                        {selectedSchool?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {schools.map((school) => (
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
            {/* 一括承認ボタン */}
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
                      <TableHead>講師名</TableHead>
                      <TableHead className="text-center">ステータス</TableHead>
                      {attendanceTypes.map((type) => (
                        <TableHead key={type.id} className="text-center">
                          {type.name}
                        </TableHead>
                      ))}
                      <TableHead className="text-center">合計</TableHead>
                      <TableHead className="w-32">操作</TableHead>
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
                        <TableCell className="font-medium">
                          {sheet.teacher?.name ?? '不明'}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className={ATTENDANCE_STATUS_COLORS[sheet.status]}>
                            {ATTENDANCE_STATUS_LABELS[sheet.status]}
                          </Badge>
                        </TableCell>
                        {attendanceTypes.map((type) => (
                          <TableCell key={type.id} className="text-center">
                            {sheet.type_totals[type.id]?.total || 0}
                            {type.unit === 'hours' ? 'h' : ''}
                          </TableCell>
                        ))}
                        <TableCell className="text-center font-medium">
                          {sheet.grand_total}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              onClick={() => handleViewDetail(sheet)}
                              className="p-2"
                              title="詳細"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {sheet.status === 'submitted' && (
                              <>
                                <Button
                                  variant="ghost"
                                  onClick={() => handleApprove(sheet)}
                                  className="p-2 text-green-600 hover:text-green-700"
                                  title="承認"
                                >
                                  <CheckCircle className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => handleRejectClick(sheet)}
                                  className="p-2 text-red-600 hover:text-red-700"
                                  title="修正"
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
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
              {rejectingSheet?.teacher.name}の出勤簿を修正します。
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
            <Button
              variant="danger"
              onClick={handleReject}
            >
              修正する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
