'use client';

/**
 * 面談ワークスペース 右カラム: 宿題・遅刻パネル
 * ------------------------------------------------------------------
 * 進行表パネルの「教材ごとの宿題未実施/遅刻の累計件数」とは別軸で、
 * 「直近6ヶ月、月ごとにどれくらい宿題忘れ・遅刻があったか」を面談中にその場で振り返れるようにする。
 *
 * 集計は interview.shared.ts の computeDisciplineMonthly に寄せている
 * （印刷シートも同じ関数を使うため、画面と印刷で数字がずれないようにするため）。
 */

import { Card, CardContent, CardHeader, CardTitle, InlineLoading } from '@/components/ui';
import type { DisciplineSessionRow } from '@/lib/api/progress-sessions';
import { computeDisciplineMonthly, DISCIPLINE_ALERT_RATIO_THRESHOLD } from './interview.shared';
import { CalendarCheck2 } from 'lucide-react';

interface DisciplinePanelProps {
  sessions: DisciplineSessionRow[];
  loading: boolean;
}

/** 集計対象期間（直近6ヶ月）。印刷シートも同じ値を使う */
const MONTHS_BACK = 6;

/** 件数・割合(%)・注意フラグをまとめて返す。授業日数0または件数0なら控えめな「—」にする */
function formatCount(
  count: number,
  lessonDays: number
): { days: number; pct: number | null; alert: boolean } {
  if (lessonDays === 0 || count === 0) return { days: count, pct: null, alert: false };
  const pct = Math.round((count / lessonDays) * 100);
  return { days: count, pct, alert: count / lessonDays >= DISCIPLINE_ALERT_RATIO_THRESHOLD };
}

export function DisciplinePanel({ sessions, loading }: DisciplinePanelProps) {
  const months = computeDisciplineMonthly(sessions, MONTHS_BACK, new Date());
  const hasAnyRecord = months.some((m) => m.lessonDays > 0);

  const totalLessonDays = months.reduce((sum, m) => sum + m.lessonDays, 0);
  const totalHomeworkMissed = months.reduce((sum, m) => sum + m.homeworkMissedDays, 0);
  const totalTardy = months.reduce((sum, m) => sum + m.tardyDays, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
        <CalendarCheck2 className="h-4 w-4 text-text-muted" />
        <CardTitle className="text-sm">宿題・遅刻</CardTitle>
      </CardHeader>
      <CardContent className="pt-3">
        {loading ? (
          <InlineLoading label="宿題・遅刻の記録を読み込み中…" />
        ) : !hasAnyRecord ? (
          <p className="text-sm text-text-muted">直近6ヶ月の授業記録がありません</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-text-muted">
                    <th className="pb-1.5 pr-2 font-medium">月</th>
                    <th className="px-1.5 pb-1.5 text-right font-medium">授業</th>
                    <th className="px-1.5 pb-1.5 text-right font-medium">宿題忘れ</th>
                    <th className="px-1.5 pb-1.5 text-right font-medium">遅刻</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => {
                    const homework = formatCount(m.homeworkMissedDays, m.lessonDays);
                    const tardy = formatCount(m.tardyDays, m.lessonDays);
                    return (
                      <tr
                        key={m.month}
                        className={`border-b border-border-subtle last:border-0 ${
                          m.lessonDays === 0 ? 'text-text-faint' : 'text-text-body'
                        }`}
                      >
                        <td className="py-1.5 pr-2">{m.label}</td>
                        <td className="px-1.5 py-1.5 text-right tabular-nums">
                          {m.lessonDays > 0 ? `${m.lessonDays}日` : '—'}
                        </td>
                        <td className="px-1.5 py-1.5 text-right tabular-nums">
                          {homework.pct == null ? (
                            '—'
                          ) : (
                            <span className={homework.alert ? 'font-semibold text-red-600' : ''}>
                              {homework.days}日
                              <span className="ml-1 text-[10px] text-text-faint">
                                （{homework.pct}%）
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="px-1.5 py-1.5 text-right tabular-nums">
                          {tardy.pct == null ? (
                            '—'
                          ) : (
                            <span className={tardy.alert ? 'font-semibold text-red-600' : ''}>
                              {tardy.days}日
                              <span className="ml-1 text-[10px] text-text-faint">
                                （{tardy.pct}%）
                              </span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-xs text-text-muted">
              直近{MONTHS_BACK}ヶ月合計: 授業{totalLessonDays}日・宿題忘れ{totalHomeworkMissed}
              日・遅刻{totalTardy}日
            </p>
          </>
        )}

        <p className="mt-2 text-[11px] text-text-faint">
          進行表の記録に基づく（未入力は数えられません）
        </p>
      </CardContent>
    </Card>
  );
}
