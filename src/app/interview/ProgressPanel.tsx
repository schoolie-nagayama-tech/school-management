'use client';

/**
 * 面談ワークスペース 右カラム: 進行表パネル（詳細）
 * ------------------------------------------------------------------
 * 「今回の面談メモ」廃止に伴い、その場で進行表を深掘りできるよう
 * 進捗バーだけだった旧・進行表サマリを拡張したもの。テキストごとに
 * 目標（試験目標）と行動（行動目標）・直近の単元履歴（引継ぎ付き）・次にやる単元・
 * 宿題未実施/遅刻の件数を出す。
 *
 * 進捗バー（done/total の％）は廃止した。面談で話すのは「どこまで進んだか」より
 * 「何点を目指して何をするか」であり、％はテキストごとの母数が違って比較もできないため。
 * 代わりに同じ場所へ目標・行動目標を出す。
 *
 * テキストのカードは教科ごとに色を変える（枠線とバッジ）。全部同系色だと、
 * 複数教材が縦に並んだときにどこが切れ目か目で追えないため。
 *
 * 集計は interview.shared.ts の summarizeTextbookDetail に寄せている
 * （印刷シートも同じ関数を使うため、画面と印刷で数字がずれないようにするため）。
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, InlineLoading } from '@/components/ui';
import type { CurriculumItemWithProgress, StudentTextbookWithDetails } from '@/types/database';
import type { FeedGoalSummary } from '@/lib/api/progress-sessions';
import { summarizeTextbookDetail, fmtDateJa } from './interview.shared';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Circle,
  ClipboardX,
  Clock3,
  Quote,
  Target,
} from 'lucide-react';

/** 進行表パネル・印刷シートで共有する「テキスト×生データ」の1組 */
export interface TextbookProgressData {
  textbook: StudentTextbookWithDetails;
  rows: CurriculumItemWithProgress[];
}

/**
 * 教科ごとのカード色。既存の教材カタログ・提案書と同じ割り当て（英語=青／数学・算数=赤／
 * 国語=緑／理科=橙／社会=紫）に揃えているので、他画面と見た目の意味が一致する。
 */
const SUBJECT_CARD_COLORS: Record<string, { border: string; badge: string }> = {
  英語: { border: 'border-l-blue-400', badge: 'bg-blue-50 text-blue-700' },
  数学: { border: 'border-l-red-400', badge: 'bg-red-50 text-red-700' },
  算数: { border: 'border-l-red-400', badge: 'bg-red-50 text-red-700' },
  国語: { border: 'border-l-green-400', badge: 'bg-green-50 text-green-700' },
  理科: { border: 'border-l-amber-400', badge: 'bg-amber-50 text-amber-700' },
  社会: { border: 'border-l-purple-400', badge: 'bg-purple-50 text-purple-700' },
};
const DEFAULT_CARD_COLOR = { border: 'border-l-gray-300', badge: 'bg-gray-100 text-gray-600' };

interface ProgressPanelProps {
  textbookData: TextbookProgressData[];
  /** student_textbook_id → 目標（試験目標）と行動目標。未取得なら空オブジェクトで良い */
  goals: Record<string, FeedGoalSummary>;
  loading: boolean;
}

