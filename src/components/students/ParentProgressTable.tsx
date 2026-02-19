'use client';

import type { ProgressRowDisplay } from '@/types/database';

interface Props {
  displayRows: ProgressRowDisplay[];
  studentName: string;
  textbookName: string;
  showProposalCount?: boolean;
  showApplicationCount?: boolean;
  showExamRange?: boolean;
  showSchoolProgress?: boolean;
  showLesson1?: boolean;
  showLesson2?: boolean;
  showLesson3?: boolean;
  showHandover?: boolean;
  onColumnVisibilityChange?: (column: string, visible: boolean) => void;
}

export default function ParentProgressTable({ 
  displayRows, 
  studentName, 
  textbookName,
  showProposalCount = true,
  showApplicationCount = false,
  showExamRange = false,
  showSchoolProgress = false,
  showLesson1 = false,
  showLesson2 = false,
  showLesson3 = false,
  showHandover = false,
  onColumnVisibilityChange: _onColumnVisibilityChange,
}: Props) {
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
        <div className="flex justify-between text-base text-[#4b5563]">
          <div>生徒名: {studentName}</div>
          <div>教材: {textbookName}</div>
        </div>
      </div>

      <table className="w-full border-collapse progress-table-parent">
        <thead>
          <tr>
            <th className="border border-gray-400 p-4 text-left font-semibold">単元名</th>
            {showProposalCount && (
              <th className="border border-gray-400 p-4 text-center font-semibold">ご提案<br/>コマ数</th>
            )}
            {showApplicationCount && (
              <th className="border border-gray-400 p-4 text-center font-semibold">申込<br/>コマ数</th>
            )}
            {showExamRange && (
              <th className="border border-gray-400 p-4 text-center font-semibold">試験範囲</th>
            )}
            {showSchoolProgress && (
              <th className="border border-gray-400 p-4 text-center font-semibold">学校進度</th>
            )}
            {showLesson1 && (
              <th className="border border-gray-400 p-4 text-center font-semibold">指導日①</th>
            )}
            {showLesson2 && (
              <th className="border border-gray-400 p-4 text-center font-semibold">指導日②</th>
            )}
            {showLesson3 && (
              <th className="border border-gray-400 p-4 text-center font-semibold">指導日③</th>
            )}
            {showHandover && (
              <th className="border border-gray-400 p-4 text-center font-semibold">引継ぎ</th>
            )}
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
                {showProposalCount && row.isGroupStart && (
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
                {/* 申込コマ数 */}
                {showApplicationCount && row.isGroupStart && (
                  <td 
                    className="border-x border-gray-400 p-4 text-center"
                    rowSpan={row.groupRowSpan}
                    style={{
                      verticalAlign: 'middle',
                    }}
                  >
                    {row.groupApplicationCount > 0 ? (
                      <span>{row.groupApplicationCount}</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                )}
                {/* 試験範囲 */}
                {showExamRange && (
                  <td className="border-x border-gray-400 p-4 text-center text-sm">
                    {row.progress?.exam_range_exam_type ? (
                      <span>{row.progress.exam_range_exam_type}</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                )}
                {/* 学校進度 */}
                {showSchoolProgress && (
                  <td className="border-x border-gray-400 p-4 text-center text-sm">
                    {row.progress?.school_progress_date ? (
                      <span>{row.progress.school_progress_date}</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                )}
                {/* 指導日① */}
                {showLesson1 && (
                  <td className="border-x border-gray-400 p-4 text-center text-sm">
                    {row.progress?.lessons && row.progress.lessons[0]?.lesson_date ? (
                      <span>{row.progress.lessons[0].lesson_date}</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                )}
                {/* 指導日② */}
                {showLesson2 && (
                  <td className="border-x border-gray-400 p-4 text-center text-sm">
                    {row.progress?.lessons && row.progress.lessons[1]?.lesson_date ? (
                      <span>{row.progress.lessons[1].lesson_date}</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                )}
                {/* 指導日③ */}
                {showLesson3 && (
                  <td className="border-x border-gray-400 p-4 text-center text-sm">
                    {row.progress?.lessons && row.progress.lessons[2]?.lesson_date ? (
                      <span>{row.progress.lessons[2].lesson_date}</span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                )}
                {/* 引継ぎ */}
                {showHandover && (
                  <td className="border-x border-gray-400 p-4 text-sm">
                    {row.progress?.handover ? (
                      <span>{row.progress.handover}</span>
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
            {showProposalCount && (
              <td className="border border-gray-400 p-4 text-center text-lg">
                {totalProposal}コマ
              </td>
            )}
            {showApplicationCount && (
              <td className="border border-gray-400 p-4 text-center text-lg">
                {totalApplication}コマ
              </td>
            )}
            {showExamRange && <td className="border border-gray-400 p-4"></td>}
            {showSchoolProgress && <td className="border border-gray-400 p-4"></td>}
            {showLesson1 && <td className="border border-gray-400 p-4"></td>}
            {showLesson2 && <td className="border border-gray-400 p-4"></td>}
            {showLesson3 && <td className="border border-gray-400 p-4"></td>}
            {showHandover && <td className="border border-gray-400 p-4"></td>}
          </tr>
        </tfoot>
      </table>

      {/* 注意書き */}
      <div className="mt-8 text-sm text-[#4b5563] print:mt-4">
        <p>※ 同じ背景色でまとまっている単元は、まとめて1コマで授業を行います。</p>
      </div>
    </div>
  );
}
