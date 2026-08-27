'use client';

import { useState, useEffect, useCallback, useMemo, DragEvent } from 'react';
import {
  getRegularPatterns,
  getTimeSlots,
  getActiveTimeSlots,
  deleteRegularPattern,
  createRegularPattern,
} from '@/lib/api/schedule';
import { getSubjects } from '@/lib/api/subjects';
import { getActiveYearRoundCourses, type SpecialCourse } from '@/lib/api/specialCourses';
import { getFormations } from '@/lib/api/schedule-formations';
import { fetchWithAuth } from '@/lib/api/auth';
import type { ScheduleRegularPattern, ScheduleTimeSlot } from '@/types/schedule';
import {
  DAY_OF_WEEK_LABELS,
  SCHEDULE_PERIOD_LABELS,
  SCHEDULE_ENTRY_FORMATION_LABELS,
  INDIVIDUAL_FORMATION,
} from '@/types/schedule';
import type { Subject } from '@/types/database';
import { X, Plus } from 'lucide-react';
import { Loading } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { RegularScheduleFormModal } from './RegularScheduleFormModal';

/** 講座の授業の一覧に出す講師（登録モーダルにも渡す） */
interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  teachable_subject_ids?: string[] | null;
}

interface AttendanceMatrixProps {
  studentId: string;
  schoolId: string;
  studentGrade?: number;
  canEdit: boolean;
  onPatternChange?: () => void;
}

// 月〜土 (1-6)
const WEEKDAYS = [1, 2, 3, 4, 5, 6];

function gradeToCategory(grade: number): 'elementary' | 'middle' | 'high' {
  if (grade <= 6) return 'elementary';
  if (grade <= 9) return 'middle';
  return 'high';
}

