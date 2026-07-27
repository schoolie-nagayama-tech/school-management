'use client';

/**
 * 面談ワークスペース 右カラム: データ参照
 * ------------------------------------------------------------------
 * 成績サマリ（直近3件の定期テスト）・進行表サマリ（使用中テキストの進捗）・基本情報
 * の3枚のカードを表示する。面談中に他画面へ移動せずその場で参照できるようにするための集約。
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Badge, InlineLoading } from '@/components/ui';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import type { AssessmentWithScores, Student } from '@/types/database';
import type { ScheduleRegularPattern } from '@/types/schedule';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';
import {
  computeScoreSummary,
  formatKoushuEnrollments,
  formatRegularPatternsSchedule,
  fmtDateJa,
  type TextbookProgressSummary,
} from './interview.shared';
import {
  AlertCircle,
  BookOpen,
  ClipboardList,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

interface StudentDataPanelProps {
  student: Student;
  assessments: AssessmentWithScores[];
  assessmentsLoading: boolean;
  textbookSummaries: TextbookProgressSummary[];
  textbookCount: number;
  progressLoading: boolean;
  regularPatterns: ScheduleRegularPattern[];
  koushuEnrollments: KoushuEnrollment[];
  lightLoading: boolean;
}

// 成績セルの前回比インジケーター（▲▼、変化なしは横棒）
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

// 合計点推移の簡易棒グラフ（divの高さで表現。rechartsは使わない）
function SimpleBarChart({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-3 px-1 pt-2">
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-xs font-semibold text-text-heading">{v > 0 ? v : '—'}</span>
          <div className="flex h-16 w-full items-end rounded-sm bg-surface-hover">
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

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border-subtle py-2 last:border-0">
      <span className="shrink-0 text-xs text-text-muted">{label}</span>
      <span className="text-right text-sm text-text-body">{value}</span>
    </div>
  );
}

export function StudentDataPanel({
  student,
  assessments,
  assessmentsLoading,
  textbookSummaries,
  textbookCount,
  progressLoading,
  regularPatterns,
  koushuEnrollments,
  lightLoading,
}: StudentDataPanelProps) {
  const scoreSummary = computeScoreSummary(assessments);
  const hasScores = scoreSummary.testLabels.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* 成績サマリ */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
          <TrendingUp className="h-4 w-4 text-text-muted" />
          <CardTitle className="text-sm">成績サマリ</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {assessmentsLoading ? (
            <InlineLoading />
          ) : !hasScores ? (
            <p className="text-sm text-text-muted">成績の登録がありません</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-left text-text-muted">
                      <th className="pb-1.5 pr-2 font-medium">教科</th>
                      {scoreSummary.testLabels.map((name, i) => (
                        <th key={`${name}-${i}`} className="px-1 pb-1.5 text-right font-medium">
                          <span className="block text-[10px] leading-tight">{name}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scoreSummary.rows.map((row) => (
                      <tr key={row.subject} className="border-b border-border-subtle last:border-0">
                        <td className="py-1.5 pr-2 text-text-body">{row.label}</td>
                        {row.values.map((s, i) => (
                          <td key={i} className="px-1 py-1.5 text-right">
                            <ScoreTrend prev={row.values[i - 1] ?? null} curr={s} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mb-1 mt-3 text-xs text-text-muted">合計点の推移</p>
              <SimpleBarChart values={scoreSummary.totals} labels={scoreSummary.testLabels} />
            </>
          )}
        </CardContent>
      </Card>

      {/* 進行表サマリ */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
          <BookOpen className="h-4 w-4 text-text-muted" />
          <CardTitle className="text-sm">進行表サマリ</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {progressLoading ? (
            <InlineLoading label="進行表を読み込み中…" />
          ) : textbookSummaries.length === 0 ? (
            <p className="text-sm text-text-muted">進行表で管理中のテキストはありません</p>
          ) : (
            <div className="flex flex-col gap-3">
              {textbookSummaries.map((tb) => (
                <div key={tb.id}>
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="flex-1 truncate text-sm font-medium text-text-body">
                      {tb.name}
                    </span>
                    {tb.subject && (
                      <Badge variant="secondary" className="shrink-0">
                        {tb.subject}
                      </Badge>
                    )}
                    {tb.stalled && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-danger-subtle px-1.5 py-0.5 text-[10px] font-medium text-danger">
                        <AlertCircle className="h-3 w-3" />
                        停滞
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover">
                      <div
                        className="h-full rounded-full bg-ink"
                        style={{ width: `${tb.progressPct}%` }}
                      />
                    </div>
                    <span className="w-9 shrink-0 text-right text-xs text-text-muted">
                      {tb.progressPct}%
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-text-faint">
                    最終記入: {tb.lastDate ? fmtDateJa(tb.lastDate) : '記入なし'}
                  </p>
                </div>
              ))}
            </div>
          )}
          <Link
            href={`/students/${student.id}/progress`}
            target="_blank"
            className="mt-3 inline-block text-xs text-text-muted hover:text-primary"
          >
            進行表を開く →
          </Link>
        </CardContent>
      </Card>

      {/* 基本情報 */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
          <ClipboardList className="h-4 w-4 text-text-muted" />
          <CardTitle className="text-sm">基本情報</CardTitle>
        </CardHeader>
        <CardContent className="pt-1">
          <InfoRow label="学年" value={formatGradeLabel(student.grade)} />
          <InfoRow label="学校" value={student.school_name || '未登録'} />
          <InfoRow
            label="通塾"
            value={lightLoading ? '…' : formatRegularPatternsSchedule(regularPatterns)}
          />
          <InfoRow
            label="講習申込"
            value={lightLoading ? '…' : formatKoushuEnrollments(koushuEnrollments)}
          />
          <InfoRow label="所持教材数" value={`${textbookCount}冊`} />
        </CardContent>
      </Card>
    </div>
  );
}
