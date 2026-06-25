'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Button,
  Input,
  Badge,
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
import { AppHeader } from '@/components/layout/AppHeader';
import { ArrowLeft, ChevronLeft, ChevronRight, Send, Undo2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { getSchoolByCode } from '@/lib/api/schools';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toSurnameOnly } from '@/lib/utils/teacherName';
import { useTeacherBadgeCount } from '@/hooks/useTeacherBadgeCount';
import { getTier } from '@/lib/teacher-tier';
import { HiddenFlower } from '@/components/badges/HiddenFlower';
import { BadgeStars } from '@/components/badges/BadgeStars';
import {
  getActiveAttendanceTypes,
  getOrCreateAttendanceSheet,
  getAttendanceSheetDetail,
  saveAttendanceRecord,
  saveAttendanceNote,
  submitAttendanceSheet,
  withdrawAttendanceSheet,
  findAttendanceSheet,
} from '@/lib/api/attendance';
import {
  getCurrentYearMonth,
  getPrevMonth,
  getNextMonth,
  formatYearMonth,
  getMonthDates,
} from '@/lib/utils/date';
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_COLORS,
  type AttendanceType,
  type AttendanceRecord,
  type AttendanceNote,
  type AttendanceSheetStatus,
} from '@/types/attendance';

/** 全角数字・全角ピリオドを半角へ正規化する。
 *  コマ数欄に全角で入力すると parseFloat が NaN→0 になって入力が消えるのを防ぐ。 */
function normalizeFullWidthDigits(value: string): string {
  return value
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.');
}

/** 遅刻早退の選択肢（自由入力で全角が混ざるのを避けるため、種別＋分のプルダウンで構成する）。
 *  保存形式は従来どおり「遅刻15分」のような文字列で、室長側の遅刻早退一覧と互換を保つ。 */
const LATE_EARLY_KINDS = ['遅刻', '早退', '欠勤', '中抜け'] as const;
/** 種別を選んだ直後の分数の初期値 */
const LATE_EARLY_DEFAULT_MINUTES = 15;

/** 「遅刻15分」のような文字列を { kind, minutes } に分解。解析できない場合は空で返す（種別未選択扱い）。 */
function parseLateEarly(value: string): { kind: string; minutes: number | null } {
  const m = value.match(/^(遅刻|早退|中抜け)(\d+)分$/);
  if (m) return { kind: m[1], minutes: parseInt(m[2], 10) };
  if (value === '欠勤') return { kind: '欠勤', minutes: null };
  return { kind: '', minutes: null };
}

/** 種別＋分から保存用文字列を組み立てる。欠勤は分なし、種別未選択は空文字。 */
function composeLateEarly(kind: string, minutes: number | null): string {
  if (!kind) return '';
  if (kind === '欠勤') return '欠勤';
  if (minutes == null) return '';
  return `${kind}${minutes}分`;
}

/** 遅刻早退セレクタ（種別＋分）。テーブルセルに収まるようネイティブ select をコンパクトに使う。 */
function LateEarlySelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  const { kind, minutes } = parseLateEarly(value);
  const selectClass =
    'h-8 text-sm border border-border rounded-md bg-surface-raised px-1 disabled:bg-surface disabled:text-text-faint';
  const needsMinutes = kind !== '' && kind !== '欠勤';
  return (
    <div className="flex items-center gap-1">
      <select
        value={kind}
        disabled={disabled}
        onChange={(e) => {
          const nextKind = e.target.value;
          // 種別変更時：分が必要な種別で未選択なら既定値を入れる
          const nextMinutes =
            nextKind === '欠勤' || nextKind === '' ? null : (minutes ?? LATE_EARLY_DEFAULT_MINUTES);
          onChange(composeLateEarly(nextKind, nextMinutes));
        }}
        className={selectClass}
        aria-label="遅刻早退の種別"
      >
        <option value="">なし</option>
        {LATE_EARLY_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      {needsMinutes && (
        <div className="flex items-center gap-0.5">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={minutes ?? LATE_EARLY_DEFAULT_MINUTES}
            disabled={disabled}
            // 分は1分単位で任意入力。全角は半角へ正規化し、未入力・0以下は記録なし扱い。
            onChange={(e) => {
              const n = parseInt(normalizeFullWidthDigits(e.target.value), 10);
              onChange(composeLateEarly(kind, Number.isFinite(n) && n > 0 ? n : null));
            }}
            className="w-14 h-8 text-sm text-center border border-border rounded-md bg-surface-raised disabled:bg-surface disabled:text-text-faint"
            aria-label="遅刻早退の分数"
          />
          <span className="text-xs text-text-muted">分</span>
        </div>
      )}
    </div>
  );
}

