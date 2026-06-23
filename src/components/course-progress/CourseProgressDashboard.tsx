'use client';

import { useMemo, useState, useRef, useCallback } from 'react';
import type { CourseProgressItem, StudentCourseProgress, CoursePrepPeriod } from '@/types/database';
import type { Student } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import type { AutoValues } from '@/lib/api/courseProgress';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { AlertTriangle, ChevronDown } from 'lucide-react';

interface CourseProgressDashboardProps {
  students: Student[];
  items: CourseProgressItem[];
  progressData: StudentCourseProgress[];
  period: CoursePrepPeriod | null;
  autoValues?: AutoValues;
  onBudgetKomaChange?: (value: number) => void;
  onTargetKomaChange?: (value: number) => void;
  onExpectedRateChange?: (value: number) => void;
  onPeriodDateChange?: (
    updates: Partial<Pick<CoursePrepPeriod, 'schedule_start_date' | 'schedule_end_date'>>
  ) => void;
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

const CATEGORY_COLORS: Record<
  SchoolCategory,
  { bg: string; border: string; text: string; accent: string }
> = {
  elementary: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-700',
    accent: '#10b981',
  },
  middle: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', accent: '#3b82f6' },
  high: {
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    text: 'text-purple-700',
    accent: '#8b5cf6',
  },
  other: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', accent: '#6b7280' },
};

// 教科別分析の表示順。ここに無い教科は末尾に日本語名順で並ぶ。
const SUBJECT_ORDER = [
  '国語',
  '算数',
  '数学',
  '英語',
  '英検',
  '理科',
  '社会',
  '理社',
  '小論文',
  '作文',
];

// =============================================
// onBlur保存のnumber input（ローカルstate保持）
// =============================================
function BlurSaveInput({
  value,
  onSave,
  placeholder,
  className,
  suffix,
  min,
  max,
  step,
}: {
  value: number;
  onSave: (v: number) => void;
  placeholder?: string;
  className?: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: string;
}) {
  const [localValue, setLocalValue] = useState(String(value || ''));
  const lastSaved = useRef(value);

  // 外部から値が変わったら同期（ただし自分が保存した直後は無視）
  const prevProp = useRef(value);
  if (value !== prevProp.current) {
    prevProp.current = value;
    if (value !== lastSaved.current) {
      setLocalValue(String(value || ''));
      lastSaved.current = value;
    }
  }

  const save = useCallback(() => {
    const num = Number(localValue) || 0;
    const clamped =
      min !== undefined ? Math.max(min, max !== undefined ? Math.min(max, num) : num) : num;
    if (clamped !== lastSaved.current) {
      lastSaved.current = clamped;
      onSave(clamped);
    }
    setLocalValue(String(clamped || ''));
  }, [localValue, onSave, min, max]);

  return (
    <span className="inline-flex items-center gap-0.5">
      <input
        type="number"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className={className}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
      />
      {suffix && <span className="text-[10px] text-gray-400">{suffix}</span>}
    </span>
  );
}

// 項目名を柔軟にマッチ
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

