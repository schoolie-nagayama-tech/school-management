'use client';

/**
 * 生徒の過去授業報告書一覧
 *
 * URL: /students/[studentId]/lesson-reports
 *
 * 表示:
 *  - ヒーロー：生徒名・学年・担当講師
 *  - 「科目ごとの最新報告書」カード (英語/数学/国語/理科/社会の最新1件)
 *  - 「過去の報告書 全件リスト」(科目フィルタ付き)
 *
 * 表示対象: status='approved' のみ（承認済み・公開済み）
 *           ※ 室長は承認待ちも見たいので将来フィルタ追加予定
 *
 * 将来：保護者ポータルから同じデータを参照する画面を別途用意。
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent } from '@/components/ui';
import { Button } from '@/components/ui';
import { ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { getApprovedReportsByStudent } from '@/lib/api/class-reports';
import { supabase } from '@/lib/supabase';
import type { ClassReport } from '@/types/class-report';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface StudentInfo {
  id: string;
  last_name: string;
  first_name: string;
  grade: number;
}

function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}

/** subject_ids から最初の科目名を取得するための補助マップ生成 */
async function fetchSubjectsMap(subjectIds: string[]): Promise<Map<string, string>> {
  if (subjectIds.length === 0) return new Map();
  const { data } = await db
    .from('subjects')
    .select('id, name')
    .in('id', subjectIds);
  const m = new Map<string, string>();
  for (const s of (data || []) as { id: string; name: string }[]) m.set(s.id, s.name);
  return m;
}

/** schedule_entries の subject_ids を一括取得して報告書ごとに科目名を引けるようにする */
async function attachSubjectNames(
  reports: ClassReport[]
): Promise<Map<string, string>> {
  if (reports.length === 0) return new Map();
  const entryIds = reports.map((r) => r.schedule_entry_id);
  const { data } = await db
    .from('schedule_entries')
    .select('id, subject_ids')
    .in('id', entryIds);
  type EntryRow = { id: string; subject_ids: string[] };
  const entryMap = new Map<string, string[]>();
  for (const e of (data || []) as EntryRow[]) {
    entryMap.set(e.id, e.subject_ids || []);
  }
  // 全 subject_id を集める
  const allSubjectIds = Array.from(
    new Set(Array.from(entryMap.values()).flat())
  );
  const subjectsMap = await fetchSubjectsMap(allSubjectIds);
  // 報告書ID → 科目名一覧
  const result = new Map<string, string>();
  for (const r of reports) {
    const subIds = entryMap.get(r.schedule_entry_id) ?? [];
    const names = subIds
      .map((id) => subjectsMap.get(id))
      .filter((n): n is string => !!n);
    result.set(r.id, names.join('・') || 'その他');
  }
  return result;
}

