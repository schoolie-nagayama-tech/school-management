'use client';

import { useMemo, useState, useRef, useCallback, type CSSProperties } from 'react';
import type { CourseProgressItem, StudentCourseProgress, CoursePrepPeriod } from '@/types/database';
import type { Student } from '@/types/database';
import type { AutoValues } from '@/lib/api/courseProgress';
import {
  computeDashboardAggregates,
  getSchoolCategory,
  CATEGORY_LABELS,
  type SchoolCategory,
} from '@/lib/coursePrepKpis';
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
      {suffix && <span className="text-[10px] text-text-faint">{suffix}</span>}
    </span>
  );
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

  // --- 集計は共通の純関数に一元化（印刷レポートと同じ数字を保証） ---
  // today は期日超過の基準日。レンダーごとに new Date() を作ると useMemo が毎回無効化されるため、
  // 日付（YYYY-MM-DD）に丸めた文字列を1回だけ確定させる。
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const agg = useMemo(
    () =>
      computeDashboardAggregates(students, items, progressData, autoValues || {}, period, today),
    [students, items, progressData, autoValues, period, today]
  );

  const {
    proposedKomaItem,
    decidedKomaItem,
    studentInterviewItem,
    parentInterviewItem,
    studentInterviewCount,
    parentInterviewCount,
    totalProposed,
    totalDecided,
    actualRatePct,
    proposedStudentCount,
    decidedStudentCount,
    expectedKoma,
    budgetKoma,
    targetKoma,
    expectedRate,
    budgetRate,
    targetRate,
    categoryAnalysis,
    subjectAnalysis,
  } = agg;
  // JSX の既存参照名に合わせて期日超過をまとめ直す
  const overdueData = { items: agg.overdueItems, list: agg.overdueList };

  // 進捗率（%整数）。0除算は0扱い。進捗状況カードの各行で使う。
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

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
    'w-20 px-2 py-1 text-sm border border-border rounded-lg text-center focus:outline-none focus:ring-1 focus:ring-blue-300';

  return (
    <div className="space-y-4 mb-6">
      {/* 講習期間設定 */}
      {onPeriodDateChange && (
        <div className="bg-surface rounded-xl border border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs text-text-muted font-medium">講習期間</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={period?.schedule_start_date || ''}
                onChange={(e) =>
                  onPeriodDateChange({ schedule_start_date: e.target.value || null })
                }
                className="px-2 py-1 text-xs border border-border rounded-lg"
              />
              <span className="text-xs text-text-faint">〜</span>
              <input
                type="date"
                value={period?.schedule_end_date || ''}
                onChange={(e) => onPeriodDateChange({ schedule_end_date: e.target.value || null })}
                className="px-2 py-1 text-xs border border-border rounded-lg"
              />
            </div>
            {hasScheduleDates && (
              <span className="text-[10px] text-text-faint">
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
        <div className="bg-surface rounded-xl border border-border px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-xs text-text-muted font-medium">講習期間</span>
            <span className="text-xs text-[#1e3a5f]">
              {period!.schedule_start_date} 〜 {period!.schedule_end_date}
            </span>
            <span className="text-[10px] text-text-faint">
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
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-xs text-text-muted mb-1 flex items-center gap-1">
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
            <span className="text-sm text-text-faint">
              / {targetKoma > 0 ? targetKoma : '–'} コマ
            </span>
          </div>
          {targetKoma > 0 && (
            <>
              <div className="mt-2 w-full bg-surface-hover rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-[#3b82f6] transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.min(Math.round(targetRate * 100), 100)}%` }}
                />
              </div>
              <div className="text-xs text-text-faint mt-1">
                目標比 {Math.round(targetRate * 100)}%
              </div>
            </>
          )}
          {onBudgetKomaChange || onTargetKomaChange ? (
            <div className="mt-3 space-y-1.5">
              {onTargetKomaChange && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted w-8 shrink-0">目標</span>
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
                  <span className="text-xs text-text-muted w-8 shrink-0">予算</span>
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
            <div className="mt-2 space-y-0.5 text-xs text-text-faint">
              {targetKoma > 0 && <div>目標: {targetKoma}コマ</div>}
              {budgetKoma > 0 && <div>予算: {budgetKoma}コマ</div>}
            </div>
          )}
          {budgetKoma > 0 && (
            <div className="mt-1.5 flex items-center gap-1">
              <span className="text-[10px] text-text-faint">予算達成:</span>
              <span
                className={`text-xs font-bold ${budgetRate >= 1 ? 'text-green-600' : budgetRate >= 0.7 ? 'text-amber-600' : 'text-red-500'}`}
              >
                {Math.round(budgetRate * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* 予想増コマ（想定 vs 実績） */}
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-xs text-text-muted mb-2 flex items-center gap-1">
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
              <div className="text-[10px] text-text-faint mb-0.5">想定</div>
              <div className="text-xl font-bold text-[#f59e0b]">{expectedKoma}</div>
              <div className="text-[10px] text-text-faint">コマ</div>
            </div>
            {/* 実績ベース */}
            <div className="text-center">
              <div className="text-[10px] text-text-faint mb-0.5">実績</div>
              <div className="text-xl font-bold text-[#3b82f6]">{totalDecided}</div>
              <div className="text-[10px] text-text-faint">コマ</div>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border-subtle space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-faint">想定取得率</span>
              {onExpectedRateChange ? (
                <BlurSaveInput
                  value={expectedRate}
                  onSave={onExpectedRateChange}
                  placeholder="0"
                  className="w-14 px-1 py-0.5 text-xs border border-border rounded text-center focus:outline-none focus:ring-1 focus:ring-amber-300"
                  suffix="%"
                  min={0}
                  max={100}
                />
              ) : (
                <span className="text-text-muted font-medium">{expectedRate}%</span>
              )}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-faint">実績取得率</span>
              <span className="text-text-muted font-medium">{actualRatePct}%</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-faint">提案合計</span>
              <span className="text-text-muted font-medium">{totalProposed}コマ</span>
            </div>
          </div>
        </div>

        {/* 進捗状況 */}
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-xs text-text-muted mb-2 flex items-center gap-1">
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
                <span className="text-text-muted">作成済</span>
                <span className="text-text-body font-medium">
                  {proposedStudentCount}
                  <span className="text-text-faint font-normal"> / {students.length}名</span>
                  <span className="text-text-faint font-normal ml-1">
                    ({pct(proposedStudentCount, students.length)}%)
                  </span>
                </span>
              </div>
              <div className="w-full bg-surface-hover rounded-full h-1.5">
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
                  <span className="text-text-muted">生徒面談</span>
                  <span className="text-text-body font-medium">
                    {studentInterviewCount}
                    <span className="text-text-faint font-normal"> / {students.length}名</span>
                    <span className="text-text-faint font-normal ml-1">
                      ({pct(studentInterviewCount, students.length)}%)
                    </span>
                  </span>
                </div>
                <div className="w-full bg-surface-hover rounded-full h-1.5">
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
                  <span className="text-text-muted">父母面談</span>
                  <span className="text-text-body font-medium">
                    {parentInterviewCount}
                    <span className="text-text-faint font-normal"> / {students.length}名</span>
                    <span className="text-text-faint font-normal ml-1">
                      ({pct(parentInterviewCount, students.length)}%)
                    </span>
                  </span>
                </div>
                <div className="w-full bg-surface-hover rounded-full h-1.5">
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
                <span className="text-text-muted">申込済</span>
                <span className="text-text-body font-medium">
                  {decidedStudentCount}
                  <span className="text-text-faint font-normal"> / {students.length}名</span>
                  <span className="text-text-faint font-normal ml-1">
                    ({pct(decidedStudentCount, students.length)}%)
                  </span>
                </span>
              </div>
              <div className="w-full bg-surface-hover rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full bg-[#3b82f6] transition-[width] duration-500 ease-out"
                  style={{
                    width: `${students.length > 0 ? Math.round((decidedStudentCount / students.length) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-border-subtle text-xs text-text-faint space-y-0.5">
            <div className="flex justify-between">
              <span>平均提案</span>
              <span className="text-text-muted">
                {students.length > 0 ? (totalProposed / students.length).toFixed(1) : 0}コマ/人
              </span>
            </div>
            <div className="flex justify-between">
              <span>平均取得</span>
              <span className="text-text-muted">
                {students.length > 0 ? (totalDecided / students.length).toFixed(1) : 0}コマ/人
              </span>
            </div>
          </div>
        </div>

        {/* 在籍数 */}
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-xs text-text-muted mb-1">在籍生徒数</div>
          <div className="text-2xl font-bold text-[#1e3a5f]">{students.length}名</div>
          <div className="mt-2 space-y-1">
            {(['elementary', 'middle', 'high'] as SchoolCategory[]).map((cat) => {
              const count = students.filter((s) => getSchoolCategory(s.grade) === cat).length;
              if (count === 0) return null;
              return (
                <div key={cat} className="flex items-center justify-between text-xs">
                  <span className="text-text-faint">{CATEGORY_LABELS[cat]}</span>
                  <span className="text-text-muted font-medium">{count}名</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 進捗・期日超過 */}
        <div
          className={`bg-surface rounded-xl border ${overdueData.list.length > 0 ? 'border-danger' : 'border-border'} p-4`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            {overdueData.list.length > 0 && <AlertTriangle className="text-red-500 w-3 h-3" />}
            <span className="text-xs text-text-muted">期日超過</span>
            <HelpTooltip
              text={'項目に設定された期日を過ぎても\n未完了（チェックなし）の生徒とタスクを表示'}
              size={10}
            />
          </div>
          {overdueData.list.length === 0 ? (
            <div className="text-sm text-text-faint mt-2">期日超過なし ✓</div>
          ) : (
            <>
              <div className="text-2xl font-bold text-red-500">{overdueData.list.length}件</div>
              <div className="text-[10px] text-text-faint mt-1">
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
                        <span className="text-text-faint shrink-0 ml-1">
                          〜{item.deadline?.slice(5).replace('-', '/')}
                        </span>
                      </div>
                      <div className="text-text-muted pl-1 truncate">
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
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <button
            onClick={() => setCategoryOpen(!categoryOpen)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-hover transition-colors duration-150"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-muted">学校種別分析</span>
              {categoryAnalysis.map((cat) => {
                const colors = CATEGORY_COLORS[cat.category];
                return (
                  <span
                    key={cat.category}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text}`}
                  >
                    {cat.label} {cat.totalDecided}/{cat.totalProposed}
                  </span>
                );
              })}
            </div>
            <ChevronDown
              className={`w-4 h-4 text-text-faint transition-[transform] duration-150 ease-out ${categoryOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {categoryOpen && (
            <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* 学校種別カードを stagger-item で順次フェードイン */}
              {categoryAnalysis.map((cat, idx) => {
                const colors = CATEGORY_COLORS[cat.category];
                return (
                  <div
                    key={cat.category}
                    className={`stagger-item ${colors.bg} rounded-xl border ${colors.border} p-4`}
                    style={{ '--stagger-index': idx } as CSSProperties}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${colors.text}`}>{cat.label}</span>
                        <span className="text-xs text-text-faint">{cat.studentCount}名</span>
                      </div>
                      <span className={`text-xs font-medium ${colors.text}`}>
                        取得率 {Math.round(cat.acquisitionRate * 100)}%
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-2 mb-3">
                      <div className="text-center">
                        <div className="text-[10px] text-text-muted">提案</div>
                        <div className={`text-sm font-bold ${colors.text}`}>
                          {cat.totalProposed}
                        </div>
                        <div className="text-[10px] text-text-faint">{cat.proposedCount}名</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-text-muted">決定</div>
                        <div className={`text-sm font-bold ${colors.text}`}>{cat.totalDecided}</div>
                        <div className="text-[10px] text-text-faint">{cat.decidedCount}名</div>
                      </div>
                      <div className="text-center">
                        <div
                          className="text-[10px] text-text-muted"
                          title="在籍1人あたりの提案コマ数"
                        >
                          平均提案
                        </div>
                        <div className={`text-sm font-bold ${colors.text}`}>
                          {cat.avgProposed.toFixed(1)}
                        </div>
                        <div className="text-[10px] text-text-faint">コマ/人</div>
                      </div>
                      <div className="text-center">
                        <div
                          className="text-[10px] text-text-muted"
                          title="在籍1人あたりの取得（決定）増コマ数"
                        >
                          平均取得
                        </div>
                        <div className={`text-sm font-bold ${colors.text}`}>
                          {cat.avgDecided.toFixed(1)}
                        </div>
                        <div className="text-[10px] text-text-faint">コマ/人</div>
                      </div>
                    </div>

                    <div className="w-full bg-white/60 rounded-full h-1.5 mb-2">
                      <div
                        className="h-1.5 rounded-full transition-[width] duration-500 ease-out"
                        style={{
                          width: `${Math.min(Math.round(cat.acquisitionRate * 100), 100)}%`,
                          backgroundColor: colors.accent,
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
                            <span className="text-text-muted w-6">{g.label}</span>
                            <span className="text-text-faint w-7 text-right">{g.count}名</span>
                            <span className="text-text-muted w-11 text-right">
                              提案{g.proposed}
                            </span>
                            <span
                              className="text-text-faint w-10 text-right"
                              title="提案増コマ平均（提案コマ÷人数）"
                            >
                              提{g.avgProposed.toFixed(1)}
                            </span>
                            <span className={`font-medium w-11 text-right ${colors.text}`}>
                              決定{g.decided}
                            </span>
                            <span
                              className="text-text-faint w-10 text-right"
                              title="取得増コマ平均（決定コマ÷人数）"
                            >
                              取{g.avgDecided.toFixed(1)}
                            </span>
                            <span
                              className={`font-medium w-9 text-right ${colors.text}`}
                              title="取得率（決定コマ÷提案コマ）"
                            >
                              {Math.round(g.rate * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
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
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => setSubjectOpen(!subjectOpen)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-hover transition-colors duration-150"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-muted">教科別 提案 vs 取得</span>
                  <span className="text-[10px] text-text-faint">
                    提案{ovProposed} → 取得{ovApplied}・取得率{Math.round(ovRate * 100)}%
                  </span>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-text-faint transition-[transform] duration-150 ease-out ${subjectOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {subjectOpen && (
                <div
                  className="px-4 pb-4 stagger-item"
                  style={{ '--stagger-index': 0 } as CSSProperties}
                >
                  {/* 学校種別タブ */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {tabs.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => setSubjectCat(t.key)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors duration-150 ${
                          subjectCat === t.key
                            ? 'bg-ink text-text-on-primary'
                            : 'bg-surface-hover text-text-muted hover:bg-surface-raised'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {/* 教科別テーブル: 提案コマ / 取得コマ / 差 / 取得率 */}
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-text-faint border-b border-border-subtle">
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
                          <tr key={r.subject} className="border-b border-border-subtle">
                            <td className="py-1.5 pl-1 text-text-body font-medium">{r.subject}</td>
                            <td className="py-1.5 text-right text-text-muted">{r.proposed}</td>
                            <td className="py-1.5 text-right text-text-heading font-medium">
                              {r.applied}
                            </td>
                            <td
                              className={`py-1.5 text-right ${diff < 0 ? 'text-amber-600' : 'text-text-faint'}`}
                            >
                              {diff > 0 ? `+${diff}` : diff}
                            </td>
                            <td className="py-1.5 pr-1">
                              <div className="flex items-center gap-2 justify-end">
                                <div className="flex-1 bg-surface-hover rounded-full h-1.5 max-w-[120px]">
                                  <div
                                    className="h-1.5 rounded-full transition-[width] duration-500 ease-out"
                                    style={{
                                      width: `${Math.min(ratePct, 100)}%`,
                                      backgroundColor: barColor,
                                    }}
                                  />
                                </div>
                                <span className="text-text-body font-medium w-9 text-right">
                                  {ratePct}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border">
                        <td className="py-1.5 pl-1 text-text-muted font-medium">合計</td>
                        <td className="py-1.5 text-right text-text-muted font-medium">
                          {sumProposed}
                        </td>
                        <td className="py-1.5 text-right text-text-heading font-bold">
                          {sumApplied}
                        </td>
                        <td
                          className={`py-1.5 text-right font-medium ${sumDiff < 0 ? 'text-amber-600' : 'text-text-faint'}`}
                        >
                          {sumDiff > 0 ? `+${sumDiff}` : sumDiff}
                        </td>
                        <td className="py-1.5 pr-1 text-right text-text-heading font-bold">
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
