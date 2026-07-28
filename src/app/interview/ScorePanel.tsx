'use client';

/**
 * 面談ワークスペース 右カラム: 成績パネル
 * ------------------------------------------------------------------
 * 定期テスト／内申／模試のカテゴリ切替タブ＋直近5件の科目別スコア表＋合計点推移の棒グラフ。
 * 「今回の面談メモ」廃止で空いた中央カラムのスペースを使い、面談中にその場で成績を
 * 参照できるようにするためのパネル（3カラム時代は右端に小さな成績サマリしか無かった）。
 */

import { useState } from 'react';
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

export function ScorePanel({ assessments, loading }: ScorePanelProps) {
  // 既定は定期テスト。データが無いカテゴリも選択自体はできるが（初期表示のため）、
  // タブはグレーアウトして押せないようにする。
  const [category, setCategory] = useState<AssessmentCategory>('regular_test');

  const hasData: Record<AssessmentCategory, boolean> = {
    regular_test: assessments.some((a) => a.category === 'regular_test'),
    report_card: assessments.some((a) => a.category === 'report_card'),
    mock: assessments.some((a) => a.category === 'mock'),
  };

  // 直近5件・古い→新しい順（左から右へ推移が読めるように）
  const summary = computeScoreSummary(assessments, category, 5);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
        <TrendingUp className="h-4 w-4 text-text-muted" />
        <CardTitle className="text-sm">成績</CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        {/* カテゴリ切替タブ */}
        <div className="mb-3 inline-flex rounded-lg border border-border-subtle p-1">
          {CATEGORIES.map((c) => {
            const active = category === c.value;
            const disabled = !hasData[c.value];
            return (
              <button
                key={c.value}
                type="button"
                disabled={disabled}
                onClick={() => setCategory(c.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-ink text-text-on-primary'
                    : disabled
                      ? 'cursor-not-allowed text-text-faint'
                      : 'text-text-muted hover:text-text-heading'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <InlineLoading />
        ) : summary.testLabels.length === 0 ? (
          <p className="text-sm text-text-muted">登録がありません</p>
        ) : (
          <>
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

            <p className="mb-1 mt-4 text-xs text-text-muted">合計点の推移</p>
            <SimpleBarChart values={summary.totals} labels={summary.testLabels} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
