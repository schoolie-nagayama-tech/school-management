'use client';

/**
 * 「本日の授業」ページ
 *
 * URL: /today
 *
 * 用途：講師が自分の本日の担当授業を一覧で見て、各コマから報告書フォームへ遷移するための入口。
 *      室長が表示する場合は、教室全体の本日授業を一覧。
 *
 * 表示:
 *  - 本日の schedule_entries (status=scheduled/completed/transferred_in、講師=ログイン中ユーザー)
 *  - 各コマカード: 時刻 / 生徒名 / 教科 / 報告書ステータス(未提出=赤・下書き=黄・承認待ち=灰・公開=緑)
 *  - クリックで /lesson-reports/[scheduleEntryId] へ遷移
 *
 * 日付ナビ:
 *  - 「前日 / 本日 / 翌日」のシンプルなナビ
 *  - 過去授業の報告書記入も可能
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent } from '@/components/ui';
import { Button } from '@/components/ui';
import { ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
// Phase A: 形態キーの直書きを定数参照に置換。
// TODO(Phase E): 形態バッジ表示はマスタ label 参照へ差し替える（新形態も表示できるように）。
import { GROUP_FORMATION, SCHEDULE_ENTRY_FORMATION_LABELS } from '@/types/schedule';
import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import type { ClassReportStatus } from '@/types/class-report';
import { ChevronLeft, ChevronRight, FileText, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import { displayStudentNameForTeacher } from '@/lib/utils/displayStudentName';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface TodayEntry {
  id: string;
  entry_date: string;
  student_id: string;
  teacher_id: string;
  subject_ids: string[];
  kind: 'regular' | 'koushu';
  formation: string; // Phase A: 動的マスタ化で union → string に緩和
  time_slot?: { slot_number: number; start_time: string; end_time: string };
  student?: { id: string; last_name: string; first_name: string; grade: number };
  teacher?: { id: string; display_name: string | null };
  /** 報告書ステータス（join 結果）。NULL = まだ報告書なし */
  report?: { id: string; status: ClassReportStatus } | null;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 (${week})`;
}

export default function TodayPage() {
  const { profile, selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast } = useToast();
  const [date, setDate] = useState<string>(todayStr());
  const [entries, setEntries] = useState<TodayEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 講師ロールなら自分のコマのみ、室長/管理者なら教室全体
  const isTeacherOnly = profile?.role === 'teacher';

  const load = useCallback(async () => {
    if (!profile) return;
    setIsLoading(true);
    try {
      const schoolIds =
        selectedSchoolId && selectedSchoolId !== 'all'
          ? [selectedSchoolId]
          : getSelectedSchoolIds();

      // 複数教室を同時表示すると 1 日でも合計が 1000 行を超えうるため全件ページング取得。
      // entry_date は一意でないので id を最終ソートキーに加えて安定化する。
      const data = await fetchAllPaged<unknown>((from, to) => {
        let query = db
          .from('schedule_entries')
          .select(
            '*, time_slot:schedule_time_slots(slot_number, start_time, end_time), student:students(id, last_name, first_name, grade), teacher:user_profiles!schedule_entries_teacher_id_fkey(id, display_name), report:class_reports(id, status)'
          )
          .eq('entry_date', date)
          .in('status', ['scheduled', 'completed', 'transferred_in']);

        if (schoolIds.length > 0) query = query.in('school_id', schoolIds);
        if (isTeacherOnly) query = query.eq('teacher_id', profile.id);

        return query.order('id', { ascending: true }).range(from, to);
      });

      type Row = TodayEntry & {
        time_slot?: TodayEntry['time_slot'] | TodayEntry['time_slot'][];
        student?: TodayEntry['student'] | TodayEntry['student'][];
        teacher?: TodayEntry['teacher'] | TodayEntry['teacher'][];
        report?:
          | { id: string; status: ClassReportStatus }[]
          | { id: string; status: ClassReportStatus }
          | null;
      };
      const rows = (data || []) as Row[];
      const normalized = rows.map((r): TodayEntry => {
        const rep = Array.isArray(r.report) ? r.report[0] : r.report;
        return {
          ...r,
          time_slot: Array.isArray(r.time_slot) ? r.time_slot[0] : r.time_slot,
          student: Array.isArray(r.student) ? r.student[0] : r.student,
          teacher: Array.isArray(r.teacher) ? r.teacher[0] : r.teacher,
          report: rep ?? null,
        };
      });

      // 時刻順 → 生徒順
      normalized.sort((a, b) => {
        const ta = a.time_slot?.start_time ?? '';
        const tb = b.time_slot?.start_time ?? '';
        if (ta !== tb) return ta.localeCompare(tb);
        const sa = a.student ? `${a.student.last_name}${a.student.first_name}` : '';
        const sb = b.student ? `${b.student.last_name}${b.student.first_name}` : '';
        return sa.localeCompare(sb, 'ja');
      });

      setEntries(normalized);
    } catch (e) {
      console.error(e);
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [profile, date, selectedSchoolId, getSelectedSchoolIds, isTeacherOnly]);

  useEffect(() => {
    load();
  }, [load]);

  // 報告書ステータスのバッジ表示
  const statusBadge = (status: ClassReportStatus | null | undefined) => {
    if (!status) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-danger-subtle text-danger rounded text-xs font-semibold">
          <AlertCircle className="w-3 h-3" /> 未提出
        </span>
      );
    }
    if (status === 'draft') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-warning-subtle text-warning rounded text-xs font-semibold">
          <Clock className="w-3 h-3" /> 下書き
        </span>
      );
    }
    if (status === 'submitted') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface text-text-body rounded text-xs font-semibold">
          <Clock className="w-3 h-3" /> 承認待ち
        </span>
      );
    }
    if (status === 'approved') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-success-subtle text-success rounded text-xs font-semibold">
          <CheckCircle className="w-3 h-3" /> 公開済
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-danger-subtle text-danger rounded text-xs font-semibold">
        差し戻し
      </span>
    );
  };

  // サマリ
  const unreported = entries.filter((e) => !e.report).length;
  const drafts = entries.filter((e) => e.report?.status === 'draft').length;

  return (
    <AdminLayout documentTitle="本日の授業">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">本日の授業</h1>
          {isTeacherOnly && profile && (
            <span className="text-sm text-text-muted">
              （{profile.display_name || profile.email}）
            </span>
          )}
        </div>

        {/* 日付ナビ */}
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setDate((d) => addDays(d, -1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1 text-center">
              <div className="text-lg font-bold">{formatDateLong(date)}</div>
              {date !== todayStr() && (
                <button
                  type="button"
                  onClick={() => setDate(todayStr())}
                  className="text-xs text-info underline"
                >
                  本日に戻る
                </button>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => setDate((d) => addDays(d, 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>

        {/* サマリ */}
        {!isLoading && entries.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-3 text-center">
                <div className="text-2xl font-bold">{entries.length}</div>
                <div className="text-xs text-text-muted">本日のコマ</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <div
                  className={`text-2xl font-bold ${unreported > 0 ? 'text-danger' : 'text-text-faint'}`}
                >
                  {unreported}
                </div>
                <div className="text-xs text-text-muted">未提出</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <div
                  className={`text-2xl font-bold ${drafts > 0 ? 'text-warning' : 'text-text-faint'}`}
                >
                  {drafts}
                </div>
                <div className="text-xs text-text-muted">下書き中</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* コマリスト */}
        {isLoading ? (
          <Loading />
        ) : entries.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-text-muted">
              この日に担当授業はありません
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {entries.map((entry, idx) => {
              // 教室外の端末での生徒名表示は社内判断待ちのため必ずヘルパー経由で出す
              // （docs/classroom-device-plan.md §1-6。マスクに倒す場合はヘルパーだけ変える）
              const studentName = displayStudentNameForTeacher(
                entry.student
                  ? `${entry.student.last_name} ${entry.student.first_name}`
                  : entry.student_id
              );
              const grade = entry.student ? formatGradeLabel(entry.student.grade) : '';
              const slot = entry.time_slot;
              return (
                <Link
                  key={entry.id}
                  href={`/lesson-reports/${entry.id}`}
                  // 40ms 刻みでカードがフェードイン。
                  // 9件目以降は最大値で頭打ち（長すぎる遅延は逆効果）
                  className="block stagger-item"
                  style={{ '--stagger-index': Math.min(idx, 8) } as React.CSSProperties}
                >
                  <Card className="hover:border-info cursor-pointer transition-[background-color,border-color,color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.99]">
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="w-20 flex-shrink-0 text-center bg-surface rounded py-2">
                        <div className="text-xs text-text-muted font-semibold">
                          {slot ? `${slot.slot_number}限` : ''}
                        </div>
                        <div className="text-sm font-bold tabular-nums">
                          {slot?.start_time?.slice(0, 5) ?? '-'}
                        </div>
                        <div className="text-[10px] text-text-muted">
                          〜{slot?.end_time?.slice(0, 5) ?? ''}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{studentName}</span>
                          <span className="text-xs text-text-muted">（{grade}）</span>
                          {entry.kind === 'koushu' && (
                            <span className="px-1.5 py-0.5 bg-warning-subtle text-warning text-[10px] rounded font-semibold">
                              講習
                            </span>
                          )}
                          {entry.formation === GROUP_FORMATION && (
                            <span className="px-1.5 py-0.5 bg-ink-subtle text-ink text-[10px] rounded font-semibold">
                              {SCHEDULE_ENTRY_FORMATION_LABELS[GROUP_FORMATION]}
                            </span>
                          )}
                        </div>
                        {!isTeacherOnly && (
                          <div className="text-xs text-text-muted mt-0.5">
                            担当: {entry.teacher?.display_name ?? '-'}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {statusBadge(entry.report?.status)}
                        <span className="text-xs text-info flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          報告書を{entry.report ? '編集' : '記入'}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
