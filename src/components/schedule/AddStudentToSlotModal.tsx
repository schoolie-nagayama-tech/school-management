'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import { StudentSearchInput, type StudentWithSubjects } from './StudentSearchInput';
import {
  createRegularPattern,
  createScheduleEntry,
  checkStudentTimeConflict,
  regenerateWeekForDate,
} from '@/lib/api/schedule';
import { getStudentCourseMap, setStudentCourse } from '@/lib/api/student-subject-contracts';
import { CoursePicker, isCourseSelectionMissing } from '@/components/schedule/CoursePicker';
import { isManagerOrAbove } from '@/lib/utils/roles';
import {
  resolveDuration,
  type CourseDuration,
  type StudentCourse,
} from '@/lib/utils/studentCourse';
import type { ScheduleTimeSlot, HalfPosition } from '@/types/schedule';
import type { ScheduleEntryFormData, ScheduleEntryKind } from '@/types/schedule';
import type { Subject } from '@/types/database';
import { DAY_OF_WEEK_LABELS } from '@/types/schedule';
import {
  groupSubjectsForSelect,
  subjectOptionLabel,
  filterSubjectsForGrade,
  gradeCategoryFromStudentGrade,
} from '@/lib/utils/subjectOptions';
import { canUseLessonEntryV2 } from '@/lib/utils/lessonEntryV2';
import { shouldCreateEntryForCell } from '@/lib/schedule/patternVersioning';

/**
 * 「この日のみ追加」で選べる授業種別。
 * regular=臨時/振替の単発、それ以外は追加授業（テスト対策/追加授業/体験）。
 * いずれも通塾日程を持たない単発コマ（regular_pattern_id=NULL）として登録する。
 */
// テスト対策は「テスト対策モード（増コマ申込の落とし込み）」に一本化したため、
// ここ（空きセルからの単発追加）には出さない（二重経路の解消）。
const SINGLE_KIND_OPTIONS: { value: ScheduleEntryKind; label: string }[] = [
  { value: 'additional', label: '追加授業' },
  { value: 'trial', label: '体験授業' },
  { value: 'regular', label: '通常（臨時・振替）' },
];

export interface AddStudentToSlotModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  dayOfWeek: number;
  timeSlot: ScheduleTimeSlot;
  teacherId: string;
  teacherName: string;
  schoolId: string;
  subjects: Subject[];
  /** 講師の指導可能科目ID。空 or null = 指導可能科目なし */
  teacherTeachableSubjectIds?: string[] | null;
  onSuccess: () => void;
}

type RegisterType = 'regular' | 'single';

