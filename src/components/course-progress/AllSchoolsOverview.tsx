'use client';

import { useMemo, type CSSProperties } from 'react';
import { ChevronRight, AlertTriangle, RefreshCw, Trophy } from 'lucide-react';
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
  // バックグラウンド更新（リロード不要の数値更新）
  refreshing?: boolean;
  updatedAt?: Date | null;
  onRefresh?: () => void;
}

// 取得コマ（このページの主役指標）の色
const ACQUIRED_COLOR = '#3b82f6';

// 最終更新時刻の HH:MM 表示
function formatUpdatedAt(d: Date): string {
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 目標達成度に応じた色。70%以上=緑 / 40%以上=アンバー / 未満=赤。
function rateColor(rate: number): string {
  if (rate >= 0.7) return '#10b981';
  if (rate >= 0.4) return '#f59e0b';
  return '#ef4444';
}

// 目標進捗バー（主役）。背を高くし、25/50/75 の目盛りを入れて達成度を読み取りやすくする。
// achieved=true（目標到達）のときは gold→emerald のグラデ＋きらめきで達成感を出す。
function TargetBar({
  pct,
  color,
  achieved = false,
}: {
  pct: number;
  color: string;
  achieved?: boolean;
}) {
  return (
    <div
      className={`relative w-full bg-gray-100 rounded-full h-3.5 overflow-hidden ${
        achieved ? 'achieve-bar-shine' : ''
      }`}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{
          width: `${Math.min(Math.max(pct, 0), 100)}%`,
          backgroundColor: color,
          ...(achieved
            ? { backgroundImage: 'linear-gradient(90deg, #10b981 0%, #f59e0b 100%)' }
            : {}),
        }}
      />
      {/* 25/50/75% の目盛り（塗り・地の両方の上に薄く重ねる） */}
      {[25, 50, 75].map((t) => (
        <div
          key={t}
          className="absolute top-0 bottom-0 w-px bg-white/60"
          style={{ left: `${t}%` }}
        />
      ))}
    </div>
  );
}

// 目標達成バッジ（トロフィー）。登場ポップ＋アイコンの小刻みな弾み。
function AchieveBadge() {
  return (
    <span className="achieve-badge inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-amber-700 bg-gradient-to-r from-amber-100 to-emerald-100 border border-amber-300 shrink-0 whitespace-nowrap">
      <Trophy className="achieve-icon w-3 h-3 text-amber-500" />
      目標達成
    </span>
  );
}

// 申込バー（サブ指標）。細めにして主役の目標バーと差をつける。
function ThinBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5">
      <div
        className="h-1.5 rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, backgroundColor: color }}
      />
    </div>
  );
}

