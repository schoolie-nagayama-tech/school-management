'use client';

import { useMemo } from 'react';
import type { CourseProgressItem, StudentCourseProgress, CoursePrepPeriod } from '@/types/database';
import type { Student } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import type { AutoValues } from '@/lib/api/courseProgress';

interface CourseProgressDashboardProps {
  students: Student[];
  items: CourseProgressItem[];
  progressData: StudentCourseProgress[];
  period: CoursePrepPeriod | null;
  autoValues?: AutoValues;
  onBudgetKomaChange?: (value: number) => void;
  onTargetKomaChange?: (value: number) => void;
  onPeriodDateChange?: (updates: Partial<Pick<CoursePrepPeriod, 'schedule_start_date' | 'schedule_end_date'>>) => void;
}

type SchoolCategory = 'elementary' | 'middle' | 'high' | 'other';

function getSchoolCategory(grade: number): SchoolCategory {
  if (grade >= 1 && grade <= 6) return 'elementary';
  if (grade >= 7 && grade <= 9) return 'middle';
  if (grade >= 10 && grade <= 12) return 'high';
  return 'other';
}

const CATEGORY_LABELS: Record<SchoolCategory, string> = {
  elementary: '小学生',
  middle: '中学生',
  high: '高校生',
  other: 'その他',
};

const CATEGORY_COLORS: Record<SchoolCategory, { bg: string; border: string; text: string; accent: string }> = {
  elementary: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', accent: '#10b981' },
  middle: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', accent: '#3b82f6' },
  high: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', accent: '#8b5cf6' },
  other: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', accent: '#6b7280' },
};

