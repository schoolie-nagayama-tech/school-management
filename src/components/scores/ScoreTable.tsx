'use client';

import { useState } from 'react';
import type { AssessmentWithScores } from '@/types/database';
import { SUBJECT_LABELS } from '@/types/database';
import { SUBJECT_CODES } from '@/types/database';
import { ScoreTableRow, getCalculatedValue } from './ScoreTableRow';
import type { NaishinType } from '@/lib/utils/convertedNaishin';

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
  const [naishinType, setNaishinType] = useState<NaishinType>('tokyo');

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
                  データがありません。上の「テストを追加」から登録してください。
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

  const isReportCard = category === 'report_card';
  const colSpanBase = 2 + 5 + 1 + 4 + 1; // 学年+テスト名+5科+5科計+4科+9科計 = 13
  const totalColSpan = colSpanBase + (isReportCard ? 1 : 0) + (canEdit ? 1 : 0);

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
            {isReportCard && (
              <th className="px-2 py-2 text-center font-semibold text-[var(--headline)] min-w-[80px]">
                <div className="flex flex-col items-center gap-0.5">
                  <span>換算内申</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setNaishinType('tokyo')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        naishinType === 'tokyo'
                          ? 'bg-[#1e3a5f] text-white'
                          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      }`}
                    >
                      都立
                    </button>
                    <button
                      type="button"
                      onClick={() => setNaishinType('kanagawa')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        naishinType === 'kanagawa'
                          ? 'bg-[#1e3a5f] text-white'
                          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      }`}
                    >
                      神奈川
                    </button>
                  </div>
                </div>
              </th>
            )}
            {canEdit && <th className="px-2 py-2 text-center font-semibold text-[var(--headline)] w-20">操作</th>}
          </tr>
        </thead>
        <tbody>
          {assessments.length === 0 ? (
            <tr>
              <td colSpan={totalColSpan} className="px-4 py-8 text-center text-[var(--paragraph)]">
                データがありません。上の「テストを追加」から登録してください。
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
                naishinType={isReportCard ? naishinType : undefined}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
