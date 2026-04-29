'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui';
import type { AssessmentWithScores } from '@/types/database';
import { ASSESSMENT_NAME_LABELS, GRADE_LABELS } from '@/types/database';
import { SUBJECT_CODES } from '@/types/database';
import { calcNaishin } from '@/lib/utils/convertedNaishin';
import type { NaishinType } from '@/lib/utils/convertedNaishin';

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
  onCellTab: (assessmentId: string, subject: string) => void;
  getCalculatedValue: (
    assessment: AssessmentWithScores,
    type: 'five_sum' | 'nine_sum'
  ) => string;
  canEdit: boolean;
  naishinType?: NaishinType;
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
  onCellTab,
  getCalculatedValue,
  canEdit,
  naishinType,
}: ScoreTableRowProps) {
  const scoreMap = new Map(assessment.scores.map((s) => [s.subject, s.value]));
  const tabTriggeredRef = useRef(false);

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
            onFocus={() => { tabTriggeredRef.current = false; }}
            onBlur={() => {
              if (tabTriggeredRef.current) {
                tabTriggeredRef.current = false;
                return;
              }
              onCellBlur(assessment.id, subject);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault();
                tabTriggeredRef.current = true;
                onCellTab(assessment.id, subject);
                return;
              }
              if (e.key === 'Enter') onCellBlur(assessment.id, subject);
              if (e.key === 'Escape') onCancelEdit();
            }}
            className="w-full px-1 py-0.5 text-center text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            autoFocus
          />
        ) : (
          <div
            className="min-h-[28px] flex items-center justify-center text-sm text-[var(--paragraph)] cursor-pointer hover:bg-[var(--surface)] rounded transition-colors duration-150"
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
      <tr className="hover:bg-[var(--surface)] transition-colors duration-150">
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

  // 換算内申の計算（report_card の場合のみ）
  let naishinDisplay: string | null = null;
  if (naishinType && category === 'report_card') {
    const scores: Record<string, number | null> = {};
    for (const subj of COMMON_9_SUBJECTS) {
      scores[subj] = scoreMap.get(subj) ?? null;
    }
    const result = calcNaishin(scores, naishinType);
    if (result.converted !== null) {
      naishinDisplay = `${result.converted}/${result.max_score}`;
    } else {
      naishinDisplay = '—';
    }
  }

  return (
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
      {naishinType && category === 'report_card' && (
        <td className="border border-gray-200 px-2 py-1.5 text-center text-sm font-medium text-[var(--paragraph)] bg-blue-50">
          {naishinDisplay}
        </td>
      )}
      {canEdit && (
        <td className="border border-gray-200 px-2 py-1.5 text-center">
          <Button variant="danger" size="sm" onClick={() => onDelete(assessment.id)}>
            削除
          </Button>
        </td>
      )}
    </tr>
  );
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
