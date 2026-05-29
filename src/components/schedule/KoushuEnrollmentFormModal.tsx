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

/** 申込1件分（formation 別）。komaCount=0 は「その形態は申込なし」 */
export interface EnrollmentRow {
  formation: ScheduleEntryFormation;
  komaCount: number;
  subjectIds: string[];
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
  /** 個別コマ数の初期値（通常授業回数）算出用。コースの season に対応する講習期間。無ければ既定値なし。 */
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
  // 個別/集団それぞれのコマ数。編集モードでは該当 formation のみ使用。
  const [individualKoma, setIndividualKoma] = useState(0);
  const [groupKoma, setGroupKoma] = useState(0);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 個別の既定値（通常授業回数）を算出中かどうか
  const [estimating, setEstimating] = useState(false);

  const isEditMode = !!initialData;
  const editFormation = initialData?.formation ?? null;

  useEffect(() => {
    if (open) {
      setSelectedStudent(null);
      setError(null);
      if (initialData) {
        // 編集: その formation の行だけを編集
        setIndividualKoma(initialData.formation === 'individual' ? initialData.koma_count : 0);
        setGroupKoma(initialData.formation === 'group' ? initialData.koma_count : 0);
        setSelectedSubjectIds(initialData.subject_ids ?? []);
      } else {
        setIndividualKoma(0);
        setGroupKoma(0);
        setSelectedSubjectIds([]);
      }
    }
  }, [open, initialData]);

  // 新規追加時、生徒を選んだら個別コマ数の初期値に「講習期間中の通常授業回数」を入れる（室長が調整可）。
  const handleSelectStudent = async (student: StudentWithSubjects | null) => {
    setSelectedStudent(student);
    if (student && !isEditMode && period) {
      setEstimating(true);
      try {
        const def = await estimateRegularKomaInPeriod(student.id, period);
        setIndividualKoma(def);
      } catch {
        // 失敗時は既定 0 のまま
      } finally {
        setEstimating(false);
      }
    }
  };

  const toggleSubject = (id: string) => {
    setSelectedSubjectIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    const studentId = isEditMode ? initialData!.student_id : selectedStudent?.id;
    if (!studentId) { setError('生徒を選択してください'); return; }

    // 保存対象の行を組み立て。編集はその formation のみ、新規は個別/集団の入力があるものだけ。
    let rows: EnrollmentRow[];
    if (isEditMode && editFormation) {
      const koma = editFormation === 'individual' ? individualKoma : groupKoma;
      if (koma < 1) { setError('コマ数は1以上を入力してください'); return; }
      rows = [{ formation: editFormation, komaCount: koma, subjectIds: selectedSubjectIds }];
    } else {
      rows = [];
      if (individualKoma > 0) rows.push({ formation: 'individual', komaCount: individualKoma, subjectIds: selectedSubjectIds });
      if (groupKoma > 0) rows.push({ formation: 'group', komaCount: groupKoma, subjectIds: selectedSubjectIds });
      if (rows.length === 0) { setError('個別または集団のコマ数を1以上で入力してください'); return; }
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

  // コマ数入力欄（個別/集団）。編集モードでは該当 formation のみ表示。
  const showIndividual = !isEditMode || editFormation === 'individual';
  const showGroup = !isEditMode || editFormation === 'group';

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
                </div>
              )}
            </div>
          )}

          {/* コマ数（個別 / 集団） */}
          <div className="space-y-3">
            {showIndividual && (
              <div>
                <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                  個別コマ数
                  {!isEditMode && (
                    <span className="ml-2 text-xs font-normal text-[var(--paragraph)]">
                      {estimating ? '（通常授業回数を計算中…）' : '（初期値＝講習期間中の通常授業回数）'}
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={individualKoma}
                    onChange={(e) => setIndividualKoma(Number(e.target.value))}
                    className="w-24 px-3 py-2 border border-[var(--stroke)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  />
                  <span className="text-sm text-[var(--paragraph)]">コマ</span>
                </div>
              </div>
            )}
            {showGroup && (
              <div>
                <label className="block text-sm font-medium text-[var(--headline)] mb-1">
                  集団コマ数
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={groupKoma}
                    onChange={(e) => setGroupKoma(Number(e.target.value))}
                    className="w-24 px-3 py-2 border border-[var(--stroke)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                  />
                  <span className="text-sm text-[var(--paragraph)]">コマ</span>
                </div>
              </div>
            )}
          </div>

          {/* 科目 */}
          {subjects.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-2">
                受講科目
              </label>
              <div className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <label
                    key={s.id}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm cursor-pointer transition-colors ${
                      selectedSubjectIds.includes(s.id)
                        ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                        : 'bg-white text-[var(--paragraph)] border-[var(--stroke)] hover:border-[var(--primary)]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={selectedSubjectIds.includes(s.id)}
                      onChange={() => toggleSubject(s.id)}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          )}

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
