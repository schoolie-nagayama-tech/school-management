'use client';

/**
 * テスト対策（増コマ）配置パネル
 *
 * 座席表で「追加授業（テスト対策）」期間を選択中に、増コマ申込の生徒ごとの
 * 「申込N コマ / 配置済みM コマ」を科目別に表示し、空きセルへ手動配置するための補助。
 * 講習配置パネル(KoushuPlacementPanel)のテスト対策版。データソースは増コマフォーム回答。
 *
 * - 残コマ数の多い順に生徒リスト
 * - 科目ごとに 残コマ + 「配置」ボタン（科目がマスタに無いと配置不可）
 * - 生徒名クリックで「通塾できる枠（増コマフォームで申告した日時）」を展開
 * - 「配置」→ 親が配置モードに入り、その生徒の通塾可能セルを強調＋クリックで test_prep コマ作成
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui';
import {
  getZoukomaPlacementProgress,
  type ZoukomaPlacementRow,
  type ZoukomaAvailableSlot,
} from '@/lib/api/zoukoma-placement';
import type { Subject } from '@/types/database';
import { CheckCircle, Target, X } from 'lucide-react';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

interface Props {
  schoolId: string;
  subjects: Subject[];
  /** 「配置」クリック時：親が配置モードに入る */
  onStartPlacement?: (
    studentId: string,
    subjectId: string,
    subjectName: string,
    availableSlots: ZoukomaAvailableSlot[]
  ) => void;
  placingStudentId?: string | null;
  placingSubjectId?: string | null;
  refreshKey?: number;
  onClose?: () => void;
}

function dowLabel(date: string): string {
  const d = new Date(date + 'T12:00:00');
  return ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
}

export function TestPrepPlacementPanel({
  schoolId,
  subjects,
  onStartPlacement,
  placingStudentId,
  placingSubjectId,
  refreshKey,
  onClose,
}: Props) {
  const [rows, setRows] = useState<ZoukomaPlacementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [openStudent, setOpenStudent] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const map = await getZoukomaPlacementProgress(schoolId, subjects);
      const list = Array.from(map.values());
      // 残コマ多い順 → 申込多い順
      list.sort(
        (a, b) => b.enrolled - b.placed - (a.enrolled - a.placed) || b.enrolled - a.enrolled
      );
      setRows(list);
    } catch (e) {
      console.error('Failed to load test-prep placement progress:', e);
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, subjects]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const totalEnrolled = rows.reduce((s, r) => s + r.enrolled, 0);
  const totalPlaced = rows.reduce((s, r) => s + r.placed, 0);

  // 生徒の通塾可能枠を「日付ごと」にまとめて表示用に整形
  const availabilityChips = (slots: ZoukomaAvailableSlot[]) => {
    const byDate = new Map<string, string[]>();
    for (const s of slots) {
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date)!.push(`${s.periodCode}限`);
    }
    return Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));
  };

  return (
    <Card className="border-warning">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4 text-warning" />
          <span className="font-semibold text-sm">追加授業（テスト対策）</span>
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
            生徒が通塾できる枠（強調表示）をクリックするとテスト対策コマが追加されます。
            もう一度「配置」を押すと終了します。
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-text-muted py-2">読み込み中...</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-text-muted py-2">
            この期間に増コマの申込（生徒に紐付け済み）はありません
          </p>
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
                      <tr className="border-t border-border-subtle bg-surface/40">
                        <td className="py-1 px-1" colSpan={2}>
                          <button
                            type="button"
                            onClick={() => setOpenStudent(isOpen ? null : r.student_id)}
                            className="text-left hover:underline"
                            title="クリックで通塾できる枠を表示"
                          >
                            <span className="font-medium">
                              {r.student?.last_name} {r.student?.first_name}
                            </span>
                            <span className="text-text-muted ml-1">
                              ({r.student ? formatGradeLabel(r.student.grade) : ''})
                            </span>
                          </button>
                        </td>
                        <td className="py-1 px-1 text-right tabular-nums text-text-muted">
                          計{r.placed}/{r.enrolled}
                        </td>
                      </tr>
                      {subjEntries.map(([key, b]) => {
                        const remaining = b.enrolled - b.placed;
                        const isComplete = remaining <= 0;
                        const isPlacing =
                          placingStudentId === r.student_id && placingSubjectId === b.subjectId;
                        const canPlace = !!b.subjectId && !isComplete && !!onStartPlacement;
                        return (
                          <tr key={key} className="border-t border-border-subtle/40">
                            <td className="py-1 pl-3 pr-1 text-text-body">
                              {b.subjectName}
                              {!b.subjectId && (
                                <span className="text-danger ml-1 text-[10px]">(科目未対応)</span>
                              )}
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
                              {canPlace && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onStartPlacement!(
                                      r.student_id,
                                      b.subjectId!,
                                      b.subjectName,
                                      r.availableSlots
                                    )
                                  }
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
                      })}
                      {isOpen && (
                        <tr className="bg-surface/60">
                          <td colSpan={3} className="px-2 py-1.5">
                            <div className="text-[11px] text-text-body">
                              <span className="font-semibold">通塾できる枠:</span>{' '}
                              {r.availableSlots.length === 0 ? (
                                <span className="text-text-muted">申告なし</span>
                              ) : (
                                <span className="inline-flex flex-wrap gap-1 align-middle">
                                  {availabilityChips(r.availableSlots).map(([date, periods]) => (
                                    <span
                                      key={date}
                                      className="px-1.5 py-0.5 rounded bg-white border border-border-subtle text-[10px]"
                                    >
                                      {date.slice(5)}({dowLabel(date)}) {periods.join('・')}
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
