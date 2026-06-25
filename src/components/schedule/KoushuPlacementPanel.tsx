'use client';

/**
 * 講習配置パネル
 *
 * 用途：座席表で講習コースを選択中に、生徒ごとの「申込N コマ / 配置済みM コマ」の進捗を表示。
 *      室長が未配置生徒を見ながら、座席表の空きセルに手動で講習コマを配置していくための補助。
 *
 * 表示：
 *  - 残コマ数の多い順に生徒リスト
 *  - 各行：生徒名 / 学年 / 残N コマ / 「配置する」ボタン
 *  - 「配置する」ボタンクリック → 親に notify → 親が「配置モード」に入り、空きセルクリックで該当生徒の koushu コマを作成
 *
 * 配置完了判定：placed >= enrolled なら緑、未達なら黄、ゼロは赤
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui';
import {
  getKoushuPlacementProgressByPeriod,
  getStudentRegularSchedule,
  type KoushuPeriodInfo,
} from '@/lib/api/koushu-period';
import type { ScheduleEntryFormation } from '@/types/schedule';
import { CheckCircle, Target, X } from 'lucide-react';

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
type StudentSchedule = Awaited<ReturnType<typeof getStudentRegularSchedule>>;

interface PlacementRow {
  student_id: string;
  enrolled: number;
  placed: number;
  subject_ids: string[];
  bySubject: Record<string, { enrolled: number; placed: number }>;
  student?: { id: string; last_name: string; first_name: string; grade: number };
}

interface Props {
  /**
   * 講習期間。course_prep_periods から取得した「春期/夏期/冬期 × 年 × school_id」のレコード。
   * 申込集計は seasonal_courses.season = period.season を満たす全コースから合算する。
   */
  period: KoushuPeriodInfo;
  /** 集計対象の形態。既定は個別（集団レーンは Phase 3 で別パネル） */
  formation?: ScheduleEntryFormation;
  /** 「配置する」ボタンクリック時：親が「配置モード」に入る（科目別なら subjectIds=[その科目]） */
  onStartPlacement?: (studentId: string, subjectIds: string[]) => void;
  /** 配置モード中の生徒ID */
  placingStudentId?: string | null;
  /** 配置モード中の科目ID（科目別配置の「終了」ラベル判定用） */
  placingSubjectId?: string | null;
  /** 科目ID→名前 */
  subjectNameById?: Map<string, string>;
  /** 配置1コマ作成完了後に呼ばれて、内部の placed カウントを再フェッチする */
  refreshKey?: number;
  /** パネルを閉じる */
  onClose?: () => void;
}

function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}

