'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui';
import { Button } from '@/components/ui';
import { StudentSearchInput, type StudentWithSubjects } from './StudentSearchInput';
import type { KoushuEnrollment } from '@/lib/api/seasonalCourses';
import { estimateRegularKomaInPeriod, type KoushuPeriodInfo } from '@/lib/api/koushu-period';
import type { Subject } from '@/types/database';
import type { ScheduleEntryFormation } from '@/types/schedule';

function gradeLabel(grade: number): string {
  if (grade <= 6) return `小${grade}`;
  if (grade <= 9) return `中${grade - 6}`;
  return `高${grade - 9}`;
}

/** 申込1件分（formation 別）。科目別コマ数で持つ。 */
export interface EnrollmentRow {
  formation: ScheduleEntryFormation;
  komaBySubject: Record<string, number>;
}

interface KoushuEnrollmentFormModalProps {
  open: boolean;
  onClose: () => void;
  schoolId: string;
  subjects: Subject[];
  /** 既に登録済みの生徒ID（重複登録防止用） */
  existingStudentIds: string[];
  /** 編集モードの場合は既存データを渡す（その formation 行だけを編集） */
  initialData?: KoushuEnrollment | null;
  /** 通常授業回数（個別コマ数の目安）算出用。コースの season に対応する講習期間。 */
  period?: KoushuPeriodInfo | null;
  onSave: (studentId: string, rows: EnrollmentRow[]) => Promise<void>;
}