export function AddStudentToSlotModal({
  isOpen,
  onClose,
  date,
  dayOfWeek,
  timeSlot,
  teacherId,
  teacherName,
  schoolId,
  subjects,
  teacherTeachableSubjectIds,
  onSuccess,
}: AddStudentToSlotModalProps) {
  const { profile } = useAuth();
  // 通塾日程v2（公開ゲート）。false のロールでは開始日の入力を出さず、
  // 保存経路も従来のまま（effective_from を渡さない＝createRegularPattern 側で今日）。
  const lessonEntryV2 = canUseLessonEntryV2(profile?.role, schoolId);
  const [selectedStudent, setSelectedStudent] = useState<StudentWithSubjects | null>(null);
  const [subjectId, setSubjectId] = useState<string>('');
  const [registerType, setRegisterType] = useState<RegisterType>('regular');
  // 「この日のみ追加」のときの授業種別（追加授業/テスト対策/体験/臨時）
  const [singleKind, setSingleKind] = useState<ScheduleEntryKind>('additional');
  const [saving, setSaving] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  // コース（PS1／PS2／キッズ）が未設定の科目で選んだ形態。★既定値を置かない。
  const [ratio, setRatio] = useState<1 | 2 | null>(null);
  const [pickedDuration, setPickedDuration] = useState<CourseDuration>(null);
  const [halfPosition, setHalfPosition] = useState<HalfPosition>(null);
  // 生徒×科目のコース。比率・時間の正のソース。
  const [courseMap, setCourseMap] = useState<Map<string, StudentCourse>>(new Map());
  const [courseLoading, setCourseLoading] = useState(false);
  // ★読み込み失敗を「未設定」と同じ扱いにしない。
  const [courseLoadError, setCourseLoadError] = useState(false);
  // v2: 通常授業の開始日（既定＝クリックしたセルの日付）。セグメントは使わず日付入力1つ。
  const [startDate, setStartDate] = useState<string>(date);

  // 選択科目。45分かどうかはコースの時間が正なので、判定は下の effectiveIs45 を使う
  // （科目マスタの duration_minutes はコース未設定の科目の既定としてだけ使う）。
  const selectedSubject = subjects.find((s) => s.id === subjectId);

  const availableSubjects = useMemo(() => {
    if (!teacherTeachableSubjectIds || teacherTeachableSubjectIds.length === 0) {
      return []; // 空 or null = 指導可能科目なし（すべてなし）
    }
    return subjects.filter((s) => teacherTeachableSubjectIds.includes(s.id));
  }, [subjects, teacherTeachableSubjectIds]);

  // P2改訂: 生徒を選んだら、その学年区分（小/中/高）でさらに科目を絞る。
  // 区分内に該当ゼロなら全（＝講師の指導可能）科目へフォールバックし注意文を出す。
  const filteredByGrade = useMemo(
    () =>
      selectedStudent
        ? filterSubjectsForGrade(
            availableSubjects,
            gradeCategoryFromStudentGrade(selectedStudent.grade)
          )
        : availableSubjects,
    [availableSubjects, selectedStudent]
  );
  const noneForGrade =
    !!selectedStudent && availableSubjects.length > 0 && filteredByGrade.length === 0;
  const shownSubjects = noneForGrade ? availableSubjects : filteredByGrade;

  useEffect(() => {
    if (isOpen) {
      setSelectedStudent(null);
      setSubjectId(availableSubjects[0]?.id ?? '');
      setRegisterType('regular');
      setSingleKind('additional');
      setConflictError(null);
      // ★既定の 1対2 を入れない。コース未設定の科目では選ばれるまで登録させない。
      setRatio(null);
      setPickedDuration(null);
      setHalfPosition(null);
      setCourseMap(new Map());
      setCourseLoadError(false);
      setStartDate(date);
    }
  }, [isOpen, availableSubjects, date]);

  // 生徒選択時にコースを読み込む。
  useEffect(() => {
    if (!selectedStudent) {
      setCourseMap(new Map());
      setCourseLoadError(false);
      return;
    }
    let cancelled = false;
    setCourseLoading(true);
    setCourseLoadError(false);
    getStudentCourseMap(selectedStudent.id).then((res) => {
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
  }, [selectedStudent]);

  // 科目が変わったら選んだ形態をクリアする（別の科目へ持ち越さない）。
  // ★ここで既定の 1対2 を入れないこと。未選択のまま登録させないのが目的。
  useEffect(() => {
    setRatio(null);
    setPickedDuration(null);
  }, [subjectId]);

  // 学年区分の絞り込みで現在の選択が候補外になったら先頭へ寄せる。
  useEffect(() => {
    if (shownSubjects.length === 0) return;
    if (!shownSubjects.some((s) => s.id === subjectId)) {
      setSubjectId(shownSubjects[0].id);
    }
  }, [shownSubjects, subjectId]);

  const slotLabel = `${DAY_OF_WEEK_LABELS[dayOfWeek] ?? ''}曜日 ${timeSlot.slot_number}限 ${timeSlot.start_time?.slice(0, 5) ?? ''}-${timeSlot.end_time?.slice(0, 5) ?? ''}`;

  /** 選択中の科目のコース。 */
  const selectedSubjectCourse = subjectId ? (courseMap.get(subjectId) ?? null) : null;
  /** 実際に保存する値。★コースがあればコースが正。 */
  const effectiveRatio: 1 | 2 | null = selectedSubjectCourse ? selectedSubjectCourse.ratio : ratio;
  const effectiveDuration: CourseDuration = selectedSubjectCourse
    ? selectedSubjectCourse.durationMinutes
    : pickedDuration;
  const effectiveIs45 =
    resolveDuration(effectiveDuration, selectedSubject?.duration_minutes) === 45;
  /** コース未設定で形態が選ばれていない（または読み込み失敗）あいだは登録させない。 */
  const courseBlocked =
    !!subjectId && isCourseSelectionMissing(selectedSubjectCourse, courseLoadError, effectiveRatio);

  // 45分になったら前後半の既定を前半にする（全コマに戻ったら外す）。
  useEffect(() => {
    setHalfPosition((prev) => (effectiveIs45 ? (prev ?? 'first') : null));
  }, [effectiveIs45]);

  const handleSubmit = async () => {
    if (!selectedStudent || !subjectId || !schoolId) return;
    if (courseBlocked) return;
    setConflictError(null);
    setSaving(true);
    try {
      const startTime = timeSlot.start_time ?? '00:00:00';
      const endTime = timeSlot.end_time ?? '23:59:59';
      // 45分のみ半コマ、それ以外は全コマ(null)。比率・時間はコースが正。
      const effHalf: HalfPosition = effectiveIs45 ? halfPosition : null;
      const effDuration = resolveDuration(effectiveDuration, selectedSubject?.duration_minutes);
      const ratioToSave: 1 | 2 = effectiveRatio ?? 2;
      const form: ScheduleEntryFormData = {
        teacher_id: teacherId,
        student_id: selectedStudent.id,
        subject_ids: [subjectId],
        seat_label: '',
        note: '',
        ratio: ratioToSave,
        duration_minutes: effDuration,
        half_position: effHalf,
      };

      if (registerType === 'regular') {
        const conflict = await checkStudentTimeConflict(
          selectedStudent.id,
          dayOfWeek,
          startTime,
          endTime,
          { durationMinutes: effDuration, halfPosition: effHalf }
        );
        if (conflict) {
          setConflictError(conflict.message);
          setSaving(false);
          return;
        }
        // ★授業の登録ではコースを書き換えない（ここの upsert が事故の原因だった）。
        //   コースが「まだ無い」ときの初回登録だけ、教室長以上に限って確定させる。
        //   講師にはコースを作らせない。間違ったコースが静かに増えると、
        //   以降の登録が全部それに従ってしまうため。未設定のまま入った分は
        //   教室長ダッシュボードの「コースと登録の食い違い」に出る。
        if (!selectedSubjectCourse && effectiveRatio !== null && isManagerOrAbove(profile?.role)) {
          try {
            await setStudentCourse({
              schoolId,
              studentId: selectedStudent.id,
              subjectId,
              ratio: effectiveRatio,
              durationMinutes: effectiveDuration,
              reasonCode: 'initial',
              actorId: profile?.id,
              actorRole: profile?.role,
            });
          } catch (e) {
            console.warn('コースの初回登録に失敗しました:', e);
          }
        }
        const pattern = await createRegularPattern(schoolId, {
          student_id: selectedStudent.id,
          day_of_week: dayOfWeek,
          time_slot_id: timeSlot.id,
          teacher_id: teacherId,
          subject_ids: [subjectId],
          seat_label: '',
          period_type: 'regular',
          ratio: ratioToSave,
          duration_minutes: effDuration,
          half_position: effHalf,
          // v2 のときだけ開始日を渡す。ゲート false では従来どおり列自体を送らない
          // （createRegularPattern 側の既定＝今日 のまま）。
          ...(lessonEntryV2 ? { effective_from: startDate } : {}),
        });
        // 当週ぶんのコマは、開始日がこのセルの日付以降のときだけ作る。
        // 未来開始のパターンでここに作ると、開始日前の授業が座席表に出てしまう。
        if (
          shouldCreateEntryForCell({ cellDate: date, startDate: lessonEntryV2 ? startDate : null })
        ) {
          await createScheduleEntry(schoolId, date, timeSlot.id, form, {
            regular_pattern_id: pattern.id,
            status: 'scheduled',
          });
        }
        await regenerateWeekForDate(schoolId, date, profile?.id);
      } else {
        const conflict = await checkStudentTimeConflict(
          selectedStudent.id,
          dayOfWeek,
          startTime,
          endTime,
          { specificDate: date, durationMinutes: effDuration, halfPosition: effHalf }
        );
        if (conflict) {
          setConflictError(conflict.message);
          setSaving(false);
          return;
        }
        // 単発コマは選んだ種別（追加授業/テスト対策/体験/臨時）で登録する。
        // regular 以外は週次再生成で削除されない（追加授業として保護される）。
        await createScheduleEntry(
          schoolId,
          date,
          timeSlot.id,
          { ...form, kind: singleKind },
          { regular_pattern_id: null, status: 'scheduled' }
        );
      }
      onSuccess();
      onClose();
    } catch (e) {
      setConflictError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // コースが未設定のまま形態を選ばずに登録させない（既定 1対2 で素通りさせない）。
  const canSubmit = selectedStudent && subjectId && schoolId && !courseBlocked && !courseLoading;

  return (
    /* Header / Footer は DialogContent の外に置く（中に入れるとスクロール領域に
       巻き込まれ、タイトルが上端で切れ、ボタンが画面外に出る）。幅は Dialog の size で決まる。 */
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()} size="md">
      <DialogHeader>
        <DialogTitle>生徒を追加</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4 py-2">
          <div className="text-sm text-[var(--paragraph)]">
            <div>追加先: {slotLabel}</div>
            <div>講師: {teacherName}</div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
              生徒を検索
            </label>
            <StudentSearchInput
              schoolId={schoolId}
              onSelect={setSelectedStudent}
              placeholder="生徒を検索..."
            />
            {selectedStudent && (
              <div className="mt-2 text-sm text-[var(--headline)]">
                選択: {selectedStudent.last_name} {selectedStudent.first_name}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">科目</label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            >
              {availableSubjects.length === 0 ? (
                <option value="">この講師の指導可能科目が設定されていません</option>
              ) : (
                groupSubjectsForSelect(shownSubjects).map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {subjectOptionLabel(s)}
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </select>
            {noneForGrade && (
              <p className="mt-1 text-[11px] text-[var(--paragraph-light)]">
                該当学年の科目がありません（指導可能科目を全て表示しています）
              </p>
            )}
          </div>

          {/* コース（PS1／PS2／キッズ）＋45分のときの前後半 */}
          <div className="grid grid-cols-2 gap-3">
            <CoursePicker
              course={selectedSubjectCourse}
              loading={courseLoading}
              loadError={courseLoadError}
              ratio={ratio}
              durationMinutes={pickedDuration}
              onChange={(r, d) => {
                setRatio(r);
                setPickedDuration(d);
              }}
              grade={selectedStudent?.grade ?? null}
              canManageCourse={isManagerOrAbove(profile?.role)}
              subjectSelected={!!subjectId}
              studentName={
                selectedStudent
                  ? `${selectedStudent.last_name} ${selectedStudent.first_name}`
                  : null
              }
              subjectName={selectedSubject?.name ?? null}
            />
            {effectiveIs45 && (
              <div>
                <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
                  45分の前後半
                </label>
                <select
                  value={halfPosition ?? 'first'}
                  onChange={(e) => setHalfPosition(e.target.value as HalfPosition)}
                  className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  <option value="first">前半（コマ開始〜+45分）</option>
                  <option value="second">後半（コマ終了−45分〜終了）</option>
                </select>
                <p className="mt-1 text-[10px] text-[var(--paragraph-light)]">
                  45分授業。同じ席の反対側にもう1人入れられます
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-medium text-[var(--paragraph)] mb-2">登録タイプ</div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="registerType"
                  checked={registerType === 'regular'}
                  onChange={() => setRegisterType('regular')}
                  className="text-[#1e3a5f]"
                />
                <span className="text-sm">通常授業として登録（毎週この曜日・コマに入る）</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="registerType"
                  checked={registerType === 'single'}
                  onChange={() => setRegisterType('single')}
                  className="text-[#1e3a5f]"
                />
                <span className="text-sm">この日のみ追加（追加授業・テスト対策・体験など）</span>
              </label>
            </div>

            {/* この日のみ追加のとき、授業種別を選ぶ。座席表では種別バッジで区別表示される */}
            {registerType === 'single' && (
              <div className="mt-2 pl-6">
                <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
                  種別
                </label>
                <select
                  value={singleKind}
                  onChange={(e) => setSingleKind(e.target.value as ScheduleEntryKind)}
                  className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  {SINGLE_KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* v2: 通常授業のときだけ開始日を選ぶ（既定＝クリックしたセルの日付）。
                「この日だけ」は単発コマなので開始日の概念がない。 */}
            {lessonEntryV2 && registerType === 'regular' && (
              <div className="mt-2 pl-6">
                <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
                  授業の開始日
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                />
                <p className="mt-1 text-[10px] text-[var(--paragraph-light)]">
                  この日から毎週の授業が始まります。先の日付にすると、その日までは座席表に出ません
                </p>
              </div>
            )}
          </div>

          {conflictError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              <div className="font-medium">時間が重複しています</div>
              <div className="mt-1">{conflictError}</div>
            </div>
          )}
        </div>
      </DialogContent>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          キャンセル
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || saving}
          className="bg-[#1e3a5f] hover:bg-[#2a4a6f]"
        >
          {saving ? '追加中...' : '追加する'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
