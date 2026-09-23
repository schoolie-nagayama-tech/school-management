'use client';

/**
 * 面談ワークスペース: 成績パネル
 * ------------------------------------------------------------------
 * 定期テスト／内申／模試を縦に並べ、それぞれ直近5件の科目別スコア表＋科目別の推移グラフを出す。
 *
 * 旧実装はカテゴリ切替タブだったが、面談では3種を見比べる（テストは上がったが内申は動かない等）
 * ことが多く、切り替えると比較できないため並べる形に変更した。データが1件も無いカテゴリは
 * 見出しごと出さない（空の枠を並べても場所を取るだけのため）。
 *
 * ★グラフは「合計点の0起点の棒」から「科目ごとの折れ線」に変えた（2026-09）。
 *   0起点の棒だと +15点が誤差にしか見えず、面談で伸びを伝えられなかったため。
 *   - 縦軸はデータの範囲に絞る（下の buildChartScale）。絞った旨は必ず注記に出す
 *   - 合計は科目とスケールが違うので線に混ぜない。表の「合計」行と「前回比」列で見せる
 *   - rechartsは入れない（ページの初期表示を重くしないため）。インラインSVGで描く
 *
 * 正典: docs/interview-workspace-layout-2026-09.md
 */

import { Card, CardContent, CardHeader, CardTitle, InlineLoading } from '@/components/ui';
import type { AssessmentWithScores } from '@/types/database';
import {
  computeScoreSummary,
  type AssessmentCategory,
  type ScoreSummary,
} from './interview.shared';
import { TrendingUp } from 'lucide-react';

interface ScorePanelProps {
  assessments: AssessmentWithScores[];
  loading: boolean;
}

const CATEGORIES: { value: AssessmentCategory; label: string }[] = [
  { value: 'regular_test', label: '定期テスト' },
  { value: 'report_card', label: '内申' },
  { value: 'mock', label: '模試' },
];

/**
 * 線の色。★既存の成績グラフ（src/components/scores/ScoreChart.tsx）と同じ割り当てにしてある。
 *   同じ生徒の同じ科目が画面によって違う色になると、面談中に読み違える。
 *   テーマトークンに系列色は無いので、ここは既存の慣習に合わせて直値で持つ。
 */
const SUBJECT_LINE_COLORS: Record<string, string> = {
  english: '#ef4444',
  math: '#3b82f6',
  japanese: '#22c55e',
  science: '#a855f7',
  social: '#f97316',
  music: '#14b8a6',
  art: '#eab308',
  tech_home: '#8b5cf6',
  pe: '#0ea5e9',
};
/** 上の表に無い科目（将来増えたぶん）に回す色。落とさず描くための受け皿 */
const FALLBACK_LINE_COLORS = ['#64748b', '#d946ef', '#84cc16', '#f43f5e'];

/**
 * 線に載せない科目。
 * ★換算内申（conv_5 / conv_4）は科目ではなく合計値で、1〜5の評定と桁が違う。
 *   同じ縦軸に載せると評定の差が潰れるため、表にだけ出す。
 */
const AGGREGATE_SUBJECTS = new Set(['conv_5', 'conv_4']);

/** カテゴリごとの上限。縦軸がデータの外へはみ出さないようにする（内申は1科目5段階） */
const CATEGORY_MAX: Record<AssessmentCategory, number> = {
  regular_test: 100,
  report_card: 5,
  mock: 100,
};

