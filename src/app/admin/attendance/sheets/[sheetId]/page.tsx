'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Button, Input, Badge, Card, CardContent, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Textarea, Label, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { ArrowLeft, ChevronLeft, ChevronRight, CheckCircle, XCircle, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import {
  getAttendanceSheetDetail,
  getActiveAttendanceTypes,
  saveAttendanceRecord,
  saveAttendanceNote,
  approveAttendanceSheet,
  rejectToTeacher,
  rejectToManager,
  reopenAttendanceSheet,
} from '@/lib/api/attendance';
import {
  formatYearMonth,
  getMonthDates,
  getPrevMonth,
  getNextMonth,
} from '@/lib/utils/date';
import { useAuth } from '@/contexts/AuthContext';
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_COLORS,
  type AttendanceType,
  type AttendanceRecord,
  type AttendanceNote,
  type AttendanceSheet,
  type AttendanceSheetStatus,
} from '@/types/attendance';

export default function AttendanceSheetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { profile } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const sheetId = params.sheetId as string;

  const isManager = profile?.role === 'manager';
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';

  const [sheet, setSheet] = useState<AttendanceSheet | null>(null);
  const [attendanceTypes, setAttendanceTypes] = useState<AttendanceType[]>([]);
  const [records, setRecords] = useState<Map<string, number>>(new Map());
  const [notes, setNotes] = useState<Map<string, { lateEarly: string; note: string }>>(
    new Map()
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const detail = await getAttendanceSheetDetail(sheetId);
      setSheet(detail.sheet);

      const types = await getActiveAttendanceTypes(detail.sheet.school_id);
      setAttendanceTypes(types);

      // recordsをMapに変換
      const recordsMap = new Map<string, number>();
      detail.records.forEach((r: AttendanceRecord) => {
        const key = `${r.date}_${r.attendance_type_id}`;
        recordsMap.set(key, Number(r.value));
      });
      setRecords(recordsMap);

      // notesをMapに変換
      const notesMap = new Map<string, { lateEarly: string; note: string }>();
      detail.notes.forEach((n: AttendanceNote) => {
        notesMap.set(n.date, {
          lateEarly: n.late_early || '',
          note: n.note || '',
        });
      });
      setNotes(notesMap);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      toastError('データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [sheetId, toastError]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading || !sheet) {
    return (
      <AdminLayout headerTitle="講師勤怠">
        <div className="flex justify-center py-8">
          <div className="text-text-body">読み込み中...</div>
        </div>
      </AdminLayout>
    );
  }

  const dates = getMonthDates(sheet.year_month);
  const status = sheet.status as AttendanceSheetStatus;

  // コマ数変更（管理者は常に編集可能）
  const handleValueChange = async (
    date: string,
    typeId: string,
    value: string
  ) => {
    const numValue = parseFloat(value) || 0;
    const key = `${date}_${typeId}`;

    setRecords((prev) => {
      const newMap = new Map(prev);
      newMap.set(key, numValue);
      return newMap;
    });

    try {
      await saveAttendanceRecord(sheetId, date, typeId, numValue);
    } catch (err) {
      console.error('Failed to save record:', err);
      toastError('保存に失敗しました');
    }
  };

  // 遅刻早退変更
  const handleLateEarlyChange = async (date: string, value: string) => {
    const currentNote = notes.get(date);

    setNotes((prev) => {
      const newMap = new Map(prev);
      newMap.set(date, {
        lateEarly: value,
        note: currentNote?.note || '',
      });
      return newMap;
    });

    try {
      await saveAttendanceNote(sheetId, date, value || null, currentNote?.note || null);
    } catch (err) {
      console.error('Failed to save note:', err);
      toastError('保存に失敗しました');
    }
  };

  // 備考変更
  const handleNoteChange = async (date: string, value: string) => {
    const currentNote = notes.get(date);

    setNotes((prev) => {
      const newMap = new Map(prev);
      newMap.set(date, {
        lateEarly: currentNote?.lateEarly || '',
        note: value,
      });
      return newMap;
    });

    try {
      await saveAttendanceNote(sheetId, date, currentNote?.lateEarly || null, value || null);
    } catch (err) {
      console.error('Failed to save note:', err);
      toastError('保存に失敗しました');
    }
  };

  // 承認
  const handleApprove = async () => {
    if (!profile) return;

    try {
      await approveAttendanceSheet(sheetId, profile.id);
      success('承認しました');
      fetchData();
    } catch (error) {
      console.error('Failed to approve:', error);
      toastError('承認に失敗しました');
    }
  };

  // 差し戻し（ロール別）
  const handleReject = async () => {
    try {
      if (isManager && status === 'submitted') {
        await rejectToTeacher(sheetId, rejectReason);
        success('講師に差し戻しました');
      } else if (isAdmin && status === 'reviewed') {
        await rejectToManager(sheetId, rejectReason);
        success('教室長に差し戻しました');
      } else {
        await rejectToTeacher(sheetId, rejectReason);
        success('差し戻しました');
      }
      setIsRejectDialogOpen(false);
      fetchData();
    } catch (error) {
      console.error('Failed to reject:', error);
      toastError('差し戻しに失敗しました');
    }
  };

  // 承認取消（提出済みに戻す）
  const handleReopen = async () => {
    try {
      await reopenAttendanceSheet(sheetId);
      success('提出済みに戻しました');
      setIsReopenDialogOpen(false);
      fetchData();
    } catch (error) {
      console.error('Failed to reopen:', error);
      toastError('操作に失敗しました');
    }
  };

  // 種別ごとの合計
  const getTypeTotal = (typeId: string): number => {
    let total = 0;
    dates.forEach((d) => {
      const key = `${d.date}_${typeId}`;
      total += records.get(key) || 0;
    });
    return total;
  };

  // 別の月の出勤簿へ移動
  const navigateToMonth = async (newYearMonth: string) => {
    // 同じ講師・教室の別月の出勤簿を探す or 作成
    if (sheet.school?.code && sheet.teacher_id) {
      router.push(
        `/attendance/${sheet.school.code}/${sheet.teacher_id}?ym=${newYearMonth}`
      );
    }
  };

  return (
    <AdminLayout headerTitle="講師勤怠">
      <div className="space-y-6">
        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push('/admin/attendance')}
              className="p-2"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <p className="text-sm text-text-body">{sheet.school?.name}</p>
              <h1 className="text-2xl font-bold">{sheet.teacher?.name}</h1>
            </div>
          </div>
          <Badge className={ATTENDANCE_STATUS_COLORS[status]}>
            {ATTENDANCE_STATUS_LABELS[status]}
          </Badge>
        </div>

        {/* 年月選択 */}
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="ghost"
            onClick={() => navigateToMonth(getPrevMonth(sheet.year_month))}
            className="p-2"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <span className="text-lg font-medium min-w-[120px] text-center">
            {formatYearMonth(sheet.year_month)}
          </span>
          <Button
            variant="ghost"
            onClick={() => navigateToMonth(getNextMonth(sheet.year_month))}
            className="p-2"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        {/* 修正理由表示 */}
        {status === 'rejected' && sheet.rejection_reason && (
          <Card className="bg-red-50 border-red-200">
            <CardContent className="py-3">
              <p className="text-red-700 text-sm">
                <strong>修正理由：</strong>
                {sheet.rejection_reason}
              </p>
            </CardContent>
          </Card>
        )}

        {/* 入力テーブル */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-left font-medium border-b sticky left-0 bg-gray-50 min-w-[80px]">
                    日付
                  </th>
                  {attendanceTypes.map((type) => (
                    <th
                      key={type.id}
                      className="px-2 py-2 text-center font-medium border-b min-w-[70px]"
                    >
                      {type.name}
                      <span className="block text-xs text-text-body font-normal">
                        {type.unit === 'hours' ? '(h)' : ''}
                      </span>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center font-medium border-b min-w-[100px]">
                    遅刻早退
                  </th>
                  <th className="px-2 py-2 text-center font-medium border-b min-w-[120px]">
                    備考
                  </th>
                </tr>
              </thead>
              <tbody>
                {dates.map((d) => {
                  const isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;
                  const noteData = notes.get(d.date);

                  return (
                    <tr
                      key={d.date}
                      className={`${isWeekend ? 'bg-blue-50/50' : ''} hover:bg-gray-50 transition-colors duration-150`}
                    >
                      <td
                        className={`px-2 py-1 border-b sticky left-0 ${
                          isWeekend ? 'bg-blue-50/50' : 'bg-surface-raised'
                        }`}
                      >
                        <span
                          className={`${
                            d.dayOfWeek === 0
                              ? 'text-red-600'
                              : d.dayOfWeek === 6
                              ? 'text-blue-600'
                              : ''
                          }`}
                        >
                          {parseInt(d.date.split('-')[2])}日({d.dayLabel})
                        </span>
                      </td>
                      {attendanceTypes.map((type) => {
                        const key = `${d.date}_${type.id}`;
                        const value = records.get(key) || '';

                        return (
                          <td key={type.id} className="px-1 py-1 border-b text-center">
                            <Input
                              type="number"
                              min="0"
                              step={type.unit === 'hours' ? '0.5' : '1'}
                              value={value}
                              onChange={(e) =>
                                handleValueChange(d.date, type.id, e.target.value)
                              }
                              className="w-16 h-8 text-center mx-auto"
                            />
                          </td>
                        );
                      })}
                      <td className="px-1 py-1 border-b">
                        <Input
                          value={noteData?.lateEarly || ''}
                          onChange={(e) => handleLateEarlyChange(d.date, e.target.value)}
                          placeholder="遅刻15分"
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="px-1 py-1 border-b">
                        <Input
                          value={noteData?.note || ''}
                          onChange={(e) => handleNoteChange(d.date, e.target.value)}
                          placeholder="備考"
                          className="h-8 text-sm"
                        />
                      </td>
                    </tr>
                  );
                })}
                {/* 合計行 */}
                <tr className="bg-gray-100 font-medium">
                  <td className="px-2 py-2 border-b sticky left-0 bg-gray-100">
                    合計
                  </td>
                  {attendanceTypes.map((type) => (
                    <td key={type.id} className="px-2 py-2 border-b text-center">
                      {getTypeTotal(type.id)}
                      {type.unit === 'hours' ? 'h' : 'コマ'}
                    </td>
                  ))}
                  <td className="px-2 py-2 border-b"></td>
                  <td className="px-2 py-2 border-b"></td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* 操作ボタン */}
        <div className="flex justify-center gap-4">
          {/* 教室長: 提出済みの出勤簿を講師に差し戻し */}
          {isManager && status === 'submitted' && (
            <Button
              variant="danger"
              onClick={() => setIsRejectDialogOpen(true)}
            >
              <XCircle className="h-4 w-4 mr-2" />
              講師に差し戻す
            </Button>
          )}
          {/* 管理者: 確認済み or 提出済みを承認 */}
          {isAdmin && (status === 'reviewed' || status === 'submitted') && (
            <>
              <Button onClick={handleApprove}>
                <CheckCircle className="h-4 w-4 mr-2" />
                承認する
              </Button>
              {status === 'reviewed' && (
                <Button
                  variant="danger"
                  onClick={() => setIsRejectDialogOpen(true)}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  教室長に差し戻す
                </Button>
              )}
            </>
          )}
          {isAdmin && status === 'approved' && (
            <Button
              variant="secondary"
              onClick={() => setIsReopenDialogOpen(true)}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              承認を取り消して確認済みに戻す
            </Button>
          )}
        </div>
      </div>

      {/* 差し戻しダイアログ */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isManager ? '講師に差し戻し' : '教室長に差し戻し'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
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
