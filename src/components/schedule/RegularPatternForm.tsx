'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button, Input, Label } from '@/components/ui';
import {
  SelectShadcn as Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import { Checkbox } from '@/components/ui';
import { SCHEDULE_PERIOD_LABELS, DAY_OF_WEEK_LABELS } from '@/types/schedule';
import type {
  ScheduleRegularPattern,
  ScheduleRegularPatternFormData,
  SchedulePeriodType,
  HalfPosition,
} from '@/types/schedule';
import type { ScheduleTimeSlot } from '@/types/schedule';
import type { Subject } from '@/types/database';
import {
  getStudentContractRatioMap,
  upsertStudentContract,
} from '@/lib/api/student-subject-contracts';

const GRADE_CATEGORY_LABELS: Record<string, string> = {
  elementary: '小学',
  middle: '中学',
  high: '高校',
};

function gradeToCategory(grade: number): 'elementary' | 'middle' | 'high' {
  if (grade <= 6) return 'elementary';
  if (grade <= 9) return 'middle';
  return 'high';
}

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
  teachable_subject_ids?: string[] | null;
  available_days_of_week?: number[] | null;
  available_slot_numbers_by_day?: Record<string, number[]> | null;
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
    ratio: 2,
    duration_minutes: null,
    half_position: null,
  });
  const [studentSearch, setStudentSearch] = useState('');
  const [saving, setSaving] = useState(false);
  // Phase R: 生徒×科目の契約比率マップ（科目選択時の ratio 初期値）。
  const [contractRatioMap, setContractRatioMap] = useState<Map<string, 1 | 2>>(new Map());

  // 半コマは「単一科目 かつ その科目が45分」のときだけ扱う（複数科目は全コマ）。
  const singleSubjectId = form.subject_ids.length === 1 ? form.subject_ids[0] : null;
  const singleSubject = singleSubjectId
    ? (subjects.find((s) => s.id === singleSubjectId) ?? null)
    : null;
  const is45 = singleSubject?.duration_minutes === 45;

  const teachersForSchool = teachers.filter((t) =>
    t.user_schools?.some((us) => us.school_id === selectedSchoolId)
  );

  const selectedSlotNumber = timeSlots.find((s) => s.id === form.time_slot_id)?.slot_number;
  const filteredTeachers = useMemo(() => {
    // 科目未選択時は講師を表示しない（科目→講師の順で選択させる）
    if (form.subject_ids.length === 0) return [];

    return teachersForSchool.filter((t) => {
      // (a) 出勤可能曜日チェック（空 or null = 該当なし）
      const days = t.available_days_of_week;
      if (!days || days.length === 0) return false;
      if (!days.includes(form.day_of_week)) return false;

      // (b) 出勤可能コマチェック（空 or null = 該当なし）
      if (selectedSlotNumber !== undefined) {
        const byDay = t.available_slot_numbers_by_day;
        if (!byDay || Object.keys(byDay).length === 0) return false;
        const dayKey = String(form.day_of_week);
        const slotNums = byDay[dayKey];
        if (!slotNums || slotNums.length === 0) return false;
        if (!slotNums.includes(selectedSlotNumber)) return false;
      }

      // (c) 指導可能科目チェック（選択科目を担当可能な講師のみ）
      const allowed = t.teachable_subject_ids;
      if (!allowed || allowed.length === 0) return false;
      return form.subject_ids.some((id) => allowed.includes(id));
    });
  }, [
    teachersForSchool,
    form.day_of_week,
    form.time_slot_id,
    form.subject_ids,
    selectedSlotNumber,
  ]);

  useEffect(() => {
    if (
      form.teacher_id &&
      filteredTeachers.length > 0 &&
      !filteredTeachers.some((t) => t.id === form.teacher_id)
    ) {
      setForm((f) => ({ ...f, teacher_id: '' }));
    }
  }, [form.teacher_id, form.day_of_week, form.time_slot_id, form.subject_ids, filteredTeachers]);

  const searchLower = studentSearch.trim().toLowerCase();
  const filteredStudents = searchLower
    ? students.filter(
        (s) =>
          `${s.last_name}${s.first_name}`.toLowerCase().includes(searchLower) ||
          `${s.last_name_kana || ''}${s.first_name_kana || ''}`.toLowerCase().includes(searchLower)
      )
    : students;

  /** 選択生徒の学年に応じた科目のみ（生徒未選択時は全件表示） */
  const selectedStudent = form.student_id ? students.find((s) => s.id === form.student_id) : null;
  const allowedGradeCategory = selectedStudent ? gradeToCategory(selectedStudent.grade) : null;
  const subjectsForStudent = allowedGradeCategory
    ? subjects.filter((s) => (s.grade_category ?? 'middle') === allowedGradeCategory)
    : subjects;

  /** 科目セクション：生徒選択時は該当学年のみ表示 */
  const subjectGroupsForDisplay = useMemo(() => {
    if (allowedGradeCategory) {
      const items = subjectsForStudent;
      return items.length > 0
        ? [
            {
              category: allowedGradeCategory,
              label: GRADE_CATEGORY_LABELS[allowedGradeCategory],
              items,
            },
          ]
        : [];
    }
    return groupSubjectsByGradeCategory(subjects);
  }, [allowedGradeCategory, subjectsForStudent, subjects]);

  const validSubjectIdsForStudent = useMemo(
    () => new Set(subjectsForStudent.map((s) => s.id)),
    [subjectsForStudent]
  );

  /** 生徒変更時：該当学年外の科目選択をクリア */
  useEffect(() => {
    if (!form.student_id || form.subject_ids.length === 0) return;
    const hasInvalid = form.subject_ids.some((id) => !validSubjectIdsForStudent.has(id));
    if (hasInvalid) {
      setForm((f) => ({
        ...f,
        subject_ids: f.subject_ids.filter((id) => validSubjectIdsForStudent.has(id)),
      }));
    }
  }, [form.student_id, validSubjectIdsForStudent]);

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
          // Phase R: 保存済みの比率・半コマを尊重（編集時は契約で上書きしない）。
          ratio: editingPattern.ratio ?? 2,
          duration_minutes: editingPattern.duration_minutes ?? null,
          half_position: editingPattern.half_position ?? null,
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
          ratio: 2,
          duration_minutes: null,
          half_position: null,
        });
      }
      setStudentSearch('');
    }
  }, [open, editingPattern, timeSlots, initialStudentId]);

  // Phase R: 生徒選択時に契約比率マップを読み込む。
  useEffect(() => {
    if (!form.student_id) {
      setContractRatioMap(new Map());
      return;
    }
    let cancelled = false;
    getStudentContractRatioMap(form.student_id).then((m) => {
      if (!cancelled) setContractRatioMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, [form.student_id]);

  // Phase R: 新規登録時のみ、単一科目に応じて ratio(契約)・duration/half(科目)を初期化する。
  // 編集時は保存値を尊重するのでスキップ（送信時に duration/half は科目から決定的に再計算する）。
  useEffect(() => {
    if (editingPattern) return;
    if (!singleSubjectId) {
      setForm((f) => ({ ...f, duration_minutes: null, half_position: null }));
      return;
    }
    const dur = singleSubject?.duration_minutes ?? null;
    setForm((f) => ({
      ...f,
      ratio: contractRatioMap.get(singleSubjectId) ?? 2,
      duration_minutes: dur,
      half_position: dur === 45 ? (f.half_position ?? 'first') : null,
    }));
    // singleSubject は id から都度引けるので依存は id と duration で十分。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singleSubjectId, contractRatioMap, editingPattern, singleSubject?.duration_minutes]);

  const handleSubmit = async () => {
    if (!form.student_id || !form.time_slot_id || !form.teacher_id) return;
    setSaving(true);
    try {
      // Phase R: duration/half は科目から決定的に再計算（単一45分科目のみ半コマ）。
      const effDuration = singleSubject?.duration_minutes ?? null;
      const effHalf: HalfPosition = is45 ? (form.half_position ?? 'first') : null;
      const ratio = form.ratio ?? 2;
      const finalForm: ScheduleRegularPatternFormData = {
        ...form,
        ratio,
        duration_minutes: effDuration,
        half_position: effHalf,
      };
      // 契約=正の設計：単一科目のときはその科目の契約比率も更新（upsert）。
      if (singleSubjectId) {
        try {
          await upsertStudentContract(selectedSchoolId, form.student_id, singleSubjectId, ratio);
        } catch (e) {
          // 契約保存の失敗はパターン登録自体を止めない（比率は finalForm 側にも載る）。
          console.warn('契約比率の保存に失敗しました:', e);
        }
      }
      await onSubmit(finalForm);
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
            <Label>科目（複数可）</Label>
            {!form.student_id ? (
              <p className="text-xs text-[var(--paragraph-light)]">
                生徒を選択すると、該当学年の科目のみ表示されます
              </p>
            ) : null}
            <div className="space-y-3 border rounded-md p-2">
              {subjectGroupsForDisplay.map(({ label, items }) => (
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
          {/* Phase R: 指導比率（契約から初期化）＋単一45分科目の前後半 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>指導比率</Label>
              <Select
                value={String(form.ratio ?? 2)}
                onValueChange={(v) => setForm({ ...form, ratio: v === '1' ? 1 : 2 })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">1対2</SelectItem>
                  <SelectItem value="1">1対1（1名で満席）</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-[var(--paragraph-light)]">
                契約（生徒×科目）の比率。変更で契約も更新
              </p>
            </div>
            {is45 && (
              <div className="space-y-2">
                <Label>45分の前後半</Label>
                <Select
                  value={form.half_position ?? 'first'}
                  onValueChange={(v) => setForm({ ...form, half_position: v as HalfPosition })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="first">前半（開始〜+45分）</SelectItem>
                    <SelectItem value="second">後半（終了−45分〜終了）</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-[var(--paragraph-light)]">
                  45分授業。反対側の半コマに別生徒を入れられます
                </p>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>講師</Label>
            {form.subject_ids.length === 0 ? (
              <p className="text-xs text-[var(--paragraph-light)]">
                科目を選択すると、担当可能な講師のみ表示されます
              </p>
            ) : null}
            <Select
              value={form.teacher_id ?? undefined}
              onValueChange={(v) => setForm({ ...form, teacher_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="講師を選択" />
              </SelectTrigger>
              <SelectContent>
                {filteredTeachers.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500">
                    {form.subject_ids.length > 0
                      ? '選択した科目を担当できる講師がいません'
                      : '科目を選択してください'}
                  </div>
                ) : (
                  filteredTeachers.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.display_name || t.email || t.id}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
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