export function KoushuPlacementPanel({
  period,
  formation = 'individual',
  onStartPlacement,
  placingStudentId,
  placingSubjectId,
  subjectNameById,
  refreshKey,
  onClose,
}: Props) {
  const [rows, setRows] = useState<PlacementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // 生徒名クリックで開く詳細（申込コマ数 + 通塾日程）
  const [openStudent, setOpenStudent] = useState<string | null>(null);
  const [sched, setSched] = useState<StudentSchedule>([]);
  const [schedLoading, setSchedLoading] = useState(false);

  const toggleDetail = useCallback(
    async (studentId: string) => {
      if (openStudent === studentId) {
        setOpenStudent(null);
        return;
      }
      setOpenStudent(studentId);
      setSchedLoading(true);
      try {
        setSched(await getStudentRegularSchedule(studentId));
      } catch {
        setSched([]);
      } finally {
        setSchedLoading(false);
      }
    },
    [openStudent]
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const map = await getKoushuPlacementProgressByPeriod(period, formation);
      const list: PlacementRow[] = [];
      // Map iteration: Array.from で TS target 互換を確保
      Array.from(map.entries()).forEach(([student_id, v]) => {
        list.push({ student_id, ...v });
      });
      // 残コマ数が多い順 → 申込多い順
      list.sort(
        (a, b) => b.enrolled - b.placed - (a.enrolled - a.placed) || b.enrolled - a.enrolled
      );
      setRows(list);
    } catch (e) {
      console.error('Failed to load placement progress:', e);
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [period, formation]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const totalEnrolled = rows.reduce((s, r) => s + r.enrolled, 0);
  const totalPlaced = rows.reduce((s, r) => s + r.placed, 0);

  return (
    <Card className="border-warning">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4 text-warning" />
          <span className="font-semibold text-sm">
            講習配置: {period.label} ({period.schedule_start_date} 〜 {period.schedule_end_date})
          </span>
          <span className="text-xs text-text-muted ml-auto">
            {totalPlaced} / {totalEnrolled} コマ
            {totalEnrolled > 0 && ` (${Math.round((totalPlaced / totalEnrolled) * 100)}%)`}
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-text-faint hover:text-text-muted"
              title="閉じる"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {placingStudentId && (
          <div className="mb-2 px-2 py-1 bg-info-subtle border border-info rounded text-xs text-info">
            <strong>配置モード中:</strong>{' '}
            座席表の空きセルをクリックすると該当生徒の講習コマが追加されます。
            もう一度ボタンを押すと配置モードを終了します。
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-text-muted py-2">読み込み中...</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-text-muted py-2">この講習に申し込みはありません</p>
        ) : (
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-text-muted">
                <tr>
                  <th className="py-1 px-1">生徒 / 科目</th>
                  <th className="py-1 px-1 text-right">配置/申込</th>
                  <th className="py-1 px-1 w-14"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isOpen = openStudent === r.student_id;
                  const subjEntries = Object.entries(r.bySubject);
                  return (
                    <React.Fragment key={r.student_id}>
                      {/* 生徒ヘッダー行（名前クリックで通塾日程） */}
                      <tr className="border-t border-border-subtle bg-surface/40">
                        <td className="py-1 px-1" colSpan={2}>
                          <button
                            type="button"
                            onClick={() => toggleDetail(r.student_id)}
                            className="text-left hover:underline"
                            title="クリックで通塾日程を表示"
                          >
                            <span className="font-medium">
                              {r.student?.last_name} {r.student?.first_name}
                            </span>
                            <span className="text-text-muted ml-1">
                              ({r.student ? gradeLabel(r.student.grade) : ''})
                            </span>
                          </button>
                        </td>
                        <td className="py-1 px-1 text-right tabular-nums text-text-muted">
                          計{r.placed}/{r.enrolled}
                        </td>
                      </tr>
                      {/* 科目別行（科目ごとに残コマと配置ボタン） */}
                      {subjEntries.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-1 pl-3 pr-1 text-text-muted text-[11px]">
                            科目内訳なし（申込 {r.enrolled} コマ）
                          </td>
                        </tr>
                      ) : (
                        subjEntries.map(([sid, b]) => {
                          const remaining = b.enrolled - b.placed;
                          const isComplete = remaining <= 0;
                          const isPlacing =
                            placingStudentId === r.student_id && placingSubjectId === sid;
                          return (
                            <tr key={sid} className="border-t border-border-subtle/40">
                              <td className="py-1 pl-3 pr-1 text-text-body">
                                {subjectNameById?.get(sid) ?? sid.slice(0, 6)}
                              </td>
                              <td className="py-1 px-1 text-right tabular-nums">
                                {isComplete ? (
                                  <span className="inline-flex items-center gap-1 text-success font-semibold">
                                    <CheckCircle className="w-3 h-3" />
                                    {b.placed}/{b.enrolled}
                                  </span>
                                ) : (
                                  <span className={b.placed > 0 ? 'text-warning' : 'text-danger'}>
                                    {b.placed}/{b.enrolled}
                                    <span className="text-text-muted ml-1">(残{remaining})</span>
                                  </span>
                                )}
                              </td>
                              <td className="py-1 px-1">
                                {!isComplete && onStartPlacement && (
                                  <button
                                    type="button"
                                    onClick={() => onStartPlacement(r.student_id, [sid])}
                                    className={`text-xs px-2 py-0.5 rounded active:scale-[0.97] transition-[background-color,transform] duration-150 ${
                                      isPlacing
                                        ? 'bg-info text-white'
                                        : 'bg-white border border-info text-info hover:bg-info-subtle'
                                    }`}
                                  >
                                    {isPlacing ? '終了' : '配置'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                      {/* 通塾日程 detail */}
                      {isOpen && (
                        <tr className="bg-surface/60">
                          <td colSpan={3} className="px-2 py-1.5">
                            <div className="text-[11px] text-text-body">
                              <span className="font-semibold">通塾日程:</span>{' '}
                              {schedLoading ? (
                                <span className="text-text-muted">読み込み中…</span>
                              ) : sched.length === 0 ? (
                                <span className="text-text-muted">登録なし</span>
                              ) : (
                                <span className="inline-flex flex-wrap gap-1 align-middle">
                                  {sched.map((s, i) => (
                                    <span
                                      key={i}
                                      className="px-1.5 py-0.5 rounded bg-white border border-border-subtle text-[10px]"
                                    >
                                      {DOW_LABELS[s.day_of_week]}
                                      {s.slot_number}限
                                      <span className="text-text-muted ml-0.5">
                                        {s.start_time?.slice(0, 5)}
                                      </span>
                                    </span>
                                  ))}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
