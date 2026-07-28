'use client';

import { useState } from 'react';
import { Input, Label } from '@/components/ui';
import {
  SelectShadcn as Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import { Checkbox } from '@/components/ui';
import { Textarea } from '@/components/ui';
import type { ScheduleEntryFormData, ScheduleEntry } from '@/types/schedule';
import type { Subject } from '@/types/database';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

const GRADE_CATEGORY_LABELS: Record<string, string> = {
  elementary: '小学',
  middle: '中学',
  high: '高校',
};

function groupSubjectsByGradeCategory(
  subjects: Subject[]
): { category: string; label: string; items: Subject[] }[] {
  const order: ('elementary' | 'middle' | 'high')[] = ['elementary', 'middle', 'high'];
  const map = new Map<string, Subject[]>();
  for (const s of subjects) {
    const cat = s.grade_category ?? 'middle';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(s);
  }
  return order
    .filter((cat) => map.has(cat))
    .map((cat) => ({
      category: cat,
      label: GRADE_CATEGORY_LABELS[cat] ?? cat,
      items: map.get(cat)!,
    }));
}

interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  user_schools?: Array<{ school_id: string }>;
}

interface StudentOption {
  id: string;
  last_name: string;
  first_name: string;
  last_name_kana?: string;
  first_name_kana?: string;
  grade: number;
}

interface ScheduleEntryFormProps {
  mode: 'add' | 'edit';
  dateLabel: string;
  slotLabel: string;
  form: ScheduleEntryFormData;
  onChange: (form: ScheduleEntryFormData) => void;
  teachers: TeacherOption[];
  students: StudentOption[];
  subjects: Subject[];
  selectedSchoolId: string;
  editingEntry?: ScheduleEntry | null;
}

export function ScheduleEntryForm({
  mode,
  dateLabel,
  slotLabel,
  form,
  onChange,
  teachers,
  students,
  subjects,
  selectedSchoolId,
  editingEntry,
}: ScheduleEntryFormProps) {
  const [studentSearch, setStudentSearch] = useState('');

  const teachersForSchool = teachers.filter((t) =>
    t.user_schools?.some((us) => us.school_id === selectedSchoolId)
  );
  const searchLower = studentSearch.trim().toLowerCase();
  const filteredStudents = searchLower
    ? students.filter(
        (s) =>
          `${s.last_name}${s.first_name}`.toLowerCase().includes(searchLower) ||
          `${s.last_name_kana || ''}${s.first_name_kana || ''}`.toLowerCase().includes(searchLower)
      )
    : students;

  const toggleSubject = (id: string) => {
    const next = form.subject_ids.includes(id)
      ? form.subject_ids.filter((x) => x !== id)
      : [...form.subject_ids, id];
    onChange({ ...form, subject_ids: next });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>日付</Label>
          <Input value={dateLabel} disabled className="bg-[var(--surface)]" />
        </div>
        <div className="space-y-2">
          <Label>コマ</Label>
          <Input value={slotLabel} disabled className="bg-[var(--surface)]" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>講師</Label>
        <Select value={form.teacher_id} onValueChange={(v) => onChange({ ...form, teacher_id: v })}>
          <SelectTrigger>
            <SelectValue placeholder="講師を選択" />
          </SelectTrigger>
          <SelectContent>
            {teachersForSchool.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.display_name || t.email || t.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>生徒</Label>
        {mode === 'edit' ? (
          <Input
            value={
              editingEntry?.student
                ? `${editingEntry.student.last_name} ${editingEntry.student.first_name}（${formatGradeLabel(editingEntry.student.grade)}）`
                : '—'
            }
            disabled
            className="bg-[var(--surface)]"
          />
        ) : (
          <>
            <Input
              placeholder="名前で検索"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              className="mb-1"
            />
            <Select
              value={form.student_id}
              onValueChange={(v) => onChange({ ...form, student_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="生徒を選択" />
              </SelectTrigger>
              <SelectContent>
                {filteredStudents.slice(0, 100).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.last_name} {s.first_name}（{formatGradeLabel(s.grade)}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
      <div className="space-y-2">
        <Label>科目（複数可）</Label>
        <div className="space-y-3 border rounded-md p-2">
          {groupSubjectsByGradeCategory(subjects).map(({ label, items }) => (
            <div key={label}>
              <p className="text-xs font-medium text-[var(--paragraph)] mb-1.5">{label}</p>
              <div className="flex flex-wrap gap-2">
                {items.map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={form.subject_ids.includes(s.id)}
                      onCheckedChange={() => toggleSubject(s.id)}
                    />
                    <span className="text-sm">{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="seat_label">座席番号（任意）</Label>
        <Input
          id="seat_label"
          value={form.seat_label}
          onChange={(e) => onChange({ ...form, seat_label: e.target.value })}
          placeholder="例：A席"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="note">備考（任意）</Label>
        <Textarea
          id="note"
          value={form.note}
          onChange={(e) => onChange({ ...form, note: e.target.value })}
          placeholder="備考"
          rows={2}
        />
      </div>
    </div>
  );
}