interface ChartScale {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * 縦軸の範囲を決める。データの最小−余白 〜 最大＋余白を、きりの良い刻みに丸める。
 * ★刻みは範囲で変える。点数（0〜100）は10刻みだが、内申の1〜5に10刻みを当てると
 *   軸が0〜10になって評定の差が消える。
 */
export function buildChartScale(values: number[], categoryMax: number): ChartScale | null {
  if (values.length === 0) return null;
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const step = rawMax - rawMin > 10 ? 10 : 1;
  const pad = step === 10 ? 5 : 1;
  let min = Math.max(0, Math.floor((rawMin - pad) / step) * step);
  let max = Math.min(categoryMax, Math.ceil((rawMax + pad) / step) * step);
  if (max <= min) {
    // 全部同じ値のとき等。1刻みぶんだけ幅を作って線が描けるようにする
    min = Math.max(0, min - step);
    max = Math.min(categoryMax, min + step);
    if (max <= min) max = min + step;
  }

  // 目盛りは4〜5本。割り切れる分割数を優先する（0.3 のような半端な目盛りを出さない）
  const span = max - min;
  const divisions = [4, 5, 3, 2].find((n) => span % n === 0) ?? 4;
  const ticks = Array.from({ length: divisions + 1 }, (_, i) => min + (span / divisions) * i);
  return { min, max, ticks };
}

interface LineSeries {
  subject: string;
  label: string;
  color: string;
  values: (number | null)[];
}

/**
 * 科目別の推移グラフ（インラインSVG）。
 * viewBox で描き、幅はカードに合わせて伸縮する。高さは200px固定。
 */
function ScoreLineChart({
  series,
  labels,
  scale,
}: {
  series: LineSeries[];
  labels: string[];
  scale: ChartScale;
}) {
  const W = 600;
  const H = 200;
  const padL = 46;
  const padR = 12;
  const padT = 12;
  const padB = 34;

  const x = (i: number) =>
    labels.length === 1
      ? (padL + (W - padR)) / 2
      : padL + ((W - padR - padL) * i) / (labels.length - 1);
  const y = (v: number) =>
    padT + (H - padT - padB) * (1 - (v - scale.min) / (scale.max - scale.min));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label="科目別の成績推移"
      className="mt-2"
    >
      {/* 目盛り線とその値 */}
      {scale.ticks.map((t) => (
        <g key={t}>
          <line
            x1={padL}
            y1={y(t)}
            x2={W - padR}
            y2={y(t)}
            stroke="var(--border-subtle)"
            strokeWidth={1}
          />
          <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--text-faint)">
            {Number.isInteger(t) ? t : t.toFixed(1)}
          </text>
        </g>
      ))}

      {/* 横軸のテスト名 */}
      {labels.map((label, i) => (
        <text
          key={`${label}-${i}`}
          x={x(i)}
          y={H - 12}
          textAnchor="middle"
          fontSize={10}
          fill="var(--text-faint)"
        >
          {label}
        </text>
      ))}

