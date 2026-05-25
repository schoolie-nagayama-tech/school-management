'use client';

/**
 * 講師向け授業スケジュール（隠し公開）
 *
 * URL: /my-schedule
 *
 * 用途：講師が自分の授業を「週次 / 月次」で確認、出欠記録だけ行う。
 *      編集や振替は不可（室長のみ）。既存ナビには載せず URL 直打ちでアクセスする想定。
 *
 * 表示：
 *  - 週次（デフォルト）：月-土を縦に並べたコンパクトリスト
 *  - 月次：カレンダー（日別件数バッジ、日クリックで日リスト展開）
 *  - 各コマに出欠ボタン（present/absent/late）と報告書リンク
 *
 * 既存機能への影響なし：
 *  - 講師がここに来るのは URL を知っている場合のみ
 *  - 編集系のアクションは出欠記録のみに限定
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent } from '@/components/ui';
import { Button } from '@/components/ui';
import { ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { recordAttendance } from '@/lib/api/schedule';
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CalendarRange,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
} from 'lucide-react';
import type { ClassReportStatus } from '@/types/class-report';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface MyEntry {
  id: string;
  entry_date: string;
  student_id: string;
  teacher_id: string;
  kind: 'regular' | 'koushu';
  formation: 'individual' | 'group';
  status: string;
  attendance_status: 'present' | 'absent' | 'late' | null;
  time_slot?: { slot_number: number; start_time: string; end_time: string };
  student?: { id: string; last_name: string; first_name: string; grade: number };
  report?: { id: string; status: ClassReportStatus } | null;
}

type ViewMode = 'week' | 'month';

// --- 日付ユーティリティ ---
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfWeekMonday(d: Date): Date {
  const x = new Date(d);
  const dow = x.getDay();
  const diff = (dow + 6) % 7; // 月曜=0 になるオフセット
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}
function formatDateLong(d: Date): string {
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 (${week})`;
}

export default function MySchedulePage() {
  const { profile } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();

  const [mode, setMode] = useState<ViewMode>('week');
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [entries, setEntries] = useState<MyEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  // 月次ビューで「この日の詳細を表示」する用
  const [monthSelectedDate, setMonthSelectedDate] = useState<string | null>(null);

  // 取得範囲（週は月-土、月は月初-月末）
  const range = useMemo(() => {
    if (mode === 'week') {
      const s = startOfWeekMonday(anchorDate);
      return { from: ymd(s), to: ymd(addDays(s, 5)) };
    }
    return { from: ymd(startOfMonth(anchorDate)), to: ymd(endOfMonth(anchorDate)) };
  }, [mode, anchorDate]);

  const load = useCallback(async () => {
    if (!profile) return;
    setIsLoading(true);
    try {
      const { data, error } = await db
        .from('schedule_entries')
        .select(
          '*, time_slot:schedule_time_slots(slot_number, start_time, end_time), student:students(id, last_name, first_name, grade), report:class_reports(id, status)'
        )
        .eq('teacher_id', profile.id)
        .gte('entry_date', range.from)
        .lte('entry_date', range.to)
        .in('status', ['scheduled', 'completed', 'transferred_in']);
      if (error) throw error;

      type Row = MyEntry & {
        time_slot?: MyEntry['time_slot'] | MyEntry['time_slot'][];
        student?: MyEntry['student'] | MyEntry['student'][];
        report?: { id: string; status: ClassReportStatus }[] | { id: string; status: ClassReportStatus } | null;
      };
      const rows = ((data || []) as Row[]).map((r): MyEntry => {
        const rep = Array.isArray(r.report) ? r.report[0] : r.report;
        return {
          ...r,
          time_slot: Array.isArray(r.time_slot) ? r.time_slot[0] : r.time_slot,
          student: Array.isArray(r.student) ? r.student[0] : r.student,
          report: rep ?? null,
        };
      });
      // 日付 → 時刻 → 生徒名 順
      rows.sort((a, b) => {
        if (a.entry_date !== b.entry_date) return a.entry_date.localeCompare(b.entry_date);
        const ta = a.time_slot?.start_time ?? '';
        const tb = b.time_slot?.start_time ?? '';
        if (ta !== tb) return ta.localeCompare(tb);
        const sa = a.student ? `${a.student.last_name}${a.student.first_name}` : '';
        const sb = b.student ? `${b.student.last_name}${b.student.first_name}` : '';
        return sa.localeCompare(sb, 'ja');
      });
      setEntries(rows);
    } catch (e) {
      console.error(e);
      toastError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [profile, range.from, range.to, toastError]);

  useEffect(() => {
    load();
  }, [load]);

  // 出欠記録（権限：自分のコマのみ recordAttendance 可能 — 既存APIは制限なしなので注意）
  const handleRecord = async (
    entry: MyEntry,
    status: 'present' | 'absent' | 'late'
  ) => {
    if (!profile) return;
    setActingId(entry.id);
    try {
      await recordAttendance(entry.id, status, profile.id);
      success(`${status === 'present' ? '出席' : status === 'absent' ? '欠席' : '遅刻'}を記録しました`);
      // ローカル状態を更新（再フェッチも可だが、軽いので部分更新）
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, attendance_status: status, status: 'completed' } : e))
      );
    } catch (e) {
      toastError(e instanceof Error ? e.message : '記録に失敗しました');
    } finally {
      setActingId(null);
    }
  };

  // ナビ
  const navPrev = () => setAnchorDate((d) => (mode === 'week' ? addDays(d, -7) : addDays(d, -28)));
  const navNext = () => setAnchorDate((d) => (mode === 'week' ? addDays(d, 7) : addDays(d, 28)));
  const navToday = () => setAnchorDate(new Date());

  // 週ビューの日付配列
  const weekDates = useMemo(() => {
    const s = startOfWeekMonday(anchorDate);
    return [0, 1, 2, 3, 4, 5].map((i) => addDays(s, i));
  }, [anchorDate]);

  // 月ビューの日付配列（月初の月曜から月末の日曜まで）
  const monthGrid = useMemo(() => {
    if (mode !== 'month') return [] as Date[];
    const s = startOfWeekMonday(startOfMonth(anchorDate));
    const e = endOfMonth(anchorDate);
    const eEnd = addDays(startOfWeekMonday(e), 6);
    const days: Date[] = [];
    for (let d = new Date(s); d <= eEnd; d = addDays(d, 1)) days.push(new Date(d));
    return days;
  }, [mode, anchorDate]);

  // 日別件数（月ビュー用）
  const countsByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.entry_date, (m.get(e.entry_date) ?? 0) + 1);
    return m;
  }, [entries]);

  const entriesByDate = useMemo(() => {
    const m = new Map<string, MyEntry[]>();
    for (const e of entries) {
      if (!m.has(e.entry_date)) m.set(e.entry_date, []);
      m.get(e.entry_date)!.push(e);
    }
    return m;
  }, [entries]);

  return (
    <AdminLayout>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-4xl mx-auto p-4 space-y-4">

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">授業スケジュール</h1>
          <Link href="/today" className="text-sm text-indigo-600 hover:underline">
            本日のみ表示 →
          </Link>
        </div>

        {/* ナビとモード切替 */}
        <Card>
          <CardContent className="p-3 flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={navPrev}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={navToday}>
              今週
            </Button>
            <Button variant="outline" size="sm" onClick={navNext}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <div className="flex-1 text-center font-semibold">
              {mode === 'week'
                ? `${ymd(weekDates[0])} 〜 ${ymd(weekDates[5])}`
                : `${anchorDate.getFullYear()}年${anchorDate.getMonth() + 1}月`}
            </div>
            <div className="flex border rounded overflow-hidden">
              <button
                type="button"
                onClick={() => setMode('week')}
                className={`px-3 py-1 text-xs font-semibold flex items-center gap-1 ${
                  mode === 'week' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600'
                }`}
              >
                <CalendarRange className="w-3 h-3" />
                週
              </button>
              <button
                type="button"
                onClick={() => setMode('month')}
                className={`px-3 py-1 text-xs font-semibold flex items-center gap-1 ${
                  mode === 'month' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600'
                }`}
              >
                <CalendarDays className="w-3 h-3" />
                月
              </button>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Loading />
        ) : mode === 'week' ? (
          // ---- 週ビュー ----
          <div className="space-y-3">
            {weekDates.map((d) => {
              const key = ymd(d);
              const dayEntries = entriesByDate.get(key) ?? [];
              const isToday = ymd(new Date()) === key;
              return (
                <Card key={key} className={isToday ? 'border-indigo-400 border-2' : ''}>
                  <CardContent className="p-3">
                    <div
                      className={`text-sm font-bold mb-2 flex items-center gap-2 ${
                        isToday ? 'text-indigo-700' : ''
                      }`}
                    >
                      {formatDateLong(d)}
                      {isToday && (
                        <span className="px-1.5 py-0.5 bg-indigo-600 text-white rounded text-[10px]">
                          今日
                        </span>
                      )}
                      <span className="ml-auto text-xs text-gray-500 font-normal">
                        {dayEntries.length} コマ
                      </span>
                    </div>
                    {dayEntries.length === 0 ? (
                      <p className="text-xs text-gray-400 py-2">この日は授業がありません</p>
                    ) : (
                      <ul className="space-y-1">
                        {dayEntries.map((e) => (
                          <EntryRow
                            key={e.id}
                            entry={e}
                            disabled={actingId === e.id}
                            onRecord={(s) => handleRecord(e, s)}
                          />
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          // ---- 月ビュー ----
          <>
            <Card>
              <CardContent className="p-2">
                <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-500 mb-1">
                  {['月', '火', '水', '木', '金', '土', '日'].map((w) => (
                    <div key={w}>{w}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {monthGrid.map((d) => {
                    const key = ymd(d);
                    const inMonth = d.getMonth() === anchorDate.getMonth();
                    const count = countsByDate.get(key) ?? 0;
                    const isToday = ymd(new Date()) === key;
                    const isSelected = monthSelectedDate === key;
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => setMonthSelectedDate(isSelected ? null : key)}
                        className={`aspect-square rounded text-xs flex flex-col items-center justify-center transition-colors border ${
                          !inMonth
                            ? 'bg-gray-50 text-gray-300 border-transparent'
                            : isSelected
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : isToday
                                ? 'border-indigo-400 bg-white'
                                : 'bg-white border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <span className="font-semibold">{d.getDate()}</span>
                        {count > 0 && (
                          <span
                            className={`text-[10px] mt-0.5 px-1 rounded ${
                              isSelected
                                ? 'bg-white/20'
                                : count > 4
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-indigo-100 text-indigo-700'
                            }`}
                          >
                            {count}コマ
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {monthSelectedDate && (
              <Card>
                <CardContent className="p-3">
                  <h2 className="text-sm font-bold mb-2">
                    {formatDateLong(new Date(monthSelectedDate + 'T12:00:00'))}
                  </h2>
                  {(entriesByDate.get(monthSelectedDate) ?? []).length === 0 ? (
                    <p className="text-xs text-gray-400 py-2">この日は授業がありません</p>
                  ) : (
                    <ul className="space-y-1">
                      {(entriesByDate.get(monthSelectedDate) ?? []).map((e) => (
                        <EntryRow
                          key={e.id}
                          entry={e}
                          disabled={actingId === e.id}
                          onRecord={(s) => handleRecord(e, s)}
                        />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

/** 1コマの表示行：時刻 / 生徒 / 出欠ボタン / 報告書リンク */
function EntryRow({
  entry,
  disabled,
  onRecord,
}: {
  entry: MyEntry;
  disabled: boolean;
  onRecord: (s: 'present' | 'absent' | 'late') => void;
}) {
  const studentName = entry.student
    ? `${entry.student.last_name} ${entry.student.first_name}`
    : entry.student_id;
  const slot = entry.time_slot;
  const att = entry.attendance_status;
  return (
    <li className="border border-gray-100 rounded-md p-2 bg-white">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold tabular-nums w-20 flex-shrink-0">
          {slot ? `${slot.start_time?.slice(0, 5)}` : '-'}
        </span>
        <span className="text-sm flex-1 min-w-0 truncate">
          {studentName}
          {entry.student && (
            <span className="text-xs text-gray-500 ml-1">
              ({gradeLabel(entry.student.grade)})
            </span>
          )}
          {entry.kind === 'koushu' && (
            <span className="ml-1 px-1 bg-amber-100 text-amber-800 text-[10px] rounded font-semibold">
              講習
            </span>
          )}
          {entry.formation === 'group' && (
            <span className="ml-1 px-1 bg-purple-100 text-purple-800 text-[10px] rounded font-semibold">
              集団
            </span>
          )}
        </span>

        {/* 出欠ボタン */}
        <div className="flex border rounded overflow-hidden">
          <AttBtn
            label="出席"
            active={att === 'present'}
            color="green"
            onClick={() => onRecord('present')}
            disabled={disabled}
            icon={<CheckCircle className="w-3 h-3" />}
          />
          <AttBtn
            label="欠席"
            active={att === 'absent'}
            color="red"
            onClick={() => onRecord('absent')}
            disabled={disabled}
            icon={<XCircle className="w-3 h-3" />}
          />
          <AttBtn
            label="遅刻"
            active={att === 'late'}
            color="amber"
            onClick={() => onRecord('late')}
            disabled={disabled}
            icon={<Clock className="w-3 h-3" />}
          />
        </div>

        <Link
          href={`/lesson-reports/${entry.id}`}
          className="text-xs text-indigo-600 hover:underline flex items-center gap-0.5 flex-shrink-0"
        >
          <FileText className="w-3 h-3" />
          報告書
          {entry.report && (
            <span
              className={`ml-0.5 px-1 rounded text-[9px] font-bold ${
                entry.report.status === 'approved'
                  ? 'bg-green-100 text-green-700'
                  : entry.report.status === 'submitted'
                    ? 'bg-amber-100 text-amber-700'
                    : entry.report.status === 'rejected'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-gray-100 text-gray-700'
              }`}
            >
              {entry.report.status === 'approved'
                ? '済'
                : entry.report.status === 'submitted'
                  ? '待'
                  : entry.report.status === 'rejected'
                    ? '戻'
                    : '下書'}
            </span>
          )}
        </Link>
      </div>
    </li>
  );
}

function AttBtn({
  label,
  active,
  color,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  active: boolean;
  color: 'green' | 'red' | 'amber';
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
}) {
  const colorClass = active
    ? color === 'green'
      ? 'bg-green-600 text-white'
      : color === 'red'
        ? 'bg-red-600 text-white'
        : 'bg-amber-500 text-white'
    : 'bg-white text-gray-500 hover:bg-gray-50';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-1 text-[10px] font-bold flex items-center gap-0.5 ${colorClass} disabled:opacity-50`}
      title={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
