'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button, Input, Label } from '@/components/ui';
import { SelectShadcn as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { Checkbox } from '@/components/ui';
import { SCHEDULE_PERIOD_LABELS, DAY_OF_WEEK_LABELS } from '@/types/schedule';
import type { ScheduleRegularPattern, ScheduleRegularPatternFormData, SchedulePeriodType } from '@/types/schedule';
import type { ScheduleTimeSlot } from '@/types/schedule';
import type { Subject } from '@/types/database';

const GRADE_CATEGORY_LABELS: Record<string, string> = {
  elementary: '小学',
  middle: '中学',
  high: '高校',
};

function groupSubjectsByGradeCategory(subjects: Subject[]): { category: string; label: string; items: Subject[] }[] {
  const order: ('elementary' | 'middle' | 'high')[] = ['elementary', 'middle', 'high'];
  const map = new Map<string, Subject[]>();
  for (const s of subjects) {
    const cat = s.grade_category ?? 'middle';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(s);
  }
  return order
    .filter((cat) => map.has(cat))
    .map((cat) => ({ category: cat, label: GRADE_CATEGORY_LABELS[cat] ?? cat, items: map.get(cat)! }));
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

interface RegularPatternFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: ScheduleRegularPatternFormData) => Promise<void>;
  editingPattern: ScheduleRegularPattern | null;
  timeSlots: ScheduleTimeSlot[];
  teachers: TeacherOption[];
  students: StudentOption[];
  subjects: Subject[];
  selectedSchoolId: string;
  /** 生徒詳細・生徒登録から開いた場合の初期生徒ID */
  initialStudentId?: string;
}

const PERIOD_TYPES: SchedulePeriodType[] = ['regular', 'spring', 'summer', 'winter'];

export function RegularPatternForm({
  open,
  onClose,
  onSubmit,
  editingPattern,
  timeSlots,
  teachers,
  students,
  subjects,
  selectedSchoolId,
  initialStudentId,
}: RegularPatternFormProps) {
  const [form, setForm] = useState<ScheduleRegularPatternFormData>({
    student_id: '',
    day_of_week: 1,
    time_slot_id: '',
    teacher_id: '',
    subject_ids: [],
    seat_label: '',
    period_type: 'regular',
  });
  const [studentSearch, setStudentSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const teachersForSchool = teachers.filter(
    (t) => t.user_schools?.some((us) => us.school_id === selectedSchoolId)
  );

  const searchLower = studentSearch.trim().toLowerCase();
  const filteredStudents = searchLower
    ? students.filter(
        (s) =>
          `${s.last_name}${s.first_name}`.toLowerCase().includes(searchLower) ||
          `${s.last_name_kana || ''}${s.first_name_kana || ''}`.toLowerCase().includes(searchLower)
      )
    : students;

  useEffect(() => {
    if (open) {
      if (editingPattern) {
        setForm({
          student_id: editingPattern.student_id,
          day_of_week: editingPattern.day_of_week,
          time_slot_id: editingPattern.time_slot_id,
          teacher_id: editingPattern.teacher_id,
          subject_ids: editingPattern.subject_ids || [],
          seat_label: editingPattern.seat_label || '',
          period_type: editingPattern.period_type,
        });
      } else {
        setForm({
          student_id: initialStudentId ?? '',
          day_of_week: 1,
          time_slot_id: timeSlots[0]?.id ?? '',
          teacher_id: '',
          subject_ids: [],
          seat_label: '',
          period_type: 'regular',
        });
      }
      setStudentSearch('');
    }
  }, [open, editingPattern, timeSlots, initialStudentId]);

  const handleSubmit = async () => {
    if (!form.student_id || !form.time_slot_id || !form.teacher_id) return;
    setSaving(true);
    try {
      await onSubmit(form);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const toggleSubject = (id: string) => {
    setForm((f) => ({
      ...f,
      subject_ids: f.subject_ids.includes(id)
        ? f.subject_ids.filter((x) => x !== id)
        : [...f.subject_ids, id],
    }));
  };

  const gradeLabel = (g: number) => {
    if (g <= 6) return `小${g}`;
    if (g <= 9) return `中${g - 6}`;
    return `高${g - 9}`;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingPattern ? '通塾日程を編集' : '通塾日程を追加'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-2">
            <Label>生徒</Label>
            <Input
              placeholder="名前で検索"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              className="mb-2"
            />
            <Select
              value={form.student_id}
              onValueChange={(v) => setForm({ ...form, student_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="生徒を選択" />
              </SelectTrigger>
              <SelectContent>
                {filteredStudents.slice(0, 100).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.last_name} {s.first_name}（{gradeLabel(s.grade)}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>曜日</Label>
              <Select
                value={String(form.day_of_week)}
                onValueChange={(v) => setForm({ ...form, day_of_week: parseInt(v, 10) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6].map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {DAY_OF_WEEK_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>コマ</Label>
              <Select
                value={form.time_slot_id}
                onValueChange={(v) => setForm({ ...form, time_slot_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="コマを選択" />
                </SelectTrigger>
                <SelectContent>
                  {timeSlots.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.slot_number}限 {s.start_time?.slice(0, 5)}-{s.end_time?.slice(0, 5)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>講師</Label>
            <Select
              value={form.teacher_id}
              onValueChange={(v) => setForm({ ...form, teacher_id: v })}
            >
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
            <Label>科目（複数可）</Label>
            <div className="space-y-3 border rounded-md p-2">
              {groupSubjectsByGradeCategory(subjects).map(({ label, items }) => (
                <div key={label}>
                  <p className="text-xs font-medium text-[#2a2a2a] mb-1.5">{label}</p>
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
              onChange={(e) => setForm({ ...form, seat_label: e.target.value })}
              placeholder="例：A席"
            />
          </div>
          <div className="space-y-2">
            <Label>期間タイプ</Label>
            <Select
              value={form.period_type}
              onValueChange={(v) => setForm({ ...form, period_type: v as SchedulePeriodType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_TYPES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {SCHEDULE_PERIOD_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
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