export function KoushuEnrollmentFormModal({
  open,
  onClose,
  schoolId,
  subjects,
  existingStudentIds,
  initialData,
  period,
  onSave,
}: KoushuEnrollmentFormModalProps) {
  const [selectedStudent, setSelectedStudent] = useState<StudentWithSubjects | null>(null);
  // 科目 × formation のコマ数マトリクス。matrix[subjectId] = { individual, group }
  const [matrix, setMatrix] = useState<Record<string, { individual: number; group: number }>>({});
  const [regularHint, setRegularHint] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditMode = !!initialData;
  const editFormation = initialData?.formation ?? null;

  useEffect(() => {
    if (!open) return;
    setSelectedStudent(null);
    setError(null);
    setRegularHint(null);
    const init: Record<string, { individual: number; group: number }> = {};
    if (initialData) {
      // 編集: その formation 行の科目別コマ数を該当列に展開
      const kbs = initialData.koma_by_subject ?? {};
      for (const [sid, n] of Object.entries(kbs)) {
        init[sid] = { individual: 0, group: 0 };
        if (initialData.formation === 'group') init[sid].group = n;
        else init[sid].individual = n;
      }
    }
    setMatrix(init);
  }, [open, initialData]);

  // 新規追加時、生徒を選んだら「通常授業回数」をヒント表示（科目別なので自動入力はせず目安だけ）
  const handleSelectStudent = async (student: StudentWithSubjects | null) => {
    setSelectedStudent(student);
    if (student && !isEditMode && period) {
      try {
        setRegularHint(await estimateRegularKomaInPeriod(student.id, period));
      } catch {
        setRegularHint(null);
      }
    }
  };

  const setCell = (subjectId: string, formation: ScheduleEntryFormation, value: number) => {
    setMatrix((prev) => {
      const cur = prev[subjectId] ?? { individual: 0, group: 0 };
      const base = { individual: cur.individual, group: cur.group };
      base[formation] = Math.max(0, value);
      return { ...prev, [subjectId]: base };
    });
  };

  const showIndividual = !isEditMode || editFormation === 'individual';
  const showGroup = !isEditMode || editFormation === 'group';

  const handleSubmit = async () => {
    const studentId = isEditMode ? initialData!.student_id : selectedStudent?.id;
    if (!studentId) { setError('生徒を選択してください'); return; }

    const indiv: Record<string, number> = {};
    const group: Record<string, number> = {};
    for (const [sid, v] of Object.entries(matrix)) {
      if (v.individual > 0) indiv[sid] = v.individual;
      if (v.group > 0) group[sid] = v.group;
    }

    const rows: EnrollmentRow[] = [];
    if (isEditMode && editFormation) {
      const data = editFormation === 'group' ? group : indiv;
      if (Object.keys(data).length === 0) { setError('コマ数を1以上で入力してください'); return; }
      rows.push({ formation: editFormation, komaBySubject: data });
    } else {
      if (Object.keys(indiv).length > 0) rows.push({ formation: 'individual', komaBySubject: indiv });
      if (Object.keys(group).length > 0) rows.push({ formation: 'group', komaBySubject: group });
      if (rows.length === 0) { setError('いずれかの科目にコマ数を1以上で入力してください'); return; }
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(studentId, rows);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const studentLabel = isEditMode && initialData?.student
    ? `${initialData.student.last_name} ${initialData.student.first_name}（${gradeLabel(initialData.student.grade)}）`
    : null;

  const indivTotal = Object.values(matrix).reduce((s, v) => s + (v.individual || 0), 0);
  const groupTotal = Object.values(matrix).reduce((s, v) => s + (v.group || 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditMode
              ? `申し込みを編集（${editFormation === 'group' ? '集団' : '個別'}）`
              : '生徒を追加'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* 生徒選択 */}
          {isEditMode ? (
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">生徒</label>
              <div className="px-3 py-2 bg-gray-50 rounded-md text-sm">{studentLabel}</div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                生徒を選択 <span className="text-red-500">*</span>
              </label>
              <StudentSearchInput
                schoolId={schoolId}
                excludeStudentIds={existingStudentIds}
                onSelect={handleSelectStudent}
                placeholder="氏名・かなで検索..."
              />
              {selectedStudent && (
                <div className="mt-2 text-sm text-[var(--headline)] bg-blue-50 px-3 py-2 rounded-md">
                  ✓ {selectedStudent.last_name} {selectedStudent.first_name}（{gradeLabel(selectedStudent.grade)}）
                  {regularHint != null && (
                    <span className="ml-2 text-xs text-[var(--paragraph)]">
                      （講習期間中の通常授業: 約{regularHint}コマ）
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 科目別コマ数（科目 × 個別/集団） */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label className="text-sm font-medium text-[var(--headline)]">科目別コマ数</label>
              <span className="text-xs text-[var(--paragraph)]">
                合計 {showIndividual && `個別${indivTotal}`}{showIndividual && showGroup && ' / '}{showGroup && `集団${groupTotal}`} コマ
              </span>
            </div>
            {subjects.length === 0 ? (
              <p className="text-xs text-[var(--paragraph)]">科目が登録されていません</p>
            ) : (
              <div className="border border-[var(--stroke)] rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-[var(--paragraph)]">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">科目</th>
                      {showIndividual && <th className="px-2 py-1.5 font-medium w-20">個別</th>}
                      {showGroup && <th className="px-2 py-1.5 font-medium w-20">集団</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {subjects.map((s) => {
                      const cell = matrix[s.id] ?? { individual: 0, group: 0 };
                      return (
                        <tr key={s.id} className="border-t border-gray-100">
                          <td className="px-2 py-1 text-[var(--headline)]">{s.name}</td>
                          {showIndividual && (
                            <td className="px-2 py-1 text-center">
                              <input
                                type="number"
                                min={0}
                                max={99}
                                value={cell.individual || 0}
                                onChange={(e) => setCell(s.id, 'individual', Number(e.target.value))}
                                className="w-14 px-2 py-1 border border-[var(--stroke)] rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                              />
                            </td>
                          )}
                          {showGroup && (
                            <td className="px-2 py-1 text-center">
                              <input
                                type="number"
                                min={0}
                                max={99}
                                value={cell.group || 0}
                                onChange={(e) => setCell(s.id, 'group', Number(e.target.value))}
                                className="w-14 px-2 py-1 border border-[var(--stroke)] rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