export default function StudentLessonReportsPage() {
  const params = useParams();
  const router = useRouter();
  const { toasts, removeToast, error: toastError } = useToast();
  const studentId = params.studentId as string;

  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [reports, setReports] = useState<ClassReport[]>([]);
  const [subjectNameByReport, setSubjectNameByReport] = useState<Map<string, string>>(
    new Map()
  );
  const [isLoading, setIsLoading] = useState(true);
  const [subjectFilter, setSubjectFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      // 生徒情報
      const { data: stu } = await db
        .from('students')
        .select('id, last_name, first_name, grade')
        .eq('id', studentId)
        .single();
      setStudent(stu as StudentInfo);

      // 報告書（承認済みのみ、最新50件）
      const data = await getApprovedReportsByStudent(studentId, 50);
      setReports(data);

      // 報告書ごとの科目名（schedule_entries から逆引き）
      const map = await attachSubjectNames(data);
      setSubjectNameByReport(map);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [studentId, toastError]);

  useEffect(() => {
    load();
  }, [load]);

  // 科目フィルタの選択肢
  const availableSubjects = useMemo(() => {
    const set = new Set<string>();
    // Map.values() を直接イテレートすると target によって失敗するため Array.from 経由
    Array.from(subjectNameByReport.values()).forEach((name) => {
      // 複数科目は最初のものを代表として扱う
      const first = name.split('・')[0];
      if (first) set.add(first);
    });
    return Array.from(set).sort();
  }, [subjectNameByReport]);

  // 科目ごとの最新報告書1件
  const latestBySubject = useMemo(() => {
    // reports は lesson_date DESC でソート済み
    const map = new Map<string, ClassReport>();
    for (const r of reports) {
      const subjectName = subjectNameByReport.get(r.id) ?? 'その他';
      const first = subjectName.split('・')[0] || 'その他';
      if (!map.has(first)) map.set(first, r);
    }
    return map;
  }, [reports, subjectNameByReport]);

  // フィルタ済みリスト
  const filteredReports = useMemo(() => {
    if (subjectFilter === 'all') return reports;
    return reports.filter((r) => {
      const name = subjectNameByReport.get(r.id) ?? '';
      return name.split('・')[0] === subjectFilter;
    });
  }, [reports, subjectFilter, subjectNameByReport]);

  if (isLoading) {
    return (
      <AdminLayout>
        <Loading />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-4xl mx-auto p-4 space-y-4">

        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ChevronLeft className="w-4 h-4 mr-1" />
          戻る
        </Button>

        {/* ヒーロー */}
        {student && (
          <Card>
            <CardContent className="p-4 bg-ink text-text-on-primary rounded-md">
              <div className="text-xs uppercase tracking-wide text-text-on-primary/70">授業報告</div>
              <div className="text-2xl font-bold mt-1">
                {student.last_name} {student.first_name}
              </div>
              <div className="text-sm mt-1 text-text-on-primary/80">{gradeLabel(student.grade)}</div>
            </CardContent>
          </Card>
        )}

        {reports.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-text-muted">
              公開済みの授業報告書はまだありません
            </CardContent>
          </Card>
        ) : (
          <>
            {/* 科目ごとの最新 */}
            <div>
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-wide mb-2">
                科目ごとの最新報告
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Array.from(latestBySubject.entries()).map(([subject, r]) => (
                  <Card
                    key={r.id}
                    className="hover:border-info cursor-pointer transition-[background-color,border-color,color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.99]"
                    onClick={() => router.push(`/lesson-reports/${r.schedule_entry_id}`)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-sm">{subject}</span>
                        <span className="text-xs text-text-muted bg-surface px-1.5 py-0.5 rounded">
                          {r.lesson_date}
                        </span>
                      </div>
                      <div className="text-xs text-text-muted mb-2">
                        担当: {r.teacher?.display_name ?? '-'}
                      </div>
                      <div className="text-xs text-text-body line-clamp-2 mb-2">
                        {r.review_comment || r.short_term_goal || '記述なし'}
                      </div>
                      <div className="flex gap-1 flex-wrap text-[10px]">
                        {r.homework_completion_pct != null && (
                          <span className="px-1.5 py-0.5 bg-surface rounded">
                            宿題 <strong>{r.homework_completion_pct}%</strong>
                          </span>
                        )}
                        {r.vocab_test_score != null && r.vocab_test_total != null && (
                          <span
                            className={`px-1.5 py-0.5 rounded ${
 r.vocab_test_passed ? 'bg-success-subtle text-success' : 'bg-surface'
 }`}
                          >
                            単語 <strong>{r.vocab_test_score}/{r.vocab_test_total}</strong>
                          </span>
                        )}
                        {r.check_test_score != null && r.check_test_total != null && (
                          <span
                            className={`px-1.5 py-0.5 rounded ${
 r.check_test_passed ? 'bg-success-subtle text-success' : 'bg-surface'
 }`}
                          >
                            確認 <strong>{r.check_test_score}/{r.check_test_total}</strong>
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* 過去全件 + フィルタ */}
            <div>
              <h2 className="text-xs font-bold text-text-muted uppercase tracking-wide mb-2">
                過去の報告書 ({filteredReports.length} 件)
              </h2>
              <div className="flex gap-1 mb-2 flex-wrap">
                <button
                  type="button"
                  className={`px-2 py-1 text-xs rounded border ${
 subjectFilter === 'all'
 ? 'bg-info text-white border-info'
 : 'bg-white text-text-muted border-border-default'
 }`}
                  onClick={() => setSubjectFilter('all')}
                >
                  すべて
                </button>
                {availableSubjects.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`px-2 py-1 text-xs rounded border ${
 subjectFilter === s
 ? 'bg-info text-white border-info'
 : 'bg-white text-text-muted border-border-default'
 }`}
                    onClick={() => setSubjectFilter(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                {filteredReports.map((r) => {
                  const subject = subjectNameByReport.get(r.id) ?? '';
                  return (
                    <Card
                      key={r.id}
                      className="hover:border-info cursor-pointer transition-[background-color,border-color,color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.99]"
                      onClick={() => router.push(`/lesson-reports/${r.schedule_entry_id}`)}
                    >
                      <CardContent className="p-2 flex items-center gap-3">
                        <div className="w-20 flex-shrink-0">
                          <div className="text-sm font-bold tabular-nums">{r.lesson_date}</div>
                        </div>
                        <span className="px-2 py-0.5 bg-surface text-xs rounded font-semibold flex-shrink-0">
                          {subject}
                        </span>
                        <div className="flex-1 min-w-0 text-xs text-text-muted truncate">
                          {r.review_comment || r.short_term_goal || '記述なし'}
                        </div>
                        <span className="text-xs text-text-muted flex-shrink-0">
                          {r.teacher?.display_name ?? ''}
                        </span>
                        <FileText className="w-4 h-4 text-text-faint flex-shrink-0" />
                        <ChevronRight className="w-4 h-4 text-text-faint flex-shrink-0" />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
