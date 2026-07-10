'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import { StudentSearchInput, type StudentWithSubjects } from './StudentSearchInput';
import { estimateRegularKomaInPeriod, type KoushuPeriodInfo } from '@/lib/api/koushu-period';
import type { Subject } from '@/types/database';
import type { ScheduleEntryFormation } from '@/types/schedule';
// Phase A: 講習申込は個別/集団の2列固定。マトリクスのキー型は2値のまま保つ（他形態はここに来ない）。
import { INDIVIDUAL_FORMATION, GROUP_FORMATION } from '@/types/schedule';

/** 講習申込マトリクスの列キー。講習は個別/集団の2列のみ（ユーザー定義形態は対象外）。 */
type KoushuFormationColumn = 'individual' | 'group';

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
  /** 既に登録済みの生徒ID（新規追加時の重複防止用） */
  existingStudentIds: string[];
  /** 編集対象の生徒（指定時は検索なしで固定。新規追加時は未指定） */
  lockedStudent?: { id: string; last_name: string; first_name: string; grade: number } | null;
  /** 編集時の既存値（個別/集団の科目別コマ数を事前入力） */
  initialRows?: EnrollmentRow[];
  /** 通常授業回数（個別コマ数の目安）算出用の講習期間 */
  period?: KoushuPeriodInfo | null;
  onSave: (studentId: string, rows: EnrollmentRow[]) => Promise<void>;
}

export function KoushuEnrollmentFormModal({
  open,
  onClose,
  schoolId,
  subjects,
  existingStudentIds,
  lockedStudent,
  initialRows,
  period,
  onSave,
}: KoushuEnrollmentFormModalProps) {
  const [selectedStudent, setSelectedStudent] = useState<StudentWithSubjects | null>(null);
  // 科目 × formation のコマ数マトリクス。matrix[subjectId] = { individual, group }
  const [matrix, setMatrix] = useState<Record<string, { individual: number; group: number }>>({});
  const [regularHint, setRegularHint] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditMode = !!lockedStudent;

  useEffect(() => {
    if (!open) return;
    setSelectedStudent(null);
    setError(null);
    setRegularHint(null);
    const init: Record<string, { individual: number; group: number }> = {};
    for (const row of initialRows ?? []) {
      // 講習申込は個別/集団の2列固定。混入した他形態行は無視して2列を汚さない。
      if (row.formation !== INDIVIDUAL_FORMATION && row.formation !== GROUP_FORMATION) continue;
      const col: KoushuFormationColumn =
        row.formation === GROUP_FORMATION ? GROUP_FORMATION : INDIVIDUAL_FORMATION;
      for (const [sid, n] of Object.entries(row.komaBySubject)) {
        if (!init[sid]) init[sid] = { individual: 0, group: 0 };
        init[sid][col] = n;
      }
    }
    setMatrix(init);
  }, [open, initialRows]);

  // 新規追加時、生徒を選んだら「通常授業回数」をヒント表示（科目別なので自動入力はせず目安だけ）
  const handleSelectStudent = async (student: StudentWithSubjects | null) => {
    setSelectedStudent(student);
    if (student && period) {
      try {
        setRegularHint(await estimateRegularKomaInPeriod(student.id, period));
      } catch {
        setRegularHint(null);
      }
    }
  };

  const setCell = (subjectId: string, formation: KoushuFormationColumn, value: number) => {
    setMatrix((prev) => {
      const cur = prev[subjectId] ?? { individual: 0, group: 0 };
      const base = { individual: cur.individual, group: cur.group };
      base[formation] = Math.max(0, value);
      return { ...prev, [subjectId]: base };
    });
  };

  const handleSubmit = async () => {
    const studentId = lockedStudent?.id ?? selectedStudent?.id;
    if (!studentId) {
      setError('生徒を選択してください');
      return;
    }

    const indiv: Record<string, number> = {};
    const group: Record<string, number> = {};
    for (const [sid, v] of Object.entries(matrix)) {
      if (v.individual > 0) indiv[sid] = v.individual;
      if (v.group > 0) group[sid] = v.group;
    }

    // 個別/集団それぞれ行を作る。空（全0）でも upsert 側で削除扱いになるよう、編集時は両方渡す。
    const rows: EnrollmentRow[] = [
      { formation: INDIVIDUAL_FORMATION, komaBySubject: indiv },
      { formation: GROUP_FORMATION, komaBySubject: group },
    ];
    if (!isEditMode && Object.keys(indiv).length === 0 && Object.keys(group).length === 0) {
      setError('いずれかの科目にコマ数を1以上で入力してください');
      return;
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

  const studentLabel = lockedStudent
    ? `${lockedStudent.last_name} ${lockedStudent.first_name}（${gradeLabel(lockedStudent.grade)}）`
    : null;

  const indivTotal = Object.values(matrix).reduce((s, v) => s + (v.individual || 0), 0);
  const groupTotal = Object.values(matrix).reduce((s, v) => s + (v.group || 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditMode ? '講習申込を編集' : '生徒を追加'}</DialogTitle>
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
                  ✓ {selectedStudent.last_name} {selectedStudent.first_name}（
                  {gradeLabel(selectedStudent.grade)}）
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
                合計 個別{indivTotal} / 集団{groupTotal} コマ
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
                      <th className="px-2 py-1.5 font-medium w-20">個別</th>
                      <th className="px-2 py-1.5 font-medium w-20">集団</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjects.map((s) => {
                      const cell = matrix[s.id] ?? { individual: 0, group: 0 };
                      return (
                        <tr key={s.id} className="border-t border-gray-100">
                          <td className="px-2 py-1 text-[var(--headline)]">{s.name}</td>
                          <td className="px-2 py-1 text-center">
                            <input
                              type="number"
                              min={0}
                              max={99}
                              value={cell.individual || 0}
                              onChange={(e) =>
                                setCell(s.id, INDIVIDUAL_FORMATION, Number(e.target.value))
                              }
                              className="w-14 px-2 py-1 border border-[var(--stroke)] rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                            />
                          </td>
                          <td className="px-2 py-1 text-center">
                            <input
                              type="number"
                              min={0}
                              max={99}
                              value={cell.group || 0}
                              onChange={(e) =>
                                setCell(s.id, GROUP_FORMATION, Number(e.target.value))
                              }
                              className="w-14 px-2 py-1 border border-[var(--stroke)] rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}
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
