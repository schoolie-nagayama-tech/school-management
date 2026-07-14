import { Fragment } from 'react';
import type {
  Student,
  CourseProgressItem,
  StudentCourseProgress,
  CoursePrepPeriod,
} from '@/types/database';
import type { AutoValues } from '@/lib/api/courseProgress';
import { computeDashboardAggregates } from '@/lib/coursePrepKpis';

export interface CourseProgressReportProps {
  schoolName: string;
  seasonLabel: string;
  year: number;
  students: Student[];
  items: CourseProgressItem[];
  progressData: StudentCourseProgress[];
  autoValues: AutoValues;
  period: CoursePrepPeriod | null;
  // 出力日（'YYYY-MM-DD' 表記の基準日）。期日超過判定にも使う。
  today: string;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

// 期間の週数（AllSchoolsOverview/ダッシュボードと同じ丸め方）
function weeksBetween(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  return Math.max(
    1,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24 * 7))
  );
}

/**
 * 講習進捗の A3 縦1枚レポート（単一校）。
 * 画面ダッシュボードと同じ computeDashboardAggregates を使い、印刷でも同じ数字を保証する。
 * 画面プレビューと印刷の両方でそのまま使える白地・黒文字のレイアウト。
 */
export function CourseProgressReport({
  schoolName,
  seasonLabel,
  year,
  students,
  items,
  progressData,
  autoValues,
  period,
  today,
}: CourseProgressReportProps) {
  const agg = computeDashboardAggregates(students, items, progressData, autoValues, period, today);
  const weeks = weeksBetween(period?.schedule_start_date, period?.schedule_end_date);

  // メイン指標カードの定義（値・補足）
  const stats: { label: string; value: string; sub?: string }[] = [
    { label: '在籍生徒数', value: `${students.length}`, sub: '名' },
    { label: '提案増コマ 合計', value: `${agg.totalProposed}`, sub: 'コマ' },
    { label: '取得増コマ 合計', value: `${agg.totalDecided}`, sub: 'コマ' },
    { label: '実績取得率', value: `${agg.actualRatePct}`, sub: '%（取得÷提案）' },
    {
      label: '目標達成',
      value: agg.targetKoma > 0 ? `${Math.round(agg.targetRate * 100)}` : '–',
      sub: agg.targetKoma > 0 ? `%（目標${agg.targetKoma}コマ）` : '目標未設定',
    },
    {
      label: '予算達成',
      value: agg.budgetKoma > 0 ? `${Math.round(agg.budgetRate * 100)}` : '–',
      sub: agg.budgetKoma > 0 ? `%（予算${agg.budgetKoma}コマ）` : '予算未設定',
    },
    {
      label: '想定増コマ',
      value: `${agg.expectedKoma}`,
      sub: `コマ（想定取得率${agg.expectedRate}%）`,
    },
    {
      label: '平均取得',
      value: students.length > 0 ? (agg.totalDecided / students.length).toFixed(1) : '0',
      sub: 'コマ/人',
    },
  ];

  // 進捗状況の各行
  const progressRows: { label: string; count: number }[] = [
    { label: '提案作成済', count: agg.proposedStudentCount },
    ...(agg.studentInterviewItem
      ? [{ label: '生徒面談 実施', count: agg.studentInterviewCount }]
      : []),
    ...(agg.parentInterviewItem
      ? [{ label: '父母面談 実施', count: agg.parentInterviewCount }]
      : []),
    { label: '申込済', count: agg.decidedStudentCount },
  ];

  return (
    <div className="course-report-print-page text-black bg-white">
      {/* ヘッダー */}
      <div className="flex items-end justify-between border-b-2 border-black pb-1.5 mb-3">
        <div>
          <div className="text-base font-bold leading-tight">
            {year}年 {seasonLabel}講習 進捗レポート
          </div>
          <div className="text-xs mt-0.5">{schoolName}</div>
        </div>
        <div className="text-right text-[10px] leading-tight">
          <div>
            講習期間：
            {period?.schedule_start_date && period?.schedule_end_date
              ? `${period.schedule_start_date} 〜 ${period.schedule_end_date}${weeks ? `（${weeks}週間）` : ''}`
              : '未設定'}
          </div>
          <div>出力日：{today}</div>
        </div>
      </div>

      {/* メイン指標 */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {stats.map((s) => (
          <div key={s.label} className="border border-gray-400 rounded px-2 py-1.5">
            <div className="text-[10px] text-gray-600 leading-tight">{s.label}</div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold tabular-nums">{s.value}</span>
              {s.sub && <span className="text-[9px] text-gray-600">{s.sub}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* 進捗状況 */}
      <div className="mb-3">
        <div className="text-xs font-bold border-b border-black mb-1.5 pb-0.5">進捗状況</div>
        <div className="grid grid-cols-4 gap-2">
          {progressRows.map((r) => (
            <div key={r.label} className="border border-gray-300 rounded px-2 py-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-600">{r.label}</span>
                <span className="text-[10px] font-medium">{pct(r.count, students.length)}%</span>
              </div>
              <div className="text-sm font-bold tabular-nums">
                {r.count}
                <span className="text-[9px] font-normal text-gray-500"> / {students.length}名</span>
              </div>
              {/* 塗りバー（印刷でも出るよう地色は薄グレー） */}
              <div className="mt-1 h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gray-800 rounded-full"
                  style={{ width: `${pct(r.count, students.length)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 学校種別分析 */}
      {agg.categoryAnalysis.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-bold border-b border-black mb-1.5 pb-0.5">学校種別分析</div>
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="border-b border-gray-400 text-gray-600">
                <th className="text-left font-medium py-1 pl-1">学校種／学年</th>
                <th className="text-right font-medium py-1">在籍</th>
                <th className="text-right font-medium py-1">提案</th>
                <th className="text-right font-medium py-1">取得</th>
                <th className="text-right font-medium py-1">平均提案</th>
                <th className="text-right font-medium py-1">平均取得</th>
                <th className="text-right font-medium py-1 pr-1">取得率</th>
              </tr>
            </thead>
            <tbody>
              {agg.categoryAnalysis.map((cat) => (
                <Fragment key={cat.category}>
                  <tr className="border-b border-gray-300 font-bold bg-gray-50">
                    <td className="py-1 pl-1">{cat.label}</td>
                    <td className="text-right py-1 tabular-nums">{cat.studentCount}名</td>
                    <td className="text-right py-1 tabular-nums">{cat.totalProposed}</td>
                    <td className="text-right py-1 tabular-nums">{cat.totalDecided}</td>
                    <td className="text-right py-1 tabular-nums">{cat.avgProposed.toFixed(1)}</td>
                    <td className="text-right py-1 tabular-nums">{cat.avgDecided.toFixed(1)}</td>
                    <td className="text-right py-1 pr-1 tabular-nums">
                      {Math.round(cat.acquisitionRate * 100)}%
                    </td>
                  </tr>
                  {cat.gradeBreakdown.length > 1 &&
                    cat.gradeBreakdown.map((g) => (
                      <tr
                        key={`${cat.category}-${g.grade}`}
                        className="border-b border-gray-100 text-gray-700"
                      >
                        <td className="py-0.5 pl-4">{g.label}</td>
                        <td className="text-right py-0.5 tabular-nums">{g.count}名</td>
                        <td className="text-right py-0.5 tabular-nums">{g.proposed}</td>
                        <td className="text-right py-0.5 tabular-nums">{g.decided}</td>
                        <td className="text-right py-0.5 tabular-nums">
                          {g.avgProposed.toFixed(1)}
                        </td>
                        <td className="text-right py-0.5 tabular-nums">
                          {g.avgDecided.toFixed(1)}
                        </td>
                        <td className="text-right py-0.5 pr-1 tabular-nums">
                          {Math.round(g.rate * 100)}%
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 教科別 提案 vs 取得 */}
      {agg.subjectAnalysis.overall.length > 0 && (
        <div className="mb-2">
          <div className="text-xs font-bold border-b border-black mb-1.5 pb-0.5">
            教科別 提案 vs 取得
          </div>
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="border-b border-gray-400 text-gray-600">
                <th className="text-left font-medium py-1 pl-1">教科</th>
                <th className="text-right font-medium py-1">提案コマ</th>
                <th className="text-right font-medium py-1">取得コマ</th>
                <th className="text-right font-medium py-1">差</th>
                <th className="text-right font-medium py-1 pr-1">取得率</th>
              </tr>
            </thead>
            <tbody>
              {agg.subjectAnalysis.overall.map((r) => {
                const diff = r.applied - r.proposed;
                return (
                  <tr key={r.subject} className="border-b border-gray-200">
                    <td className="py-1 pl-1 font-medium">{r.subject}</td>
                    <td className="text-right py-1 tabular-nums">{r.proposed}</td>
                    <td className="text-right py-1 tabular-nums font-medium">{r.applied}</td>
                    <td className="text-right py-1 tabular-nums">{diff > 0 ? `+${diff}` : diff}</td>
                    <td className="text-right py-1 pr-1 tabular-nums">
                      {Math.round(r.rate * 100)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {(() => {
                const sp = agg.subjectAnalysis.overall.reduce((a, r) => a + r.proposed, 0);
                const sa = agg.subjectAnalysis.overall.reduce((a, r) => a + r.applied, 0);
                const sd = sa - sp;
                return (
                  <tr className="border-t-2 border-black font-bold">
                    <td className="py-1 pl-1">合計</td>
                    <td className="text-right py-1 tabular-nums">{sp}</td>
                    <td className="text-right py-1 tabular-nums">{sa}</td>
                    <td className="text-right py-1 tabular-nums">{sd > 0 ? `+${sd}` : sd}</td>
                    <td className="text-right py-1 pr-1 tabular-nums">
                      {sp > 0 ? Math.round((sa / sp) * 100) : 0}%
                    </td>
                  </tr>
                );
              })()}
            </tfoot>
          </table>
        </div>
      )}

      {/* 期日超過（あれば） */}
      {agg.overdueList.length > 0 && (
        <div className="mb-1">
          <div className="text-xs font-bold border-b border-black mb-1 pb-0.5">
            期日超過タスク（{agg.overdueList.length}件）
          </div>
          <div className="text-[10px] leading-snug">
            {agg.overdueItems.map((item) => {
              const names = agg.overdueList
                .filter((o) => o.item.id === item.id)
                .map((o) => o.student.last_name);
              return (
                <div key={item.id} className="flex gap-1">
                  <span className="font-medium shrink-0">
                    {item.name}
                    {item.deadline ? `（〜${item.deadline.slice(5).replace('-', '/')}）` : ''}:
                  </span>
                  <span className="text-gray-700">
                    {names.slice(0, 12).join('、')}
                    {names.length > 12 ? ` 他${names.length - 12}名` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 集計対象列の脚注 */}
      <div className="text-[8px] text-gray-500 mt-2 pt-1 border-t border-gray-300">
        集計対象列：提案＝{agg.proposedKomaItem?.name ?? '未検出'} / 取得＝
        {agg.decidedKomaItem?.name ?? '未検出'}
      </div>
    </div>
  );
}