// 科目ごとの色
const SUBJECT_COLORS: Record<string, { bg: string; text: string; border: string }> = {};
const COLOR_PALETTE = [
  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300' },
  { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
  { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-300' },
  { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-300' },
  { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-300' },
];

function getSubjectColor(subjectId: string, index: number) {
  if (!SUBJECT_COLORS[subjectId]) {
    SUBJECT_COLORS[subjectId] = COLOR_PALETTE[index % COLOR_PALETTE.length];
  }
  return SUBJECT_COLORS[subjectId];
}

export function AttendanceMatrix({
  studentId,
  schoolId,
  studentGrade,
  canEdit,
  onPatternChange,
}: AttendanceMatrixProps) {
  const [patterns, setPatterns] = useState<ScheduleRegularPattern[]>([]);
  const [timeSlots, setTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  // 講座の授業（個別以外の形態のパターン）セクション用。マトリクスは個別専用のまま残し、
  // 講座はこの下のリストで扱う（入り口を1か所にまとめる）。
  const [courses, setCourses] = useState<SpecialCourse[]>([]);
  const [formationLabels, setFormationLabels] = useState<Record<string, string>>({});
  const [allTimeSlots, setAllTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();
  // 同一コマへの重ね登録をブロックした際の一時的なお知らせ（数秒で自動消去）
  const [notice, setNotice] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!schoolId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const gradeCategory = studentGrade ? gradeToCategory(studentGrade) : undefined;
    // Promise.allSettled にして 1 つ失敗しても他のデータは表示できるように
    // このマトリクスは1コマ=1生徒の単一授業（ドラッグ&ドロップで科目を割当）という個別指導の
    // モデル前提のセル設計（複数生徒が入る集団授業は表現できない）のため、コマ時間は
    // 個別指導枠のみに絞る。無指定のままだと集団の同slot_numberコマが混ざり「1限」行が重複する。
    const [patsRes, slotsRes, subsRes, coursesRes, formationsRes, allSlotsRes, teachersRes] =
      await Promise.allSettled([
        getRegularPatterns(schoolId, { studentId }),
        getTimeSlots(schoolId, INDIVIDUAL_FORMATION),
        getSubjects(gradeCategory),
        // 講座の授業セクション用。失敗してもマトリクス本体は表示できるようにここでも allSettled。
        getActiveYearRoundCourses(schoolId),
        getFormations(),
        getActiveTimeSlots(schoolId),
        // 講師一覧は編集できるときだけ引く（講師ロールは /api/admin/users を叩けない）
        canEdit
          ? fetchWithAuth('/api/admin/users?role=teacher')
              .then((r) => r.json())
              .then((d) => (d.users ?? []) as TeacherOption[])
          : Promise.resolve([] as TeacherOption[]),
      ]);
    if (patsRes.status === 'fulfilled') {
      setPatterns(patsRes.value);
    } else {
      console.error('Error fetching regular patterns:', patsRes.reason);
    }
    if (slotsRes.status === 'fulfilled') {
      setTimeSlots(slotsRes.value.filter((s) => s.is_active));
    } else {
      console.error('Error fetching time slots:', slotsRes.reason);
    }
    if (subsRes.status === 'fulfilled') {
      setSubjects(subsRes.value);
    } else {
      console.error('Error fetching subjects:', subsRes.reason);
    }
    setCourses(coursesRes.status === 'fulfilled' ? coursesRes.value : []);
    setFormationLabels(
      formationsRes.status === 'fulfilled'
        ? Object.fromEntries(formationsRes.value.map((f) => [f.key, f.label]))
        : {}
    );
    setAllTimeSlots(allSlotsRes.status === 'fulfilled' ? allSlotsRes.value : []);
    setTeachers(teachersRes.status === 'fulfilled' ? teachersRes.value : []);
    setIsLoading(false);
  }, [schoolId, studentId, studentGrade, canEdit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 科目IDから科目名のマップ
  const subjectMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of subjects) {
      map.set(s.id, s.name);
    }
    return map;
  }, [subjects]);

  // パターンを曜日×コマのマップにする (period_type='regular' かつ個別指導のみ)
  // このマトリクスのコマ行は個別指導枠に絞っているため、パターン側も個別指導のもの
  // （formation 未設定の旧データも個別として扱う）だけを対象にし、行と整合させる。
  const patternMap = useMemo(() => {
    const map = new Map<string, ScheduleRegularPattern>();
    for (const p of patterns) {
      if (p.period_type === 'regular' && p.formation === INDIVIDUAL_FORMATION) {
        map.set(`${p.day_of_week}-${p.time_slot_id}`, p);
      }
    }
    return map;
  }, [patterns]);

  // 通常期の週回数
  // 同じ曜日×コマ（例: 国/理 のように 2 科目を 1 コマで実施）は週 1 回として数えるため、
  // パターン件数ではなく「曜日×コマ」のユニーク数で集計する。
  const weeklyCount = useMemo(() => {
    const slots = new Set<string>();
    for (const p of patterns) {
      if (p.period_type === 'regular' && p.formation === INDIVIDUAL_FORMATION) {
        slots.add(`${p.day_of_week}-${p.time_slot_id}`);
      }
    }
    return slots.size;
  }, [patterns]);

  /**
   * 講座の授業（個別以外の形態の通常期パターン）。
   * マトリクスは1コマ=1生徒の個別モデルなので表現できず、下のリストで扱う。
   * 終了日を過ぎた履歴行は現在の通塾内容ではないので出さない。
   */
  const coursePatterns = useMemo(() => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return patterns
      .filter(
        (p) =>
          p.period_type === 'regular' &&
          p.formation !== INDIVIDUAL_FORMATION &&
          (!p.effective_until || p.effective_until >= todayStr)
      )
      .sort((a, b) => a.day_of_week - b.day_of_week);
  }, [patterns]);

  /** 講座の週コマ数（個別と同じく曜日×コマのユニーク数で数える） */
  const courseWeeklyCount = useMemo(
    () => new Set(coursePatterns.map((p) => `${p.day_of_week}-${p.time_slot_id}`)).size,
    [coursePatterns]
  );

  /** 講座id → 講座名。引けない場合は形態ラベルで代用する（黙って空欄にしない）。 */
  const courseLabelOf = useCallback(
    (pattern: ScheduleRegularPattern): string => {
      const course = pattern.special_course_id
        ? courses.find((c) => c.id === pattern.special_course_id)
        : null;
      if (course) return course.name;
      const formation = pattern.formation ?? '';
      return formationLabels[formation] ?? SCHEDULE_ENTRY_FORMATION_LABELS[formation] ?? '講座';
    },
    [courses, formationLabels]
  );

  /** 講師の表示。姓だけ出して密度を優先し、未設定は「担当未決定」。 */
  const teacherLabelOf = (pattern: ScheduleRegularPattern): string => {
    const name = pattern.teacher?.display_name || pattern.teacher?.email || '';
    if (!name) return '担当未決定';
    // 「山田 太郎」「山田　太郎」どちらの区切りでも姓だけを出す
    return name.split(/[ 　]+/)[0];
  };

  /** 講座の授業を1件外す（is_active=false。マトリクスのセル削除と同じ deleteRegularPattern） */
  const handleDeleteCoursePattern = useCallback(
    async (pattern: ScheduleRegularPattern) => {
      const ok = await confirm({
        title: '削除確認',
        description: 'この講座の授業を通塾日程から外しますか？',
        confirmLabel: '削除',
        variant: 'danger',
      });
      if (!ok) return;
      setSaving(pattern.id);
      try {
        await deleteRegularPattern(pattern.id);
        await fetchData();
        onPatternChange?.();
      } catch (err) {
        console.error('Error deleting course pattern:', err);
      } finally {
        setSaving(null);
      }
    },
    [confirm, fetchData, onPatternChange]
  );

  // ドラッグ開始
  const handleDragStart = useCallback((e: DragEvent, subjectId: string) => {
    e.dataTransfer.setData('subjectId', subjectId);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  // ドラッグオーバー
  const handleDragOver = useCallback((e: DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverCell(key);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverCell(null);
  }, []);

  // ドロップ → パターン作成
  const handleDrop = useCallback(
    async (e: DragEvent, dayOfWeek: number, slotId: string) => {
      e.preventDefault();
      setDragOverCell(null);
      if (!canEdit) return;

      const subjectId = e.dataTransfer.getData('subjectId');
      if (!subjectId) return;

      const key = `${dayOfWeek}-${slotId}`;
      const existing = patternMap.get(key);
      // 1コマには授業を1つだけ。2科目を同時に入れたい場合は「算/国」のような複合科目を使う。
      // 既に授業が入っているコマには重ねて登録できないようブロックし、その旨を通知する。
      if (existing) {
        setNotice(
          'このコマには既に授業が入っています。2科目を1コマで行う場合は「算/国」などの複合科目を選んでください。'
        );
        window.setTimeout(() => setNotice(null), 4000);
        return;
      }

      setSaving(key);
      try {
        // 自前の insert ではなく createRegularPattern を通す。
        // 形態をまたぐ時間帯の重複チェック（checkStudentTimeConflict）がこの中にあり、
        // 直接 insert すると講座と同じ時間帯に個別が二重に入るのを止められないため。
        await createRegularPattern(schoolId, {
          student_id: studentId,
          day_of_week: dayOfWeek,
          time_slot_id: slotId,
          teacher_id: null,
          subject_ids: [subjectId],
          seat_label: '',
          period_type: 'regular',
        });
        await fetchData();
        onPatternChange?.();
      } catch (err) {
        console.error('Error creating pattern:', err);
        // 重複エラーは黙って失敗させず、ブロック通知と同じ場所に理由を出す
        setNotice((err as Error).message || '通塾日程の登録に失敗しました');
        window.setTimeout(() => setNotice(null), 6000);
      } finally {
        setSaving(null);
      }
    },
    [canEdit, patternMap, schoolId, studentId, fetchData, onPatternChange]
  );

  // パターン削除
  const handleRemovePattern = useCallback(
    async (e: React.MouseEvent, dayOfWeek: number, slotId: string) => {
      e.stopPropagation();
      const key = `${dayOfWeek}-${slotId}`;
      const existing = patternMap.get(key);
      if (!existing) return;
      setSaving(key);
      try {
        await deleteRegularPattern(existing.id);
        await fetchData();
        onPatternChange?.();
      } catch (err) {
        console.error('Error deleting pattern:', err);
      } finally {
        setSaving(null);
      }
    },
    [patternMap, fetchData, onPatternChange]
  );

  if (isLoading) {
    return <Loading size="md" />;
  }

  if (timeSlots.length === 0) {
    return (
      <div className="text-sm text-[#2a2a2a]/80 space-y-2 p-4 bg-[#fff7ed] border border-[#fed7aa] rounded-lg">
        <p className="font-medium">この生徒の教室にコマ時間が登録されていません。</p>
        <p className="text-xs text-[#6b7280]">
          設定 → コマ時間設定 を開くと、現在選択中の教室（ヘッダーの教室）が初期表示されます。
          その教室にコマ時間を登録すると、このマトリクスに反映されます。
        </p>
        <p className="text-[10px] text-[#9ca3af]">
          school_id: <code className="px-1 bg-white rounded">{schoolId || '（なし）'}</code>
        </p>
      </div>
    );
  }

  // 90分科目と45分科目に分類
  const subjects90 = subjects.filter((s) => s.duration_minutes >= 90);
  const subjects45 = subjects.filter((s) => s.duration_minutes < 90);

  return (
    <div className="space-y-3">
      {/* 同一コマへの重ね登録ブロック通知 */}
      {notice && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          {notice}
        </div>
      )}

      {/* 科目一覧（ドラッグ元）— 表の上に横並び */}
      {canEdit && (
        <div className="space-y-1.5">
          {subjects90.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-gray-400 font-medium w-[36px] flex-shrink-0">
                90分
              </span>
              {subjects90.map((sub) => {
                const color = getSubjectColor(sub.id, subjects.indexOf(sub));
                return (
                  <div
                    key={sub.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, sub.id)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded border cursor-grab active:cursor-grabbing select-none ${color.bg} ${color.text} ${color.border}`}
                  >
                    {sub.name}
                  </div>
                );
              })}
            </div>
          )}
          {subjects45.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-gray-400 font-medium w-[36px] flex-shrink-0">
                45分
              </span>
              {subjects45.map((sub) => {
                const color = getSubjectColor(sub.id, subjects.indexOf(sub));
                return (
                  <div
                    key={sub.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, sub.id)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded border-2 border-dashed cursor-grab active:cursor-grabbing select-none ${color.bg} ${color.text} ${color.border}`}
                  >
                    {sub.name}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* マトリクス */}
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs w-full">
          <thead>
            <tr>
              <th className="border border-gray-200 bg-gray-50 px-2 py-1.5 text-left text-[10px] text-gray-500 min-w-[80px]">
                コマ
              </th>
              {WEEKDAYS.map((day) => (
                <th
                  key={day}
                  className={`border border-gray-200 bg-gray-50 px-2 py-1.5 text-center text-[10px] min-w-[56px] ${
                    day === 6 ? 'text-blue-500' : 'text-gray-600'
                  }`}
                >
                  {DAY_OF_WEEK_LABELS[day]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timeSlots.map((slot) => (
              <tr key={slot.id}>
                <td className="border border-gray-200 bg-gray-50 px-2 py-1.5 text-[10px] text-gray-500 whitespace-nowrap">
                  {slot.slot_number}限{' '}
                  <span className="text-gray-400">
                    {slot.start_time?.slice(0, 5)}-{slot.end_time?.slice(0, 5)}
                  </span>
                </td>
                {WEEKDAYS.map((day) => {
                  const key = `${day}-${slot.id}`;
                  const pattern = patternMap.get(key);
                  const isOn = !!pattern;
                  const isSaving = saving === key;
                  const isDragOver = dragOverCell === key && !isOn;

                  // 科目名・時間・色を取得
                  const firstSubjectId = pattern?.subject_ids?.[0];
                  const subjectObj = firstSubjectId
                    ? subjects.find((s) => s.id === firstSubjectId)
                    : null;
                  const subjectName =
                    subjectObj?.name ?? (firstSubjectId ? subjectMap.get(firstSubjectId) : null);
                  const is45 = subjectObj ? subjectObj.duration_minutes < 90 : false;
                  const subjectIdx = firstSubjectId
                    ? subjects.findIndex((s) => s.id === firstSubjectId)
                    : 0;
                  const color = firstSubjectId ? getSubjectColor(firstSubjectId, subjectIdx) : null;

                  return (
                    <td
                      key={key}
                      className={`border border-gray-200 px-0.5 py-0.5 text-center transition-[background-color,box-shadow] duration-150 ease-out relative h-[36px] ${
                        isSaving ? 'opacity-50' : ''
                      } ${isDragOver ? 'bg-blue-100 ring-2 ring-inset ring-blue-400' : ''} ${
                        !isOn && !isDragOver ? 'bg-white' : ''
                      }`}
                      onDragOver={(e) => handleDragOver(e, key)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, day, slot.id)}
                    >
                      {isOn && (
                        <div
                          className={`group relative flex flex-col items-center justify-center rounded mx-0.5 px-1 py-0.5 ${is45 ? 'border-2 border-dashed' : 'border'} ${color?.bg ?? 'bg-gray-100'} ${color?.border ?? 'border-gray-300'}`}
                        >
                          <span
                            className={`text-[11px] font-medium leading-tight ${color?.text ?? 'text-gray-600'}`}
                          >
                            {subjectName ?? '●'}
                          </span>
                          {is45 && (
                            <span className="text-[8px] text-gray-400 leading-none">45分</span>
                          )}
                          {canEdit && (
                            <button
                              onClick={(e) => handleRemovePattern(e, day, slot.id)}
                              className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-gray-400 hover:bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* サマリ */}
      <div className="flex items-center gap-4 text-xs">
        <span className="text-gray-500">
          通常期: <span className="font-bold text-[#1e3a5f]">週{weeklyCount}回</span>
        </span>
        {/* 講座は個別の週回数の数え方を変えず、別枠で添える */}
        {courseWeeklyCount > 0 && (
          <span className="text-gray-400">（ほかに講座 {courseWeeklyCount} コマ）</span>
        )}
        {patterns.filter((p) => p.period_type !== 'regular').length > 0 && (
          <span className="text-gray-400">
            (講習期パターン: {patterns.filter((p) => p.period_type !== 'regular').length}件)
          </span>
        )}
      </div>

      {/* 講座の授業（小集団・プログラミング等）。マトリクスは個別専用なのでここで扱う。
          講座も講座のパターンも無い教室では何も出さない（ノイズを増やさない）。 */}
      {(coursePatterns.length > 0 || (canEdit && courses.length > 0)) && (
        <div className="border-t border-gray-100 pt-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-gray-400">講座の授業（小集団・プログラミングなど）</p>
            {canEdit && courses.length > 0 && (
              <button
                type="button"
                onClick={() => setCourseFormOpen(true)}
                className="inline-flex items-center gap-1 text-[11px] text-[#1e3a5f] hover:underline transition-[color] duration-150 ease-out"
              >
                <Plus className="w-3 h-3" />
                講座の授業を追加
              </button>
            )}
          </div>
          {coursePatterns.length === 0 ? (
            <p className="text-[11px] text-gray-400">
              講座の授業はありません。「講座の授業を追加」から登録できます。
            </p>
          ) : (
            <ul className="space-y-1">
              {coursePatterns.map((p) => (
                <li
                  key={p.id}
                  className={`text-[11px] text-gray-600 flex flex-wrap items-center gap-2 ${
                    saving === p.id ? 'opacity-50' : ''
                  }`}
                >
                  <span className="inline-flex px-1.5 py-0.5 text-[9px] rounded bg-indigo-100 text-indigo-600 border border-indigo-200">
                    {courseLabelOf(p)}
                  </span>
                  <span>毎週{DAY_OF_WEEK_LABELS[p.day_of_week] ?? '—'}曜</span>
                  <span>
                    {p.time_slot
                      ? `${p.time_slot.slot_number}限 ${p.time_slot.start_time?.slice(0, 5)}-${p.time_slot.end_time?.slice(0, 5)}`
                      : '—'}
                  </span>
                  <span className="text-gray-400">{teacherLabelOf(p)}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => handleDeleteCoursePattern(p)}
                      className="ml-auto text-gray-400 hover:text-red-500 transition-[color] duration-150 ease-out"
                      aria-label="削除"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 講座の授業の登録モーダル（個別指導はマトリクスのD&Dが担当するので講座専用で開く） */}
      {canEdit && (
        <RegularScheduleFormModal
          open={courseFormOpen}
          onClose={() => setCourseFormOpen(false)}
          studentId={studentId}
          schoolId={schoolId}
          studentGrade={studentGrade}
          pattern={null}
          timeSlots={allTimeSlots}
          teachers={teachers}
          subjects={subjects}
          courses={courses}
          formationLabels={formationLabels}
          courseOnly
          onSuccess={() => {
            fetchData();
            onPatternChange?.();
          }}
        />
      )}

      {ConfirmDialog}

      {/* 講習期パターンがある場合にリスト表示 */}
      {patterns.filter((p) => p.period_type !== 'regular').length > 0 && (
        <div className="border-t border-gray-100 pt-2">
          <p className="text-[10px] text-gray-400 mb-1">講習期パターン</p>
          <ul className="space-y-1">
            {patterns
              .filter((p) => p.period_type !== 'regular')
              .map((p) => (
                <li key={p.id} className="text-[11px] text-gray-600 flex gap-2">
                  <span className="inline-flex px-1.5 py-0.5 text-[9px] rounded bg-orange-100 text-orange-600">
                    {SCHEDULE_PERIOD_LABELS[p.period_type]}
                  </span>
                  <span>{DAY_OF_WEEK_LABELS[p.day_of_week]}</span>
                  <span>
                    {p.time_slot
                      ? `${p.time_slot.slot_number}限 ${p.time_slot.start_time?.slice(0, 5)}-${p.time_slot.end_time?.slice(0, 5)}`
                      : '—'}
                  </span>
                  {p.teacher?.display_name && (
                    <span className="text-gray-400">{p.teacher.display_name}</span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
