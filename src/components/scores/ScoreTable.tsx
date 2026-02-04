'use client';

import type { AssessmentWithScores } from '@/types/database';
import { SUBJECT_LABELS } from '@/types/database';
import { SUBJECT_CODES } from '@/types/database';
import { ScoreTableRow, getCalculatedValue } from './ScoreTableRow';

const FIVE_SUBJECTS = [
  SUBJECT_CODES.ENGLISH,
  SUBJECT_CODES.MATH,
  SUBJECT_CODES.JAPANESE,
  SUBJECT_CODES.SOCIAL,
  SUBJECT_CODES.SCIENCE,
] as const;

type Category = 'regular_test' | 'report_card' | 'mock';

interface ScoreTableProps {
  category: Category;
  assessments: AssessmentWithScores[];
  editingCell: { assessmentId: string; subject: string } | null;
  cellValue: string;
  onCellClick: (assessmentId: string, subject: string, value: number | null) => void;
  onCellBlur: (assessmentId: string, subject: string) => void;
  onCellChange: (value: string) => void;
  onCancelEdit: () => void;
  onDelete: (assessmentId: string) => void;
  canEdit: boolean;
}

export function ScoreTable({
  category,
  assessments,
  editingCell,
  cellValue,
  onCellClick,
  onCellBlur,
  onCellChange,
  onCancelEdit,
  onDelete,
  canEdit,
}: ScoreTableProps) {
  if (category === 'mock') {
    return (
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[var(--surface)] border-b border-gray-200">
              <th className="px-2 py-2 text-left font-semibold text-[var(--headline)] whitespace-nowrap">学年</th>
              <th className="px-2 py-2 text-left font-semibold text-[var(--headline)] whitespace-nowrap">テスト名</th>
              <th className="px-2 py-2 text-left font-semibold text-[var(--headline)] whitespace-nowrap">実施月</th>
              {FIVE_SUBJECTS.map((subj) => (
                <th key={subj} className="px-2 py-2 text-center font-semibold text-[var(--headline)] min-w-[52px]">
                  {SUBJECT_LABELS[subj]}
                </th>
              ))}
              <th className="px-2 py-2 text-center font-semibold text-[var(--headline)] min-w-[52px]">3科</th>
              <th className="px-2 py-2 text-center font-semibold text-[var(--headline)] min-w-[52px]">5科</th>
            </tr>
          </thead>
          <tbody>
            {assessments.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-[var(--paragraph)]">
                  データがありません
                </td>
              </tr>
            ) : (
              assessments.map((a) => (
                <ScoreTableRow
                  key={a.id}
                  assessment={a}
                  category="mock"
                  editingCell={editingCell}
                  cellValue={cellValue}
                  onCellClick={onCellClick}
                  onCellBlur={onCellBlur}
                  onCellChange={onCellChange}
                  onCancelEdit={onCancelEdit}
                  onDelete={onDelete}
                  getCalculatedValue={getCalculatedValue}
                  canEdit={canEdit}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  }

  const nineSubjects = [
    SUBJECT_CODES.MUSIC,
    SUBJECT_CODES.ART,
    SUBJECT_CODES.TECH_HOME,
    SUBJECT_CODES.PE,
  ] as const;

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-[var(--surface)] border-b border-gray-200">
            <th className="px-2 py-2 text-left font-semibold text-[var(--headline)] whitespace-nowrap">学年</th>
            <th className="px-2 py-2 text-left font-semibold text-[var(--headline)] whitespace-nowrap">テスト名</th>
            {FIVE_SUBJECTS.map((subj) => (
              <th key={subj} className="px-2 py-2 text-center font-semibold text-[var(--headline)] min-w-[52px]">
                {SUBJECT_LABELS[subj]}
              </th>
            ))}
            <th className="px-2 py-2 text-center font-semibold text-[var(--headline)]">5科計</th>
            {nineSubjects.map((subj) => (
              <th key={subj} className="px-2 py-2 text-center font-semibold text-[var(--headline)] min-w-[52px]">
                {SUBJECT_LABELS[subj]}
              </th>
            ))}
            <th className="px-2 py-2 text-center font-semibold text-[var(--headline)]">9科計</th>
            {canEdit && <th className="px-2 py-2 text-center font-semibold text-[var(--headline)] w-20">操作</th>}
          </tr>
        </thead>
        <tbody>
          {assessments.length === 0 ? (
            <tr>
              <td colSpan={canEdit ? 14 : 13} className="px-4 py-8 text-center text-[var(--paragraph)]">
                データがありません
              </td>
            </tr>
          ) : (
            assessments.map((a) => (
              <ScoreTableRow
                key={a.id}
                assessment={a}
                category={category}
                editingCell={editingCell}
                cellValue={cellValue}
                onCellClick={onCellClick}
                onCellBlur={onCellBlur}
                onCellChange={onCellChange}
                onCancelEdit={onCancelEdit}
                onDelete={onDelete}
                getCalculatedValue={getCalculatedValue}
                canEdit={canEdit}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
