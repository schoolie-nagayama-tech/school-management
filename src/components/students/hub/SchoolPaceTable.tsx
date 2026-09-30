'use client';

import { useMemo } from 'react';
import { useHubProgress } from './HubDataContext';
import { toDateStr } from './hubSummary';
import { computeSchoolPace, formatSchoolPaceDiff, type SchoolPaceCompared } from './schoolPace';

/**
 * 進行表セクションの先頭に置く「学校進度との比較」の表。テキスト | 学校 | 当塾 | 差。
 *
 * ★取得は増やさない。ハブ共通の進行表の取得（useHubProgress）をそのまま読む。
 *   進行表パネル（InterviewPanels）と同じ取得なので、置いても通信は1回のまま。
 * ★学校進度の記録が無いテキストは出さない。全テキストで無ければ何も描かない（見出しも説明文も出さない）。
 *   学校進度は手入力の欄で、入れていない教室も多い。空の表や「記録がありません」を並べても用が無い。
 * ★色は遅れの行の「差」だけ黄。同じ・先は対応が要らないので色を付けない。
 * ★読み込み中も何も描かない。下の進行表パネルが読み込み表示を出しているので、二重に出さない。
 */
export function SchoolPaceTable() {
  const { progress, loading } = useHubProgress();
  const rows = useMemo(
    () =>
      computeSchoolPace(progress.textbookData, toDateStr(new Date())).filter(
        (e): e is SchoolPaceCompared => e.kind === 'compared'
      ),
    [progress.textbookData]
  );

  if (loading || rows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
            <th className="py-1.5 pr-3 font-medium">テキスト</th>
            <th className="py-1.5 pr-3 font-medium">学校</th>
            <th className="py-1.5 pr-3 font-medium">当塾</th>
            <th className="py-1.5 font-medium">差</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.textbookId} className="border-b border-border-subtle last:border-0">
              <td className="py-1.5 pr-3 text-text-heading [overflow-wrap:anywhere]">{r.label}</td>
              <td className="py-1.5 pr-3 [overflow-wrap:anywhere]">{r.schoolUnit}</td>
              <td className="py-1.5 pr-3 [overflow-wrap:anywhere]">
                {r.jukuUnit ?? <span className="text-text-faint">未着手</span>}
              </td>
              <td
                className={`whitespace-nowrap py-1.5 tabular-nums ${
                  r.status === 'behind' ? 'font-bold text-warning' : 'text-text-body'
                }`}
              >
                {formatSchoolPaceDiff(r.diff)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
