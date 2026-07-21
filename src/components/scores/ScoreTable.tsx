'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import type { AssessmentWithScores } from '@/types/database';
import { ASSESSMENT_NAME_LABELS, GRADE_LABELS, SUBJECT_LABELS } from '@/types/database';
import { SUBJECT_CODES } from '@/types/database';
import { ScoreTableRow, getCalculatedValue } from './ScoreTableRow';
import type { NaishinType } from '@/lib/utils/convertedNaishin';
import { Button } from '@/components/ui';
import { getAssessmentSubjects, type AssessmentSubject } from '@/lib/api/assessmentSubjects';

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
  /** 行削除の可否（canEdit より狭い。講師は編集はできるが削除はできない） */
  canDelete: boolean;
  /** 生徒の学年。10以上のとき高校生用の動的科目を使用 */
  studentGrade?: number;
  /** 生徒の所属教室ID。科目マスタの絞り込みに使用 */
  schoolId?: string | null;
  /** 行の並び替えコールバック（fromIndex → toIndex） */
  onReorder?: (fromIdx: number, toIdx: number) => void;
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
  canDelete,
  studentGrade,
  schoolId,
  onReorder,
}: ScoreTableProps) {
  const [naishinType, setNaishinType] = useState<NaishinType>('tokyo');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const isHighSchool = (studentGrade ?? 0) >= 10;
  const [hsSubjects, setHsSubjects] = useState<AssessmentSubject[]>([]);
  const tabTriggeredRef = useRef(false);

  useEffect(() => {
    if (!isHighSchool) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await getAssessmentSubjects({
          schoolType: '高校',
          grade: studentGrade,
          schoolId: schoolId ?? undefined,
        });
        if (!cancelled) setHsSubjects(list);
      } catch (e) {
        console.error('評価科目マスタの取得に失敗:', e);
        if (!cancelled) setHsSubjects([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isHighSchool, studentGrade, schoolId]);

  /** 高校生用：表示するコード列（マスタ + 既存登録の救済） */
  const hsAllCodes = useMemo(() => {
    if (!isHighSchool) return [] as string[];
    const set = new Set<string>(hsSubjects.map((s) => s.code));
    const tail: string[] = [];
    for (const a of assessments) {
      for (const s of a.scores ?? []) {
        if (s.subject && !set.has(s.subject) && !tail.includes(s.subject)) {
          tail.push(s.subject);
        }
      }
    }
    return [...hsSubjects.map((s) => s.code), ...tail];
  }, [isHighSchool, hsSubjects, assessments]);

  const handleCellTabForRow = useCallback(
    (assessmentId: string, subject: string, orderedSubjects: string[]) => {
      const colIdx = orderedSubjects.indexOf(subject);
      let nextId = assessmentId;
      let nextSubj: string | null = null;

      if (colIdx < orderedSubjects.length - 1) {
        nextSubj = orderedSubjects[colIdx + 1];
      } else {
        const rowIdx = assessments.findIndex((a) => a.id === assessmentId);
        if (rowIdx < assessments.length - 1) {
          nextId = assessments[rowIdx + 1].id;
          nextSubj = orderedSubjects[0];
        }
      }

      onCellBlur(assessmentId, subject);
      if (nextSubj !== null) {
        const nextAssessment = assessments.find((a) => a.id === nextId)!;
        const scoreMap = new Map(
          (nextAssessment.scores ?? []).map((s) => [s.subject, s.value ?? null])
        );
        onCellClick(nextId, nextSubj, scoreMap.get(nextSubj) ?? null);
      }
    },
    [assessments, onCellBlur, onCellClick]
  );

  const labelOfHs = (code: string): string => {
    const meta = hsSubjects.find((s) => s.code === code);
    if (meta) return meta.short_name ?? meta.name;
    return SUBJECT_LABELS[code] ?? code;
  };

  // ────────────────── 高校生用：動的カラム ──────────────────
  if (isHighSchool) {
    const totalCols = 2 + (category !== 'mock' ? 0 : 1) + hsAllCodes.length + (canEdit ? 1 : 0);
    return (
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[var(--surface)] border-b border-gray-200">
              <th className="px-2 py-2 text-left font-semibold text-[var(--headline)] whitespace-nowrap">
                学年
              </th>
              <th className="px-2 py-2 text-left font-semibold text-[var(--headline)] whitespace-nowrap">
                テスト名
              </th>
              {category === 'mock' && (
                <th className="px-2 py-2 text-left font-semibold text-[var(--headline)] whitespace-nowrap">
                  実施月
                </th>
              )}
              {hsAllCodes.map((code) => {
                const isCustom = !hsSubjects.some((s) => s.code === code);
                return (
                  <th
                    key={code}
                    className={`px-2 py-2 text-center font-semibold whitespace-nowrap min-w-[58px] ${isCustom ? 'text-amber-700 italic' : 'text-[var(--headline)]'}`}
                    title={isCustom ? '（マスタ外の科目／旧データ）' : labelOfHs(code)}
                  >
                    {labelOfHs(code)}
                  </th>
                );
              })}
              {canEdit && (
                <th className="px-2 py-2 text-center font-semibold text-[var(--headline)] w-20">
                  操作
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {assessments.length === 0 ? (
              <tr>
                <td colSpan={totalCols} className="px-4 py-8 text-center text-[var(--paragraph)]">
                  データがありません。上の「行を追加」から登録してください。
                </td>
              </tr>
            ) : (
              assessments.map((a, idx) => {
                const scoreMap = new Map<string, number | null>(
                  (a.scores ?? []).map((s) => [s.subject, s.value ?? null])
                );
                const examMonthLabel = a.exam_month
                  ? `${new Date(a.exam_month).getFullYear()}-${String(new Date(a.exam_month).getMonth() + 1).padStart(2, '0')}`
                  : '—';
                const isDraggingRow = dragIdx === idx;
                const isDragOverRow = dragOverIdx === idx && dragIdx !== idx;
                return (
                  <tr
                    key={a.id}
                    className={`transition-colors duration-150 ${isDragOverRow ? 'bg-blue-50 border-t-2 border-blue-300' : 'hover:bg-[var(--surface)]'} ${isDraggingRow ? 'opacity-40' : ''}`}
                    draggable={canEdit && !!onReorder}
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverIdx(idx);
                    }}
                    onDrop={() => {
                      if (dragIdx !== null && dragIdx !== idx) onReorder?.(dragIdx, idx);
                      setDragIdx(null);
                      setDragOverIdx(null);
                    }}
                    onDragEnd={() => {
                      setDragIdx(null);
                      setDragOverIdx(null);
                    }}
                  >
                    <td className="border border-gray-200 px-2 py-1.5 text-sm text-[var(--headline)] whitespace-nowrap">
                      {GRADE_LABELS[a.grade] ?? a.grade}
                    </td>
                    <td className="border border-gray-200 px-2 py-1.5 text-sm text-[var(--paragraph)] whitespace-nowrap">
                      {ASSESSMENT_NAME_LABELS[a.name_code] || a.name_code}
                    </td>
                    {category === 'mock' && (
                      <td className="border border-gray-200 px-2 py-1.5 text-sm text-[var(--paragraph)] whitespace-nowrap">
                        {examMonthLabel}
                      </td>
                    )}
                    {hsAllCodes.map((code) => {
                      const value = scoreMap.get(code) ?? null;
                      const isEditing =
                        editingCell?.assessmentId === a.id && editingCell?.subject === code;
                      return (
                        <td
                          key={code}
                          className="border border-gray-200 px-1 py-1 text-center min-w-[52px]"
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              value={cellValue}
                              onChange={(e) => onCellChange(e.target.value)}
                              onFocus={() => {
                                tabTriggeredRef.current = false;
                              }}
                              onBlur={() => {
                                if (tabTriggeredRef.current) {
                                  tabTriggeredRef.current = false;
                                  return;
                                }
                                onCellBlur(a.id, code);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Tab') {
                                  e.preventDefault();
                                  tabTriggeredRef.current = true;
                                  handleCellTabForRow(a.id, code, hsAllCodes);
                                  return;
                                }
                                if (e.key === 'Enter') onCellBlur(a.id, code);
                                if (e.key === 'Escape') onCancelEdit();
                              }}
                              autoFocus
                              className="w-full px-1 py-0.5 text-center text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                            />
                          ) : (
                            <div
                              className="min-h-[28px] flex items-center justify-center text-sm text-[var(--paragraph)] cursor-pointer hover:bg-[var(--surface)] rounded transition-colors duration-150"
                              onClick={() => canEdit && onCellClick(a.id, code, value)}
                            >
                              {value !== null && value !== undefined ? value : '—'}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    {canEdit && (
                      <td className="border border-gray-200 px-2 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {canDelete && (
                            <Button variant="danger" size="sm" onClick={() => onDelete(a.id)}>
                              削除
                            </Button>
                          )}
                          {onReorder && (
                            <span
                              className="text-gray-300 hover:text-gray-500 cursor-grab transition-colors"
                              title="ドラッグして並び替え"
                            >
                              <GripVertical className="w-4 h-4" />
                            </span>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    );
  }

  // ────────────────── 中学・小学：従来の固定カラム ──────────────────
  if (category === 'mock') {
    return (
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[var(--surface)] border-b border-gray-200">
              <th className="px-2 py-2 text-left font-semibold text-[var(--headline)] whitespace-nowrap">
                学年
              </th>
              <th className="px-2 py-2 text-left font-semibold text-[var(--headline)] whitespace-nowrap">
                テスト名
              </th>
              <th className="px-2 py-2 text-left font-semibold text-[var(--headline)] whitespace-nowrap">
                実施月
              </th>
              {FIVE_SUBJECTS.map((subj) => (
                <th
                  key={subj}
                  className="px-2 py-2 text-center font-semibold text-[var(--headline)] min-w-[52px]"
                >
                  {SUBJECT_LABELS[subj]}
                </th>
              ))}
              <th className="px-2 py-2 text-center font-semibold text-[var(--headline)] min-w-[52px]">
                3科
              </th>
              <th className="px-2 py-2 text-center font-semibold text-[var(--headline)] min-w-[52px]">
                5科
              </th>
              {canEdit && (
                <th className="px-2 py-2 text-center font-semibold text-[var(--headline)] w-20">
                  操作
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {assessments.length === 0 ? (
              <tr>
                <td
                  colSpan={canEdit ? 11 : 10}
                  className="px-4 py-8 text-center text-[var(--paragraph)]"
                >
                  データがありません。上の「行を追加」から登録してください。
                </td>
              </tr>
            ) : (
              assessments.map((a, idx) => (
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
                  canDelete={canDelete}
                  onCellTab={(aId, subj) =>
                    handleCellTabForRow(aId, subj, [
                      'english',
                      'math',
                      'japanese',
                      'social',
                      'science',
                      'hensa_3',
                      'hensa_5',
                    ])
                  }
                  showDragHandle={canEdit && !!onReorder}
                  isDragging={dragIdx === idx}
                  isDragOver={dragOverIdx === idx && dragIdx !== idx}
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverIdx(idx);
                  }}
                  onDrop={() => {
                    if (dragIdx !== null && dragIdx !== idx) onReorder?.(dragIdx, idx);
                    setDragIdx(null);
                    setDragOverIdx(null);
                  }}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setDragOverIdx(null);
                  }}
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
  const colSpanBase = 2 + 5 + 1 + 4 + 1;
  const totalColSpan = colSpanBase + (isReportCard ? 1 : 0) + (canEdit ? 1 : 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-[var(--surface)] border-b border-gray-200">
            <th className="px-2 py-2 text-left font-semibold text-[var(--headline)] whitespace-nowrap">
              学年
            </th>
            <th className="px-2 py-2 text-left font-semibold text-[var(--headline)] whitespace-nowrap">
              テスト名
            </th>
            {FIVE_SUBJECTS.map((subj) => (
              <th
                key={subj}
                className="px-2 py-2 text-center font-semibold text-[var(--headline)] min-w-[52px]"
              >
                {SUBJECT_LABELS[subj]}
              </th>
            ))}
            <th className="px-2 py-2 text-center font-semibold text-[var(--headline)]">5科計</th>
            {nineSubjects.map((subj) => (
              <th
                key={subj}
                className="px-2 py-2 text-center font-semibold text-[var(--headline)] min-w-[52px]"
              >
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
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] ${
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
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] ${
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
            {canEdit && (
              <th className="px-2 py-2 text-center font-semibold text-[var(--headline)] w-20">
                操作
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {assessments.length === 0 ? (
            <tr>
              <td colSpan={totalColSpan} className="px-4 py-8 text-center text-[var(--paragraph)]">
                データがありません。上の「行を追加」から登録してください。
              </td>
            </tr>
          ) : (
            assessments.map((a, idx) => (
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
                canDelete={canDelete}
                naishinType={isReportCard ? naishinType : undefined}
                onCellTab={(aId, subj) =>
                  handleCellTabForRow(aId, subj, [
                    'english',
                    'math',
                    'japanese',
                    'social',
                    'science',
                    'music',
                    'art',
                    'tech_home',
                    'pe',
                  ])
                }
                showDragHandle={canEdit && !!onReorder}
                isDragging={dragIdx === idx}
                isDragOver={dragOverIdx === idx && dragIdx !== idx}
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverIdx(idx);
                }}
                onDrop={() => {
                  if (dragIdx !== null && dragIdx !== idx) onReorder?.(dragIdx, idx);
                  setDragIdx(null);
                  setDragOverIdx(null);
                }}
                onDragEnd={() => {
                  setDragIdx(null);
                  setDragOverIdx(null);
                }}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
