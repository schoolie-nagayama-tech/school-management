'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * 成績（保護者ポータル）のカテゴリ別推移グラフ — /mypage/grades のアコーディオン内で使う。
 *
 * ★ recharts を使わず自前のSVGで描く理由:
 *   recharts v3 の ResponsiveContainer は「アコーディオンで開いた瞬間に初めてマウントされる」
 *   文脈で内部の計測が復帰せずグラフが 8×8px に潰れる症状が出た（親は 240×幅 を持つのに
 *   描画されない。ローカル実機で再現）。用途は「5科目 × 最大数回」の折れ線だけなので、
 *   親幅を ResizeObserver で測って素のSVGを描く方が確実・軽量で、テーマ対応も完全にできる。
 *
 * ★ ライト/ダーク両テーマ対応:
 *   SVG要素の色は presentation属性ではなく inline style で当てる。style は CSS なので
 *   `var(--text-muted)` などのCSS変数が解決される（属性 fill="var(...)" は解決されない）。
 *   グリッド線・軸ラベルはテーマトークン、科目の線色だけは両テーマで見分けられる固定色。
 */

/** 科目別の固定色（スタッフ側 ScoreChart.tsx と共通。テーマに依らず科目を色で見分ける）。 */
const SUBJECTS: { code: keyof Omit<ChartDataPoint, 'label'>; label: string; color: string }[] = [
  { code: 'english', label: '英語', color: '#ef4444' },
  { code: 'math', label: '数学', color: '#3b82f6' },
  { code: 'japanese', label: '国語', color: '#22c55e' },
  { code: 'science', label: '理科', color: '#a855f7' },
  { code: 'social', label: '社会', color: '#f97316' },
];

/** 推移グラフ1点ぶんのデータ（テスト回・内申期など1回の成績に対応）。 */
export interface ChartDataPoint {
  label: string;
  english: number | null;
  math: number | null;
  japanese: number | null;
  science: number | null;
  social: number | null;
}

interface PortalScoreChartProps {
  data: ChartDataPoint[];
  category: 'regular_test' | 'report_card' | 'mock';
}

const HEIGHT = 220;
const PAD = { top: 10, right: 12, bottom: 30, left: 30 };

/** カテゴリごとのY軸の目盛り（下→上）。模試（偏差値）だけデータから算出する。 */
function yTicksFor(category: PortalScoreChartProps['category'], data: ChartDataPoint[]): number[] {
  if (category === 'report_card') return [1, 2, 3, 4, 5];
  if (category === 'regular_test') return [0, 25, 50, 75, 100];
  // 模試: 実データの min/max に合わせて 20〜80 の範囲で4分割の目盛りを作る。
  const values: number[] = [];
  data.forEach((d) => {
    SUBJECTS.forEach((s) => {
      const v = d[s.code];
      if (v != null && !Number.isNaN(v)) values.push(v);
    });
  });
  if (values.length === 0) return [25, 50, 75];
  const lo = Math.max(20, Math.floor((Math.min(...values) - 5) / 5) * 5);
  const hi = Math.min(80, Math.ceil((Math.max(...values) + 5) / 5) * 5);
  const step = (hi - lo) / 4;
  return [0, 1, 2, 3, 4].map((i) => Math.round(lo + step * i));
}

export function PortalScoreChart({ data, category }: PortalScoreChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ticks = useMemo(() => yTicksFor(category, data), [category, data]);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  // x座標: 点が1つなら中央、複数なら等間隔。
  const xAt = (i: number) =>
    data.length <= 1 ? PAD.left + plotW / 2 : PAD.left + (i / (data.length - 1)) * plotW;
  // y座標: 値→ピクセル（上が高得点）。
  const yAt = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  return (
    <div>
      <div ref={containerRef} className="w-full">
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label="成績の推移グラフ">
            {/* 横グリッド線＋Y軸ラベル */}
            {ticks.map((t) => {
              const y = yAt(t);
              return (
                <g key={t}>
                  <line
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={y}
                    y2={y}
                    style={{ stroke: 'var(--border-subtle)' }}
                    strokeWidth={1}
                  />
                  <text
                    x={PAD.left - 6}
                    y={y + 3}
                    textAnchor="end"
                    style={{ fill: 'var(--text-muted)', fontSize: 10 }}
                  >
                    {t}
                  </text>
                </g>
              );
            })}

            {/* X軸ラベル（テスト名） */}
            {data.map((d, i) => (
              <text
                key={`${d.label}-${i}`}
                x={xAt(i)}
                y={HEIGHT - PAD.bottom + 16}
                textAnchor="middle"
                style={{ fill: 'var(--text-muted)', fontSize: 10 }}
              >
                {d.label}
              </text>
            ))}

            {/* 科目ごとの折れ線＋点（値が無い回は飛ばして線をつなぐ＝connectNulls相当） */}
            {SUBJECTS.map((s) => {
              const pts = data
                .map((d, i) => ({ i, v: d[s.code] }))
                .filter((p): p is { i: number; v: number } => p.v != null);
              if (pts.length === 0) return null;
              const line = pts.map((p) => `${xAt(p.i)},${yAt(p.v)}`).join(' ');
              return (
                <g key={s.code}>
                  {pts.length > 1 && (
                    <polyline points={line} fill="none" stroke={s.color} strokeWidth={2} />
                  )}
                  {pts.map((p) => (
                    <circle key={p.i} cx={xAt(p.i)} cy={yAt(p.v)} r={2.75} fill={s.color} />
                  ))}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* 凡例（DOMなのでCSS変数がそのまま効く） */}
      <ul className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1">
        {SUBJECTS.map((s) => (
          <li key={s.code} className="flex items-center gap-1 text-[11px] text-text-muted">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
