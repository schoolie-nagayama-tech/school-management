'use client';

import Link from 'next/link';
import type { ScoreListStudent, ScoreListCategory } from '@/lib/utils/scoreListTransform';
import { getGradeLabel } from '@/lib/utils/scoreListTransform';
import { ScoreListCell, ScoreListSumCell } from './ScoreListCell';
import type { NaishinType } from '@/lib/utils/convertedNaishin';

// ── カラム定義 ──

interface ColumnDef {
  key: string;
  label: string;
  type: 'subject' | 'sum' | 'special';
}

const REPORT_CARD_COLUMNS: ColumnDef[] = [
  { key: 'english', label: '英語', type: 'subject' },
  { key: 'math', label: '数学', type: 'subject' },
  { key: 'japanese', label: '国語', type: 'subject' },
  { key: 'social', label: '社会', type: 'subject' },
  { key: 'science', label: '理科', type: 'subject' },
  { key: 'fiveSum', label: '5科合計', type: 'sum' },
  { key: 'music', label: '音楽', type: 'subject' },
  { key: 'art', label: '美術', type: 'subject' },
  { key: 'tech_home', label: '技術・家庭', type: 'subject' },
  { key: 'pe', label: '保体', type: 'subject' },
  { key: 'nineSum', label: '9科合計', type: 'sum' },
  { key: 'convertedNaishin', label: '換算内申', type: 'special' },
];

const REGULAR_TEST_COLUMNS: ColumnDef[] = [
  { key: 'english', label: '英語', type: 'subject' },
  { key: 'math', label: '数学', type: 'subject' },
  { key: 'japanese', label: '国語', type: 'subject' },
  { key: 'social', label: '社会', type: 'subject' },
  { key: 'science', label: '理科', type: 'subject' },
  { key: 'fiveSum', label: '5科合計', type: 'sum' },
];

const MOCK_COLUMNS: ColumnDef[] = [
  { key: 'english', label: '英語', type: 'subject' },
  { key: 'math', label: '数学', type: 'subject' },
  { key: 'japanese', label: '国語', type: 'subject' },
  { key: 'science', label: '理科', type: 'subject' },
  { key: 'social', label: '社会', type: 'subject' },
  { key: 'hensa3', label: '3科偏差値', type: 'special' },
  { key: 'hensa5', label: '5科偏差値', type: 'special' },
];

function getColumns(category: ScoreListCategory): ColumnDef[] {
  switch (category) {
    case 'report_card': return REPORT_CARD_COLUMNS;
    case 'regular_test': return REGULAR_TEST_COLUMNS;
    case 'mock': return MOCK_COLUMNS;
  }
}

// ── Props ──

interface ScoreListTableProps {
  students: ScoreListStudent[];
  category: ScoreListCategory;
  canEdit: boolean;
  editingCell: { assessmentId: string; subject: string } | null;
  cellValue: string;
  onCellClick: (assessmentId: string, subject: string, value: number | null) => void;
  onCellChange: (value: string) => void;
  onCellBlur: (assessmentId: string, subject: string) => void;
  onCancelEdit: () => void;
  naishinType?: NaishinType;
}

// ── コンポーネント ──

