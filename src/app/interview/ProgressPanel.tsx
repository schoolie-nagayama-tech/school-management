'use client';

/**
 * 面談ワークスペース 右カラム: 進行表パネル（詳細）
 * ------------------------------------------------------------------
 * 「今回の面談メモ」廃止に伴い、その場で進行表を深掘りできるよう
 * 進捗バーだけだった旧・進行表サマリを拡張したもの。テキストごとに
 * 直近の単元履歴（引継ぎ付き）・次にやる単元・宿題未実施/遅刻の件数を出す。
 *
 * 集計は interview.shared.ts の summarizeTextbookDetail に寄せている
 * （印刷シートも同じ関数を使うため、画面と印刷で数字がずれないようにするため）。
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Badge, InlineLoading } from '@/components/ui';
import type { CurriculumItemWithProgress, StudentTextbookWithDetails } from '@/types/database';
import { summarizeTextbookDetail, fmtDateJa } from './interview.shared';
import { AlertCircle, BookOpen, ClipboardX, Clock3, Quote } from 'lucide-react';

/** 進行表パネル・印刷シートで共有する「テキスト×生データ」の1組 */
export interface TextbookProgressData {
  textbook: StudentTextbookWithDetails;
  rows: CurriculumItemWithProgress[];
}

interface ProgressPanelProps {
  textbookData: TextbookProgressData[];
  loading: boolean;
}

export function ProgressPanel({ textbookData, loading }: ProgressPanelProps) {
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
              return (
                <div key={detail.id} className="rounded-lg border border-border-subtle p-3">
                  {/* ヘッダー行: テキスト名・教科バッジ・進捗バー・停滞バッジ・最終記入日 */}
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-text-heading">{detail.name}</span>
                    {detail.subject && (
                      <Badge variant="secondary" className="shrink-0">
                        {detail.subject}
                      </Badge>
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
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover">
                      <div
                        className="h-full rounded-full bg-ink"
                        style={{ width: `${detail.progressPct}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs text-text-muted">
                      {detail.done}/{detail.total}（{detail.progressPct}%）
                    </span>
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
