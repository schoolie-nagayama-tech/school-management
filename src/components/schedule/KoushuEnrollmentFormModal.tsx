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
import type { Subject } from '@/types/database';

function gradeLabel(grade: number): string {
  if (grade <= 6) return `小${grade}`;
  if (grade <= 9) return `中${grade - 6}`;
  return `高${grade - 9}`;
}

interface KoushuEnrollmentFormModalProps {
  open: boolean;
  onClose: () => void;
  schoolId: string;
  subjects: Subject[];
  /** 既に登録済みの生徒ID（重複登録防止用） */
  existingStudentIds: string[];
  /** 編集モードの場合は既存データを渡す */
  initialData?: KoushuEnrollment | null;
  onSave: (studentId: string, komaCount: number, subjectIds: string[]) => Promise<void>;
}

export function KoushuEnrollmentFormModal({
  open,
  onClose,
  schoolId,
  subjects,
  existingStudentIds,
  initialData,
  onSave,
}: KoushuEnrollmentFormModalProps) {
  const [selectedStudent, setSelectedStudent] = useState<StudentWithSubjects | null>(null);
  const [komaCount, setKomaCount] = useState(1);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditMode = !!initialData;

  useEffect(() => {
    if (open) {
      setSelectedStudent(null);
      setKomaCount(initialData?.koma_count ?? 1);
      setSelectedSubjectIds(initialData?.subject_ids ?? []);
      setError(null);
    }
  }, [open, initialData]);

  const toggleSubject = (id: string) => {
    setSelectedSubjectIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleSubmit = async () => {
    const studentId = isEditMode ? initialData!.student_id : selectedStudent?.id;
    if (!studentId) { setError('生徒を選択してください'); return; }
    if (komaCount < 1) { setError('コマ数は1以上を入力してください'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(studentId, komaCount, selectedSubjectIds);
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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditMode ? '申し込みを編集' : '生徒を追加'}</DialogTitle>
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
                onSelect={setSelectedStudent}
                placeholder="氏名・かなで検索..."
              />
              {selectedStudent && (
                <div className="mt-2 text-sm text-[var(--headline)] bg-blue-50 px-3 py-2 rounded-md">
                  ✓ {selectedStudent.last_name} {selectedStudent.first_name}（{gradeLabel(selectedStudent.grade)}）
                </div>
              )}
            </div>
          )}

          {/* コマ数 */}
          <div>
            <label className="block text-sm font-medium text-[var(--headline)] mb-1">
              申し込みコマ数 <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={99}
                value={komaCount}
                onChange={(e) => setKomaCount(Number(e.target.value))}
                className="w-24 px-3 py-2 border border-[var(--stroke)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
              <span className="text-sm text-[var(--paragraph)]">コマ</span>
            </div>
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