export function ProgressPanel({ textbookData, goals, loading }: ProgressPanelProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
        <BookOpen className="h-4 w-4 text-text-muted" />
        <CardTitle className="text-sm">進行表</CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        {loading ? (
          <InlineLoading label="進行表を読み込み中…" />
        ) : textbookData.length === 0 ? (
          <p className="text-sm text-text-muted">進行表で管理中のテキストはありません</p>
        ) : (
          <div className="flex flex-col gap-4">
            {textbookData.map(({ textbook, rows }) => {
              const detail = summarizeTextbookDetail(textbook, rows);
              const color = detail.subject
                ? (SUBJECT_CARD_COLORS[detail.subject] ?? DEFAULT_CARD_COLOR)
                : DEFAULT_CARD_COLOR;
              const goal = goals[detail.id];
              return (
                <div
                  key={detail.id}
                  className={`rounded-lg border border-border-subtle border-l-4 p-3 ${color.border}`}
                >
                  {/* ヘッダー行: テキスト名・教科バッジ・停滞バッジ・最終記入日 */}
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-text-heading">{detail.name}</span>
                    {detail.subject && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${color.badge}`}
                      >
                        {detail.subject}
                      </span>
                    )}
                    {detail.stalled && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-danger-subtle px-1.5 py-0.5 text-[10px] font-medium text-danger">
                        <AlertCircle className="h-3 w-3" />
                        停滞
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-xs text-text-faint">
                      最終記入: {detail.lastDate ? fmtDateJa(detail.lastDate) : '記入なし'}
                    </span>
                  </div>

                  {/* 目標（試験目標）と行動（行動目標）。進捗バーを廃止してこの位置に置いた */}
                  <div className="mb-2 rounded-md bg-surface-hover px-2.5 py-2">
                    {goal?.exam ? (
                      <>
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                          <span className="inline-flex items-center gap-1 font-medium text-text-muted">
                            <Target className="h-3 w-3" />
                            目標
                          </span>
                          <span className="font-semibold text-text-heading">{goal.exam.label}</span>
                          {goal.exam.examDate && (
                            <span className="text-text-faint">{fmtDateJa(goal.exam.examDate)}</span>
                          )}
                          {goal.exam.targetScore != null && (
                            <span className="font-semibold text-info">
                              {goal.exam.targetScore}点
                            </span>
                          )}
                        </div>
                        {goal.actionGoals.length > 0 ? (
                          <ul className="mt-1.5 flex flex-col gap-1">
                            {goal.actionGoals.map((g) => (
                              <li key={g.id} className="flex items-start gap-1.5 text-xs">
                                {g.achieved ? (
                                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                                ) : (
                                  <Circle className="mt-0.5 h-3 w-3 shrink-0 text-text-faint" />
                                )}
                                <span
                                  className={
                                    g.achieved ? 'text-text-faint line-through' : 'text-text-body'
                                  }
                                >
                                  {g.title}
                                  {g.counterTarget != null && (
                                    <span className="ml-1 text-text-faint">
                                      （{g.counterCurrent ?? 0}/{g.counterTarget}）
                                    </span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-xs text-text-faint">行動目標は未設定</p>
                        )}
                      </>
                    ) : (
                      // 目標未設定は面談で決めるべき事項なので、空欄にせず明示する
                      <p className="inline-flex items-center gap-1 text-xs text-text-faint">
                        <Target className="h-3 w-3" />
                        目標未設定
                      </p>
                    )}
                  </div>

                  {/* 直近の単元履歴（最大5件・新しい順）。引継ぎがあれば引用ブロックで表示 */}
                  {detail.recentLessons.length > 0 && (
                    <div className="mb-2">
                      <p className="mb-1 text-xs font-medium text-text-muted">直近の単元履歴</p>
                      <ul className="flex flex-col gap-1.5">
                        {detail.recentLessons.map((l, i) => (
                          <li key={i} className="text-xs text-text-body">
                            <span className="text-text-faint">{fmtDateJa(l.lessonDate)}</span>{' '}
                            <span className="font-medium">{l.unitTitle}</span>
                            {l.teacherName && (
                              <span className="text-text-faint">（{l.teacherName}）</span>
                            )}
                            {l.handover && (
                              <div className="mt-1 flex gap-1 rounded-md bg-surface-hover px-2 py-1.5 text-[11px] leading-relaxed text-text-body">
                                <Quote className="mt-0.5 h-3 w-3 shrink-0 text-text-faint" />
                                <span className="whitespace-pre-wrap">{l.handover}</span>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 次にやる単元（未実施の先頭1〜2件） */}
                  {detail.nextUnitTitles.length > 0 && (
                    <p className="mb-2 text-xs text-text-body">
                      <span className="font-medium text-text-muted">次にやる単元: </span>
                      {detail.nextUnitTitles.join('、')}
                    </p>
                  )}

                  {/* 宿題未実施・遅刻の集計。0件なら何も出さない（未入力運用が多いため「0回」を並べない） */}
                  {(detail.homeworkNotDoneCount > 0 || detail.tardyCount > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                      {detail.homeworkNotDoneCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning-subtle px-2 py-0.5 text-[10px] font-medium text-warning">
                          <ClipboardX className="h-3 w-3" />
                          宿題未実施 {detail.homeworkNotDoneCount}回
                        </span>
                      )}
                      {detail.tardyCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning-subtle px-2 py-0.5 text-[10px] font-medium text-warning">
                          <Clock3 className="h-3 w-3" />
                          遅刻 {detail.tardyCount}回
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {textbookData.length > 0 && (
          <Link
            href={`/students/${textbookData[0].textbook.student_id}/progress`}
            target="_blank"
            className="mt-3 inline-block text-xs text-text-muted hover:text-primary"
          >
            進行表を開く →
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
