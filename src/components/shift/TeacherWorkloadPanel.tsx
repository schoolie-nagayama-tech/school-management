'use client';

import { useMemo } from 'react';

/**
 * 講師別コマ数の全体分析パネル（通常シフト・講習シフト共通）。
 * 上位/下位の数名だけでなく、全講師のコマ数分布・一人当たり平均・最多/最少を
 * 一目で把握できるようにする運営判断用ビュー。
 */
export interface TeacherWorkloadItem {
  teacher_name: string;
  count: number;
}

export function TeacherWorkloadPanel({
  teachers,
  unitLabel = 'コマ',
}: {
  teachers: TeacherWorkloadItem[];
  /** コマ数の単位ラベル（既定「コマ」） */
  unitLabel?: string;
}) {
  const stats = useMemo(() => {
    const sorted = [...teachers].sort((a, b) => b.count - a.count);
    const counts = sorted.map((t) => t.count);
    const n = counts.length;
    const total = counts.reduce((a, b) => a + b, 0);
    const avg = n > 0 ? total / n : 0;
    const max = n > 0 ? Math.max(...counts) : 0;
    const min = n > 0 ? Math.min(...counts) : 0;
    // 中央値（外れ値に強い「真ん中」の目安。平均と並べて偏りを見る）
    const asc = [...counts].sort((a, b) => a - b);
    const median = n > 0
      ? (n % 2 === 1 ? asc[(n - 1) / 2] : (asc[n / 2 - 1] + asc[n / 2]) / 2)
      : 0;
    return { sorted, n, total, avg, max, min, median };
  }, [teachers]);

  if (stats.n === 0) return null;

  // 平均との比較で「多い/少ない」を色分け（一目で偏りが分かるように）
  const levelOf = (count: number): { bar: string; tag: '多' | '少' | null; tagColor: string } => {
    if (stats.avg <= 0) return { bar: 'bg-slate-300', tag: null, tagColor: '' };
    if (count >= stats.avg * 1.25) return { bar: 'bg-emerald-400', tag: '多', tagColor: 'text-emerald-600' };
    if (count <= stats.avg * 0.6) return { bar: 'bg-amber-400', tag: '少', tagColor: 'text-amber-600' };
    return { bar: 'bg-slate-300', tag: null, tagColor: '' };
  };

  // バー内に引く平均ラインの位置（最大値を 100% とした相対位置）
  const avgPct = stats.max > 0 ? (stats.avg / stats.max) * 100 : 0;

  return (
    <div className="mt-4 border border-slate-200 rounded-lg p-3 bg-white">
      <div className="font-medium text-slate-700 mb-3 text-sm">講師別コマ数（{stats.n}名）</div>

      {/* サマリー統計 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 mb-3">
        <span>合計 <b className="text-slate-800 tabular-nums">{stats.total}</b> {unitLabel}</span>
        <span>一人当たり平均 <b className="text-slate-800 tabular-nums">{stats.avg.toFixed(1)}</b> {unitLabel}</span>
        <span>中央値 <b className="text-slate-800 tabular-nums">{stats.median}</b></span>
        <span>最多 <b className="text-slate-800 tabular-nums">{stats.max}</b></span>
        <span>最少 <b className="text-slate-800 tabular-nums">{stats.min}</b></span>
      </div>

      {/* 講師別の分布（コマ数降順。多い順に並べ、平均ラインと多/少フラグで偏りを表示） */}
      <div className="max-h-64 overflow-y-auto pr-1 space-y-1">
        {stats.sorted.map((t, i) => {
          const pct = stats.max > 0 ? (t.count / stats.max) * 100 : 0;
          const { bar, tag, tagColor } = levelOf(t.count);
          return (
            <div key={`${t.teacher_name}-${i}`} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 truncate text-slate-700" title={t.teacher_name}>
                {t.teacher_name}
              </span>
              <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden relative">
                <div
                  className={`h-full ${bar} rounded`}
                  style={{ width: `${pct}%`, minWidth: t.count > 0 ? 4 : 0 }}
                />
                {avgPct > 0 && (
                  <div
                    className="absolute top-0 bottom-0 border-l border-dashed border-slate-400/70"
                    style={{ left: `${avgPct}%` }}
                    aria-hidden
                  />
                )}
              </div>
              <span className="w-7 shrink-0 text-right tabular-nums text-slate-700">{t.count}</span>
              <span className={`w-4 shrink-0 text-center text-[10px] ${tagColor}`}>{tag ?? ''}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 text-[10px] text-slate-400">
        破線＝一人当たり平均。<span className="text-emerald-600">多</span>＝平均の1.25倍以上 ／{' '}
        <span className="text-amber-600">少</span>＝平均の6割以下。
      </div>
    </div>
  );
}
