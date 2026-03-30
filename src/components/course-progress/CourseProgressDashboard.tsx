'use client';

import type { CourseProgressItem, StudentCourseProgress, CoursePrepPeriod } from '@/types/database';
import type { Student } from '@/types/database';
import { PROGRESS_COLUMN_GROUPS } from '@/types/database';

interface CourseProgressDashboardProps {
  students: Student[];
  items: CourseProgressItem[];
  progressData: StudentCourseProgress[];
  period: CoursePrepPeriod | null;
  onBudgetKomaChange?: (value: number) => void;
}

export function CourseProgressDashboard({
  students,
  items,
  progressData,
  period,
  onBudgetKomaChange,
}: CourseProgressDashboardProps) {
  // チェック項目のみの完了率
  const checkItems = items.filter((i) => i.column_type === 'check' && !i.is_hidden);
  const totalCheckCells = students.length * checkItems.length;
  const completedCheckCells = progressData.filter(
    (d) => d.status === 'completed' && checkItems.some((i) => i.id === d.item_id)
  ).length;
  const overallRate = totalCheckCells > 0 ? completedCheckCells / totalCheckCells : 0;

  // 予算コマ関連
  const budgetKoma = period?.budget_koma || 0;
  const proposedKomaItem = items.find((i) => i.name === '提示増コマ回数');
  const decidedKomaItem = items.find((i) => i.name === '増コマ回数決定');
  const totalProposed = proposedKomaItem
    ? progressData
        .filter((d) => d.item_id === proposedKomaItem.id && d.number_value != null)
        .reduce((sum, d) => sum + (d.number_value || 0), 0)
    : 0;
  const totalDecided = decidedKomaItem
    ? progressData
        .filter((d) => d.item_id === decidedKomaItem.id && d.number_value != null)
        .reduce((sum, d) => sum + (d.number_value || 0), 0)
    : 0;
  const komaRate = budgetKoma > 0 ? totalDecided / budgetKoma : 0;

  // グループ別進捗
  const groupStats = Object.entries(PROGRESS_COLUMN_GROUPS).map(([groupKey, groupDef]) => {
    const groupCheckItems = checkItems.filter((i) => i.column_group === groupKey);
    const groupTotal = students.length * groupCheckItems.length;
    const groupCompleted = progressData.filter(
      (d) => d.status === 'completed' && groupCheckItems.some((i) => i.id === d.item_id)
    ).length;
    return {
      key: groupKey,
      ...groupDef,
      total: groupTotal,
      completed: groupCompleted,
      rate: groupTotal > 0 ? groupCompleted / groupTotal : 0,
    };
  }).filter((g) => g.total > 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* 全体達成度 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-xs text-gray-500 mb-1">全体進捗</div>
        <div className="text-2xl font-bold text-[#1e3a5f]">
          {Math.round(overallRate * 100)}%
        </div>
        <div className="mt-2 w-full bg-gray-100 rounded-full h-2.5">
          <div
            className="h-2.5 rounded-full transition-all"
            style={{
              width: `${Math.round(overallRate * 100)}%`,
              backgroundColor: overallRate >= 0.8 ? '#10b981' : overallRate >= 0.5 ? '#f59e0b' : '#ef4444',
            }}
          />
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {completedCheckCells} / {totalCheckCells} 完了
        </div>
      </div>

      {/* 予算コマ */}
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
            style={{ width: `${Math.min(Math.round(komaRate * 100), 100)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-gray-400 mt-1">
          <span>提示: {totalProposed}コマ</span>
          {budgetKoma > 0 && <span>{Math.round(komaRate * 100)}%</span>}
        </div>
        {onBudgetKomaChange && (
          <div className="mt-2 flex items-center gap-1">
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
      </div>

      {/* 在籍数 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-xs text-gray-500 mb-1">在籍生徒数</div>
        <div className="text-2xl font-bold text-[#1e3a5f]">{students.length}名</div>
        <div className="text-xs text-gray-400 mt-3">
          チェック項目: {checkItems.length}項目
        </div>
      </div>

      {/* グループ別進捗 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-xs text-gray-500 mb-2">カテゴリ別進捗</div>
        <div className="space-y-2">
          {groupStats.map((g) => (
            <div key={g.key} className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 w-12 shrink-0">{g.label.replace('関連', '').replace('情報', '').replace('処理', '').replace('別コマ', '')}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.round(g.rate * 100)}%`, backgroundColor: g.color }}
                />
              </div>
              <span className="text-[10px] text-gray-400 w-8 text-right">
                {Math.round(g.rate * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
