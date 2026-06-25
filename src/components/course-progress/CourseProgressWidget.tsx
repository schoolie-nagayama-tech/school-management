'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { batchFetchCoursePrepApi } from '@/lib/api/coursePrepApi';
import { loadSavedSeasonYear } from '@/lib/utils/coursePrepStorage';
import type {
  Student,
  CourseProgressItem,
  StudentCourseProgress,
  SeasonType,
} from '@/types/database';
import { SEASON_LABELS } from '@/types/database';
import type { AutoValues } from '@/lib/api/courseProgress';
import { ArrowRight, ChevronDown, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { InlineLoading } from '@/components/ui';

interface CourseProgressWidgetProps {
  schoolId: string;
}

function findItemByKeywords(
  items: CourseProgressItem[],
  keywords: string[]
): CourseProgressItem | undefined {
  for (const kw of keywords) {
    const exact = items.find((i) => i.name === kw);
    if (exact) return exact;
  }
  for (const kw of keywords) {
    const partial = items.find((i) => i.name.includes(kw));
    if (partial) return partial;
  }
  return undefined;
}

export function CourseProgressWidget({ schoolId }: CourseProgressWidgetProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [items, setItems] = useState<CourseProgressItem[]>([]);
  const [progressData, setProgressData] = useState<StudentCourseProgress[]>([]);
  const [autoValues, setAutoValues] = useState<AutoValues>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(true);
  const [season] = useState<SeasonType>(() => loadSavedSeasonYear().season);
  const [year] = useState(() => loadSavedSeasonYear().year);

  const fetchData = useCallback(async () => {
    if (!schoolId) return;
    setIsLoading(true);
    try {
      const result = await batchFetchCoursePrepApi(
        { schoolId, season, year: String(year), includeHidden: 'false' },
        ['students', 'progress_items', 'student_progress', 'auto_values']
      );

      setStudents(((result.students as Record<string, unknown>[]) || []) as Student[]);

      const rawItems = (result.progress_items as Record<string, unknown>[]) || [];
      setItems(
        rawItems.map((item) => ({
          ...item,
          column_type: (item.column_type as string) || 'check',
          manager_only: item.manager_only === true,
          is_hidden: item.is_hidden === true,
          deadline: (item.deadline as string) || null,
          auto_source: (item.auto_source as string) || null,
        })) as CourseProgressItem[]
      );

      const rawProgress = (result.student_progress as Record<string, unknown>[]) || [];
      setProgressData(
        rawProgress.map((d) => ({
          ...d,
          number_value: d.number_value ?? null,
          date_value: d.date_value ?? null,
        })) as StudentCourseProgress[]
      );

      setAutoValues((result.auto_values || {}) as AutoValues);
    } catch {
      // non-critical widget
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, season, year]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- PCS回収 ---
  const pcsItem = useMemo(() => findItemByKeywords(items, ['PCS回収', 'PCS']), [items]);
  const pcsStats = useMemo(() => {
    if (!pcsItem) return null;
    let completed = 0;
    for (const s of students) {
      const d = progressData.find((p) => p.student_id === s.id && p.item_id === pcsItem.id);
      if (d?.status === 'completed') completed++;
    }
    return { completed, total: students.length };
  }, [pcsItem, students, progressData]);

  // --- 面談申込 ---
  const soudanItem = useMemo(
    () => findItemByKeywords(items, ['面談申込', '面談申し込み', '面談申込み']),
    [items]
  );
  const soudanStats = useMemo(() => {
    if (!soudanItem) return null;
    let completed = 0;
    for (const s of students) {
      const d = progressData.find((p) => p.student_id === s.id && p.item_id === soudanItem.id);
      if (d?.status === 'completed') completed++;
    }
    return { completed, total: students.length };
  }, [soudanItem, students, progressData]);

  // --- 生徒面談実施 ---
  const studentInterviewItem = useMemo(
    () => findItemByKeywords(items, ['生徒面談実施', '生徒面談']),
    [items]
  );
  const studentInterviewStats = useMemo(() => {
    if (!studentInterviewItem) return null;
    let completed = 0;
    for (const s of students) {
      const d = progressData.find(
        (p) => p.student_id === s.id && p.item_id === studentInterviewItem.id
      );
      if (d?.status === 'completed') completed++;
    }
    return { completed, total: students.length };
  }, [studentInterviewItem, students, progressData]);

  // --- 父母面談実施 ---
  const parentInterviewItem = useMemo(
    () => findItemByKeywords(items, ['父母面談実施', '保護者面談実施', '父母面談', '保護者面談']),
    [items]
  );
  const parentInterviewStats = useMemo(() => {
    if (!parentInterviewItem) return null;
    let completed = 0;
    for (const s of students) {
      const d = progressData.find(
        (p) => p.student_id === s.id && p.item_id === parentInterviewItem.id
      );
      if (d?.status === 'completed') completed++;
    }
    return { completed, total: students.length };
  }, [parentInterviewItem, students, progressData]);

  // --- 教科別提案コマ数 ---
  const subjectItems = useMemo(
    () => items.filter((i) => i.column_group === '教科別' && i.column_type === 'number'),
    [items]
  );

  const subjectTotals = useMemo(() => {
    const totals: { name: string; total: number }[] = [];
    let grandTotal = 0;
    for (const item of subjectItems) {
      let sum = 0;
      for (const s of students) {
        if (item.auto_source === 'subject_proposal') {
          const sv = autoValues[s.id];
          if (sv?.subject_proposals) {
            if (sv.subject_proposals[item.name] !== undefined) {
              sum += sv.subject_proposals[item.name];
            } else {
              for (const [subject, count] of Object.entries(sv.subject_proposals)) {
                if (item.name.includes(subject)) {
                  sum += count;
                  break;
                }
              }
            }
          }
        } else {
          const d = progressData.find((p) => p.student_id === s.id && p.item_id === item.id);
          if (d?.number_value != null) sum += d.number_value;
        }
      }
      if (sum > 0) {
        totals.push({ name: item.name, total: sum });
      }
      grandTotal += sum;
    }
    return { subjects: totals, grandTotal };
  }, [subjectItems, students, progressData, autoValues]);

  // --- 増コマ回数 ---
  const proposedKomaItem = useMemo(() => {
    const byAutoSource = items.find((i) => i.auto_source === 'proposed_extra');
    if (byAutoSource) return byAutoSource;
    return findItemByKeywords(items, ['提案増コマ', '提示増コマ']);
  }, [items]);

  const decidedKomaItem = useMemo(() => {
    const byAutoSource = items.find(
      (i) => i.id !== proposedKomaItem?.id && i.auto_source === 'applied_extra'
    );
    if (byAutoSource) return byAutoSource;
    return (
      items.find(
        (i) =>
          i.id !== proposedKomaItem?.id &&
          i.column_type === 'number' &&
          (i.name.includes('増コマ回数') || i.name === '増コマ回数決定')
      ) ||
      findItemByKeywords(
        items.filter((i) => i.id !== proposedKomaItem?.id),
        ['増コマ回数決定', '増コマ決定', '決定コマ', '増コマ回数']
      )
    );
  }, [items, proposedKomaItem]);

  const komaStats = useMemo(() => {
    let totalProposed = 0;
    let totalDecided = 0;
    for (const s of students) {
      // 提案コマ
      if (proposedKomaItem) {
        if (proposedKomaItem.auto_source === 'proposed_extra') {
          const sv = autoValues[s.id];
          const proposalTotal = sv?.proposal_total ?? 0;
          const courseSessions = sv?.course_sessions ?? 0;
          totalProposed += Math.max(0, proposalTotal - courseSessions);
        } else {
          const d = progressData.find(
            (p) => p.student_id === s.id && p.item_id === proposedKomaItem.id
          );
          totalProposed += d?.number_value ?? 0;
        }
      }
      // 決定コマ
      if (decidedKomaItem) {
        if (decidedKomaItem.auto_source === 'applied_extra') {
          const sv = autoValues[s.id];
          const appliedTotal = sv?.applied_total ?? 0;
          const courseSessions = sv?.course_sessions ?? 0;
          totalDecided += Math.max(0, appliedTotal - courseSessions);
        } else {
          const d = progressData.find(
            (p) => p.student_id === s.id && p.item_id === decidedKomaItem.id
          );
          totalDecided += d?.number_value ?? 0;
        }
      }
    }
    return { proposed: totalProposed, decided: totalDecided };
  }, [students, proposedKomaItem, decidedKomaItem, subjectItems, progressData, autoValues]);

  if (isLoading) {
    return (
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <InlineLoading label="講習進捗を読み込み中..." />
      </div>
    );
  }

  if (items.length === 0) return null;

  const hasAnyData =
    pcsStats ||
    soudanStats ||
    studentInterviewStats ||
    parentInterviewStats ||
    subjectTotals.grandTotal > 0 ||
    komaStats.proposed > 0 ||
    komaStats.decided > 0;
  if (!hasAnyData) return null;

  const seasonLabel = SEASON_LABELS[season];

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2">
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center gap-2 hover:opacity-70 transition-opacity"
        >
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
          />
          <GraduationCap className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-bold text-gray-700">講習進捗</span>
          <span className="text-xs text-gray-400">
            {year}年 {seasonLabel}
          </span>
        </button>
        <Link
          href="/courses/progress"
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
        >
          詳細を見る
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Content — grid-rows で height を GPU に乗せず、opacity のみトランジション（逸脱10対策） */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="overflow-hidden">
          <div className="px-4 py-3 border-t border-gray-100">
            <div className="flex flex-wrap gap-3">
              {/* PCS回収 */}
              {pcsStats && (
                <MetricChip
                  label="PCS回収"
                  value={pcsStats.completed}
                  total={pcsStats.total}
                  color="blue"
                />
              )}

              {/* 面談申込 */}
              {soudanStats && (
                <MetricChip
                  label="面談申込"
                  value={soudanStats.completed}
                  total={soudanStats.total}
                  color="amber"
                />
              )}

              {/* 生徒面談実施 */}
              {studentInterviewStats && (
                <MetricChip
                  label="生徒面談"
                  value={studentInterviewStats.completed}
                  total={studentInterviewStats.total}
                  color="green"
                />
              )}

              {/* 父母面談実施 */}
              {parentInterviewStats && (
                <MetricChip
                  label="父母面談"
                  value={parentInterviewStats.completed}
                  total={parentInterviewStats.total}
                  color="green"
                />
              )}

              {/* 増コマ回数 */}
              {(komaStats.proposed > 0 || komaStats.decided > 0) && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-purple-200 bg-purple-50 text-[11px]">
                  <span className="text-purple-600 font-medium">増コマ</span>
                  <span className="text-purple-800 font-bold">{komaStats.decided}</span>
                  <span className="text-purple-400">/</span>
                  <span className="text-purple-600">{komaStats.proposed}</span>
                </div>
              )}
            </div>

            {/* 教科別提案コマ数 */}
            {subjectTotals.subjects.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-gray-400 mr-0.5">提案コマ:</span>
                {subjectTotals.subjects.map((s) => (
                  <span
                    key={s.name}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px]"
                  >
                    <span className="text-gray-500">{s.name}</span>
                    <span className="text-gray-800 font-bold">{s.total}</span>
                  </span>
                ))}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-[10px]">
                  <span className="text-indigo-600 font-medium">合計</span>
                  <span className="text-indigo-800 font-bold">{subjectTotals.grandTotal}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricChip({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: 'blue' | 'amber' | 'green';
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const colors = {
    blue: {
      border: 'border-blue-200',
      bg: 'bg-blue-50',
      label: 'text-blue-600',
      value: 'text-blue-800',
      sub: 'text-blue-400',
    },
    amber: {
      border: 'border-amber-200',
      bg: 'bg-amber-50',
      label: 'text-amber-600',
      value: 'text-amber-800',
      sub: 'text-amber-400',
    },
    green: {
      border: 'border-green-200',
      bg: 'bg-green-50',
      label: 'text-green-600',
      value: 'text-green-800',
      sub: 'text-green-400',
    },
  }[color];

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${colors.border} ${colors.bg} text-[11px]`}
    >
      <span className={`${colors.label} font-medium`}>{label}</span>
      <span className={`${colors.value} font-bold`}>{value}</span>
      <span className={colors.sub}>/</span>
      <span className={`${colors.label}`}>{total}</span>
      <span className={`${colors.sub} text-[10px]`}>({pct}%)</span>
    </div>
  );
}
