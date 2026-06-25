'use client';

import { useMemo } from 'react';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import type { SchoolKpis } from '@/lib/coursePrepKpis';

export interface SchoolOverviewRow {
  schoolId: string;
  schoolName: string;
  kpis: SchoolKpis;
}

interface AllSchoolsOverviewProps {
  rows: SchoolOverviewRow[];
  loading: boolean;
  // カードクリックでその教室の詳細表に切り替える
  onSelectSchool: (schoolId: string) => void;
}

// 取得率に応じた色（達成度の温度感を出す）。70%以上=緑 / 40%以上=アンバー / 未満=赤。
function rateColor(rate: number): string {
  if (rate >= 0.7) return '#10b981';
  if (rate >= 0.4) return '#f59e0b';
  return '#ef4444';
}

export function AllSchoolsOverview({ rows, loading, onSelectSchool }: AllSchoolsOverviewProps) {
  // 全校合計サマリー
  const totals = useMemo(() => {
    const studentCount = rows.reduce((a, r) => a + r.kpis.studentCount, 0);
    const totalProposed = rows.reduce((a, r) => a + r.kpis.totalProposed, 0);
    const totalDecided = rows.reduce((a, r) => a + r.kpis.totalDecided, 0);
    const decidedStudentCount = rows.reduce((a, r) => a + r.kpis.decidedStudentCount, 0);
    const overdueCount = rows.reduce((a, r) => a + r.kpis.overdueCount, 0);
    return {
      studentCount,
      totalProposed,
      totalDecided,
      decidedStudentCount,
      overdueCount,
      acquisitionRate: totalProposed > 0 ? totalDecided / totalProposed : 0,
    };
  }, [rows]);

  if (loading) {
    return (
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-44 rounded-xl bg-gray-50 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="mb-6 space-y-4">
      {/* 全校合計 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-gray-600">全校合計</span>
          <span className="text-[11px] text-gray-400">{rows.length}教室</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div>
            <div className="text-[10px] text-gray-400">在籍</div>
            <div className="text-xl font-bold text-[#1e3a5f]">{totals.studentCount}名</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">提案コマ</div>
            <div className="text-xl font-bold text-[#1e3a5f]">{totals.totalProposed}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">取得コマ</div>
            <div className="text-xl font-bold text-[#3b82f6]">{totals.totalDecided}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">取得率</div>
            <div className="text-xl font-bold" style={{ color: rateColor(totals.acquisitionRate) }}>
              {Math.round(totals.acquisitionRate * 100)}%
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">期日超過</div>
            <div
              className={`text-xl font-bold ${totals.overdueCount > 0 ? 'text-red-500' : 'text-gray-300'}`}
            >
              {totals.overdueCount}件
            </div>
          </div>
        </div>
      </div>

      {/* 教室別カード */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((row) => {
          const k = row.kpis;
          const ratePct = Math.round(k.acquisitionRate * 100);
          const color = rateColor(k.acquisitionRate);
          return (
            <button
              key={row.schoolId}
              onClick={() => onSelectSchool(row.schoolId)}
              className="group text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-[#1e3a5f]/40 hover:shadow-sm transition-[border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.99]"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-bold text-[#1e3a5f] truncate">
                    {row.schoolName}
                  </span>
                  <span className="text-[11px] text-gray-400 shrink-0">{k.studentCount}名</span>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-[#1e3a5f] transition-colors shrink-0" />
              </div>

              {/* 取得率（メイン指標） */}
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-2xl font-bold" style={{ color }}>
                  {ratePct}%
                </span>
                <span className="text-xs text-gray-400">
                  取得 {k.totalDecided} / 提案 {k.totalProposed} コマ
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
                <div
                  className="h-2 rounded-full transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.min(ratePct, 100)}%`, backgroundColor: color }}
                />
              </div>

              {/* 内訳 */}
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">作成済</span>
                  <span className="text-gray-700 font-medium">
                    {k.proposedStudentCount}/{k.studentCount}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">申込済</span>
                  <span className="text-gray-700 font-medium">
                    {k.decidedStudentCount}/{k.studentCount}
                  </span>
                </div>
                {k.targetKoma > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">目標比</span>
                    <span className="text-gray-700 font-medium">
                      {Math.round((k.totalDecided / k.targetKoma) * 100)}%
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">期日超過</span>
                  <span
                    className={`font-medium flex items-center gap-0.5 ${k.overdueCount > 0 ? 'text-red-500' : 'text-gray-300'}`}
                  >
                    {k.overdueCount > 0 && <AlertTriangle className="w-3 h-3" />}
                    {k.overdueCount}件
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
