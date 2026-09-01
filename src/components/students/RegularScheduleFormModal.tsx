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
import { HelpCircle } from 'lucide-react';
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
  getStudentContractRatioMap,
  upsertStudentContract,
} from '@/lib/api/student-subject-contracts';
import {
  buildFormationClassParams,
  filterCoursesForGrade,
  hasFixedWeeklySlot,
  resolveFormationForSlots,
} from '@/lib/schedule/patternCourseForm';
import { resolvePatternSaveMode, todayStr } from '@/lib/schedule/patternVersioning';
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
  /**
   * 講座専用モード。「授業」セレクトから個別指導を外す。
   * 個別指導の登録は生徒詳細のマトリクス（科目のドラッグ＆ドロップ）が担当するため、
   * 入り口を二重に作らない。
   */
  courseOnly?: boolean;
  /**
   * 通塾日程v2（公開ゲート canUseLessonEntryV2）。
   * true のとき「いつから適用」のセグメントを日付入力1つに置き換え、
   * 個別指導の担当講師（未定可）・指導比率を編集できるようにする。
   * false のときは従来UI・従来の保存経路のまま（講師・教室長の画面を変えないため）。
   */
  lessonEntryV2?: boolean;
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
  courseOnly = false,
  lessonEntryV2 = false,
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
  // v2: 「変更を適用する日」（新規は開始日）。既定=今日。
  // セグメント（今すぐ/指定日から）は使わず日付入力1つに統一する。
  const [applyDate, setApplyDate] = useState<string>(todayStr());
  // v2: 指導比率（個別のみ）。生徒×科目の契約と食い違わせないため契約から初期化する。
  const [ratio, setRatio] = useState<1 | 2>(2);
  const [contractRatioMap, setContractRatioMap] = useState<Map<string, 1 | 2>>(new Map());
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
      // まだ始まっていない行（例: 10/1 開始の予定）を編集するときは、その行の開始日を初期値にする。
      // 常に今日を入れていると、開いて保存しただけで開始日が今日へ前倒しされてしまい、
      // 一覧の「10/1〜」と食い違う。始まっている行は「今日から切り替える」が既定でよい。
      const patternFrom = pattern.effective_from ?? '';
      setApplyDate(patternFrom && patternFrom > todayStr() ? patternFrom : todayStr());
      setRatio(pattern.ratio ?? 2);
    } else {
      // 講座専用モードでは個別指導を選ばせないので、先頭の講座を初期選択にする
      setCourseId(courseOnly ? (courseOptions[0]?.id ?? '') : '');
      setDayOfWeek(1);
      setTimeSlotId('');
      setSubjectIds(subjectsForGrade[0] ? [subjectsForGrade[0].id] : []);
      setTeacherId('');
      setPeriodType('regular');
      setApplyMode('now');
      setEffectiveFrom(getNextMonthFirstDay());
      setEffectiveUntil('');
      setApplyDate(todayStr());
      setRatio(2);
    }
  }, [open, pattern, subjectsForGrade, courseOnly, courseOptions]);

  // v2: 比率の初期値は生徒×科目の契約が正（座席表の空席「＋」と同じ扱い）。開いたときに読む。
  useEffect(() => {
    if (!open || !lessonEntryV2 || !studentId) return;
    let cancelled = false;
    getStudentContractRatioMap(studentId).then((m) => {
      if (!cancelled) setContractRatioMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, [open, lessonEntryV2, studentId]);

  // v2: 新規の個別指導は、選んだ科目の契約比率を既定にする（契約と食い違う登録を作らない）。
  // 編集時は保存済みの値が正なので触らない。
  useEffect(() => {
    if (!open || !lessonEntryV2 || isEdit) return;
    const singleSubjectId = subjectIds.length === 1 ? subjectIds[0] : null;
    if (!singleSubjectId) return;
    setRatio(contractRatioMap.get(singleSubjectId) ?? 2);
  }, [open, lessonEntryV2, isEdit, subjectIds, contractRatioMap]);

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

  /**
   * 講師は講座では任意（担当未決定で登録できる）。個別は従来どおり必須。
   * v2 では個別でも「担当未決定」のまま登録できる（マトリクスのD&Dと同じ扱い）。
   */
  const canSubmit = !!schoolId && !!timeSlotId && (isCourseMode || lessonEntryV2 || !!teacherId);

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
            // v2 は日付入力1つ。今日なら API 側が今日を入れるので 'now' と同じ扱いにする。
            applyMode: lessonEntryV2 ? (applyDate > todayStr() ? 'future' : 'now') : applyMode,
            effectiveFrom: lessonEntryV2 ? applyDate : effectiveFrom,
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
        // v2 の個別のみ比率を送る（従来の呼び出しのペイロードは1バイトも変えない）
        ...(lessonEntryV2 && !isCourseMode ? { ratio } : {}),
      };

      // 契約=正の設計。v2 の個別で単一科目のときは契約比率も揃える
      // （座席表の空席「＋」と同じ。片方だけ動かして食い違う状態を作らない）。
      if (lessonEntryV2 && !isCourseMode && subjectIds.length === 1) {
        try {
          await upsertStudentContract(schoolId, studentId, subjectIds[0], ratio);
        } catch (e) {
          // 契約保存の失敗で通塾日程の登録自体は止めない（比率はパターン側にも載る）
          console.warn('契約比率の保存に失敗しました:', e);
        }
      }

      if (isEdit && pattern) {
        // v2 は「変更日 > 現在の開始日」なら版を切る、それ以外は上書き（純関数で判定）。
        const saveMode = lessonEntryV2
          ? resolvePatternSaveMode({
              patternEffectiveFrom: pattern.effective_from,
              applyDate,
              isCourse: isCourseMode,
            })
          : applyMode === 'future'
            ? 'version'
            : 'overwrite';
        if (saveMode === 'version') {
          // 版を切る：旧パターンに終了日（変更日の前日）をセットし、新パターンを変更日から開始
          await scheduleRegularPatternChangeFrom(
            pattern.id,
            lessonEntryV2 ? applyDate : effectiveFrom,
            {
              ...form,
              // 版を切る API は渡した値をそのまま書き込むので、形態・半コマ・比率は
              // 現在の行から引き継ぐ（渡さないと個別・全コマ・1対2 に落ちて占有が壊れる）
              formation: pattern.formation,
              duration_minutes: pattern.duration_minutes,
              half_position: pattern.half_position,
              ratio: form.ratio ?? pattern.ratio,
            },
            schoolId
          );
        } else {
          // 上書き：既存行をそのまま更新（effective_until のみ変えたい場合もここで処理）
          // 講座のパターンは special_course_id / formation を更新対象に含めないので維持される。
          await updateRegularPattern(pattern.id, {
            ...form,
            // v2 の個別で「まだ始まっていない行の開始日を前倒しする」場合だけ開始日も動かす。
            // 上書きは 変更日 <= 開始日 のときしか選ばれないので、開始が後ろへずれることはない。
            ...(lessonEntryV2 && !isCourseMode ? { effective_from: applyDate } : {}),
          });
        }
        await regenerateCurrentWeekIfNeeded(schoolId, profile?.id);
        onSuccess();
        onClose();
      } else {
        // 新規追加：v2 は日付入力の値、従来は applyMode によって今日 or 指定日
        const createForm: ScheduleRegularPatternFormData = {
          ...form,
          effective_from: lessonEntryV2
            ? applyDate || undefined
            : applyMode === 'future'
              ? effectiveFrom
              : undefined,
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

  /** 講座のパターンの編集は即時反映のみ（変更日を選ばせない） */
  const isCourseEdit = isCourseMode && isEdit;
  /** 終了日は講座の新規登録では出さない（講座の枠の終了は一覧の削除から行う） */
  const showEndDate = !(isCourseMode && !isEdit);
  /** 指導比率は v2 の個別指導だけの概念（講座は定員で管理する） */
  const showRatio = lessonEntryV2 && !isCourseMode;
  /** 日付入力が2つ並ぶ場面だけ2列にして縦を詰める（狭い画面では1列に戻す） */
  const useDateGrid = lessonEntryV2 && !isCourseEdit && showEndDate;

  return (
    /* Header / Footer は DialogContent の外に置く。中に入れるとスクロール領域に巻き込まれ、
       タイトルが画面上端で切れ、保存ボタンが画面外に出る。幅は Dialog の size で決まる。 */
    <Dialog open={open} onOpenChange={(open) => !open && onClose()} size="md">
      <DialogHeader>
        <DialogTitle>{isEdit ? '通塾日程を編集' : '通塾日程を追加'}</DialogTitle>
      </DialogHeader>

      <DialogContent>
        <div className="space-y-4">
          {/* 授業（個別指導 or 講座）。編集では変更不可（個別⇔講座の載せ替えは削除→追加で行う）。 */}
          {isEdit ? (
            /* 編集では選べないので、入力欄風の箱＋注釈2行はやめて1行の読み取り専用表示にする。
               「変更できない理由」はヘルプアイコンの title に寄せて常時2行を占有させない。 */
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[var(--paragraph)] flex-shrink-0">
                授業
              </span>
              <span className="text-sm font-medium text-[var(--headline)]">
                {selectedCourse
                  ? courseOptionLabel(selectedCourse)
                  : isCourseMode
                    ? '講座'
                    : '個別指導'}
              </span>
              <span
                className="inline-flex text-[var(--paragraph-light)]"
                title="授業の種類は変更できません。別の授業へ移す場合は削除してから追加してください。"
              >
                <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">授業</label>
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
              >
                {courseOnly ? (
                  courseOptions.length === 0 && <option value="">選択できる講座がありません</option>
                ) : (
                  <option value="">個別指導</option>
                )}
                {courseOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {courseOptionLabel(c)}
                  </option>
                ))}
              </select>
            </div>
          )}

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

          {/* 講師と指導比率は2列に並べて縦を詰める（指導比率が無い場合は講師が全幅） */}
          <div className={showRatio ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''}>
            <div>
              <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">講師</label>
              <select
                value={validTeacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
              >
                {/* 講座は担当未決定のまま登録できる（座席表の「＋講座の枠」と同じ）。
                    v2 では個別指導も担当未決定のまま登録できる（あとで座席表で決める運用）。 */}
                <option value="">
                  {isCourseMode || lessonEntryV2 ? '担当未決定' : '選択してください'}
                </option>
                {teachersForSubject.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.display_name || t.email || '—'}
                  </option>
                ))}
              </select>
            </div>

            {/* 指導比率（個別指導のみ）。生徒×科目の契約と同じ値を持たせる。 */}
            {showRatio && (
              <div>
                <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
                  指導比率
                </label>
                <div className="flex gap-2">
                  {([1, 2] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRatio(r)}
                      className={`flex-1 px-3 py-1.5 rounded text-sm border ${
                        ratio === r
                          ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                          : 'bg-white border-[var(--stroke)] text-[var(--paragraph)] hover:bg-[var(--surface)] transition-colors duration-150'
                      }`}
                    >
                      {r === 1 ? '1対1' : '1対2'}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--paragraph-light)] mt-1">
                  この科目の指導契約（1対1／1対2）にも同じ比率が保存されます。
                </p>
              </div>
            )}
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
          <div className="border-t border-[var(--stroke)] pt-3">
            {/* 変更日（開始日）と終了日は2列に並べて縦を詰める（狭い画面では1列に戻す） */}
            <div className={useDateGrid ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : 'space-y-2'}>
              {/* 講座のパターンの編集は即時反映のみ（指定日からの切替は講座の引き継ぎができないため） */}
              {isCourseEdit ? (
                <p className="text-[11px] text-[var(--paragraph-light)]">
                  講座の通塾日程の変更は今すぐ反映されます。
                </p>
              ) : lessonEntryV2 ? (
                /* v2: 「今すぐ/指定日から」の2択は使わず、日付入力1つ（既定=今日）に統一する */
                <div>
                  <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
                    {isEdit ? '適用開始日' : '開始日'}
                  </label>
                  <input
                    type="date"
                    value={applyDate}
                    onChange={(e) => setApplyDate(e.target.value)}
                    className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
                  />
                  <p className="text-[11px] text-[var(--paragraph-light)] mt-1">
                    {isEdit
                      ? '入力した内容がこの日から反映されます（操作した日ではありません）。今日より後の日にすると、前日までは今の内容のまま履歴に残ります'
                      : 'この日から授業が始まります。過去の月の請求には影響しません'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
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
                </div>
              )}

              {/* 終了日は講座の新規登録では出さない（講座の枠の終了は一覧の削除から行う） */}
              {showEndDate && (
                <div>
                  <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
                    終了日（任意）
                  </label>
                  <input
                    type="date"
                    value={effectiveUntil}
                    onChange={(e) => setEffectiveUntil(e.target.value)}
                    className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
                  />
                  <p className="text-[11px] text-[var(--paragraph-light)] mt-1">
                    退塾や期間限定の通塾の場合に指定。空欄なら無期限。
                  </p>
                </div>
              )}
            </div>
          </div>

          {errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}
        </div>
      </DialogContent>

      <DialogFooter className="gap-2">
        {/* 編集はドラッグ直後に自動で開くことがあり、その時点で既に登録済み。
            「キャンセル」だと登録も取り消されるように読めるので「閉じる」にする。 */}
        <Button variant="outline" onClick={onClose} disabled={saving}>
          {isEdit ? '閉じる' : 'キャンセル'}
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={saving || !canSubmit}
          className="bg-[#1e3a5f] hover:bg-[#2a4a6f] transition-colors duration-150"
        >
          {saving ? '保存中...' : '保存する'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
