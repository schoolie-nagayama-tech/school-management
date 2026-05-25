'use client';

/**
 * 出勤簿 vs スケジュール 照合パネル
 *
 * 用途：室長が submitted 状態の出勤簿を確認する際、座席表の集計値と並列表示して
 *       「講師の申告が実態と合っているか」を目視チェックする。
 *
 * 表示内容（日別行）:
 *   - 講師申告コマ数（attendance_records の合計）
 *   - スケジュール側コマ数（通常 / 講習別 + 合計）
 *   - 差分（合計どうしを比較）。差分があれば赤くハイライト
 *
 * 注意：自動転記は一切しない。あくまで参考値として並べる。
 *       差分の解釈は室長が行う（準備給など座席表に出ない種別は集計外）。
 */

import { useEffect, useState } from 'react';
import { getScheduleCountsByMonth, type ScheduleCountsByDate } from '@/lib/api/schedule-vs-attendance';
import { Loader2 } from 'lucide-react';

interface Props {
  schoolId: string;
  teacherId: string;
  yearMonth: string;
  /** 講師申告の (date → 当日コマ数合計) マップ。親で attendance_records を集計して渡す */
  teacherReportedByDate: Map<string, number>;
  /** 講師申告の月合計（コマ単位の attendance_type の合計） */
  teacherReportedTotal: number;
}

export function ScheduleDriftCheckPanel({
  schoolId,
  teacherId,
  yearMonth,
  teacherReportedByDate,
  teacherReportedTotal,
}: Props) {
  const [counts, setCounts] = useState<ScheduleCountsByDate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getScheduleCountsByMonth(schoolId, teacherId, yearMonth)
      .then((data) => {
        if (!cancelled) setCounts(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, teacherId, yearMonth]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        スケジュール側のコマ数を集計中...
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-sm text-danger">{error}</div>;
  }

  if (!counts) return null;

  // 表示対象日：出勤簿側 or スケジュール側に1件でも記録があるすべての日
  // Map.keys() の直接 spread は ts target によって失敗するので Array.from 経由で取り出す
  const dateSet = new Set<string>();
  Array.from(teacherReportedByDate.keys()).forEach((d) => dateSet.add(d));
  Array.from(counts.byDate.keys()).forEach((d) => dateSet.add(d));
  const allDates = Array.from(dateSet).sort();

  const scheduleTotal = counts.totalRegular + counts.totalKoushu;
  const totalDiff = teacherReportedTotal - scheduleTotal;

  return (
    <div className="border border-border-subtle rounded-lg overflow-hidden bg-white">
      <div className="px-4 py-3 bg-surface border-b">
        <h3 className="font-semibold text-sm">スケジュール照合</h3>
        <p className="text-xs text-text-muted mt-1">
          講師の自己申告と座席表側の集計を並べて表示します。差分があれば実態と照らして判断してください
          （準備給・自習対応など座席表に出ない種別は集計対象外）。
        </p>
      </div>

      {/* 月合計サマリ */}
      <div className="px-4 py-3 grid grid-cols-3 gap-3 bg-white border-b text-sm">
        <div>
          <div className="text-xs text-text-muted">講師申告（月合計）</div>
          <div className="text-lg font-semibold">{teacherReportedTotal} コマ</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">座席表集計（通常+講習）</div>
          <div className="text-lg font-semibold">
            {scheduleTotal} コマ
            <span className="ml-1 text-xs text-text-muted">
              (通常 {counts.totalRegular} / 講習 {counts.totalKoushu})
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted">差分</div>
          <div
            className={`text-lg font-semibold ${
 totalDiff === 0 ? 'text-success' : 'text-danger'
 }`}
          >
            {totalDiff === 0 ? '一致 ✓' : totalDiff > 0 ? `+${totalDiff}` : `${totalDiff}`}
          </div>
        </div>
      </div>

      {/* 日別比較テーブル */}
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-medium w-28">日付</th>
              <th className="text-right px-3 py-2 font-medium w-20">講師申告</th>
              <th className="text-right px-3 py-2 font-medium w-32">座席表 (通常 / 講習)</th>
              <th className="text-right px-3 py-2 font-medium w-20">差分</th>
            </tr>
          </thead>
          <tbody>
            {allDates.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-text-muted">
                  この月にコマ記録がありません
                </td>
              </tr>
            ) : (
              allDates.map((date) => {
                const reported = teacherReportedByDate.get(date) ?? 0;
                const kindCounts = counts.byDateByKind.get(date) ?? { regular: 0, koushu: 0 };
                const scheduleSum = kindCounts.regular + kindCounts.koushu;
                const diff = reported - scheduleSum;
                const isMatch = diff === 0;
                return (
                  <tr key={date} className={`border-t ${isMatch ? '' : 'bg-danger-subtle'}`}>
                    <td className="px-3 py-2 tabular-nums">{date}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{reported}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {scheduleSum}
                      <span className="ml-1 text-xs text-text-muted">
                        ({kindCounts.regular} / {kindCounts.koushu})
                      </span>
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-medium ${
 isMatch ? 'text-text-faint' : 'text-danger'
 }`}
                    >
                      {isMatch ? '✓' : diff > 0 ? `+${diff}` : `${diff}`}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
