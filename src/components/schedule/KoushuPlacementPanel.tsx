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

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui';
import {
  getKoushuPlacementProgress,
  type KoushuCourse,
  type KoushuEnrollment,
} from '@/lib/api/seasonalCourses';
import { CheckCircle, Target, X } from 'lucide-react';

interface PlacementRow {
  student_id: string;
  enrolled: number;
  placed: number;
  subject_ids: string[];
  student: KoushuEnrollment['student'];
}

interface Props {
  course: KoushuCourse;
  /** 「配置する」ボタンクリック時：親が「配置モード」に入る */
  onStartPlacement?: (studentId: string, subjectIds: string[]) => void;
  /** 配置モード中の生徒ID（バインド側で管理）。配置1コマ追加するたびに再フェッチさせる用にバージョンキーを持つ */
  placingStudentId?: string | null;
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
  course,
  onStartPlacement,
  placingStudentId,
  refreshKey,
  onClose,
}: Props) {
  const [rows, setRows] = useState<PlacementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const map = await getKoushuPlacementProgress(course);
      const list: PlacementRow[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const [student_id, v] of (map as any).entries()) {
        list.push({ student_id, ...v });
      }
      // 残コマ数が多い順 → 申込多い順
      list.sort((a, b) => (b.enrolled - b.placed) - (a.enrolled - a.placed) || b.enrolled - a.enrolled);
      setRows(list);
    } catch (e) {
      console.error('Failed to load placement progress:', e);
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [course]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const totalEnrolled = rows.reduce((s, r) => s + r.enrolled, 0);
  const totalPlaced = rows.reduce((s, r) => s + r.placed, 0);

  return (
    <Card className="border-amber-300">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4 text-amber-700" />
          <span className="font-semibold text-sm">
            講習配置: {course.name}
          </span>
          <span className="text-xs text-gray-600 ml-auto">
            {totalPlaced} / {totalEnrolled} コマ
            {totalEnrolled > 0 && ` (${Math.round((totalPlaced / totalEnrolled) * 100)}%)`}
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              title="閉じる"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {placingStudentId && (
          <div className="mb-2 px-2 py-1 bg-indigo-100 border border-indigo-300 rounded text-xs text-indigo-900">
            <strong>配置モード中:</strong> 座席表の空きセルをクリックすると該当生徒の講習コマが追加されます。
            もう一度ボタンを押すと配置モードを終了します。
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-gray-500 py-2">読み込み中...</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-gray-500 py-2">この講習に申し込みはありません</p>
        ) : (
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="py-1 px-1">生徒</th>
                  <th className="py-1 px-1 text-right">配置/申込</th>
                  <th className="py-1 px-1 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const remaining = r.enrolled - r.placed;
                  const isComplete = remaining <= 0;
                  const isPlacing = placingStudentId === r.student_id;
                  return (
                    <tr key={r.student_id} className="border-t border-gray-100">
                      <td className="py-1 px-1">
                        <span className="font-medium">
                          {r.student?.last_name} {r.student?.first_name}
                        </span>
                        <span className="text-gray-500 ml-1">
                          ({r.student ? gradeLabel(r.student.grade) : ''})
                        </span>
                      </td>
                      <td className="py-1 px-1 text-right tabular-nums">
                        {isComplete ? (
                          <span className="inline-flex items-center gap-1 text-green-700 font-semibold">
                            <CheckCircle className="w-3 h-3" />
                            {r.placed}/{r.enrolled}
                          </span>
                        ) : (
                          <span className={r.placed > 0 ? 'text-amber-700' : 'text-red-700'}>
                            {r.placed}/{r.enrolled}
                            <span className="text-gray-500 ml-1">(残{remaining})</span>
                          </span>
                        )}
                      </td>
                      <td className="py-1 px-1">
                        {!isComplete && onStartPlacement && (
                          <button
                            type="button"
                            onClick={() => onStartPlacement(r.student_id, r.subject_ids)}
                            className={`text-xs px-2 py-0.5 rounded ${
                              isPlacing
                                ? 'bg-indigo-600 text-white'
                                : 'bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-50'
                            }`}
                          >
                            {isPlacing ? '終了' : '配置する'}
                          </button>
                        )}
                      </td>
                    </tr>
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