export function ScoreListTable({
  students,
  category,
  canEdit,
  editingCell,
  cellValue,
  onCellClick,
  onCellChange,
  onCellBlur,
  onCancelEdit,
  naishinType,
}: ScoreListTableProps) {
  const columns = getColumns(category);

  if (students.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400 italic">
        成績データがありません
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-200 px-2 py-2 text-left font-medium text-gray-700 min-w-[120px] whitespace-nowrap">
              学校
            </th>
            <th className="border border-gray-200 px-2 py-2 text-left font-medium text-gray-700 min-w-[48px]">
              学年
            </th>
            <th className="border border-gray-200 px-2 py-2 text-left font-medium text-gray-700 min-w-[80px]">
              名前（リンク）
            </th>
            <th className="border border-gray-200 px-2 py-2 text-center font-medium text-gray-700 min-w-[80px]">
              {category === 'report_card' ? '' : ''}
            </th>
            {columns.map((col) => (
              <th
                key={col.key}
                className={`border border-gray-200 px-2 py-2 text-center font-medium text-gray-700 min-w-[52px] whitespace-nowrap ${
                  col.type === 'sum' || col.type === 'special' ? 'bg-gray-50' : ''
                }`}
              >
                {col.label}
                {col.key === 'convertedNaishin' && naishinType && (
                  <span className="block text-[10px] text-gray-400 font-normal">
                    ({naishinType === 'tokyo' ? '都立' : '神奈川'})
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <StudentGroup
              key={student.studentId}
              student={student}
              category={category}
              columns={columns}
              canEdit={canEdit}
              editingCell={editingCell}
              cellValue={cellValue}
              onCellClick={onCellClick}
              onCellChange={onCellChange}
              onCellBlur={onCellBlur}
              onCancelEdit={onCancelEdit}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 生徒グループ ──

function StudentGroup({
  student,
  category: _category,
  columns,
  canEdit,
  editingCell,
  cellValue,
  onCellClick,
  onCellChange,
  onCellBlur,
  onCancelEdit,
}: {
  student: ScoreListStudent;
  category: ScoreListCategory;
  columns: ColumnDef[];
  canEdit: boolean;
  editingCell: { assessmentId: string; subject: string } | null;
  cellValue: string;
  onCellClick: (assessmentId: string, subject: string, value: number | null) => void;
  onCellChange: (value: string) => void;
  onCellBlur: (assessmentId: string, subject: string) => void;
  onCancelEdit: () => void;
}) {
  const rowCount = student.rows.length;

  return (
    <>
      {student.rows.map((row, rowIdx) => (
        <tr
          key={row.assessmentId}
          className={`${rowIdx === rowCount - 1 ? 'border-b-2 border-b-gray-300' : ''} hover:bg-blue-50/30`}
        >
          {/* 学校（最初の行のみ） */}
          {rowIdx === 0 && (
            <td
              className="border border-gray-200 px-2 py-1 text-xs text-gray-700 whitespace-nowrap bg-white"
              rowSpan={rowCount}
            >
              {student.schoolName || <span className="text-gray-300">—</span>}
            </td>
          )}
          {/* 学年（最初の行のみ） */}
          {rowIdx === 0 && (
            <td
              className="border border-gray-200 px-2 py-1 text-center text-xs font-medium text-gray-600 bg-white"
              rowSpan={rowCount}
            >
              {getGradeLabel(student.grade)}
            </td>
          )}
          {/* 名前（最初の行のみ） */}
          {rowIdx === 0 && (
            <td
              className="border border-gray-200 px-2 py-1 bg-white"
              rowSpan={rowCount}
            >
              <Link
                href={`/students/${student.studentId}/scores`}
                className="text-xs font-medium text-[#1e3a5f] hover:text-[#3b82f6] hover:underline whitespace-nowrap"
              >
                {student.lastName} {student.firstName}
              </Link>
            </td>
          )}
          {/* 学期 / テスト名 */}
          <td className="border border-gray-200 px-2 py-1 text-center text-xs text-gray-600 whitespace-nowrap">
            {row.label}
          </td>
          {/* スコアカラム */}
          {columns.map((col) => {
            if (col.type === 'subject') {
              const isEditing =
                editingCell?.assessmentId === row.assessmentId && editingCell?.subject === col.key;
              return (
                <ScoreListCell
                  key={col.key}
                  value={row.scores[col.key] ?? null}
                  diff={row.diffs[col.key] ?? null}
                  assessmentId={row.assessmentId}
                  subject={col.key}
                  canEdit={canEdit}
                  isEditing={isEditing}
                  editValue={cellValue}
                  onCellClick={onCellClick}
                  onCellChange={onCellChange}
                  onCellBlur={onCellBlur}
                  onCancelEdit={onCancelEdit}
                />
              );
            }
            if (col.key === 'fiveSum') {
              return <ScoreListSumCell key={col.key} value={row.fiveSum} diff={row.fiveSumDiff} />;
            }
            if (col.key === 'nineSum') {
              return <ScoreListSumCell key={col.key} value={row.nineSum} diff={row.nineSumDiff} />;
            }
            if (col.key === 'convertedNaishin') {
              return <ScoreListSumCell key={col.key} value={row.convertedNaishin} diff={row.convertedNaishinDiff} />;
            }
            if (col.key === 'hensa3') {
              const isEditing =
                editingCell?.assessmentId === row.assessmentId && editingCell?.subject === 'hensa_3';
              return (
                <ScoreListCell
                  key={col.key}
                  value={row.hensa3}
                  diff={row.hensa3Diff}
                  assessmentId={row.assessmentId}
                  subject="hensa_3"
                  canEdit={canEdit}
                  isEditing={isEditing}
                  editValue={cellValue}
                  onCellClick={onCellClick}
                  onCellChange={onCellChange}
                  onCellBlur={onCellBlur}
                  onCancelEdit={onCancelEdit}
                />
              );
            }
            if (col.key === 'hensa5') {
              const isEditing =
                editingCell?.assessmentId === row.assessmentId && editingCell?.subject === 'hensa_5';
              return (
                <ScoreListCell
                  key={col.key}
                  value={row.hensa5}
                  diff={row.hensa5Diff}
                  assessmentId={row.assessmentId}
                  subject="hensa_5"
                  canEdit={canEdit}
                  isEditing={isEditing}
                  editValue={cellValue}
                  onCellClick={onCellClick}
                  onCellChange={onCellChange}
                  onCellBlur={onCellBlur}
                  onCancelEdit={onCancelEdit}
                />
              );
            }
            return null;
          })}
        </tr>
      ))}
    </>
  );
}
