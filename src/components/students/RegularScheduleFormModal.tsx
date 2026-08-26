'use client';

/**
 * 通塾日程の登録・編集モーダル（生徒詳細）。
 *
 * 「授業」セレクトで個別指導と講座（通年講座＝HAL・国理社オンラインライブ等）を選ぶ。
 *  - 個別指導: 従来どおり createRegularPattern / updateRegularPattern。
 *  - 講座(新規): createFormationClassPatterns を通す（定員・同時刻枠数・講師重複・
 *    生徒の時間帯重複のバリデーションが全てそこにあるため、自前で insert しない）。
 * 講座に入れる操作は座席表の形態ボードの「＋講座の枠」と同じ結果になる。
 */

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import {
  createRegularPattern,
  updateRegularPattern,
  regenerateCurrentWeekIfNeeded,
  scheduleRegularPatternChangeFrom,
} from '@/lib/api/schedule';
import { createFormationClassPatterns } from '@/lib/api/formation-patterns';
import { getFormationCapacityDefaults } from '@/lib/api/schedule-formations';
import {
  buildFormationClassParams,
  filterCoursesForGrade,
  hasFixedWeeklySlot,
  resolveFormationForSlots,
} from '@/lib/schedule/patternCourseForm';
import {
  DAY_OF_WEEK_LABELS,
  SCHEDULE_PERIOD_LABELS,
  SCHEDULE_ENTRY_FORMATION_LABELS,
  INDIVIDUAL_FORMATION,
} from '@/types/schedule';
import type {
  ScheduleRegularPattern,
  ScheduleRegularPatternFormData,
  ScheduleTimeSlot,
  SchedulePeriodType,
} from '@/types/schedule';
import type { SpecialCourse } from '@/lib/api/specialCourses';
import type { Subject } from '@/types/database';

const DAYS: number[] = [0, 1, 2, 3, 4, 5, 6];
const PERIOD_TYPES: SchedulePeriodType[] = ['regular', 'spring', 'summer', 'winter'];

/** props 未指定時の既定値。毎レンダリングで新しい配列を作ると useEffect が空回りするため定数にする。 */
const EMPTY_COURSES: SpecialCourse[] = [];
const EMPTY_FORMATION_LABELS: Record<string, string> = {};

interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  teachable_subject_ids?: string[] | null;
}

/** 学年(1-12)から科目のgrade_categoryへ */
function gradeToCategory(grade: number): 'elementary' | 'middle' | 'high' {
  if (grade <= 6) return 'elementary';
  if (grade <= 9) return 'middle';
  return 'high';
}

