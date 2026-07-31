'use client';

/**
 * 面談ワークスペース 右カラム: 成績パネル
 * ------------------------------------------------------------------
 * 定期テスト／内申／模試を縦に並べ、それぞれ直近5件の科目別スコア表＋合計点推移の棒グラフを出す。
 * 「今回の面談メモ」廃止で空いた中央カラムのスペースを使い、面談中にその場で成績を
 * 参照できるようにするためのパネル（3カラム時代は右端に小さな成績サマリしか無かった）。
 *
 * 旧実装はカテゴリ切替タブだったが、面談では3種を見比べる（テストは上がったが内申は動かない等）
 * ことが多く、切り替えると比較できないため並べる形に変更した。データが1件も無いカテゴリは
 * 見出しごと出さない（空の枠を並べても場所を取るだけのため）。
 */

import { Card, CardContent, CardHeader, CardTitle, InlineLoading } from '@/components/ui';
import type { AssessmentWithScores } from '@/types/database';
import { computeScoreSummary, type AssessmentCategory } from './interview.shared';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

interface ScorePanelProps {
  assessments: AssessmentWithScores[];
  loading: boolean;
}

const CATEGORIES: { value: AssessmentCategory; label: string }[] = [
  { value: 'regular_test', label: '定期テスト' },
  { value: 'report_card', label: '内申' },
  { value: 'mock', label: '模試' },
];

// 成績セルの前回比インジケーター（▲▼、変化なしは横棒）。前回が無い列は数値のみ表示する。
function ScoreTrend({ prev, curr }: { prev: number | null; curr: number | null }) {
  if (curr == null) return <span className="text-text-faint">—</span>;
  if (prev == null) {
    return <span className="text-sm font-semibold text-text-heading">{curr}</span>;
  }
  const diff = curr - prev;
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-0.5">
        <span className="text-sm font-semibold text-text-heading">{curr}</span>
        <Minus className="h-3 w-3 text-text-faint" />
      </span>
    );
  }
  const up = diff > 0;
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="text-sm font-semibold text-text-heading">{curr}</span>
      {up ? (
        <TrendingUp className="h-3 w-3 text-success" />
      ) : (
        <TrendingDown className="h-3 w-3 text-danger" />
      )}
    </span>
  );
}

// 合計点推移の簡易棒グラフ（divの高さで表現。満点がカテゴリごとに違っても「合計」の推移を見せるだけなのでrechartsは使わない）
function SimpleBarChart({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-3 px-1 pt-2">
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-xs font-semibold text-text-heading">{v > 0 ? v : '—'}</span>
          <div className="flex h-20 w-full items-end rounded-sm bg-surface-hover">
            <div
              className="w-full rounded-sm bg-ink transition-all"
              style={{ height: v > 0 ? `${Math.max((v / max) * 100, 4)}%` : '0%' }}
            />
          </div>
          <span className="text-center text-[10px] leading-tight text-text-faint">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

// 1カテゴリ分の中身（スコア表＋合計推移）。3カテゴリを並べるため切り出した。
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
  const summary = computeScoreSummary(assessments, category, 5);
  if (summary.testLabels.length === 0) return null;

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
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr key={row.subject} className="border-b border-border-subtle last:border-0">
                <td className="py-1.5 pr-2 text-text-body">{row.label}</td>
                {row.values.map((s, i) => (
                  <td key={i} className="px-1.5 py-1.5 text-right">
                    <ScoreTrend prev={row.values[i - 1] ?? null} curr={s} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mb-1 mt-3 text-xs text-text-muted">合計点の推移</p>
      <SimpleBarChart values={summary.totals} labels={summary.testLabels} />
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
