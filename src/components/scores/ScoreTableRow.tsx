'use client';

import { Button } from '@/components/ui';
import type { AssessmentWithScores } from '@/types/database';
import { SUBJECT_LABELS, ASSESSMENT_NAME_LABELS, GRADE_LABELS } from '@/types/database';
import { SUBJECT_CODES } from '@/types/database';

const FIVE_SUBJECTS = [
  SUBJECT_CODES.ENGLISH,
  SUBJECT_CODES.MATH,
  SUBJECT_CODES.JAPANESE,
  SUBJECT_CODES.SOCIAL,
  SUBJECT_CODES.SCIENCE,
] as const;

const COMMON_9_SUBJECTS = [
  SUBJECT_CODES.ENGLISH,
  SUBJECT_CODES.MATH,
  SUBJECT_CODES.JAPANESE,
  SUBJECT_CODES.SOCIAL,
  SUBJECT_CODES.SCIENCE,
  SUBJECT_CODES.MUSIC,
  SUBJECT_CODES.ART,
  SUBJECT_CODES.TECH_HOME,
  SUBJECT_CODES.PE,
] as const;

type Category = 'regular_test' | 'report_card' | 'mock';

interface ScoreTableRowProps {
  assessment: AssessmentWithScores;
  category: Category;
  editingCell: { assessmentId: string; subject: string } | null;
  cellValue: string;
  onCellClick: (assessmentId: string, subject: string, value: number | null) => void;
  onCellBlur: (assessmentId: string, subject: string) => void;
  onCellChange: (value: string) => void;
  onCancelEdit: () => void;
  onDelete: (assessmentId: string) => void;
  getCalculatedValue: (
    assessment: AssessmentWithScores,
    type: 'five_sum' | 'nine_sum'
  ) => string;
  canEdit: boolean;
}

export function ScoreTableRow({
  assessment,
  category,
  editingCell,
  cellValue,
  onCellClick,
  onCellBlur,
  onCellChange,
  onCancelEdit,
  onDelete,
  getCalculatedValue,
  canEdit,
}: ScoreTableRowProps) {
  const scoreMap = new Map(assessment.scores.map((s) => [s.subject, s.value]));

  const renderCell = (subject: string) => {
    const value = scoreMap.get(subject) ?? null;
    const isEditing =
      editingCell?.assessmentId === assessment.id && editingCell?.subject === subject;

    return (
      <td key={subject} className="border border-gray-200 px-2 py-1.5 text-center min-w-[52px]">
        {isEditing ? (
          <input
            type="text"
            value={cellValue}
            onChange={(e) => onCellChange(e.target.value)}
            onBlur={() => onCellBlur(assessment.id, subject)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCellBlur(assessment.id, subject);
              if (e.key === 'Escape') onCancelEdit();
            }}
            className="w-full px-1 py-0.5 text-center text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            autoFocus
          />
        ) : (
          <div
            className="min-h-[28px] flex items-center justify-center text-sm text-[var(--paragraph)] cursor-pointer hover:bg-[var(--surface)] rounded"
            onClick={() => onCellClick(assessment.id, subject, value)}
          >
            {value !== null && value !== undefined ? value : '—'}
          </div>
        )}
      </td>
    );
  };

  const examMonthLabel = assessment.exam_month
    ? `${new Date(assessment.exam_month).getFullYear()}-${String(new Date(assessment.exam_month).getMonth() + 1).padStart(2, '0')}`
    : '—';

  if (category === 'mock') {
    return (
      <tr className="hover:bg-[var(--surface)]">
        <td className="border border-gray-200 px-2 py-1.5 text-sm text-[var(--headline)] whitespace-nowrap">
          {GRADE_LABELS[assessment.grade] ?? assessment.grade}
        </td>
        <td className="border border-gray-200 px-2 py-1.5 text-sm text-[var(--paragraph)] whitespace-nowrap">
          {ASSESSMENT_NAME_LABELS[assessment.name_code] || assessment.name_code}
        </td>
        <td className="border border-gray-200 px-2 py-1.5 text-sm text-[var(--paragraph)] whitespace-nowrap">
          {examMonthLabel}
        </td>
        {FIVE_SUBJECTS.map((subj) => renderCell(subj))}
        {renderCell('hensa_3')}
        {renderCell('hensa_5')}
      </tr>
    );
  }

  const fiveSum = getCalculatedValue(assessment, 'five_sum');
  const nineSum = getCalculatedValue(assessment, 'nine_sum');

  const regularRow = (
    <tr className="hover:bg-[var(--surface)]">
      <td className="border border-gray-200 px-2 py-1.5 text-sm text-[var(--headline)] whitespace-nowrap">
        {GRADE_LABELS[assessment.grade] ?? assessment.grade}
      </td>
      <td className="border border-gray-200 px-2 py-1.5 text-sm text-[var(--paragraph)] whitespace-nowrap">
        {ASSESSMENT_NAME_LABELS[assessment.name_code] || assessment.name_code}
      </td>
      {FIVE_SUBJECTS.map((subj) => renderCell(subj))}
      <td className="border border-gray-200 px-2 py-1.5 text-center text-sm font-medium text-[var(--paragraph)]">
        {fiveSum}
      </td>
      {(['music', 'art', 'tech_home', 'pe'] as const).map((subj) => renderCell(subj))}
      <td className="border border-gray-200 px-2 py-1.5 text-center text-sm font-medium text-[var(--paragraph)]">
        {nineSum}
      </td>
      {canEdit && (
        <td className="border border-gray-200 px-2 py-1.5 text-center">
          <Button variant="danger" size="sm" onClick={() => onDelete(assessment.id)}>
            削除
          </Button>
        </td>
      )}
    </tr>
  );
  return regularRow;
}

export function getCalculatedValue(
  assessment: AssessmentWithScores,
  type: 'five_sum' | 'nine_sum'
): string {
  const scores = assessment.scores || [];
  const scoreMap = new Map(scores.map((s) => [s.subject, s.value]));
  if (type === 'five_sum') {
    const values = FIVE_SUBJECTS.map((subj) => scoreMap.get(subj)).filter(
      (v): v is number => v !== null && v !== undefined
    );
    if (values.length === 0) return '—';
    return values.reduce((sum, v) => sum + v, 0).toString();
  }
  const values = COMMON_9_SUBJECTS.map((subj) => scoreMap.get(subj)).filter(
    (v): v is number => v !== null && v !== undefined
  );
  if (values.length === 0) return '—';
  return values.reduce((sum, v) => sum + v, 0).toString();
}