export function CourseProgressDashboard({
  students,
  items,
  progressData,
  period,
  autoValues,
  onBudgetKomaChange,
  onTargetKomaChange,
  onPeriodDateChange,
}: CourseProgressDashboardProps) {
  // 予算・目標コマ
  const budgetKoma = period?.budget_koma || 0;
  const targetKoma = period?.target_koma || 0;

  // 増コマ関連の項目を名前で検索
  const proposedKomaItem = items.find((i) => i.name === '提示増コマ回数');
  const decidedKomaItem = items.find((i) => i.name === '増コマ回数決定');

  // 教科別グループの数値項目合計（教科別コマ合計）
  const subjectItems = useMemo(
    () => items.filter((i) => i.column_group === '教科別' && i.column_type === 'number'),
    [items]
  );

  // 各生徒の教科別コマ合計
  const studentSubjectTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const s of students) {
      let sum = 0;
      for (const item of subjectItems) {
        if (item.auto_source) {
          const sv = autoValues?.[s.id];
          if (sv) {
            if (item.auto_source === 'regular_weekly') sum += sv.regular_weekly;
            else if (item.auto_source === 'course_sessions') sum += sv.course_sessions;
          }
        } else {
          const d = progressData.find((p) => p.student_id === s.id && p.item_id === item.id);
          if (d?.number_value != null) sum += d.number_value;
        }
      }
      totals[s.id] = sum;
    }
    return totals;
  }, [students, subjectItems, progressData, autoValues]);

  // 各生徒の提案増コマ
  const studentProposedKoma = useMemo(() => {
    const vals: Record<string, number> = {};
    for (const s of students) {
      if (proposedKomaItem) {
        if (proposedKomaItem.auto_source === 'proposed_extra') {
          // 自動計算: 教科別合計 - 講習期間通常回数
          const subjectTotal = studentSubjectTotals[s.id] ?? 0;
          const courseSessions = autoValues?.[s.id]?.course_sessions ?? 0;
          vals[s.id] = Math.max(0, subjectTotal - courseSessions);
        } else {
          const d = progressData.find((p) => p.student_id === s.id && p.item_id === proposedKomaItem.id);
          vals[s.id] = d?.number_value ?? 0;
        }
      } else {
        vals[s.id] = 0;
      }
    }
    return vals;
  }, [students, proposedKomaItem, progressData, autoValues, studentSubjectTotals]);

  // 各生徒の決定増コマ
  const studentDecidedKoma = useMemo(() => {
    const vals: Record<string, number> = {};
    for (const s of students) {
      if (decidedKomaItem) {
        const d = progressData.find((p) => p.student_id === s.id && p.item_id === decidedKomaItem.id);
        vals[s.id] = d?.number_value ?? 0;
      } else {
        vals[s.id] = 0;
      }
    }
    return vals;
  }, [students, decidedKomaItem, progressData]);

  // 全体集計
  const totalProposed = Object.values(studentProposedKoma).reduce((a, b) => a + b, 0);
  const totalDecided = Object.values(studentDecidedKoma).reduce((a, b) => a + b, 0);
  // 提案に対する取得率（決定 / 提案）
  const acquisitionRate = totalProposed > 0 ? totalDecided / totalProposed : 0;
  // 予想増コマ = 提案増コマ × 取得率
  const expectedKoma = Math.round(totalProposed * acquisitionRate);
  // 予算達成率
  const budgetRate = budgetKoma > 0 ? totalDecided / budgetKoma : 0;
  // 目標達成率
  const targetRate = targetKoma > 0 ? totalDecided / targetKoma : 0;

  // 提案済み生徒数（提案 > 0）
  const proposedStudentCount = Object.values(studentProposedKoma).filter((v) => v > 0).length;
  // 決定済み生徒数（決定 > 0）
  const decidedStudentCount = Object.values(studentDecidedKoma).filter((v) => v > 0).length;

  // 学校種別ごとの分析
  const categoryAnalysis = useMemo(() => {
    const categories: SchoolCategory[] = ['elementary', 'middle', 'high'];
    return categories.map((cat) => {
      const catStudents = students.filter((s) => getSchoolCategory(s.grade) === cat);
      if (catStudents.length === 0) return null;

      const catProposed = catStudents.reduce((sum, s) => sum + (studentProposedKoma[s.id] ?? 0), 0);
      const catDecided = catStudents.reduce((sum, s) => sum + (studentDecidedKoma[s.id] ?? 0), 0);
      const catRate = catProposed > 0 ? catDecided / catProposed : 0;
      const catProposedCount = catStudents.filter((s) => (studentProposedKoma[s.id] ?? 0) > 0).length;
      const catDecidedCount = catStudents.filter((s) => (studentDecidedKoma[s.id] ?? 0) > 0).length;

      // 学年別内訳
      const gradeBreakdown: { grade: number; label: string; count: number; proposed: number; decided: number }[] = [];
      const gradeSet = Array.from(new Set(catStudents.map((s) => s.grade))).sort((a, b) => a - b);
      for (const grade of gradeSet) {
        const gradeStudents = catStudents.filter((s) => s.grade === grade);
        gradeBreakdown.push({
          grade,
          label: GRADE_LABELS[grade] || `${grade}`,
          count: gradeStudents.length,
          proposed: gradeStudents.reduce((sum, s) => sum + (studentProposedKoma[s.id] ?? 0), 0),
          decided: gradeStudents.reduce((sum, s) => sum + (studentDecidedKoma[s.id] ?? 0), 0),
        });
      }

      return {
        category: cat,
        label: CATEGORY_LABELS[cat],
        colors: CATEGORY_COLORS[cat],
        studentCount: catStudents.length,
        proposedCount: catProposedCount,
        decidedCount: catDecidedCount,
        totalProposed: catProposed,
        totalDecided: catDecided,
        acquisitionRate: catRate,
        avgProposed: catStudents.length > 0 ? catProposed / catStudents.length : 0,
        avgDecided: catStudents.length > 0 ? catDecided / catStudents.length : 0,
        gradeBreakdown,
      };
    }).filter((x): x is Exclude<typeof x, null> => x !== null);
  }, [students, studentProposedKoma, studentDecidedKoma]);

  // 講習期間表示
  const hasScheduleDates = period?.schedule_start_date && period?.schedule_end_date;

  return (
    <div className="space-y-4 mb-6">
      {/* 講習期間設定 */}
      {onPeriodDateChange && (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs text-gray-500 font-medium">講習期間</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={period?.schedule_start_date || ''}
                onChange={(e) => onPeriodDateChange({ schedule_start_date: e.target.value || null })}
                className="px-2 py-1 text-xs border border-gray-200 rounded-lg"
              />
              <span className="text-xs text-gray-400">〜</span>
              <input
                type="date"
                value={period?.schedule_end_date || ''}
                onChange={(e) => onPeriodDateChange({ schedule_end_date: e.target.value || null })}
                className="px-2 py-1 text-xs border border-gray-200 rounded-lg"
              />
            </div>
            {hasScheduleDates && (
              <span className="text-[10px] text-gray-400">
                ({Math.max(1, Math.round((new Date(period!.schedule_end_date!).getTime() - new Date(period!.schedule_start_date!).getTime()) / (1000 * 60 * 60 * 24 * 7)))}週間)
              </span>
            )}
            {!hasScheduleDates && (
              <span className="text-[10px] text-amber-500">※ 講習期間を設定すると通常回数が自動計算されます</span>
            )}
          </div>
        </div>
      )}
      {/* 講習期間表示（権限なし時） */}
      {!onPeriodDateChange && hasScheduleDates && (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500 font-medium">講習期間</span>
            <span className="text-xs text-[#1e3a5f]">
              {period!.schedule_start_date} 〜 {period!.schedule_end_date}
            </span>
            <span className="text-[10px] text-gray-400">
              ({Math.max(1, Math.round((new Date(period!.schedule_end_date!).getTime() - new Date(period!.schedule_start_date!).getTime()) / (1000 * 60 * 60 * 24 * 7)))}週間)
            </span>
          </div>
        </div>
      )}

      {/* メイン指標カード */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 増コマ達成度 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">増コマ達成度</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#1e3a5f]">{totalDecided}</span>
            <span className="text-sm text-gray-400">
              / {budgetKoma > 0 ? budgetKoma : '–'} コマ
            </span>
          </div>
          <div className="mt-2 w-full bg-gray-100 rounded-full h-2.5">
            <div
              className="h-2.5 rounded-full bg-[#3b82f6] transition-all"
              style={{ width: `${Math.min(Math.round(budgetRate * 100), 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-400 mt-1">
            {budgetKoma > 0 && <span>{Math.round(budgetRate * 100)}%</span>}
          </div>
          {(onBudgetKomaChange || onTargetKomaChange) && (
            <div className="mt-2 flex items-center gap-3">
              {onBudgetKomaChange && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400">予算:</span>
                  <input
                    type="number"
                    value={budgetKoma || ''}
                    onChange={(e) => onBudgetKomaChange(Number(e.target.value) || 0)}
                    className="w-16 px-1 py-0.5 text-xs border border-gray-200 rounded text-center"
                    placeholder="0"
                  />
                </div>
              )}
              {onTargetKomaChange && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400">目標:</span>
                  <input
                    type="number"
                    value={targetKoma || ''}
                    onChange={(e) => onTargetKomaChange(Number(e.target.value) || 0)}
                    className="w-16 px-1 py-0.5 text-xs border border-gray-200 rounded text-center"
                    placeholder="0"
                  />
                </div>
              )}
            </div>
          )}
          {targetKoma > 0 && (
            <div className="mt-1.5 flex items-center gap-1">
              <span className="text-[10px] text-gray-400">目標達成:</span>
              <span className={`text-[10px] font-medium ${targetRate >= 1 ? 'text-green-600' : targetRate >= 0.7 ? 'text-amber-600' : 'text-red-500'}`}>
                {Math.round(targetRate * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* 予想増コマ */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">予想増コマ</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#f59e0b]">{expectedKoma}</span>
            <span className="text-sm text-gray-400">コマ</span>
          </div>
          <div className="mt-2 text-xs text-gray-400 space-y-0.5">
            <div className="flex justify-between">
              <span>提案合計</span>
              <span className="font-medium text-gray-600">{totalProposed}コマ</span>
            </div>
            <div className="flex justify-between">
              <span>取得率</span>
              <span className="font-medium text-gray-600">{totalProposed > 0 ? Math.round(acquisitionRate * 100) : 0}%</span>
            </div>
            <div className="flex justify-between">
              <span>決定済み</span>
              <span className="font-medium text-gray-600">{totalDecided}コマ</span>
            </div>
          </div>
        </div>

        {/* 提案状況 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">提案状況</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#1e3a5f]">{proposedStudentCount}</span>
            <span className="text-sm text-gray-400">/ {students.length} 名</span>
          </div>
          <div className="mt-2 w-full bg-gray-100 rounded-full h-2.5">
            <div
              className="h-2.5 rounded-full bg-[#f59e0b] transition-all"
              style={{ width: `${students.length > 0 ? Math.round((proposedStudentCount / students.length) * 100) : 0}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-gray-400 flex justify-between">
            <span>提案済: {proposedStudentCount}名</span>
            <span>決定済: {decidedStudentCount}名</span>
          </div>
          <div className="mt-1 text-xs text-gray-400">
            平均提案: {students.length > 0 ? (totalProposed / students.length).toFixed(1) : 0}コマ/人
          </div>
        </div>

        {/* 在籍数 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1">在籍生徒数</div>
          <div className="text-2xl font-bold text-[#1e3a5f]">{students.length}名</div>
          <div className="mt-2 space-y-1">
            {(['elementary', 'middle', 'high'] as SchoolCategory[]).map((cat) => {
              const count = students.filter((s) => getSchoolCategory(s.grade) === cat).length;
              if (count === 0) return null;
              return (
                <div key={cat} className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">{CATEGORY_LABELS[cat]}</span>
                  <span className="text-gray-600 font-medium">{count}名</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 学校種別分析カード */}
      {categoryAnalysis.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {categoryAnalysis.map((cat) => (
            <div
              key={cat.category}
              className={`${cat.colors.bg} rounded-xl border ${cat.colors.border} p-4`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${cat.colors.text}`}>{cat.label}</span>
                  <span className="text-xs text-gray-400">{cat.studentCount}名</span>
                </div>
                <span className={`text-xs font-medium ${cat.colors.text}`}>
                  取得率 {Math.round(cat.acquisitionRate * 100)}%
                </span>
              </div>

              {/* 指標 */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="text-center">
                  <div className="text-[10px] text-gray-500">提案</div>
                  <div className={`text-sm font-bold ${cat.colors.text}`}>{cat.totalProposed}</div>
                  <div className="text-[10px] text-gray-400">{cat.proposedCount}名</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-gray-500">決定</div>
                  <div className={`text-sm font-bold ${cat.colors.text}`}>{cat.totalDecided}</div>
                  <div className="text-[10px] text-gray-400">{cat.decidedCount}名</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-gray-500">平均</div>
                  <div className={`text-sm font-bold ${cat.colors.text}`}>{cat.avgProposed.toFixed(1)}</div>
                  <div className="text-[10px] text-gray-400">コマ/人</div>
                </div>
              </div>

              {/* 取得率プログレスバー */}
              <div className="w-full bg-white/60 rounded-full h-1.5 mb-2">
                <div
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: `${Math.min(Math.round(cat.acquisitionRate * 100), 100)}%`,
                    backgroundColor: cat.colors.accent,
                  }}
                />
              </div>

              {/* 学年別内訳 */}
              {cat.gradeBreakdown.length > 1 && (
                <div className="mt-2 space-y-0.5">
                  {cat.gradeBreakdown.map((g) => (
                    <div key={g.grade} className="flex items-center justify-between text-[10px]">
                      <span className="text-gray-500 w-8">{g.label}</span>
                      <span className="text-gray-400">{g.count}名</span>
                      <span className="text-gray-500">提案{g.proposed}</span>
                      <span className={`font-medium ${cat.colors.text}`}>決定{g.decided}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
