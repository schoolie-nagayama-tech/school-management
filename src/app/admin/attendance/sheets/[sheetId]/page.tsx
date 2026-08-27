'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import {
  Button,
  Input,
  Badge,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Textarea,
  Label,
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
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
  RotateCcw,
  Send,
} from 'lucide-react';
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
  submitAttendanceSheet,
} from '@/lib/api/attendance';
import { formatYearMonth, getMonthDates, getPrevMonth, getNextMonth } from '@/lib/utils/date';
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
import { ScheduleDriftCheckPanel } from '@/components/attendance/ScheduleDriftCheckPanel';
import { LateEarlySelect } from '@/components/attendance/LateEarlySelect';

export default function AttendanceSheetDetailPage() {
  const params = useParams();
  const router = useRouter();
  // 一覧から渡された表示月。戻るときに同じ月へ返すために使う
  const backYearMonth = useSearchParams()?.get('ym') ?? '';
  const { profile } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const sheetId = params.sheetId as string;

  const isManager = profile?.role === 'manager';
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';

  const [sheet, setSheet] = useState<AttendanceSheet | null>(null);
  const [attendanceTypes, setAttendanceTypes] = useState<AttendanceType[]>([]);
  const [records, setRecords] = useState<Map<string, number>>(new Map());
  const [notes, setNotes] = useState<Map<string, { lateEarly: string; note: string }>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [isReopenDialogOpen, setIsReopenDialogOpen] = useState(false);
  const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false);
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
        <Loading size="md" />
      </AdminLayout>
    );
  }

  const dates = getMonthDates(sheet.year_month);
  const status = sheet.status as AttendanceSheetStatus;

  // 自分自身の出勤簿を開いているか。
  // ★ 事務員など「室長以上のロールだが自分も出勤簿を書く」人のための判定。
  //   講師用の出勤簿ページ(/attendance/[schoolCode]/[teacherId])は role='teacher' 前提で
  //   開けないため、提出ボタンがどこにも無く、入力しても「入力中」のまま止まっていた。
  const isOwnSheet = !!profile?.id && profile.id === sheet.teacher_id;

  // 提出できるのは「本人」と「管理者(admin/owner)」。
  // ★ 管理者が他人の分も提出できる必要がある: 退職した講師は本人が提出できないので、
  //   誰も出せないまま永久に「入力中」で残り、承認フローに乗らなくなる。
  const canSubmitSheet = (isOwnSheet || isAdmin) && (status === 'draft' || status === 'rejected');

  // コマ数変更（管理者は常に編集可能）
  const handleValueChange = async (date: string, typeId: string, value: string) => {
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

  // 出勤簿を提出（入力中／差し戻し → 提出済み）。本人の提出と管理者の代理提出で共通。
  const handleSubmitSheet = async () => {
    try {
      await submitAttendanceSheet(sheetId);
      success(isOwnSheet ? '提出しました' : '代理で提出しました');
      setIsSubmitDialogOpen(false);
      fetchData();
    } catch (error) {
      console.error('Failed to submit sheet:', error);
      toastError('提出に失敗しました');
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
      router.push(`/attendance/${sheet.school.code}/${sheet.teacher_id}?ym=${newYearMonth}`);
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
              // 一覧で見ていた月(?ym=)へ戻す。付いていなければ従来どおり既定の月。
              onClick={() =>
                router.push(
                  backYearMonth ? `/admin/attendance?ym=${backYearMonth}` : '/admin/attendance'
                )
              }
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
                  {/* 遅刻早退は講師側の入力欄を廃止したため、ここが唯一の入力箇所 */}
                  <th className="px-2 py-2 text-center font-medium border-b min-w-[150px] whitespace-nowrap">
                    遅刻早退
                    <span className="block text-xs text-text-body font-normal">室長が入力</span>
                  </th>
                  <th className="px-2 py-2 text-center font-medium border-b min-w-[120px]">備考</th>
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
                              onChange={(e) => handleValueChange(d.date, type.id, e.target.value)}
                              className="w-16 h-8 text-center mx-auto"
                            />
                          </td>
                        );
                      })}
                      <td className="px-1 py-1 border-b">
                        <LateEarlySelect
                          value={noteData?.lateEarly || ''}
                          onChange={(next) => handleLateEarlyChange(d.date, next)}
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
                  <td className="px-2 py-2 border-b sticky left-0 bg-gray-100">合計</td>
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
          {/* 本人の提出（講師ページを開けない室長以上のための導線）＋管理者による代理提出 */}
          {canSubmitSheet && (
            <Button onClick={() => setIsSubmitDialogOpen(true)}>
              <Send className="h-4 w-4 mr-2" />
              {isOwnSheet ? (status === 'rejected' ? '再提出する' : '提出する') : '代理で提出する'}
            </Button>
          )}
          {/* 教室長: 提出済みの出勤簿を講師に差し戻し */}
          {isManager && status === 'submitted' && (
            <Button variant="danger" onClick={() => setIsRejectDialogOpen(true)}>
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
                <Button variant="danger" onClick={() => setIsRejectDialogOpen(true)}>
                  <XCircle className="h-4 w-4 mr-2" />
                  教室長に差し戻す
                </Button>
              )}
            </>
          )}
          {isAdmin && status === 'approved' && (
            <Button variant="secondary" onClick={() => setIsReopenDialogOpen(true)}>
              <RotateCcw className="h-4 w-4 mr-2" />
              承認を取り消して確認済みに戻す
            </Button>
          )}
        </div>

        {/* スケジュール照合パネル：講師申告と座席表側コマ数の差分チェック */}
        {sheet && (
          <div className="mt-4">
            <ScheduleDriftCheckPanel
              schoolId={sheet.school_id}
              teacherId={sheet.teacher_id}
              yearMonth={sheet.year_month}
              teacherReportedByDate={(() => {
                // attendance_records (date_typeId → value) を date → 合計コマ に集約
                // count 単位の attendance_type のみ「コマ数」として加算（hours は除外）
                const countTypeIds = new Set(
                  attendanceTypes.filter((t) => t.unit === 'count').map((t) => t.id)
                );
                const byDate = new Map<string, number>();
                records.forEach((value, key) => {
                  const [date, typeId] = key.split('_');
                  if (!countTypeIds.has(typeId)) return;
                  byDate.set(date, (byDate.get(date) ?? 0) + value);
                });
                return byDate;
              })()}
              teacherReportedTotal={(() => {
                const countTypeIds = new Set(
                  attendanceTypes.filter((t) => t.unit === 'count').map((t) => t.id)
                );
                let total = 0;
                records.forEach((value, key) => {
                  const [, typeId] = key.split('_');
                  if (countTypeIds.has(typeId)) total += value;
                });
                return total;
              })()}
            />
          </div>
        )}
      </div>

      {/* 差し戻しダイアログ */}
      {/* Header / Footer は DialogContent の外に置く（中に入れるとスクロール領域に巻き込まれ、
          タイトルが上端で切れ、ボタンが画面外に出る）。幅は Dialog の size で決まる。 */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogHeader>
          <DialogTitle>{isManager ? '講師に差し戻し' : '教室長に差し戻し'}</DialogTitle>
        </DialogHeader>
        <DialogContent>
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

      {/* 提出確認ダイアログ（本人／管理者の代理提出で文言を変える） */}
      <AlertDialog open={isSubmitDialogOpen} onOpenChange={setIsSubmitDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isOwnSheet
                ? '自分の出勤簿を提出しますか？'
                : `${sheet.teacher?.name ?? 'この講師'}さんの出勤簿を代理で提出しますか？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isOwnSheet
                ? '提出すると「提出済み」になり、承認の対象になります。提出後も内容は編集できます。'
                : '本人の代わりに「提出済み」にします。退職などで本人が提出できない出勤簿を承認フローに乗せるための操作です。提出後も内容は編集できます。'}
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

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