export function CourseProgressDashboard({
  students,
  items,
  progressData,
  period,
  autoValues,
  onBudgetKomaChange,
  onTargetKomaChange,
  onExpectedRateChange,
  onPeriodDateChange,
}: CourseProgressDashboardProps) {
  const [categoryOpen, setCategoryOpen] = useState(false);
  // 教科別 提案vs取得セクションの開閉と、表示対象（全体／学校種別）
  const [subjectOpen, setSubjectOpen] = useState(false);
  const [subjectCat, setSubjectCat] = useState<'overall' | 'elementary' | 'middle' | 'high'>(
    'overall'
  );

  const budgetKoma = period?.budget_koma || 0;
  const targetKoma = period?.target_koma || 0;
  const expectedRate = period?.expected_rate || 0; // 0-100 の整数

  // --- 項目の検索 ---
  const proposedKomaItem = useMemo(() => {
    const byAutoSource = items.find((i) => i.auto_source === 'proposed_extra');
    if (byAutoSource) return byAutoSource;
    return findItemByKeywords(items, [
      '提案増コマ',
      '提示増コマ',
      '提案増コマ回数',
      '提示増コマ回数',
    ]);
  }, [items]);

  const decidedKomaItem = useMemo(() => {
    // 申込増コマ自動列（提案書の applied_koma 合計 - 通常回数）があれば最優先で採用。
    // これにより「提案済みにして入力した申込コマ」が決定コマ＝取得率に直結する。
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
        ['増コマ回数決定', '増コマ決定', '決定コマ']
      )
    );
  }, [items, proposedKomaItem]);

  // --- 面談実施チェック項目（生徒面談・父母面談を分離） ---
  const studentInterviewItem = useMemo(() => {
    return findItemByKeywords(items, ['生徒面談実施', '生徒面談']);
  }, [items]);

  const parentInterviewItem = useMemo(() => {
    return findItemByKeywords(items, ['父母面談実施', '保護者面談実施', '父母面談', '保護者面談']);
  }, [items]);

  const studentInterviewCount = useMemo(() => {
    if (!studentInterviewItem) return 0;
    let count = 0;
    for (const s of students) {
      const d = progressData.find(
        (p) => p.student_id === s.id && p.item_id === studentInterviewItem.id
      );
      if (d?.status === 'completed') count++;
    }
    return count;
  }, [studentInterviewItem, students, progressData]);

  const parentInterviewCount = useMemo(() => {
    if (!parentInterviewItem) return 0;
    let count = 0;
    for (const s of students) {
      const d = progressData.find(
        (p) => p.student_id === s.id && p.item_id === parentInterviewItem.id
      );
      if (d?.status === 'completed') count++;
    }
    return count;
  }, [parentInterviewItem, students, progressData]);

  // --- 教科別コマ合計 ---
  const subjectItems = useMemo(
    () => items.filter((i) => i.column_group === '教科別' && i.column_type === 'number'),
    [items]
  );

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
            else if (item.auto_source === 'subject_proposal') {
              // 科目名マッチング
              const sp = sv.subject_proposals;
              if (sp) {
                if (sp[item.name] !== undefined) {
                  sum += sp[item.name];
                } else {
                  for (const [subject, count] of Object.entries(sp)) {
                    if (item.name.includes(subject)) {
                      sum += count;
                      break;
                    }
                  }
                }
              }
            }
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

  // --- 生徒ごと提案増コマ ---
  const studentProposedKoma = useMemo(() => {
    const vals: Record<string, number> = {};
    for (const s of students) {
      if (proposedKomaItem) {
        if (proposedKomaItem.auto_source === 'proposed_extra') {
          const sv = autoValues?.[s.id];
          const proposalTotal = sv?.proposal_total ?? 0;
          const courseSessions = sv?.course_sessions ?? 0;
          vals[s.id] = Math.max(0, proposalTotal - courseSessions);
        } else {
          const d = progressData.find(
            (p) => p.student_id === s.id && p.item_id === proposedKomaItem.id
          );
          vals[s.id] = d?.number_value ?? 0;
        }
      } else {
        vals[s.id] = 0;
      }
    }
    return vals;
  }, [students, proposedKomaItem, progressData, autoValues, studentSubjectTotals]);

  // --- 生徒ごと決定増コマ ---
  const studentDecidedKoma = useMemo(() => {
    const vals: Record<string, number> = {};
    for (const s of students) {
      if (decidedKomaItem) {
        if (decidedKomaItem.auto_source === 'applied_extra') {
          // 申込増コマ = 提案書の申込コマ合計 - 講習期間の通常回数
          const sv = autoValues?.[s.id];
          const appliedTotal = sv?.applied_total ?? 0;
          const courseSessions = sv?.course_sessions ?? 0;
          vals[s.id] = Math.max(0, appliedTotal - courseSessions);
        } else {
          const d = progressData.find(
            (p) => p.student_id === s.id && p.item_id === decidedKomaItem.id
          );
          vals[s.id] = d?.number_value ?? 0;
        }
      } else {
        vals[s.id] = 0;
      }
    }
    return vals;
  }, [students, decidedKomaItem, progressData, autoValues]);

  // --- 生徒ごと「決定コマの記録があるか」 ---
  // 申込件数(申込済)のカウント用。手入力列は 0 を明示入力した生徒も「申込済(コマ0で確定)」として数えるため、
  // number_value が記録されていれば（0でも）true。自動列は明示的な0入力の概念がないので値>0を記録ありとみなす。
  const studentDecidedHasValue = useMemo(() => {
    const vals: Record<string, boolean> = {};
    for (const s of students) {
      if (!decidedKomaItem) {
        vals[s.id] = false;
        continue;
      }
      if (decidedKomaItem.auto_source) {
        vals[s.id] = (studentDecidedKoma[s.id] ?? 0) > 0;
      } else {
        const d = progressData.find(
          (p) => p.student_id === s.id && p.item_id === decidedKomaItem.id
        );
        vals[s.id] = d?.number_value != null;
      }
    }
    return vals;
  }, [students, decidedKomaItem, progressData, studentDecidedKoma]);

  // --- 集計 ---
  // 進捗率（%整数）。0除算は0扱い。進捗状況カードの各行と学年別内訳の取得率で共用する。
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const totalProposed = Object.values(studentProposedKoma).reduce((a, b) => a + b, 0);
  const totalDecided = Object.values(studentDecidedKoma).reduce((a, b) => a + b, 0);
  const actualRate = totalProposed > 0 ? totalDecided / totalProposed : 0;
  const actualRatePct = Math.round(actualRate * 100);
  // 予想: 手動入力の予想取得率 × 提案合計
  const expectedRateDecimal = expectedRate / 100;
  const expectedKoma = Math.round(totalProposed * expectedRateDecimal);
  // 実績: 実際の取得率 × 提案合計 = totalDecided
  const budgetRate = budgetKoma > 0 ? totalDecided / budgetKoma : 0;
  const targetRate = targetKoma > 0 ? totalDecided / targetKoma : 0;
  const proposedStudentCount = Object.values(studentProposedKoma).filter((v) => v > 0).length;
  // 申込済件数: 決定コマの記録がある生徒数（手入力0コマも申込済として数える）。
  // テーブル列フッターの「入力済み(number_value!=null)」と数え方を統一する。
  const decidedStudentCount = Object.values(studentDecidedHasValue).filter(Boolean).length;

  // --- 期日超過タスク ---
  const today = new Date().toISOString().slice(0, 10);
  const overdueData = useMemo(() => {
    const checkItems = items.filter(
      (i) => i.column_type === 'check' && i.deadline && i.deadline < today && !i.is_hidden
    );
    const overdueList: { item: CourseProgressItem; student: Student }[] = [];
    for (const item of checkItems) {
      for (const s of students) {
        const d = progressData.find((p) => p.student_id === s.id && p.item_id === item.id);
        if (!d || (d.status !== 'completed' && d.status !== 'not_applicable')) {
          overdueList.push({ item, student: s });
        }
      }
    }
    return { items: checkItems, list: overdueList };
  }, [items, students, progressData, today]);

  // --- 学校種別分析 ---
  const categoryAnalysis = useMemo(() => {
    const categories: SchoolCategory[] = ['elementary', 'middle', 'high'];
    return categories
      .map((cat) => {
        const catStudents = students.filter((s) => getSchoolCategory(s.grade) === cat);
        if (catStudents.length === 0) return null;
        const catProposed = catStudents.reduce(
          (sum, s) => sum + (studentProposedKoma[s.id] ?? 0),
          0
        );
        const catDecided = catStudents.reduce((sum, s) => sum + (studentDecidedKoma[s.id] ?? 0), 0);
        const catRate = catProposed > 0 ? catDecided / catProposed : 0;
        const catProposedCount = catStudents.filter(
          (s) => (studentProposedKoma[s.id] ?? 0) > 0
        ).length;
        // 申込済件数は「決定コマの記録あり」で数える（0コマ確定も申込済に含める）
        const catDecidedCount = catStudents.filter((s) => studentDecidedHasValue[s.id]).length;

        const gradeBreakdown: {
          grade: number;
          label: string;
          count: number;
          proposed: number;
          decided: number;
          avgProposed: number;
          avgDecided: number;
          rate: number;
        }[] = [];
        const gradeSet = Array.from(new Set(catStudents.map((s) => s.grade))).sort((a, b) => a - b);
        for (const grade of gradeSet) {
          const gs = catStudents.filter((s) => s.grade === grade);
          const gProposed = gs.reduce((sum, s) => sum + (studentProposedKoma[s.id] ?? 0), 0);
          const gDecided = gs.reduce((sum, s) => sum + (studentDecidedKoma[s.id] ?? 0), 0);
          gradeBreakdown.push({
            grade,
            label: GRADE_LABELS[grade] || `${grade}`,
            count: gs.length,
            proposed: gProposed,
            decided: gDecided,
            // 提案増コマ平均（その学年の在籍1人あたりの提案コマ数）
            avgProposed: gs.length > 0 ? gProposed / gs.length : 0,
            // 取得増コマ平均（その学年の在籍1人あたりの決定コマ数）
            avgDecided: gs.length > 0 ? gDecided / gs.length : 0,
            // 取得率（決定コマ ÷ 提案コマ）。提案0の学年は0%扱い。
            rate: gProposed > 0 ? gDecided / gProposed : 0,
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
          // 平均取得増コマ数（在籍1人あたりの決定コマ数）
          avgDecided: catStudents.length > 0 ? catDecided / catStudents.length : 0,
          gradeBreakdown,
        };
      })
      .filter((x): x is Exclude<typeof x, null> => x !== null);
  }, [students, studentProposedKoma, studentDecidedKoma, studentDecidedHasValue]);

  // --- 教科別 提案 vs 取得（提案書ベース） ---
  // 提案書の subject_proposals（提案コマ）と subject_applied（申込＝取得コマ）を教科ごとに全生徒合算する。
  // 提案コマ・取得コマは結合グループを考慮済みの値が auto_values で届くため、ここでは素直に加算するだけでよい。
  // 「全体」に加えて学校種別（小／中／高）でも内訳を集計し、タブで切り替えて見られるようにする。
  type SubjectRow = { subject: string; proposed: number; applied: number; rate: number };
  const subjectAnalysis = useMemo(() => {
    type Agg = Record<string, { proposed: number; applied: number }>;
    const overall: Agg = {};
    const byCat: Record<'elementary' | 'middle' | 'high', Agg> = {
      elementary: {},
      middle: {},
      high: {},
    };
    const add = (agg: Agg, subject: string, proposed: number, applied: number) => {
      if (!agg[subject]) agg[subject] = { proposed: 0, applied: 0 };
      agg[subject].proposed += proposed;
      agg[subject].applied += applied;
    };
    for (const s of students) {
      const sv = autoValues?.[s.id];
      if (!sv) continue;
      const cat = getSchoolCategory(s.grade);
      // 提案・申込どちらかに登場する教科をすべて対象にする（提案0・申込のみの教科も拾う）
      const subjects = Array.from(
        new Set([
          ...Object.keys(sv.subject_proposals ?? {}),
          ...Object.keys(sv.subject_applied ?? {}),
        ])
      );
      for (const subject of subjects) {
        const p = sv.subject_proposals?.[subject] ?? 0;
        const a = sv.subject_applied?.[subject] ?? 0;
        add(overall, subject, p, a);
        if (cat === 'elementary' || cat === 'middle' || cat === 'high')
          add(byCat[cat], subject, p, a);
      }
    }
    // 既知順（SUBJECT_ORDER）→ それ以外は日本語名順に並べて行配列化する
    const toRows = (agg: Agg): SubjectRow[] =>
      Object.entries(agg)
        .map(([subject, v]) => ({
          subject,
          proposed: v.proposed,
          applied: v.applied,
          rate: v.proposed > 0 ? v.applied / v.proposed : 0,
        }))
        .sort((a, b) => {
          const ia = SUBJECT_ORDER.indexOf(a.subject);
          const ib = SUBJECT_ORDER.indexOf(b.subject);
          if (ia !== -1 && ib !== -1) return ia - ib;
          if (ia !== -1) return -1;
          if (ib !== -1) return 1;
          return a.subject.localeCompare(b.subject, 'ja');
        });
    return {
      overall: toRows(overall),
      elementary: toRows(byCat.elementary),
      middle: toRows(byCat.middle),
      high: toRows(byCat.high),
    };
  }, [students, autoValues]);

  const hasScheduleDates = period?.schedule_start_date && period?.schedule_end_date;

  const matchInfo = useMemo(() => {
    const info: string[] = [];
    if (proposedKomaItem) info.push(`提案: "${proposedKomaItem.name}"`);
    else info.push('提案: 未検出');
    if (decidedKomaItem) info.push(`決定: "${decidedKomaItem.name}"`);
    else info.push('決定: 未検出');
    return info.join(' / ');
  }, [proposedKomaItem, decidedKomaItem]);

  const inputClass =
    'w-20 px-2 py-1 text-sm border border-gray-200 rounded-lg text-center focus:outline-none focus:ring-1 focus:ring-blue-300';

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
                onChange={(e) =>
                  onPeriodDateChange({ schedule_start_date: e.target.value || null })
                }
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
                (
                {Math.max(
                  1,
                  Math.round(
                    (new Date(period!.schedule_end_date!).getTime() -
                      new Date(period!.schedule_start_date!).getTime()) /
                      (1000 * 60 * 60 * 24 * 7)
                  )
                )}
                週間)
              </span>
            )}
            {!hasScheduleDates && (
              <span className="text-[10px] text-amber-500">
                ※ 講習期間を設定すると通常回数が自動計算されます
              </span>
            )}
          </div>
        </div>
      )}
      {!onPeriodDateChange && hasScheduleDates && (
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500 font-medium">講習期間</span>
            <span className="text-xs text-[#1e3a5f]">
              {period!.schedule_start_date} 〜 {period!.schedule_end_date}
            </span>
            <span className="text-[10px] text-gray-400">
              (
              {Math.max(
                1,
                Math.round(
                  (new Date(period!.schedule_end_date!).getTime() -
                    new Date(period!.schedule_start_date!).getTime()) /
                    (1000 * 60 * 60 * 24 * 7)
                )
              )}
              週間)
            </span>
          </div>
        </div>
      )}

      {/* 項目マッチ警告 */}
      {(!proposedKomaItem || !decidedKomaItem) && (
        <div className="text-[10px] text-amber-500 px-1">
          <AlertTriangle className="inline h-3 w-3 mr-1" />
          ダッシュボード集計: {matchInfo}
          {!proposedKomaItem && (
            <span className="ml-1">（「提案増コマ」「提示増コマ」を含む数値項目が必要）</span>
          )}
          {!decidedKomaItem && <span className="ml-1">（「増コマ回数」を含む数値項目が必要）</span>}
        </div>
      )}

      {/* ===== 1段目: メイン指標 ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* 増コマ達成度 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
            増コマ達成度
            <HelpTooltip
              text={
                '決定コマ数の予算・目標に対する達成度。\n予算: 上限の目安\n目標: 達成したいコマ数'
              }
              size={10}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#1e3a5f]">{totalDecided}</span>
            <span className="text-sm text-gray-400">
              / {targetKoma > 0 ? targetKoma : '–'} コマ
            </span>
          </div>
          {targetKoma > 0 && (
            <>
              <div className="mt-2 w-full bg-gray-100 rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-[#3b82f6] transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.min(Math.round(targetRate * 100), 100)}%` }}
                />
              </div>
              <div className="text-xs text-gray-400 mt-1">
                目標比 {Math.round(targetRate * 100)}%
              </div>
            </>
          )}
          {onBudgetKomaChange || onTargetKomaChange ? (
            <div className="mt-3 space-y-1.5">
              {onTargetKomaChange && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500 w-8 shrink-0">目標</span>
                  <BlurSaveInput
                    value={targetKoma}
                    onSave={onTargetKomaChange}
                    placeholder="0"
                    className={inputClass}
                    suffix="コマ"
                  />
                </div>
              )}
              {onBudgetKomaChange && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500 w-8 shrink-0">予算</span>
                  <BlurSaveInput
                    value={budgetKoma}
                    onSave={onBudgetKomaChange}
                    placeholder="0"
                    className={inputClass}
                    suffix="コマ"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 space-y-0.5 text-xs text-gray-400">
              {targetKoma > 0 && <div>目標: {targetKoma}コマ</div>}
              {budgetKoma > 0 && <div>予算: {budgetKoma}コマ</div>}
            </div>
          )}
          {budgetKoma > 0 && (
            <div className="mt-1.5 flex items-center gap-1">
              <span className="text-[10px] text-gray-400">予算達成:</span>
              <span
                className={`text-[11px] font-bold ${budgetRate >= 1 ? 'text-green-600' : budgetRate >= 0.7 ? 'text-amber-600' : 'text-red-500'}`}
              >
                {Math.round(budgetRate * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* 予想増コマ（想定 vs 実績） */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
            予想増コマ
            <HelpTooltip
              text={
                '想定: 提案合計 × 想定取得率\n実績: 実際の決定コマ合計\n想定取得率: 手動で設定する見込みの割合\n実績取得率: 決定コマ÷提案コマの実績'
              }
              size={10}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {/* 想定 */}
            <div className="text-center">
              <div className="text-[10px] text-gray-400 mb-0.5">想定</div>
              <div className="text-xl font-bold text-[#f59e0b]">{expectedKoma}</div>
              <div className="text-[10px] text-gray-400">コマ</div>
            </div>
            {/* 実績ベース */}
            <div className="text-center">
              <div className="text-[10px] text-gray-400 mb-0.5">実績</div>
              <div className="text-xl font-bold text-[#3b82f6]">{totalDecided}</div>
              <div className="text-[10px] text-gray-400">コマ</div>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-gray-100 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">想定取得率</span>
              {onExpectedRateChange ? (
                <BlurSaveInput
                  value={expectedRate}
                  onSave={onExpectedRateChange}
                  placeholder="0"
                  className="w-14 px-1 py-0.5 text-xs border border-gray-200 rounded text-center focus:outline-none focus:ring-1 focus:ring-amber-300"
                  suffix="%"
                  min={0}
                  max={100}
                />
              ) : (
                <span className="text-gray-600 font-medium">{expectedRate}%</span>
              )}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">実績取得率</span>
              <span className="text-gray-600 font-medium">{actualRatePct}%</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400">提案合計</span>
              <span className="text-gray-600 font-medium">{totalProposed}コマ</span>
            </div>
          </div>
        </div>

        {/* 進捗状況 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
            進捗状況
            <HelpTooltip
              text={
                '作成済: 提示増コマが1以上の生徒数\n生徒面談: 生徒面談実施チェック済みの生徒数\n父母面談: 父母面談実施チェック済みの生徒数\n申込済: 増コマ決定が記録済みの生徒数（0コマ確定も含む）'
              }
              size={10}
            />
          </div>
          <div className="space-y-2">
            {/* 作成済み */}
            <div>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-gray-500">作成済</span>
                <span className="text-gray-700 font-medium">
                  {proposedStudentCount}
                  <span className="text-gray-400 font-normal"> / {students.length}名</span>
                  <span className="text-gray-400 font-normal ml-1">
                    ({pct(proposedStudentCount, students.length)}%)
                  </span>
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full bg-[#f59e0b] transition-[width] duration-500 ease-out"
                  style={{
                    width: `${students.length > 0 ? Math.round((proposedStudentCount / students.length) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
            {/* 生徒面談実施済み */}
            {studentInterviewItem && (
              <div>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="text-gray-500">生徒面談</span>
                  <span className="text-gray-700 font-medium">
                    {studentInterviewCount}
                    <span className="text-gray-400 font-normal"> / {students.length}名</span>
                    <span className="text-gray-400 font-normal ml-1">
                      ({pct(studentInterviewCount, students.length)}%)
                    </span>
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full bg-[#10b981] transition-[width] duration-500 ease-out"
                    style={{
                      width: `${students.length > 0 ? Math.round((studentInterviewCount / students.length) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}
            {/* 父母面談実施済み */}
            {parentInterviewItem && (
              <div>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="text-gray-500">父母面談</span>
                  <span className="text-gray-700 font-medium">
                    {parentInterviewCount}
                    <span className="text-gray-400 font-normal"> / {students.length}名</span>
                    <span className="text-gray-400 font-normal ml-1">
                      ({pct(parentInterviewCount, students.length)}%)
                    </span>
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full bg-[#059669] transition-[width] duration-500 ease-out"
                    style={{
                      width: `${students.length > 0 ? Math.round((parentInterviewCount / students.length) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}
            {/* 申込済み */}
            <div>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-gray-500">申込済</span>
                <span className="text-gray-700 font-medium">
                  {decidedStudentCount}
                  <span className="text-gray-400 font-normal"> / {students.length}名</span>
                  <span className="text-gray-400 font-normal ml-1">
                    ({pct(decidedStudentCount, students.length)}%)
                  </span>
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full bg-[#3b82f6] transition-[width] duration-500 ease-out"
                  style={{
                    width: `${students.length > 0 ? Math.round((decidedStudentCount / students.length) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-400">
            <div className="flex justify-between">
              <span>平均提案</span>
              <span className="text-gray-600">
                {students.length > 0 ? (totalProposed / students.length).toFixed(1) : 0}コマ/人
              </span>
            </div>
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

        {/* 進捗・期日超過 */}
        <div
          className={`bg-white rounded-xl border ${overdueData.list.length > 0 ? 'border-red-200' : 'border-gray-200'} p-4`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            {overdueData.list.length > 0 && <AlertTriangle className="text-red-500 w-3 h-3" />}
            <span className="text-xs text-gray-500">期日超過</span>
            <HelpTooltip
              text={'項目に設定された期日を過ぎても\n未完了（チェックなし）の生徒とタスクを表示'}
              size={10}
            />
          </div>
          {overdueData.list.length === 0 ? (
            <div className="text-sm text-gray-400 mt-2">期日超過なし ✓</div>
          ) : (
            <>
              <div className="text-2xl font-bold text-red-500">{overdueData.list.length}件</div>
              <div className="text-[10px] text-gray-400 mt-1">
                {overdueData.items.length}タスク × 未完了生徒
              </div>
              <div className="mt-2 max-h-28 overflow-y-auto space-y-1 pr-1">
                {overdueData.items.map((item) => {
                  const overdueStudents = overdueData.list.filter((o) => o.item.id === item.id);
                  return (
                    <div key={item.id} className="text-[10px]">
                      <div className="flex items-center justify-between">
                        <span
                          className="text-red-600 font-medium truncate max-w-[100px]"
                          title={item.name}
                        >
                          {item.name}
                        </span>
                        <span className="text-gray-400 shrink-0 ml-1">
                          〜{item.deadline?.slice(5).replace('-', '/')}
                        </span>
                      </div>
                      <div className="text-gray-500 pl-1 truncate">
                        {overdueStudents
                          .slice(0, 3)
                          .map((o) => `${o.student.last_name}`)
                          .join(', ')}
                        {overdueStudents.length > 3 && ` 他${overdueStudents.length - 3}名`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===== 2段目: 学校種別分析（アコーディオン） ===== */}
      {categoryAnalysis.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            onClick={() => setCategoryOpen(!categoryOpen)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors duration-150"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600">学校種別分析</span>
              {categoryAnalysis.map((cat) => (
                <span
                  key={cat.category}
                  className={`text-[10px] px-1.5 py-0.5 rounded-full ${cat.colors.bg} ${cat.colors.text}`}
                >
                  {cat.label} {cat.totalDecided}/{cat.totalProposed}
                </span>
              ))}
            </div>
            <ChevronDown
              className={`w-4 h-4 text-gray-400 transition-[transform] duration-150 ease-out ${categoryOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {categoryOpen && (
            <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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

                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <div className="text-center">
                      <div className="text-[10px] text-gray-500">提案</div>
                      <div className={`text-sm font-bold ${cat.colors.text}`}>
                        {cat.totalProposed}
                      </div>
                      <div className="text-[10px] text-gray-400">{cat.proposedCount}名</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-gray-500">決定</div>
                      <div className={`text-sm font-bold ${cat.colors.text}`}>
                        {cat.totalDecided}
                      </div>
                      <div className="text-[10px] text-gray-400">{cat.decidedCount}名</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-gray-500" title="在籍1人あたりの提案コマ数">
                        平均提案
                      </div>
                      <div className={`text-sm font-bold ${cat.colors.text}`}>
                        {cat.avgProposed.toFixed(1)}
                      </div>
                      <div className="text-[10px] text-gray-400">コマ/人</div>
                    </div>
                    <div className="text-center">
                      <div
                        className="text-[10px] text-gray-500"
                        title="在籍1人あたりの取得（決定）増コマ数"
                      >
                        平均取得
                      </div>
                      <div className={`text-sm font-bold ${cat.colors.text}`}>
                        {cat.avgDecided.toFixed(1)}
                      </div>
                      <div className="text-[10px] text-gray-400">コマ/人</div>
                    </div>
                  </div>

                  <div className="w-full bg-white/60 rounded-full h-1.5 mb-2">
                    <div
                      className="h-1.5 rounded-full transition-[width] duration-500 ease-out"
                      style={{
                        width: `${Math.min(Math.round(cat.acquisitionRate * 100), 100)}%`,
                        backgroundColor: cat.colors.accent,
                      }}
                    />
                  </div>

                  {cat.gradeBreakdown.length > 1 && (
                    <div className="mt-2 space-y-0.5">
                      {cat.gradeBreakdown.map((g) => (
                        <div
                          key={g.grade}
                          className="flex items-center justify-between text-[10px]"
                        >
                          <span className="text-gray-500 w-6">{g.label}</span>
                          <span className="text-gray-400 w-7 text-right">{g.count}名</span>
                          <span className="text-gray-500 w-11 text-right">提案{g.proposed}</span>
                          <span
                            className="text-gray-400 w-10 text-right"
                            title="提案増コマ平均（提案コマ÷人数）"
                          >
                            提{g.avgProposed.toFixed(1)}
                          </span>
                          <span className={`font-medium w-11 text-right ${cat.colors.text}`}>
                            決定{g.decided}
                          </span>
                          <span
                            className="text-gray-400 w-10 text-right"
                            title="取得増コマ平均（決定コマ÷人数）"
                          >
                            取{g.avgDecided.toFixed(1)}
                          </span>
                          <span
                            className={`font-medium w-9 text-right ${cat.colors.text}`}
                            title="取得率（決定コマ÷提案コマ）"
                          >
                            {Math.round(g.rate * 100)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== 3段目: 教科別 提案 vs 取得（アコーディオン） ===== */}
      {subjectAnalysis.overall.length > 0 &&
        (() => {
          // 全体サマリ（ヘッダー常時表示用）
          const ovProposed = subjectAnalysis.overall.reduce((a, r) => a + r.proposed, 0);
          const ovApplied = subjectAnalysis.overall.reduce((a, r) => a + r.applied, 0);
          const ovRate = ovProposed > 0 ? ovApplied / ovProposed : 0;
          // タブは「全体」＋データのある学校種別のみ
          const tabs: { key: 'overall' | 'elementary' | 'middle' | 'high'; label: string }[] = [
            { key: 'overall', label: '全体' },
            ...(['elementary', 'middle', 'high'] as const)
              .filter((c) => subjectAnalysis[c].length > 0)
              .map((c) => ({ key: c, label: CATEGORY_LABELS[c] })),
          ];
          // 選択中タブにデータが無ければ全体にフォールバック
          const rows =
            subjectAnalysis[subjectCat]?.length > 0
              ? subjectAnalysis[subjectCat]
              : subjectAnalysis.overall;
          const sumProposed = rows.reduce((a, r) => a + r.proposed, 0);
          const sumApplied = rows.reduce((a, r) => a + r.applied, 0);
          const sumRate = sumProposed > 0 ? sumApplied / sumProposed : 0;
          const sumDiff = sumApplied - sumProposed;
          // 取得率バーの色（全体はスレート、種別はそのカラー）
          const barColor =
            subjectCat === 'overall' ? '#475569' : CATEGORY_COLORS[subjectCat].accent;
          return (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button
                onClick={() => setSubjectOpen(!subjectOpen)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors duration-150"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-600">教科別 提案 vs 取得</span>
                  <span className="text-[10px] text-gray-400">
                    提案{ovProposed} → 取得{ovApplied}・取得率{Math.round(ovRate * 100)}%
                  </span>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-[transform] duration-150 ease-out ${subjectOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {subjectOpen && (
                <div className="px-4 pb-4">
                  {/* 学校種別タブ */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {tabs.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => setSubjectCat(t.key)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors duration-150 ${
                          subjectCat === t.key
                            ? 'bg-gray-800 text-white'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {/* 教科別テーブル: 提案コマ / 取得コマ / 差 / 取得率 */}
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="text-left font-medium py-1.5 pl-1">教科</th>
                        <th className="text-right font-medium py-1.5">提案</th>
                        <th className="text-right font-medium py-1.5">取得</th>
                        <th
                          className="text-right font-medium py-1.5"
                          title="取得コマ − 提案コマ（マイナスは取りこぼし）"
                        >
                          差
                        </th>
                        <th className="text-right font-medium py-1.5 pr-1 w-[42%]">取得率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const diff = r.applied - r.proposed;
                        const ratePct = Math.round(r.rate * 100);
                        return (
                          <tr key={r.subject} className="border-b border-gray-50">
                            <td className="py-1.5 pl-1 text-gray-700 font-medium">{r.subject}</td>
                            <td className="py-1.5 text-right text-gray-600">{r.proposed}</td>
                            <td className="py-1.5 text-right text-gray-800 font-medium">
                              {r.applied}
                            </td>
                            <td
                              className={`py-1.5 text-right ${diff < 0 ? 'text-amber-600' : 'text-gray-400'}`}
                            >
                              {diff > 0 ? `+${diff}` : diff}
                            </td>
                            <td className="py-1.5 pr-1">
                              <div className="flex items-center gap-2 justify-end">
                                <div className="flex-1 bg-gray-100 rounded-full h-1.5 max-w-[120px]">
                                  <div
                                    className="h-1.5 rounded-full transition-[width] duration-500 ease-out"
                                    style={{
                                      width: `${Math.min(ratePct, 100)}%`,
                                      backgroundColor: barColor,
                                    }}
                                  />
                                </div>
                                <span className="text-gray-700 font-medium w-9 text-right">
                                  {ratePct}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200">
                        <td className="py-1.5 pl-1 text-gray-500 font-medium">合計</td>
                        <td className="py-1.5 text-right text-gray-600 font-medium">
                          {sumProposed}
                        </td>
                        <td className="py-1.5 text-right text-gray-800 font-bold">{sumApplied}</td>
                        <td
                          className={`py-1.5 text-right font-medium ${sumDiff < 0 ? 'text-amber-600' : 'text-gray-400'}`}
                        >
                          {sumDiff > 0 ? `+${sumDiff}` : sumDiff}
                        </td>
                        <td className="py-1.5 pr-1 text-right text-gray-800 font-bold">
                          {Math.round(sumRate * 100)}%
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
}