export function AllSchoolsOverview({
  rows,
  loading,
  onSelectSchool,
  refreshing = false,
  updatedAt = null,
  onRefresh,
}: AllSchoolsOverviewProps) {
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
          <div key={i} className="h-52 rounded-xl bg-gray-50 animate-pulse" />
        ))}
      </div>
    );
  }

  const totalsHasTarget = totals.totalTarget > 0;
  const totalsTargetPct = Math.round(totals.targetRate * 100);
  const totalsTargetColor = totalsHasTarget ? rateColor(totals.targetRate) : '#d1d5db';
  // 全校で目標到達なら祝祭演出
  const totalsAchieved = totalsHasTarget && totals.totalDecided >= totals.totalTarget;

  return (
    <div className="mb-6 space-y-4">
      {/* 更新ツールバー: 最終更新時刻＋手動更新ボタン（リロード不要で数値を取り直す） */}
      {onRefresh && (
        <div className="flex items-center justify-end gap-3">
          {updatedAt && (
            <span className="text-[11px] text-gray-400">最終更新 {formatUpdatedAt(updatedAt)}</span>
          )}
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            更新
          </button>
        </div>
      )}

      {/* 全校合計: 主役＝取得コマ／目標進捗。提案コマ・取得率はサブ行に落とす。 */}
      <div
        className={`rounded-xl border p-4 ${
          totalsAchieved
            ? 'achieve-card border-amber-300 bg-gradient-to-br from-amber-50 via-white to-emerald-50'
            : 'bg-white border-gray-200'
        }`}
      >
        <div className="flex items-center justify-between mb-3 gap-2">
          <span className="text-xs font-medium text-gray-600">全校合計</span>
          <div className="flex items-center gap-2 shrink-0">
            {totalsAchieved && <AchieveBadge />}
            <span className="text-[11px] text-gray-400">{rows.length}教室</span>
          </div>
        </div>

        {/* ヒーロー: 取得コマ（大）＋ 目標進捗率（大） */}
        <div className="flex items-end justify-between gap-4 mb-2">
          <div>
            <div className="text-[11px] text-gray-400">取得コマ</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold" style={{ color: ACQUIRED_COLOR }}>
                {totals.totalDecided}
              </span>
              <span className="text-sm text-gray-400">
                / 目標 {totalsHasTarget ? totals.totalTarget : '–'} コマ
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-gray-400">目標進捗</div>
            <div className="text-3xl font-bold leading-none" style={{ color: totalsTargetColor }}>
              {totalsHasTarget ? `${totalsTargetPct}%` : '–'}
            </div>
          </div>
        </div>
        <TargetBar
          pct={totalsHasTarget ? totalsTargetPct : 0}
          color={totalsTargetColor}
          achieved={totalsAchieved}
        />

        {/* サブ指標: 在籍 / 提案コマ / 取得率（小さく1行に） */}
        <div className="mt-3 pt-2 border-t border-gray-100 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-gray-400">
          <span>
            在籍 <span className="text-gray-600 font-medium">{totals.studentCount}名</span>
          </span>
          <span>
            提案コマ <span className="text-gray-600 font-medium">{totals.totalProposed}</span>
          </span>
          <span>
            取得率{' '}
            <span className="font-medium" style={{ color: rateColor(totals.acquisitionRate) }}>
              {Math.round(totals.acquisitionRate * 100)}%
            </span>
          </span>
        </div>
      </div>

      {/* 教室別カード: stagger-item で順次フェードイン（最大8件でインデックスをクランプ） */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((row, idx) => {
          const k = row.kpis;
          const acqPct = Math.round(k.acquisitionRate * 100);
          // 目標進捗（取得 ÷ 目標）。目標未設定(0)はバーなし扱い。
          const hasTarget = k.targetKoma > 0;
          const targetRate = hasTarget ? k.totalDecided / k.targetKoma : 0;
          const targetPct = Math.round(targetRate * 100);
          const targetColor = hasTarget ? rateColor(targetRate) : '#d1d5db';
          // 目標到達なら祝祭演出
          const achieved = hasTarget && k.totalDecided >= k.targetKoma;
          // 申込（申込済 ÷ 在籍）
          const applyPct =
            k.studentCount > 0 ? Math.round((k.decidedStudentCount / k.studentCount) * 100) : 0;
          return (
            <button
              key={row.schoolId}
              onClick={() => onSelectSchool(row.schoolId)}
              className={`stagger-item group text-left rounded-xl border p-4 transition-[border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.99] ${
                achieved
                  ? 'achieve-card border-amber-300 bg-gradient-to-br from-amber-50 via-white to-emerald-50'
                  : 'bg-white border-gray-200 hover:border-[#1e3a5f]/40 hover:shadow-sm'
              }`}
              style={{ '--stagger-index': Math.min(idx, 7) } as CSSProperties}
            >
              <div className="flex items-center justify-between mb-3 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-bold text-[#1e3a5f] truncate">
                    {row.schoolName}
                  </span>
                  <span className="text-[11px] text-gray-400 shrink-0">{k.studentCount}名</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {achieved && <AchieveBadge />}
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-[#1e3a5f] transition-colors shrink-0" />
                </div>
              </div>

              {/* ヒーロー: 取得コマ（大）＋ 目標進捗率（大） */}
              <div className="flex items-end justify-between gap-2 mb-1.5">
                <div>
                  <div className="text-[10px] text-gray-400">取得コマ</div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold" style={{ color: ACQUIRED_COLOR }}>
                      {k.totalDecided}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      / 目標 {hasTarget ? k.targetKoma : '–'}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-gray-400">目標進捗</div>
                  <div className="text-2xl font-bold leading-none" style={{ color: targetColor }}>
                    {hasTarget ? `${targetPct}%` : '–'}
                  </div>
                </div>
              </div>
              <TargetBar pct={hasTarget ? targetPct : 0} color={targetColor} achieved={achieved} />

              {/* 申込バー（サブ） */}
              <div className="mt-2.5">
                <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                  <span>申込</span>
                  <span>
                    {k.decidedStudentCount} / {k.studentCount}名
                    <span className="ml-1 font-medium text-[#3b82f6]">{applyPct}%</span>
                  </span>
                </div>
                <ThinBar pct={applyPct} color="#93c5fd" />
              </div>

              {/* サブ指標: 取得率 / 提案 / 作成済 / 期日超過（小さく） */}
              <div className="mt-2.5 pt-2 border-t border-gray-100 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-400">
                <span>
                  取得率{' '}
                  <span className="font-medium" style={{ color: rateColor(k.acquisitionRate) }}>
                    {acqPct}%
                  </span>
                </span>
                <span>
                  提案 <span className="text-gray-600 font-medium">{k.totalProposed}</span>
                </span>
                <span>
                  作成済{' '}
                  <span className="text-gray-600 font-medium">
                    {k.proposedStudentCount}/{k.studentCount}
                  </span>
                </span>
                <span className="inline-flex items-center gap-0.5">
                  期日超過{' '}
                  {k.overdueCount > 0 && <AlertTriangle className="w-2.5 h-2.5 text-red-500" />}
                  <span
                    className={`font-medium ${k.overdueCount > 0 ? 'text-red-500' : 'text-gray-600'}`}
                  >
                    {k.overdueCount}件
                  </span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