export default function TeacherAttendancePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const schoolCode = params.schoolCode as string;
  const teacherId = params.teacherId as string;

  const { toasts, removeToast, success, error: toastError } = useToast();
  const { profile } = useAuth();
  const badgeCount = useTeacherBadgeCount();
  // 閲覧者が本人の場合のみ演出を適用 (他者のデータを覗くときは通常表示)
  const isOwner = profile?.role === 'teacher' && profile.id === teacherId;
  const tierKey = isOwner && badgeCount !== null ? getTier(badgeCount).key : null;
  const [school, setSchool] = useState<{ id: string; name: string } | null>(null);
  const [teacher, setTeacher] = useState<{ id: string; name: string } | null>(null);
  const [yearMonth, setYearMonth] = useState(searchParams.get('ym') || getCurrentYearMonth());
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [status, setStatus] = useState<AttendanceSheetStatus>('draft');
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [attendanceTypes, setAttendanceTypes] = useState<AttendanceType[]>([]);
  const [records, setRecords] = useState<Map<string, number>>(new Map());
  const [notes, setNotes] = useState<Map<string, { lateEarly: string; note: string }>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false);
  const [showThanks, setShowThanks] = useState(false);
  const [isWithdrawDialogOpen, setIsWithdrawDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevMonthUnsubmitted, setPrevMonthUnsubmitted] = useState<string | null>(null);

  const dates = getMonthDates(yearMonth);

  // 編集可能かどうか
  const canEdit = status === 'draft' || status === 'rejected';

  // データ取得
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 教室 + 講師は互いに独立 → 並列
      const supabase = getSupabaseBrowserClient();
      const [schoolData, teacherRes] = await Promise.all([
        getSchoolByCode(schoolCode),
        supabase
          .from('user_profiles')
          .select('id, display_name, email, role, is_active')
          .eq('id', teacherId)
          .eq('role', 'teacher')
          .maybeSingle(),
      ]);

      if (!schoolData) {
        setError('教室が見つかりません');
        return;
      }
      setSchool(schoolData);

      if (teacherRes.error) {
        console.error('Error fetching teacher:', teacherRes.error);
        throw new Error('講師情報の取得に失敗しました');
      }
      const teacherData = teacherRes.data;
      if (!teacherData || teacherData.is_active === false) {
        throw new Error('講師情報の取得に失敗しました');
      }
      setTeacher({
        id: teacherData.id,
        name:
          profile?.role === 'teacher'
            ? profile?.last_name ||
              toSurnameOnly(teacherData.display_name) ||
              teacherData.email ||
              '未設定'
            : teacherData.display_name || teacherData.email || '未設定',
      });

      // コマ種別 + 出勤簿（取得 or 作成）を並列
      const [types, sheet] = await Promise.all([
        getActiveAttendanceTypes(schoolData.id),
        getOrCreateAttendanceSheet(teacherId, schoolData.id, yearMonth),
      ]);
      setAttendanceTypes(types);
      setSheetId(sheet.id);
      setStatus(sheet.status as AttendanceSheetStatus);
      setRejectionReason(sheet.rejection_reason ?? null);

      // 前月のシートが未提出かチェック（今日の前月が基準）
      const realPrevMonth = getPrevMonth(getCurrentYearMonth());
      findAttendanceSheet(teacherId, schoolData.id, realPrevMonth).then((prev) => {
        if (prev && (prev.status === 'draft' || prev.status === 'rejected')) {
          setPrevMonthUnsubmitted(realPrevMonth);
        } else {
          setPrevMonthUnsubmitted(null);
        }
      });

      // 明細と備考を取得
      const detail = await getAttendanceSheetDetail(sheet.id);

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
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [schoolCode, teacherId, yearMonth]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 年月変更時
  const handleMonthChange = (newYearMonth: string) => {
    setYearMonth(newYearMonth);
    router.push(`/attendance/${schoolCode}/${teacherId}?ym=${newYearMonth}`);
  };

  // コマ数変更
  const handleValueChange = async (date: string, typeId: string, value: string) => {
    if (!sheetId || !canEdit) return;

    // 全角で入力された数字を半角に正規化してから数値化（全角だと 0 に化けるのを防ぐ）
    const numValue = parseFloat(normalizeFullWidthDigits(value)) || 0;
    const key = `${date}_${typeId}`;

    // 即座にUIを更新
    setRecords((prev) => {
      const newMap = new Map(prev);
      newMap.set(key, numValue);
      return newMap;
    });

    // DBに保存
    try {
      await saveAttendanceRecord(sheetId, date, typeId, numValue);
    } catch (err) {
      console.error('Failed to save record:', err);
      toastError('保存に失敗しました');
    }
  };

  // 遅刻早退変更
  const handleLateEarlyChange = async (date: string, value: string) => {
    if (!sheetId || !canEdit) return;

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
    if (!sheetId || !canEdit) return;

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

  // 提出
  const handleSubmit = async () => {
    if (!sheetId) return;

    setIsSaving(true);
    try {
      await submitAttendanceSheet(sheetId);
      setStatus('submitted');
      setIsSubmitDialogOpen(false);
      // ボタン近くに感謝のポップアップを表示（4秒で自動消去）
      setShowThanks(true);
      setTimeout(() => setShowThanks(false), 4000);
    } catch (err) {
      console.error('Failed to submit:', err);
      toastError('提出に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // 取り下げ
  const handleWithdraw = async () => {
    if (!sheetId) return;

    setIsSaving(true);
    try {
      await withdrawAttendanceSheet(sheetId);
      setStatus('draft');
      success('取り下げました');
      setIsWithdrawDialogOpen(false);
    } catch (err) {
      console.error('Failed to withdraw:', err);
      toastError('取り下げに失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // 種別ごとの合計を計算
  const getTypeTotal = (typeId: string): number => {
    let total = 0;
    dates.forEach((d) => {
      const key = `${d.date}_${typeId}`;
      total += records.get(key) || 0;
    });
    return total;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loading />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-danger text-lg">{error}</p>
          <Button variant="secondary" className="mt-4" onClick={() => router.push('/students')}>
            戻る
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen bg-gray-50${tierKey ? ' tier-attendance' : ''}`}
      data-teacher-tier={tierKey ?? undefined}
    >
      <AppHeader title="講師勤怠" />
      {/* ヘッダー */}
      <header className="bg-surface-raised border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => router.push('/students')} className="p-2">
              <ArrowLeft className="h-4 w-4 mr-1" />
              戻る
            </Button>
            <div className="text-center">
              <p className="text-sm text-text-body">{school?.name}</p>
              <p className="font-bold">{teacher?.name}</p>
              {isOwner && badgeCount !== null && badgeCount > 0 && (
                <BadgeStars count={badgeCount} className="mt-0.5" />
              )}
            </div>
            <Badge className={ATTENDANCE_STATUS_COLORS[status]}>
              {ATTENDANCE_STATUS_LABELS[status]}
            </Badge>
          </div>
        </div>
      </header>

      {/* 前月未提出アラート */}
      {prevMonthUnsubmitted && prevMonthUnsubmitted !== yearMonth && (
        <div className="bg-amber-50 border-b border-amber-300">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-900 flex-1">
              {formatYearMonth(prevMonthUnsubmitted)}の出勤簿がまだ提出されていません
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleMonthChange(prevMonthUnsubmitted)}
            >
              {formatYearMonth(prevMonthUnsubmitted)}を開く
            </Button>
          </div>
        </div>
      )}

      {/* 年月選択 */}
      <div className="bg-surface-raised border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => handleMonthChange(getPrevMonth(yearMonth))}
            className="p-2"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <span className={`text-lg font-medium${tierKey ? ' tier-ym' : ''}`}>
            {formatYearMonth(yearMonth)}
          </span>
          <Button
            variant="ghost"
            onClick={() => handleMonthChange(getNextMonth(yearMonth))}
            className="p-2"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* 差し戻し理由 */}
      {status === 'rejected' && (
        <div className="bg-red-50 border-b border-red-200">
          <div className="max-w-6xl mx-auto px-4 py-3">
            <p className="text-red-700 text-sm">
              <strong>差し戻し：</strong>内容を修正して再提出してください
              {rejectionReason && (
                <span className="block mt-2 px-3 py-2 bg-red-50 rounded text-red-800">
                  {rejectionReason}
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* 入力テーブル */}
      <main className="max-w-6xl mx-auto px-4 py-4">
        <div className="bg-surface-raised rounded-lg shadow overflow-x-auto">
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
                    className={`${isWeekend ? 'bg-blue-50/50' : ''} hover:bg-gray-50`}
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
                            disabled={!canEdit}
                            className="w-16 h-8 text-center mx-auto"
                          />
                        </td>
                      );
                    })}
                    <td className="px-1 py-1 border-b">
                      <LateEarlySelect
                        value={noteData?.lateEarly || ''}
                        onChange={(next) => handleLateEarlyChange(d.date, next)}
                        disabled={!canEdit}
                      />
                    </td>
                    <td className="px-1 py-1 border-b">
                      <Input
                        value={noteData?.note || ''}
                        onChange={(e) => handleNoteChange(d.date, e.target.value)}
                        disabled={!canEdit}
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
        </div>

        {/* 操作ボタン */}
        <div className="relative mt-6 flex justify-center gap-4">
          {/* 提出完了のポンっと感謝ポップアップ */}
          {showThanks && (
            <div
              className="absolute left-1/2 -top-2 -translate-x-1/2 -translate-y-full z-30 pointer-events-none"
              style={{
                animation:
                  'thanks-pop 0.5s cubic-bezier(.34,1.56,.64,1) both, thanks-fade-out .5s cubic-bezier(0.23,1,0.32,1) 3.5s forwards',
              }}
            >
              <div className="relative bg-gradient-to-br from-pink-50 to-white border border-pink-200 rounded-2xl shadow-lg px-5 py-3 whitespace-nowrap">
                <p className="text-sm font-bold text-pink-700 leading-tight">提出しました！</p>
                <p className="text-xs text-gray-600 mt-1 leading-tight">
                  今月もありがとうございました！
                </p>
                <span className="absolute -top-2 -right-2">
                  <HiddenFlower size={16} rotate={20} opacity={0.85} />
                </span>
                <span className="absolute -bottom-1 -left-1">
                  <HiddenFlower size={12} rotate={-30} opacity={0.7} color="#F8BBD0" />
                </span>
                <span className="absolute -top-1 left-3">
                  <HiddenFlower size={10} rotate={45} opacity={0.6} color="#FCE4EC" />
                </span>
                {/* 吹き出しの三角 */}
                <span
                  className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-3 h-3 bg-white border-r border-b border-pink-200 rotate-45"
                  aria-hidden
                />
              </div>
              <style>{`
                @keyframes thanks-pop {
                  0% { transform: translate(-50%, calc(-100% + 14px)) scale(.5); opacity: 0; }
                  60% { transform: translate(-50%, calc(-100% - 4px)) scale(1.06); opacity: 1; }
                  100% { transform: translate(-50%, -100%) scale(1); opacity: 1; }
                }
                @keyframes thanks-fade-out {
                  0% { opacity: 1; }
                  100% { opacity: 0; transform: translate(-50%, calc(-100% + 6px)) scale(.95); }
                }
              `}</style>
            </div>
          )}
          {status === 'draft' && (
            <Button onClick={() => setIsSubmitDialogOpen(true)}>
              <Send className="h-4 w-4 mr-2" />
              提出する
            </Button>
          )}
          {status === 'submitted' && (
            <Button variant="secondary" onClick={() => setIsWithdrawDialogOpen(true)}>
              <Undo2 className="h-4 w-4 mr-2" />
              提出を取り下げる
            </Button>
          )}
          {status === 'rejected' && (
            <Button onClick={() => setIsSubmitDialogOpen(true)}>
              <Send className="h-4 w-4 mr-2" />
              再提出する
            </Button>
          )}
          {status === 'approved' && <p className="text-text-body">承認済みのため編集できません</p>}
        </div>
      </main>

      {/* 提出確認ダイアログ */}
      <AlertDialog open={isSubmitDialogOpen} onOpenChange={setIsSubmitDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>出勤簿を提出しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              提出後は編集できなくなります。教室長の承認後に確定します。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsSubmitDialogOpen(false)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? '提出中...' : '提出する'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 取り下げ確認ダイアログ */}
      <AlertDialog open={isWithdrawDialogOpen} onOpenChange={setIsWithdrawDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>提出を取り下げますか？</AlertDialogTitle>
            <AlertDialogDescription>
              取り下げると再度編集できるようになります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsWithdrawDialogOpen(false)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleWithdraw} disabled={isSaving}>
              {isSaving ? '処理中...' : '取り下げる'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
