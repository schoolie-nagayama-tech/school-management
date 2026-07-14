import type { SchoolOverviewRow } from './AllSchoolsOverview';

export interface AllSchoolsReportProps {
  seasonLabel: string;
  year: number;
  rows: SchoolOverviewRow[];
  today: string;
}

const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

/**
 * 全教室横断の A3 縦1枚レポート。
 * AllSchoolsOverview と同じ SchoolKpis を使い、全校合計＋教室別の一覧を印刷する。
 */
export function AllSchoolsReport({ seasonLabel, year, rows, today }: AllSchoolsReportProps) {
  const totals = {
    studentCount: rows.reduce((a, r) => a + r.kpis.studentCount, 0),
    totalProposed: rows.reduce((a, r) => a + r.kpis.totalProposed, 0),
    totalDecided: rows.reduce((a, r) => a + r.kpis.totalDecided, 0),
    totalTarget: rows.reduce((a, r) => a + r.kpis.targetKoma, 0),
    proposedStudentCount: rows.reduce((a, r) => a + r.kpis.proposedStudentCount, 0),
    decidedStudentCount: rows.reduce((a, r) => a + r.kpis.decidedStudentCount, 0),
    overdueCount: rows.reduce((a, r) => a + r.kpis.overdueCount, 0),
  };
  const totalsAcqRate = rate(totals.totalDecided, totals.totalProposed);
  const totalsTargetRate = rate(totals.totalDecided, totals.totalTarget);

  const stats: { label: string; value: string; sub?: string }[] = [
    { label: '教室数', value: `${rows.length}`, sub: '校' },
    { label: '在籍生徒数', value: `${totals.studentCount}`, sub: '名' },
    { label: '提案増コマ 合計', value: `${totals.totalProposed}`, sub: 'コマ' },
    { label: '取得増コマ 合計', value: `${totals.totalDecided}`, sub: 'コマ' },
    { label: '取得率', value: `${totalsAcqRate}`, sub: '%（取得÷提案）' },
    {
      label: '目標進捗',
      value: totals.totalTarget > 0 ? `${totalsTargetRate}` : '–',
      sub: totals.totalTarget > 0 ? `%（目標${totals.totalTarget}コマ）` : '目標未設定',
    },
    {
      label: '平均提案',
      value:
        totals.studentCount > 0 ? (totals.totalProposed / totals.studentCount).toFixed(1) : '0',
      sub: 'コマ/人',
    },
    {
      label: '平均取得',
      value: totals.studentCount > 0 ? (totals.totalDecided / totals.studentCount).toFixed(1) : '0',
      sub: 'コマ/人',
    },
  ];

  return (
    <div className="course-report-print-page text-black bg-white">
      {/* ヘッダー */}
      <div className="flex items-end justify-between border-b-2 border-black pb-1.5 mb-3">
        <div>
          <div className="text-base font-bold leading-tight">
            {year}年 {seasonLabel}講習 進捗レポート（全教室）
          </div>
          <div className="text-xs mt-0.5">{rows.length}教室 横断サマリー</div>
        </div>
        <div className="text-right text-[10px] leading-tight">
          <div>出力日：{today}</div>
        </div>
      </div>

      {/* 全校合計 */}
      <div className="text-xs font-bold border-b border-black mb-1.5 pb-0.5">全校合計</div>
      <div className="grid grid-cols-4 gap-2 mb-4">
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

      {/* 教室別一覧 */}
      <div className="text-xs font-bold border-b border-black mb-1.5 pb-0.5">教室別</div>
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="border-b border-gray-400 text-gray-600">
            <th className="text-left font-medium py-1 pl-1">教室</th>
            <th className="text-right font-medium py-1">在籍</th>
            <th className="text-right font-medium py-1">提案</th>
            <th className="text-right font-medium py-1">取得</th>
            <th className="text-right font-medium py-1">取得率</th>
            <th className="text-right font-medium py-1">目標</th>
            <th className="text-right font-medium py-1">目標達成</th>
            <th className="text-right font-medium py-1">作成済</th>
            <th className="text-right font-medium py-1">申込済</th>
            <th className="text-right font-medium py-1 pr-1">期日超過</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const k = row.kpis;
            return (
              <tr key={row.schoolId} className="border-b border-gray-200">
                <td className="py-1 pl-1 font-medium">{row.schoolName}</td>
                <td className="text-right py-1 tabular-nums">{k.studentCount}</td>
                <td className="text-right py-1 tabular-nums">{k.totalProposed}</td>
                <td className="text-right py-1 tabular-nums font-medium">{k.totalDecided}</td>
                <td className="text-right py-1 tabular-nums">
                  {Math.round(k.acquisitionRate * 100)}%
                </td>
                <td className="text-right py-1 tabular-nums">
                  {k.targetKoma > 0 ? k.targetKoma : '–'}
                </td>
                <td className="text-right py-1 tabular-nums">
                  {k.targetKoma > 0 ? `${rate(k.totalDecided, k.targetKoma)}%` : '–'}
                </td>
                <td className="text-right py-1 tabular-nums">
                  {k.proposedStudentCount}/{k.studentCount}
                </td>
                <td className="text-right py-1 tabular-nums">
                  {k.decidedStudentCount}/{k.studentCount}
                </td>
                <td className="text-right py-1 pr-1 tabular-nums">{k.overdueCount}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-bold">
            <td className="py-1 pl-1">合計</td>
            <td className="text-right py-1 tabular-nums">{totals.studentCount}</td>
            <td className="text-right py-1 tabular-nums">{totals.totalProposed}</td>
            <td className="text-right py-1 tabular-nums">{totals.totalDecided}</td>
            <td className="text-right py-1 tabular-nums">{totalsAcqRate}%</td>
            <td className="text-right py-1 tabular-nums">
              {totals.totalTarget > 0 ? totals.totalTarget : '–'}
            </td>
            <td className="text-right py-1 tabular-nums">
              {totals.totalTarget > 0 ? `${totalsTargetRate}%` : '–'}
            </td>
            <td className="text-right py-1 tabular-nums">
              {totals.proposedStudentCount}/{totals.studentCount}
            </td>
            <td className="text-right py-1 tabular-nums">
              {totals.decidedStudentCount}/{totals.studentCount}
            </td>
            <td className="text-right py-1 pr-1 tabular-nums">{totals.overdueCount}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
