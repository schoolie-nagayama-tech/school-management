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
import { useAuth } from '@/contexts/AuthContext';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import { SCHEDULE_PERIOD_LABELS, DAY_OF_WEEK_LABELS } from '@/types/schedule';
import type {
  ScheduleRegularPattern,
  ScheduleRegularPatternFormData,
  SchedulePeriodType,
  HalfPosition,
} from '@/types/schedule';
import type { ScheduleTimeSlot } from '@/types/schedule';
import type { Subject } from '@/types/database';
import { getStudentCourseMap, setStudentCourse } from '@/lib/api/student-subject-contracts';
import { CoursePicker, isCourseSelectionMissing } from '@/components/schedule/CoursePicker';
import { CourseChangeDialog } from '@/components/students/CourseChangeDialog';
import { isManagerOrAbove } from '@/lib/utils/roles';
import {
  resolveDuration,
  type CourseDuration,
  type StudentCourse,
} from '@/lib/utils/studentCourse';
// 出勤可否は teacher_availability_periods（正典）を経由して判定する。
// user_profiles の生カラム(available_days_of_week 等)は教室非依存の単一値で
// period の manual > regular_shift の優先順位も表現できないため、直読みしない。
import {
  getAvailabilityDayMap,
  availableUserIdsForInterval,
  type AvailabilityDayMap,
} from '@/lib/api/teacher-availability';

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
  /**
   * @deprecated 出勤可否は teacher_availability_periods から取得した
   * AvailabilityDayMap を使う（下記 availabilityMap state）。呼び出し元の型互換のため
   * プロパティ自体は残すが、このコンポーネントは参照しない。
   */
  available_days_of_week?: number[] | null;
  /** @deprecated 同上 */
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
  const { profile } = useAuth();
  const [form, setForm] = useState<ScheduleRegularPatternFormData>({
    student_id: '',
    day_of_week: 1,
    time_slot_id: '',
    teacher_id: '',
    subject_ids: [],
    seat_label: '',
    period_type: 'regular',
    // ★比率の既定を置かない。コース（PS1／PS2／キッズ）が正で、
    //   コース未設定の科目では選ばれるまで保存させない。
    duration_minutes: null,
    half_position: null,
  });
  const [studentSearch, setStudentSearch] = useState('');
  const [saving, setSaving] = useState(false);
  // 生徒×科目のコース（PS1／PS2／キッズ）。ここが比率・時間の正のソース。
  const [courseMap, setCourseMap] = useState<Map<string, StudentCourse>>(new Map());
  const [courseLoading, setCourseLoading] = useState(false);
  // ★読み込み失敗を「未設定」と同じ扱いにしない（既定へ落ちると1対1の生徒を1対2で登録する）。
  const [courseLoadError, setCourseLoadError] = useState(false);
  const [showCourseChange, setShowCourseChange] = useState(false);
  // コース未設定の科目で選んだ形態。null = 未選択（既定を置かない）。
  const [pickedRatio, setPickedRatio] = useState<1 | 2 | null>(null);
  const [pickedDuration, setPickedDuration] = useState<CourseDuration>(null);
  // 出勤可否（正典）。教室・時点(asOfDate)で取り直す非同期データ。
  // null は「未取得（読み込み中 or ダイアログ未オープン）」を表し、取得完了後は
  // period が1件も無い教室でも空の Map（byDayOfWeek.size === 0）で確定させる。
  const [availabilityMap, setAvailabilityMap] = useState<AvailabilityDayMap | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  // 半コマは「単一科目 かつ その科目が45分」のときだけ扱う（複数科目は全コマ）。
  const singleSubjectId = form.subject_ids.length === 1 ? form.subject_ids[0] : null;
  const singleSubject = singleSubjectId
    ? (subjects.find((s) => s.id === singleSubjectId) ?? null)
    : null;
  // 45分かどうかはコースの時間が正。科目マスタの duration_minutes は
  // コース未設定の科目の既定としてだけ使う（判定は下の effectiveIs45）。

  const teachersForSchool = teachers.filter((t) =>
    t.user_schools?.some((us) => us.school_id === selectedSchoolId)
  );

  const selectedTimeSlot = timeSlots.find((s) => s.id === form.time_slot_id);

  // 出勤可否データの取得。asOfDate は編集中パターンの effective_from があればそれを、
  // 無ければ今日を使う（新規作成時は「今日時点で有効な出勤可否」で候補を絞るのが妥当）。
  useEffect(() => {
    if (!open || !selectedSchoolId) return;
    let cancelled = false;
    setAvailabilityLoading(true);
    const asOfDate = editingPattern?.effective_from ?? new Date().toISOString().slice(0, 10);
    getAvailabilityDayMap(selectedSchoolId, asOfDate)
      .then((map) => {
        if (!cancelled) setAvailabilityMap(map);
      })
      .catch(() => {
        // 取得失敗時は「絞り込みなし（全員候補）」にフォールバックする。
        // 出勤可否の取得エラーで講師選択自体をブロックしたくない。
        if (!cancelled) setAvailabilityMap(null);
      })
      .finally(() => {
        if (!cancelled) setAvailabilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedSchoolId, editingPattern?.effective_from]);

  const filteredTeachers = useMemo(() => {
    // 科目未選択時は講師を表示しない（科目→講師の順で選択させる）
    if (form.subject_ids.length === 0) return [];

    // (a)(b) 出勤可否チェック（teacher_availability_periods 正典、manual > regular_shift 済み）。
    //  - availabilityMap 未取得（読み込み中）のときは絞り込みをスキップする。読み込み完了前に
    //    候補を空にすると、選択済みの講師が一瞬消えて見える事故になるため。
    //  - byDayOfWeek が空 Map（その教室に period レコードが1件も無い）のときも絞り込みを
    //    スキップする。「出勤可否データが存在しない」ことと「誰も出勤できない」ことは別であり、
    //    後者と誤解釈すると講師が全員候補から消えてしまう。
    let availableTeacherIds: Set<string> | null = null;
    if (availabilityMap && selectedTimeSlot && availabilityMap.byDayOfWeek.size > 0) {
      availableTeacherIds = new Set(
        availableUserIdsForInterval(
          availabilityMap,
          form.day_of_week,
          selectedTimeSlot.start_time,
          selectedTimeSlot.end_time
        )
      );
    }

    return teachersForSchool.filter((t) => {
      if (availableTeacherIds && !availableTeacherIds.has(t.id)) return false;

      // (c) 指導可能科目チェック（選択科目を担当可能な講師のみ）
      const allowed = t.teachable_subject_ids;
      if (!allowed || allowed.length === 0) return false;
      return form.subject_ids.some((id) => allowed.includes(id));
    });
  }, [teachersForSchool, form.day_of_week, form.subject_ids, selectedTimeSlot, availabilityMap]);

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
        // 編集時は行に保存されている値を選択の初期値にする（コースが無い既存行をそのまま保てるように）。
        setPickedRatio(editingPattern.ratio === 1 ? 1 : 2);
        setPickedDuration(
          editingPattern.duration_minutes === 45
            ? 45
            : editingPattern.duration_minutes === 90
              ? 90
              : null
        );
      } else {
        setForm({
          student_id: initialStudentId ?? '',
          day_of_week: 1,
          time_slot_id: timeSlots[0]?.id ?? '',
          teacher_id: '',
          subject_ids: [],
          seat_label: '',
          period_type: 'regular',
          duration_minutes: null,
          half_position: null,
        });
        // ★新規は既定を置かない。コース未設定の科目では選ばれるまで保存させない。
        setPickedRatio(null);
        setPickedDuration(null);
      }
      setStudentSearch('');
    }
  }, [open, editingPattern, timeSlots, initialStudentId]);

  // 生徒選択時にコースを読み込む。
  useEffect(() => {
    if (!form.student_id) {
      setCourseMap(new Map());
      setCourseLoadError(false);
      return;
    }
    let cancelled = false;
    setCourseLoading(true);
    setCourseLoadError(false);
    getStudentCourseMap(form.student_id).then((res) => {
      if (cancelled) return;
      setCourseLoading(false);
      if (res.ok) {
        setCourseMap(res.map);
      } else {
        setCourseMap(new Map());
        setCourseLoadError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [form.student_id]);

  // 新規登録で科目を切り替えたら、選んだ形態をクリアする（別の科目へ持ち越さない）。
  // ★ここで既定の 1対2 を入れないこと。未選択のまま保存できないようにするのが目的。
  // ScheduleRegularPatternFormData.ratio は「未選択」を表せない（1|2）ので、
  // 選択中の値はフォーム本体ではなくこのローカル state で持ち、送信時に確定させる。
  useEffect(() => {
    if (editingPattern) return;
    setPickedRatio(null);
    setPickedDuration(null);
  }, [singleSubjectId, editingPattern]);

  /** 選択中の科目のコース。単一科目のときだけ比率・時間の概念を持つ（複数科目は全コマ）。 */
  const selectedSubjectCourse = singleSubjectId ? (courseMap.get(singleSubjectId) ?? null) : null;
  /** 実際に保存する値。★コースがあればコースが正（フォームの選択値を優先しない）。 */
  const effectiveRatio: 1 | 2 | null = selectedSubjectCourse
    ? selectedSubjectCourse.ratio
    : pickedRatio;
  const effectiveDuration: CourseDuration = selectedSubjectCourse
    ? selectedSubjectCourse.durationMinutes
    : pickedDuration;
  /** 実効の45分判定。コースの時間 → 無ければ科目マスタの既定、の順。 */
  const effectiveIs45 = resolveDuration(effectiveDuration, singleSubject?.duration_minutes) === 45;
  /**
   * コース未設定の科目で形態が選ばれていない（または読み込み失敗）あいだは保存させない。
   * ★以前は既定 1対2 で素通りしていたため、コース未登録の生徒が黙って1対2で通っていた。
   */
  const courseBlocked =
    !!singleSubjectId &&
    isCourseSelectionMissing(selectedSubjectCourse, courseLoadError, effectiveRatio);

  const handleSubmit = async () => {
    if (!form.student_id || !form.time_slot_id || !form.teacher_id) return;
    if (courseBlocked) return;
    setSaving(true);
    try {
      // 比率・時間はコースが正。コースが無い科目だけフォームで選ばれた値を使う。
      const ratio: 1 | 2 = effectiveRatio ?? 2;
      const effDuration = resolveDuration(effectiveDuration, singleSubject?.duration_minutes);
      const effHalf: HalfPosition = effectiveIs45 ? (form.half_position ?? 'first') : null;
      const finalForm: ScheduleRegularPatternFormData = {
        ...form,
        ratio,
        duration_minutes: effDuration,
        half_position: effHalf,
      };

      // ★授業の登録ではコースを書き換えない（ここの upsert が事故の原因だった）。
      //   コースが「まだ無い」ときの初回登録だけ、教室長以上に限って確定させる。
      if (
        !editingPattern &&
        singleSubjectId &&
        !selectedSubjectCourse &&
        effectiveRatio !== null &&
        isManagerOrAbove(profile?.role)
      ) {
        try {
          await setStudentCourse({
            schoolId: selectedSchoolId,
            studentId: form.student_id,
            subjectId: singleSubjectId,
            ratio: effectiveRatio,
            durationMinutes: effectiveDuration,
            reasonCode: 'initial',
            actorId: profile?.id,
            actorRole: profile?.role,
          });
        } catch (e) {
          // コースが入らなくてもパターン登録は止めない。
          // 未設定のまま残った分は教室長ダッシュボードの「コース未設定」で拾える。
          console.warn('コースの初回登録に失敗しました:', e);
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

  return (
    /* Header / Footer は DialogContent の外に置く（中に入れるとスクロール領域に
       巻き込まれ、タイトルが上端で切れ、ボタンが画面外に出る）。幅は Dialog の size で決まる。 */
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} size="md">
      <DialogHeader>
        <DialogTitle>{editingPattern ? '通塾日程を編集' : '通塾日程を追加'}</DialogTitle>
      </DialogHeader>
      <DialogContent>
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
                    {s.last_name} {s.first_name}（{formatGradeLabel(s.grade)}）
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
          {/* コース（PS1／PS2／キッズ）＋45分のときの前後半 */}
          <div className="grid grid-cols-2 gap-4">
            <CoursePicker
              course={selectedSubjectCourse}
              loading={courseLoading}
              loadError={courseLoadError}
              ratio={pickedRatio}
              durationMinutes={pickedDuration}
              onChange={(r, d) => {
                setPickedRatio(r);
                setPickedDuration(d);
              }}
              grade={selectedStudent?.grade ?? null}
              canManageCourse={isManagerOrAbove(profile?.role)}
              onRequestChange={() => setShowCourseChange(true)}
              subjectSelected={!!singleSubjectId}
              studentName={
                selectedStudent
                  ? `${selectedStudent.last_name} ${selectedStudent.first_name}`
                  : null
              }
              subjectName={singleSubject?.name ?? null}
              registeredRatio={editingPattern ? (editingPattern.ratio === 1 ? 1 : 2) : null}
              registeredDuration={
                editingPattern
                  ? editingPattern.duration_minutes === 45
                    ? 45
                    : editingPattern.duration_minutes === 90
                      ? 90
                      : null
                  : null
              }
            />
            {effectiveIs45 && (
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
            ) : availabilityLoading ? (
              <p className="text-xs text-[var(--paragraph-light)]">出勤可否を確認中...</p>
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
      </DialogContent>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          キャンセル
        </Button>
        <Button onClick={handleSubmit} disabled={saving || courseBlocked || courseLoading}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </DialogFooter>

      {/* コースを変更する唯一の入口。 */}
      {showCourseChange && singleSubjectId && form.student_id && (
        <CourseChangeDialog
          open
          onClose={() => setShowCourseChange(false)}
          onSaved={() => {
            getStudentCourseMap(form.student_id).then((res) => {
              if (res.ok) setCourseMap(res.map);
            });
          }}
          schoolId={selectedSchoolId}
          studentId={form.student_id}
          studentName={
            selectedStudent ? `${selectedStudent.last_name} ${selectedStudent.first_name}` : ''
          }
          subjectId={singleSubjectId}
          subjectName={singleSubject?.name ?? ''}
          current={selectedSubjectCourse}
          grade={selectedStudent?.grade ?? null}
          actorId={profile?.id}
          actorRole={profile?.role}
        />
      )}
    </Dialog>
  );
}
