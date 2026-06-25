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

// 達成度に応じた色。70%以上=緑 / 40%以上=アンバー / 未満=赤。
function rateColor(rate: number): string {
  if (rate >= 0.7) return '#10b981';
  if (rate >= 0.4) return '#f59e0b';
  return '#ef4444';
}

// 申込バーの色（取得率の温度感とは別物なので固定のブルー）
const APPLY_BAR_COLOR = '#3b82f6';

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div
        className="h-2 rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%`, backgroundColor: color }}
      />
    </div>
  );
}

export function AllSchoolsOverview({ rows, loading, onSelectSchool }: AllSchoolsOverviewProps) {
  // 全校合計サマリー
  const totals = useMemo(() => {
    const studentCount = rows.reduce((a, r) => a + r.kpis.studentCount, 0);
    const totalProposed = rows.reduce((a, r) => a + r.kpis.totalProposed, 0);
    const totalDecided = rows.reduce((a, r) => a + r.kpis.totalDecided, 0);
    const totalTarget = rows.reduce((a, r) => a + r.kpis.targetKoma, 0);
    return {
      studentCount,
      totalProposed,
      totalDecided,
      totalTarget,
      // 取得率＝取得 ÷ 提案
      acquisitionRate: totalProposed > 0 ? totalDecided / totalProposed : 0,
      // 目標進捗＝取得 ÷ 目標
      targetRate: totalTarget > 0 ? totalDecided / totalTarget : 0,
    };
  }, [rows]);

  if (loading) {
    return (
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-48 rounded-xl bg-gray-50 animate-pulse" />
        ))}
      </div>
    );
  }

  const totalsTargetPct = Math.round(totals.targetRate * 100);

  return (
    <div className="mb-6 space-y-4">
      {/* 全校合計: 在籍 / 目標コマ / 取得コマ / 提案コマ / 取得率 ＋ 目標への取得バー */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-gray-600">全校合計</span>
          <span className="text-[11px] text-gray-400">{rows.length}教室</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          <div>
            <div className="text-[10px] text-gray-400">在籍</div>
            <div className="text-xl font-bold text-[#1e3a5f]">{totals.studentCount}名</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">目標コマ</div>
            <div className="text-xl font-bold text-[#1e3a5f]">
              {totals.totalTarget > 0 ? totals.totalTarget : '–'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">取得コマ</div>
            <div className="text-xl font-bold text-[#3b82f6]">{totals.totalDecided}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">提案コマ</div>
            <div className="text-xl font-bold text-[#1e3a5f]">{totals.totalProposed}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">取得率</div>
            <div className="text-xl font-bold" style={{ color: rateColor(totals.acquisitionRate) }}>
              {Math.round(totals.acquisitionRate * 100)}%
            </div>
          </div>
        </div>
        {/* 目標への取得コマ数の進捗バー */}
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-gray-400">目標進捗（取得 / 目標）</span>
            <span className="text-gray-600">
              取得 {totals.totalDecided} / 目標 {totals.totalTarget > 0 ? totals.totalTarget : '–'}{' '}
              コマ
              {totals.totalTarget > 0 && (
                <span className="ml-1 font-bold" style={{ color: rateColor(totals.targetRate) }}>
                  {totalsTargetPct}%
                </span>
              )}
            </span>
          </div>
          <ProgressBar value={totalsTargetPct} color={rateColor(totals.targetRate)} />
        </div>
      </div>

      {/* 教室別カード */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((row) => {
          const k = row.kpis;
          const acqPct = Math.round(k.acquisitionRate * 100);
          // 目標進捗（取得 ÷ 目標）。目標未設定(0)はバーなし扱い。
          const hasTarget = k.targetKoma > 0;
          const targetRate = hasTarget ? k.totalDecided / k.targetKoma : 0;
          const targetPct = Math.round(targetRate * 100);
          const targetColor = hasTarget ? rateColor(targetRate) : '#d1d5db';
          // 申込（申込済 ÷ 在籍）
          const applyPct =
            k.studentCount > 0 ? Math.round((k.decidedStudentCount / k.studentCount) * 100) : 0;
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

              {/* 目標への取得コマ数バー（メイン指標） */}
              <div className="mb-2.5">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-gray-400">目標進捗</span>
                  <span className="text-gray-600">
                    取得 {k.totalDecided} / 目標 {hasTarget ? k.targetKoma : '–'} コマ
                    {hasTarget && (
                      <span className="ml-1 font-bold" style={{ color: targetColor }}>
                        {targetPct}%
                      </span>
                    )}
                  </span>
                </div>
                <ProgressBar value={hasTarget ? targetPct : 0} color={targetColor} />
              </div>

              {/* 申込バー */}
              <div className="mb-3">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-gray-400">申込</span>
                  <span className="text-gray-600">
                    {k.decidedStudentCount} / {k.studentCount}名
                    <span className="ml-1 font-bold" style={{ color: APPLY_BAR_COLOR }}>
                      {applyPct}%
                    </span>
                  </span>
                </div>
                <ProgressBar value={applyPct} color={APPLY_BAR_COLOR} />
              </div>

              {/* 残りは数値だけ並べる */}
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">取得率</span>
                  <span className="font-medium" style={{ color: rateColor(k.acquisitionRate) }}>
                    {acqPct}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">提案コマ</span>
                  <span className="text-gray-700 font-medium">{k.totalProposed}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">作成済</span>
                  <span className="text-gray-700 font-medium">
                    {k.proposedStudentCount}/{k.studentCount}
                  </span>
                </div>
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