      {/* 科目ごとの線とドット。★欠測（null）は線を切る。0として描くと急落に見える */}
      {series.map((s) => {
        const points = s.values
          .map((v, i) => (v == null ? null : { x: x(i), y: y(v) }))
          .filter((p): p is { x: number; y: number } => p !== null);
        return (
          <g key={s.subject}>
            {points.length > 1 && (
              <polyline
                points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={2.8} fill={s.color} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** 前回比。＋は緑・−は赤。前回が無い／今回が無いときは「—」 */
function DiffCell({ values }: { values: (number | null)[] }) {
  const curr = values[values.length - 1] ?? null;
  const prev = values[values.length - 2] ?? null;
  if (curr == null || prev == null) return <span className="text-text-faint">—</span>;
  const diff = curr - prev;
  if (diff === 0) return <span className="text-text-faint">±0</span>;
  return (
    <span className={diff > 0 ? 'font-semibold text-success' : 'font-semibold text-danger'}>
      {diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`}
    </span>
  );
}

/** 1カテゴリ分の中身（スコア表＋推移グラフ）。3カテゴリを並べるため切り出した。 */
function CategorySection({
  label,
  assessments,
  category,
}: {
  label: string;
  assessments: AssessmentWithScores[];
  category: AssessmentCategory;
}) {
  // 直近5件・古い→新しい順（左から右へ推移が読めるように）
  const summary: ScoreSummary = computeScoreSummary(assessments, category, 5);
  if (summary.testLabels.length === 0) return null;

  let fallbackIndex = 0;
  const series: LineSeries[] = summary.rows
    .filter((row) => !AGGREGATE_SUBJECTS.has(row.subject))
    .filter((row) => row.values.some((v) => v != null))
    .map((row) => {
      const color =
        SUBJECT_LINE_COLORS[row.subject] ??
        FALLBACK_LINE_COLORS[fallbackIndex++ % FALLBACK_LINE_COLORS.length];
      return { subject: row.subject, label: row.label, color, values: row.values };
    });

  const scale = buildChartScale(
    series.flatMap((s) => s.values.filter((v): v is number => v != null)),
    CATEGORY_MAX[category]
  );

  return (
    <section>
      <h3 className="mb-1.5 border-b border-border-subtle pb-1 text-xs font-semibold text-text-heading">
        {label}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-left text-text-muted">
              <th className="pb-1.5 pr-2 font-medium">教科</th>
              {summary.testLabels.map((name, i) => (
                <th key={`${name}-${i}`} className="px-1.5 pb-1.5 text-right font-medium">
                  <span className="block text-xs leading-tight">{name}</span>
                </th>
              ))}
              <th className="pb-1.5 pl-1.5 text-right font-medium">
                <span className="block text-xs leading-tight">前回比</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr key={row.subject} className="border-b border-border-subtle">
                <td className="py-1.5 pr-2 text-text-body">{row.label}</td>
                {row.values.map((s, i) => (
                  <td
                    key={i}
                    className="px-1.5 py-1.5 text-right font-semibold text-text-heading tabular-nums"
                  >
                    {s ?? <span className="font-normal text-text-faint">—</span>}
                  </td>
                ))}
                <td className="py-1.5 pl-1.5 text-right tabular-nums">
                  <DiffCell values={row.values} />
                </td>
              </tr>
            ))}
            {/* 合計は線に混ぜず、ここで見せる（科目とスケールが違うため） */}
            <tr>
              <td className="py-1.5 pr-2 font-bold text-text-heading">合計</td>
              {summary.totals.map((t, i) => (
                <td
                  key={i}
                  className="px-1.5 py-1.5 text-right font-bold text-text-heading tabular-nums"
                >
                  {t}
                </td>
              ))}
              <td className="py-1.5 pl-1.5 text-right tabular-nums">
                <DiffCell values={summary.totals} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {scale && series.length > 0 && (
        <>
          <ScoreLineChart series={series} labels={summary.testLabels} scale={scale} />
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
            {series.map((s) => (
              <span key={s.subject} className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-0.5 w-3.5"
                  style={{ backgroundColor: s.color }}
                  aria-hidden="true"
                />
                {s.label}
              </span>
            ))}
          </div>
          {/* ★縦軸を絞っている旨は必ず出す。書かないと伸び幅を実際より大きく読み違える */}
          <p className="mt-1 text-[11px] text-text-faint">
            縦軸は {scale.min}〜{scale.max} に絞って表示（差が見えるように）
          </p>
        </>
      )}
    </section>
  );
}

export function ScorePanel({ assessments, loading }: ScorePanelProps) {
  // 1件でも登録があるカテゴリだけを並べる
  const shown = CATEGORIES.filter((c) => assessments.some((a) => a.category === c.value));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
        <TrendingUp className="h-4 w-4 text-text-muted" />
        <CardTitle className="text-sm">成績</CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        {loading ? (
          <InlineLoading />
        ) : shown.length === 0 ? (
          <p className="text-sm text-text-muted">登録がありません</p>
        ) : (
          <div className="flex flex-col gap-5">
            {shown.map((c) => (
              <CategorySection
                key={c.value}
                label={c.label}
                assessments={assessments}
                category={c.value}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
