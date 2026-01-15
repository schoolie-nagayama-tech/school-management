'use client';

import type { ProgressRowDisplay } from '@/types/database';

interface Props {
  displayRows: ProgressRowDisplay[];
  studentName: string;
  textbookName: string;
}

export default function ParentProgressTable({ displayRows, studentName, textbookName }: Props) {
  // 合計計算
  const totalProposal = displayRows
    .filter(row => row.isGroupStart)
    .reduce((sum, row) => sum + row.groupProposalCount, 0);
  
  const totalApplication = displayRows
    .filter(row => row.isGroupStart)
    .reduce((sum, row) => sum + row.groupApplicationCount, 0);

  // グループの境界線スタイルを取得
  const getRowBorderClass = (row: ProgressRowDisplay, index: number, rows: ProgressRowDisplay[]): string => {
    const groupNumber = row.progress?.group_number;
    if (groupNumber == null) {
      return 'border-b-2 border-gray-300';
    }

    // グループの最後の行かどうか
    const nextRow = rows[index + 1];
    const isLastInGroup = !nextRow || nextRow.progress?.group_number !== groupNumber;
    
    return isLastInGroup ? 'border-b-2 border-gray-300' : 'border-b border-gray-200';
  };

  return (
    <div className="print-container p-8">
      {/* ヘッダー（PDF用） */}
      <div className="mb-8 print:mb-6">
        <h2 className="text-2xl font-bold text-center mb-4">学習進行表（ご提案内容）</h2>
        <div className="flex justify-between text-base text-[#2a2a2a]">
          <div>生徒名: {studentName}</div>
          <div>教材: {textbookName}</div>
        </div>
      </div>

      <table className="w-full border-collapse progress-table-parent">
        <thead>
          <tr>
            <th className="border border-gray-400 p-4 text-left font-semibold" style={{ width: '80%' }}>単元名</th>
            <th className="border border-gray-400 p-4 text-center font-semibold" style={{ width: '20%' }}>ご提案<br/>コマ数</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, index) => {
            const borderClass = getRowBorderClass(row, index, displayRows);
            const groupNumber = row.progress?.group_number;

            return (
              <tr 
                key={row.curriculumItem.id} 
                className={borderClass}
              >
                {/* 単元名 */}
                <td className="border-x border-gray-400 p-4">
                  <div className="flex items-center">
                    {/* グループインジケーター */}
                    {groupNumber != null && (
                      <div className={`w-1 h-6 mr-3 rounded ${
                        row.isGroupStart ? 'bg-gray-400' : 'bg-gray-300'
                      }`} />
                    )}
                    <span>
                      {row.curriculumItem.item_number && (
                        <span className="text-gray-600 mr-2">{row.curriculumItem.item_number}</span>
                      )}
                      {row.curriculumItem.title}
                    </span>
                  </div>
                </td>

                {/* 提案コマ数（セル結合） */}
                {row.isGroupStart && (
                  <td 
                    className="border-x border-gray-400 p-4 text-center text-lg font-medium"
                    rowSpan={row.groupRowSpan}
                    style={{
                      verticalAlign: 'middle',
                    }}
                  >
                    {row.groupProposalCount > 0 ? (
                      <span>{row.groupProposalCount}</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className="border border-gray-400 p-4 text-right">合計</td>
            <td className="border border-gray-400 p-4 text-center text-lg">
              {totalProposal}コマ
            </td>
          </tr>
        </tfoot>
      </table>

      {/* 注意書き */}
      <div className="mt-8 text-sm text-[#2a2a2a] print:mt-4">
        <p>※ 同じ背景色でまとまっている単元は、まとめて1コマで授業を行います。</p>
      </div>
    </div>
  );
}
