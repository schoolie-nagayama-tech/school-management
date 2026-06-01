'use client';

/**
 * 集団コマ作成モーダル（手動編成）
 *
 * 集団は手動編成中心。室長が「日付・集団コマ・講師・科目・生徒（複数）」を決めて1クラスを作る。
 * 講師はその日に出勤可能な講師から選ばせる（本格マッチングはしない）。
 * 保存は生徒ごとに schedule_entries (kind='koushu', formation='group') を作成する。
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
} from '@/components/ui';
import { StudentSearchInput, type StudentWithSubjects } from './StudentSearchInput';
import type { Subject } from '@/types/database';
import type { ScheduleTimeSlot } from '@/types/schedule';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  schoolId: string;
  date: string;
  slot: ScheduleTimeSlot | null;
  subjects: Subject[];
  maxStudents: number;
  /** その日に出勤可能な講師 */
  availableTeachers: { id: string; display_name: string | null; email: string | null }[];
  onSubmit: (data: { teacherId: string; subjectIds: string[]; studentIds: string[] }) => Promise<void>;
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}（${dow}）`;
}

export function GroupKomaFormModal({
  open,
  onClose,
  schoolId,
  date,
  slot,
  subjects,
  maxStudents,
  availableTeachers,
  onSubmit,
}: Props) {
  const [teacherId, setTeacherId] = useState('');
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [students, setStudents] = useState<StudentWithSubjects[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTeacherId('');
      setSubjectIds([]);
      setStudents([]);
      setError(null);
    }
  }, [open]);

  const toggleSubject = (id: string) =>
    setSubjectIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const addStudent = (s: StudentWithSubjects | null) => {
    if (!s) return;
    setStudents((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]));
  };
  const removeStudent = (id: string) => setStudents((prev) => prev.filter((s) => s.id !== id));

  const handleSubmit = async () => {
    if (!teacherId) { setError('講師を選択してください'); return; }
    if (students.length === 0) { setError('生徒を1名以上選択してください'); return; }
    if (students.length > maxStudents) { setError(`生徒は最大${maxStudents}名までです`); return; }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ teacherId, subjectIds, studentIds: students.map((s) => s.id) });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            集団コマを作成{slot ? ` — ${fmtDate(date)} ${slot.slot_number}限` : ''}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* 講師 */}
          <div>
            <label className="block text-sm font-medium text-[var(--headline)] mb-1">
              講師 <span className="text-red-500">*</span>
            </label>
            {availableTeachers.length === 0 ? (
              <p className="text-xs text-warning bg-warning-subtle/40 rounded px-2 py-1">
                この曜日に出勤可能な講師がいません。シフトや出勤可能期間を確認してください。
              </p>
            ) : (
              <select
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              >
                <option value="">選択してください</option>
                {availableTeachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.display_name || t.email || t.id}</option>
                ))}
              </select>
            )}
          </div>

          {/* 科目 */}
          {subjects.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-2">科目</label>
              <div className="flex flex-wrap gap-2">
                {subjects.map((s) => (
                  <label
                    key={s.id}
                    className={`px-3 py-1.5 rounded-full border text-sm cursor-pointer transition-colors ${
                      subjectIds.includes(s.id)
                        ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                        : 'bg-white text-[var(--paragraph)] border-[var(--stroke)] hover:border-[var(--primary)]'
                    }`}
                  >
                    <input type="checkbox" className="sr-only" checked={subjectIds.includes(s.id)} onChange={() => toggleSubject(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* 生徒（複数） */}
          <div>
            <label className="block text-sm font-medium text-[var(--headline)] mb-1">
              生徒 <span className="text-red-500">*</span>
              <span className="ml-2 text-xs font-normal text-[var(--paragraph)]">{students.length}/{maxStudents}名</span>
            </label>
            <StudentSearchInput
              schoolId={schoolId}
              excludeStudentIds={students.map((s) => s.id)}
              onSelect={addStudent}
              placeholder="氏名・かなで検索して追加..."
            />
            {students.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {students.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent-ink-subtle border border-accent-ink/15 text-xs text-accent-ink">
                    {s.last_name} {s.first_name}
                    <button type="button" onClick={() => removeStudent(s.id)} className="text-accent-ink/40 hover:text-danger" aria-label="外す">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={saving}>キャンセル</Button>
          <Button onClick={handleSubmit} disabled={saving || availableTeachers.length === 0}>
            {saving ? '作成中...' : '作成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
