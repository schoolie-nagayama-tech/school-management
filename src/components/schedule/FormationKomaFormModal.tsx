'use client';

/**
 * 形態別クラス枠の登録モーダル（Phase C）。
 *
 * 曜日×コマ（セルから開けば自動設定）・講師（1名、担当未決定可）・生徒（複数）・科目（任意）を選び、
 * 生徒ごとに schedule_regular_patterns 行（formation=キー）を作成する。
 * バリデーション（定員・同時刻枠数・講師別枠重複・生徒時間重複）は API 側（createFormationClassPatterns）で行う。
 *
 * モード:
 *  - create: 空セルの「＋クラス枠」から。講師を選んで新しいクラス枠を作る。
 *  - add   : 既存クラスの空席行から。講師は固定、生徒だけ追加する。
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

interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  schoolId: string;
  formationLabel: string;
  /** クラス枠を作る対象日（この日の曜日で週次パターンを作る） */
  date: string;
  slot: ScheduleTimeSlot | null;
  subjects: Subject[];
  /** 1枠あたり生徒数上限（表示用） */
  maxStudents: number;
  /** この教室の講師（担当未決定＝空を含めて選択可） */
  teachers: TeacherOption[];
  /** 'create'=新規クラス枠 / 'add'=既存クラスへ生徒追加 */
  mode: 'create' | 'add';
  /** add モード時の固定講師（null=担当未決定クラスへの追加） */
  lockedTeacherId?: string | null;
  onSubmit: (data: {
    teacherId: string | null;
    subjectIds: string[];
    studentIds: string[];
  }) => Promise<void>;
}

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return `毎週${DOW_LABELS[d.getDay()]}曜`;
}

export function FormationKomaFormModal({
  open,
  onClose,
  schoolId,
  formationLabel,
  date,
  slot,
  subjects,
  maxStudents,
  teachers,
  mode,
  lockedTeacherId,
  onSubmit,
}: Props) {
  // teacherId: '' = 担当未決定（意図的に空を許容）
  const [teacherId, setTeacherId] = useState('');
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [students, setStudents] = useState<StudentWithSubjects[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTeacherId(mode === 'add' ? (lockedTeacherId ?? '') : '');
      setSubjectIds([]);
      setStudents([]);
      setError(null);
    }
  }, [open, mode, lockedTeacherId]);

  const toggleSubject = (id: string) =>
    setSubjectIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  const addStudent = (s: StudentWithSubjects | null) => {
    if (!s) return;
    setStudents((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]));
  };
  const removeStudent = (id: string) => setStudents((prev) => prev.filter((s) => s.id !== id));

  const handleSubmit = async () => {
    if (students.length === 0) {
      setError('生徒を1名以上選択してください');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        teacherId: teacherId || null,
        subjectIds,
        studentIds: students.map((s) => s.id),
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const slotLabel = slot
    ? `${slot.slot_number}限 ${slot.start_time?.slice(0, 5)}-${slot.end_time?.slice(0, 5)}`
    : '';
  const lockedTeacher = teachers.find((t) => t.id === lockedTeacherId);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'add'
              ? `${formationLabel} クラスに生徒を追加`
              : `${formationLabel} クラス枠を登録`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* 曜日×コマ（固定表示） */}
          <div className="text-sm text-[var(--paragraph)] bg-[var(--surface)] rounded px-3 py-2">
            {fmtDate(date)} ・ {slotLabel}
          </div>

          {/* 講師（1名・担当未決定可）。add モードは固定表示 */}
          <div>
            <label className="block text-sm font-medium text-[var(--headline)] mb-1">講師</label>
            {mode === 'add' ? (
              <p className="text-sm text-[var(--paragraph)] px-3 py-2 border border-[var(--stroke)] rounded-md bg-[var(--surface)]">
                {lockedTeacher?.display_name || lockedTeacher?.email || '担当未決定'}
              </p>
            ) : (
              <select
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              >
                <option value="">担当未決定</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.display_name || t.email || t.id}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* 科目（任意・複数可） */}
          {subjects.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-[var(--headline)] mb-2">
                科目
                <span className="ml-1 text-xs font-normal text-[var(--paragraph)]">（任意）</span>
              </label>
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
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={subjectIds.includes(s.id)}
                      onChange={() => toggleSubject(s.id)}
                    />
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
              <span className="ml-2 text-xs font-normal text-[var(--paragraph)]">
                {students.length}名選択中（上限{maxStudents}名）
              </span>
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
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent-ink-subtle border border-accent-ink/15 text-xs text-accent-ink"
                  >
                    {s.last_name} {s.first_name}
                    <button
                      type="button"
                      onClick={() => removeStudent(s.id)}
                      className="text-accent-ink/40 hover:text-danger"
                      aria-label="外す"
                    >
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
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={saving || students.length === 0}>
            {saving ? '登録中...' : '登録'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