/** 翌月1日を YYYY-MM-DD で返す（「来月から変更」のデフォルト値） */
function getNextMonthFirstDay(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export interface RegularScheduleFormModalProps {
  open: boolean;
  onClose: () => void;
  studentId: string;
  schoolId: string;
  /** 該当学年の科目だけ表示するため（1-6: 小学生, 7-9: 中学生, 10-12: 高校生） */
  studentGrade?: number;
  pattern: ScheduleRegularPattern | null;
  /**
   * 全形態のコマ時間。形態ごとにコマ時間が独立しているため、
   * 選択中の授業（個別 or 講座の形態）で絞って候補に出す。
   */
  timeSlots: ScheduleTimeSlot[];
  teachers: TeacherOption[];
  subjects: Subject[];
  /** 教室の有効な通年講座（全形態）。対象学年での絞り込みはこのモーダル内で行う。 */
  courses?: SpecialCourse[];
  /** 形態キー → 表示名（schedule_formations.label）。講座名に添える形態ラベル用。 */
  formationLabels?: Record<string, string>;
  onSuccess: () => void;
}

export function RegularScheduleFormModal({
  open,
  onClose,
  studentId,
  schoolId,
  studentGrade,
  pattern,
  timeSlots,
  teachers,
  subjects,
  courses = EMPTY_COURSES,
  formationLabels = EMPTY_FORMATION_LABELS,
  onSuccess,
}: RegularScheduleFormModalProps) {
  const { profile } = useAuth();
  // '' = 個別指導 / 講座id = その講座
  const [courseId, setCourseId] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [timeSlotId, setTimeSlotId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [periodType, setPeriodType] = useState<SchedulePeriodType>('regular');
  // 適用開始モード: 'now' = 既存を即時上書き / 'future' = 指定日から（新パターン作成・旧パターンに終了日）
  const [applyMode, setApplyMode] = useState<'now' | 'future'>('now');
  // 適用開始日（future モード時。デフォルトは翌月1日）
  const [effectiveFrom, setEffectiveFrom] = useState<string>(getNextMonthFirstDay());
  // 終了日（任意。退塾・期間限定変更用）
  const [effectiveUntil, setEffectiveUntil] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isEdit = !!pattern;

  /** 該当学年の科目のみ（studentGrade 未指定時は全件） */
  const subjectsForGrade = useMemo(
    () =>
      studentGrade != null
        ? subjects.filter((s) => s.grade_category === gradeToCategory(studentGrade))
        : subjects,
    [subjects, studentGrade]
  );

  /** 授業セレクトに出す講座（その生徒の学年が対象に入っているもの） */
  const courseOptions = useMemo(
    () => filterCoursesForGrade(courses, studentGrade),
    [courses, studentGrade]
  );

  /** 選択中の講座。編集時は学年対象外・無効化された講座でも名前を出せるよう全件から引く。 */
  const selectedCourse = useMemo(
    () => courses.find((c) => c.id === courseId) ?? null,
    [courses, courseId]
  );

  /** 講座のパターンか（編集時はパターン自身の special_course_id が正） */
  const isCourseMode = isEdit ? !!pattern?.special_course_id : !!selectedCourse;

  /** コマ候補を出す形態。編集時はパターン自身の形態（講座が引けなくても崩れないように）。 */
  const slotFormation = resolveFormationForSlots(
    selectedCourse,
    isEdit ? (pattern?.formation ?? INDIVIDUAL_FORMATION) : null
  );

  const slotsForFormation = useMemo(
    () =>
      timeSlots
        .filter((s) => s.formation === slotFormation)
        .sort((a, b) => a.slot_number - b.slot_number),
    [timeSlots, slotFormation]
  );

  /** 開催枠固定の講座（国理社型）を新規登録するとき、曜日・コマは講座の値で固定する。 */
  const isFixedSlotCourse = !isEdit && !!selectedCourse && hasFixedWeeklySlot(selectedCourse);
  /** 講座に科目が決まっているときは科目も固定（HAL のように科目なしの講座は従来どおり選ぶ） */
  const isFixedSubjectCourse = !isEdit && !!selectedCourse?.subject_id;

  useEffect(() => {
    if (!open) return;
    setErrorMessage(null);
    if (pattern) {
      setCourseId(pattern.special_course_id ?? '');
      setDayOfWeek(pattern.day_of_week);
      setTimeSlotId(pattern.time_slot_id);
      setTeacherId(pattern.teacher_id ?? '');
      setSubjectIds(pattern.subject_ids ?? []);
      setPeriodType(pattern.period_type ?? 'regular');
      setApplyMode('now');
      setEffectiveFrom(getNextMonthFirstDay());
      setEffectiveUntil(pattern.effective_until ?? '');
    } else {
      setCourseId('');
      setDayOfWeek(1);
      setTimeSlotId('');
      setSubjectIds(subjectsForGrade[0] ? [subjectsForGrade[0].id] : []);
      setTeacherId('');
      setPeriodType('regular');
      setApplyMode('now');
      setEffectiveFrom(getNextMonthFirstDay());
      setEffectiveUntil('');
    }
  }, [open, pattern, subjectsForGrade]);

  // 授業（個別 / 講座）を切り替えたら、その形態のコマ・講座の曜日・科目に合わせ直す。
  // 形態ごとにコマ時間マスタが独立しているため、コマidの持ち越しは必ず外す。
  useEffect(() => {
    if (!open || isEdit) return;
    if (selectedCourse && hasFixedWeeklySlot(selectedCourse)) {
      setDayOfWeek(selectedCourse.day_of_week as number);
      setTimeSlotId(selectedCourse.time_slot_id as string);
    } else {
      setTimeSlotId((prev) =>
        slotsForFormation.some((s) => s.id === prev) ? prev : (slotsForFormation[0]?.id ?? '')
      );
    }
    if (selectedCourse?.subject_id) {
      const fixed = selectedCourse.subject_id;
      setSubjectIds((prev) => (prev.length === 1 && prev[0] === fixed ? prev : [fixed]));
    } else {
      // 講座固有の科目が外れたら、学年の科目一覧に無い科目は選択から落とす
      setSubjectIds((prev) => {
        const next = prev.filter((id) => subjectsForGrade.some((s) => s.id === id));
        return next.length === prev.length ? prev : next;
      });
    }
  }, [open, isEdit, selectedCourse, slotsForFormation, subjectsForGrade]);

  /** 選択科目を指導可能な講師のみ（teachable_subject_ids が空/未設定は全科目可） */
  const teachersForSubject =
    subjectIds.length > 0
      ? teachers.filter((t) => {
          const allowed = t.teachable_subject_ids;
          if (!allowed || allowed.length === 0) return true;
          return subjectIds.some((id) => allowed.includes(id));
        })
      : teachers;

  const validTeacherId =
    teacherId === ''
      ? ''
      : teachersForSubject.some((t) => t.id === teacherId)
        ? teacherId
        : (teachersForSubject[0]?.id ?? '');

  useEffect(() => {
    if (teacherId !== '' && validTeacherId !== teacherId) {
      setTeacherId(validTeacherId);
    }
  }, [validTeacherId, teacherId]);

  /** 講師は講座では任意（担当未決定で登録できる）。個別は従来どおり必須。 */
  const canSubmit = !!schoolId && !!timeSlotId && (isCourseMode || !!teacherId);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      // 講座への新規登録は必ず createFormationClassPatterns を通す（定員等の検査がそこにある）
      if (!isEdit && selectedCourse) {
        const capacityDefaults = await getFormationCapacityDefaults(
          schoolId,
          selectedCourse.formation
        );
        await createFormationClassPatterns(
          buildFormationClassParams({
            schoolId,
            studentId,
            course: selectedCourse,
            dayOfWeek,
            timeSlotId,
            teacherId,
            subjectIds,
            applyMode,
            effectiveFrom,
            capacityDefaults,
          })
        );
        await regenerateCurrentWeekIfNeeded(schoolId, profile?.id);
        onSuccess();
        onClose();
        return;
      }

      const form: ScheduleRegularPatternFormData = {
        student_id: studentId,
        day_of_week: dayOfWeek,
        time_slot_id: timeSlotId,
        teacher_id: teacherId || null,
        subject_ids: subjectIds,
        seat_label: '',
        period_type: periodType,
        effective_until: effectiveUntil || null,
      };
      if (isEdit && pattern) {
        if (applyMode === 'future') {
          // 「来月から」変更：旧パターンに終了日をセットし、新パターンを effective_from から開始
          await scheduleRegularPatternChangeFrom(pattern.id, effectiveFrom, form, schoolId);
        } else {
          // 即時変更：既存行をそのまま更新（effective_until のみ変えたい場合もここで処理）
          // 講座のパターンは special_course_id / formation を更新対象に含めないので維持される。
          await updateRegularPattern(pattern.id, form);
        }
        await regenerateCurrentWeekIfNeeded(schoolId, profile?.id);
        onSuccess();
        onClose();
      } else {
        // 新規追加：effective_from は applyMode によって今日 or 指定日
        const createForm: ScheduleRegularPatternFormData = {
          ...form,
          effective_from: applyMode === 'future' ? effectiveFrom : undefined,
        };
        await createRegularPattern(schoolId, createForm);
        await regenerateCurrentWeekIfNeeded(schoolId, profile?.id);
        onSuccess();
        onClose();
      }
    } catch (e) {
      setErrorMessage((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const slotLabel = (slot: ScheduleTimeSlot) =>
    `${slot.slot_number}限 ${slot.start_time?.slice(0, 5) ?? ''}-${slot.end_time?.slice(0, 5) ?? ''}`;

  /** 講座名に添える形態ラベル（例「HAL50分（プログラミング）」） */
  const courseOptionLabel = (course: SpecialCourse) => {
    const label =
      formationLabels[course.formation] ??
      SCHEDULE_ENTRY_FORMATION_LABELS[course.formation] ??
      course.formation;
    return `${course.name}（${label}）`;
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle>{isEdit ? '通塾日程を編集' : '通塾日程を追加'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 授業（個別指導 or 講座）。編集では変更不可（個別⇔講座の載せ替えは削除→追加で行う）。 */}
          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">授業</label>
            {isEdit ? (
              <p className="px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-[var(--surface)] text-[var(--paragraph)]">
                {selectedCourse
                  ? courseOptionLabel(selectedCourse)
                  : isCourseMode
                    ? '講座'
                    : '個別指導'}
              </p>
            ) : (
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
              >
                <option value="">個別指導</option>
                {courseOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {courseOptionLabel(c)}
                  </option>
                ))}
              </select>
            )}
            {isEdit && (
              <p className="text-[11px] text-[var(--paragraph-light)] mt-1">
                授業の種類は変更できません。別の授業へ移す場合は削除してから追加してください。
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">曜日</label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={isFixedSlotCourse}
                  onClick={() => setDayOfWeek(d)}
                  className={`px-3 py-1.5 rounded text-sm border ${
                    dayOfWeek === d
                      ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                      : 'bg-white border-[var(--stroke)] text-[var(--paragraph)] hover:bg-[var(--surface)] transition-colors duration-150'
                  } ${isFixedSlotCourse ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  {DAY_OF_WEEK_LABELS[d] ?? ''}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">コマ</label>
            <select
              value={timeSlotId}
              disabled={isFixedSlotCourse}
              onChange={(e) => setTimeSlotId(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white disabled:bg-[var(--surface)] disabled:text-[var(--paragraph)]"
            >
              {slotsForFormation.length === 0 && <option value="">コマ時間がありません</option>}
              {slotsForFormation.map((s) => (
                <option key={s.id} value={s.id}>
                  {slotLabel(s)}
                </option>
              ))}
            </select>
            {isFixedSlotCourse && (
              <p className="text-[11px] text-[var(--paragraph-light)] mt-1">
                この講座は開催枠が決まっているため、曜日・コマは変更できません。
              </p>
            )}
            {!isFixedSlotCourse && isCourseMode && !isEdit && slotsForFormation.length === 0 && (
              <p className="text-[11px] text-[#c62828] mt-1">
                この講座の指導形態にコマ時間が登録されていません。「授業の設定」で登録してください。
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">科目</label>
            <select
              value={subjectIds[0] ?? ''}
              disabled={isFixedSubjectCourse}
              onChange={(e) => {
                const next = e.target.value ? [e.target.value] : [];
                setSubjectIds(next);
                if (next.length === 0) {
                  setTeacherId('');
                } else {
                  const nextTeacherIds = teachers
                    .filter((t) => {
                      const allowed = t.teachable_subject_ids;
                      if (!allowed || allowed.length === 0) return true;
                      return next.some((id) => allowed.includes(id));
                    })
                    .map((t) => t.id);
                  if (!nextTeacherIds.includes(teacherId)) setTeacherId(nextTeacherIds[0] ?? '');
                }
              }}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white disabled:bg-[var(--surface)] disabled:text-[var(--paragraph)]"
            >
              <option value="">選択してください</option>
              {isFixedSubjectCourse &&
                !subjectsForGrade.some((s) => s.id === subjectIds[0]) &&
                subjectIds[0] && (
                  // 講座の科目が学年の科目一覧に無い場合でも、選択中の値を表示できるようにする
                  <option value={subjectIds[0]}>
                    {subjects.find((s) => s.id === subjectIds[0])?.name ?? '講座の科目'}
                  </option>
                )}
              {subjectsForGrade.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {isFixedSubjectCourse && (
              <p className="text-[11px] text-[var(--paragraph-light)] mt-1">
                この講座の科目は固定です。
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">講師</label>
            <select
              value={validTeacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
            >
              {/* 講座は担当未決定のまま登録できる（座席表の「＋講座の枠」と同じ） */}
              <option value="">{isCourseMode ? '担当未決定' : '選択してください'}</option>
              {teachersForSubject.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name || t.email || '—'}
                </option>
              ))}
            </select>
          </div>

          {/* 期間区分は講座の新規登録では選ばせない（講座の枠は通常期として作られる） */}
          {!(isCourseMode && !isEdit) && (
            <div>
              <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">期間</label>
              <select
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value as SchedulePeriodType)}
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
              >
                {PERIOD_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {SCHEDULE_PERIOD_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 適用範囲（バージョン管理）— 過去月の請求と整合を取るため、変更日を予約できる */}
          <div className="border-t border-[var(--stroke)] pt-3 space-y-2">
            {/* 講座のパターンの編集は即時反映のみ（指定日からの切替は講座の引き継ぎができないため） */}
            {isCourseMode && isEdit ? (
              <p className="text-[11px] text-[var(--paragraph-light)]">
                講座の通塾日程の変更は今すぐ反映されます。
              </p>
            ) : (
              <>
                <label className="block text-xs font-medium text-[var(--paragraph)]">
                  いつから適用
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setApplyMode('now')}
                    className={`flex-1 px-3 py-1.5 rounded text-sm border ${
                      applyMode === 'now'
                        ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                        : 'bg-white border-[var(--stroke)] text-[var(--paragraph)] hover:bg-[var(--surface)]'
                    }`}
                  >
                    今すぐ反映
                  </button>
                  <button
                    type="button"
                    onClick={() => setApplyMode('future')}
                    className={`flex-1 px-3 py-1.5 rounded text-sm border ${
                      applyMode === 'future'
                        ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                        : 'bg-white border-[var(--stroke)] text-[var(--paragraph)] hover:bg-[var(--surface)]'
                    }`}
                  >
                    指定日から
                  </button>
                </div>
                {applyMode === 'future' && (
                  <div>
                    <input
                      type="date"
                      value={effectiveFrom}
                      onChange={(e) => setEffectiveFrom(e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
                    />
                    <p className="text-[11px] text-[var(--paragraph-light)] mt-1">
                      {isEdit
                        ? 'この日以降に新しい設定が適用され、これまでの設定はこの日の前日で終了します（過去月の請求計算に影響しません）'
                        : 'この日から新しい通塾日程として登録されます'}
                    </p>
                  </div>
                )}
              </>
            )}

            {/* 終了日は講座の新規登録では出さない（講座の枠の終了は一覧の削除から行う） */}
            {!(isCourseMode && !isEdit) && (
              <>
                <label className="block text-xs font-medium text-[var(--paragraph)] pt-2">
                  終了日（任意）
                </label>
                <input
                  type="date"
                  value={effectiveUntil}
                  onChange={(e) => setEffectiveUntil(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
                />
                <p className="text-[11px] text-[var(--paragraph-light)]">
                  退塾や期間限定の通塾の場合に指定。空欄なら無期限。
                </p>
              </>
            )}
          </div>

          {errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !canSubmit}
            className="bg-[#1e3a5f] hover:bg-[#2a4a6f] transition-colors duration-150"
          >
            {saving ? '保存中...' : '保存する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
