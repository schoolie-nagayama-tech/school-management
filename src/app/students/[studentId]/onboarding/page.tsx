'use client';

/**
 * 入会オンボーディングウィザード（教室長向け）。
 *
 * 入会処理から「担当講師の決定」までを 1 つの流れで完結させる
 * （設計: docs/small-group-programming-schedule-plan.md §2.13 ／ §2.13改訂 ／ §2.13改訂2）。
 *
 * 入口:
 *  1. 問合せ詳細「生徒として登録」→ 生徒作成後 `/students/[id]/onboarding?inquiryId=...` へ遷移
 *  2. 生徒詳細（StudentDetailModal）に「通塾セットアップ」導線（通塾日程 0 件のときのみ表示）
 *
 * ステップ（§2.13改訂2 で役割分担を明確化）:
 *  1. 生徒情報の確認（主要4項目のインライン編集。ここだけ即時 updateStudent）
 *  2. 受講科目（学年で絞った科目を複数選択。各科目に 比率＋曜日＋時限＋45分なら前半/後半 を確定）
 *  3. コマ配置: ① 通塾開始日 ／ ② スケジュール（Step2 で決めた各コマだけをミニ座席表として詳しく表示し、
 *     受講科目の数だけ並ぶドラッグカードを出勤講師に D&D して担当を決定）
 *  4. 確認・一括保存（契約 upsert・パターン作成・週再生成・体験コマ引き継ぎ）
 *
 * 途中離脱では何も書かれない（Step1 の生徒情報修正のみ例外で即時保存）。保存は Step4 で一括。
 * 担当を落とさなかった科目は teacher_id=null（担当未決定）で登録し、座席表側で後から割り当てる。
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { AdminLayout } from '@/components/layouts';
import { Loading, Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { getStudent, updateStudent } from '@/lib/api/students';
import { getSubjects } from '@/lib/api/subjects';
import { fetchWithAuth } from '@/lib/api/auth';
import {
  getActiveTimeSlots,
  getScheduleEntries,
  getClosedDays,
  getWeekStartForDate,
  createRegularPattern,
  checkStudentTimeConflict,
  regenerateWeekForDate,
  convertInquiryTrialEntriesToStudent,
} from '@/lib/api/schedule';
import { getAvailabilityDayMap } from '@/lib/api/teacher-availability';
import { getClassCapacity, DEFAULT_CLASS_CAPACITY } from '@/lib/api/school-class-capacity';
import {
  getStudentContractRatioMap,
  upsertStudentContract,
} from '@/lib/api/student-subject-contracts';
import {
  gradeCategoryFromStudentGrade,
  filterSubjectsForGrade,
  groupSubjectsForSelect,
  subjectOptionLabel,
} from '@/lib/utils/subjectOptions';
import { getSurname } from '@/lib/utils/teacherName';
import { evaluateStudentDrop } from '@/lib/utils/scheduleDrop';
import { INDIVIDUAL_FORMATION, DAY_OF_WEEK_LABELS } from '@/types/schedule';
import type { HalfPosition, ScheduleTimeSlot, ScheduleEntry } from '@/types/schedule';
import type { Student, Subject } from '@/types/database';
import { CheckCircle2, ArrowRight, ArrowLeft, CalendarDays } from 'lucide-react';
import {
  MiniSeatingSlot,
  OnboardingDragCard,
  type Placement,
  type SubjectDragPayload,
} from './MiniSeatingGrid';
import styles from '@/components/schedule/scheduleDensity.module.css';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import { toKatakana } from '@/lib/utils/kana';

// Step2 の曜日プルダウンに出す曜日＝月〜土（個別指導は日曜運用しない想定）。
const SELECTABLE_DAYS = [1, 2, 3, 4, 5, 6];

const TOTAL_STEPS = 4;
const STEP_LABELS = ['生徒情報', '受講科目', 'コマ配置', '確認'];

/** ローカル講師（/api/admin/users?role=teacher の返り値の必要フィールド）。 */
interface OnbTeacher {
  id: string;
  display_name: string | null;
  last_name?: string | null;
  email: string | null;
  teachable_subject_ids?: string[] | null;
  gender?: 'male' | 'female' | 'other' | null;
}

/** Step2 で確定した1科目ぶんの受講計画（科目×曜日×コマ×比率×半コマ）。 */
interface SubjectPlan {
  subject: Subject;
  ratio: 1 | 2;
  day: number;
  slotId: string;
  slotNumber: number;
  startTime: string;
  endTime: string;
  durationMinutes: number | null;
  half: HalfPosition;
}

/** "HH:MM[:SS]" → 分。 */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/**
 * 45 分授業の実効時間帯を導出する（schedule.ts の computeEffectiveTimeRange と同等・クライアント版）。
 * 前半=開始〜+45分 / 後半=終了−45分〜終了 / それ以外はコマ全体。同一曜日のコマ同士の重複判定に使う。
 */
function effectiveRange(
  startTime: string,
  endTime: string,
  duration: number | null,
  half: HalfPosition
): { start: number; end: number } {
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  if (duration === 45 && half === 'first') return { start: s, end: s + 45 };
  if (duration === 45 && half === 'second') return { start: e - 45, end: e };
  return { start: s, end: e };
}

/**
 * 受講計画リスト内で「同一曜日かつ実効時間帯が重なる」ペアを探す。
 * （例: 同じコマに 90分科目を2つ入れてしまった等）。重なりが無ければ null。
 */
function findPlanOverlap(plans: SubjectPlan[]): SubjectPlan | null {
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      const a = plans[i];
      const b = plans[j];
      if (a.day !== b.day) continue;
      const ra = effectiveRange(a.startTime, a.endTime, a.durationMinutes, a.half);
      const rb = effectiveRange(b.startTime, b.endTime, b.durationMinutes, b.half);
      if (ra.start < rb.end && rb.start < ra.end) return a;
    }
  }
  return null;
}

/** YYYY-MM-DD（ローカル）。 */
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 月曜始まりの週開始日 + (dow-1) 日 → その曜日の実日付。dow は 1(月)〜6(土)。 */
function dateForDow(weekStartStr: string, dow: number): string {
  const d = new Date(weekStartStr + 'T12:00:00');
  d.setDate(d.getDate() + (dow - 1));
  return toLocalDateStr(d);
}

/** 来月1日の YYYY-MM-DD。 */
function firstOfNextMonth(): string {
  const d = new Date();
  return toLocalDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 1));
}

/** ドロップ先 droppable id の生成/解析（`onb:day:slotId:teacherId`）。 */
function makeDropId(day: number, slotId: string, teacherId: string): string {
  return `onb:${day}:${slotId}:${teacherId}`;
}
function parseDropId(id: string): { day: number; slotId: string; teacherId: string } | null {
  if (!id.startsWith('onb:')) return null;
  const parts = id.slice('onb:'.length).split(':');
  if (parts.length !== 3) return null;
  return { day: parseInt(parts[0], 10), slotId: parts[1], teacherId: parts[2] };
}

export default function OnboardingPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const studentId = params.studentId as string;
  const inquiryId = searchParams.get('inquiryId');

  // 今は入会経路によらず Step1（生徒情報の確認）だけ行い、受講科目・コマ配置・
  // 担当決定（Step2〜4）はデフォルト（未設定）でスキップして生徒詳細へ直接進む。
  // 通塾セットアップ自体は生徒詳細から後で行える。
  // （元は問合せ経由=inquiryId付きだけこの挙動だったが、生徒管理からの新規登録
  //   →「通塾セットアップ」導線も同じくStep1のみにした。inquiryId 自体は
  //   「問合せから転記済み」バッジの表示にのみ引き続き使う。）
  const singleStepOnly = true;

  const { profile, schoolIds } = useAuth();
  const isManager = isManagerOrAbove(profile?.role);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(1);

  // ---- 読み込みデータ ----
  const [student, setStudent] = useState<Student | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [timeSlots, setTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [teachers, setTeachers] = useState<OnbTeacher[]>([]);
  // 1講師あたりの個別席上限（満席判定用）。取得失敗時は既定値。
  const [maxStudents, setMaxStudents] = useState<number>(
    DEFAULT_CLASS_CAPACITY.max_students_per_teacher_individual
  );

  // ---- Step1: 生徒情報のインライン編集 ----
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastKana, setLastKana] = useState('');
  const [firstKana, setFirstKana] = useState('');
  const [grade, setGrade] = useState<number>(7);
  const [schoolName, setSchoolName] = useState('');
  const [isSavingStudent, setIsSavingStudent] = useState(false);

  // ---- Step2: 受講科目（科目×曜日×コマ×比率×半コマ）----
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<Set<string>>(new Set());
  const [ratioMap, setRatioMap] = useState<Map<string, 1 | 2>>(new Map());
  // 科目ごとの受講コマ（曜日・時限）と 45分の半コマ位置。
  const [dayMap, setDayMap] = useState<Map<string, number>>(new Map());
  const [slotMap, setSlotMap] = useState<Map<string, string>>(new Map());
  const [halfMap, setHalfMap] = useState<Map<string, HalfPosition>>(new Map());

  // ---- Step3: コマ配置（ミニ座席表） ----
  const [effectiveFrom, setEffectiveFrom] = useState<string>(toLocalDateStr(new Date()));
  // 表示週の実データ
  const [weekLoading, setWeekLoading] = useState(false);
  const [availByDaySlot, setAvailByDaySlot] = useState<Map<string, string[]>>(new Map());
  const [weekEntries, setWeekEntries] = useState<ScheduleEntry[]>([]);
  const [closedDates, setClosedDates] = useState<Set<string>>(new Set());
  // ローカルに積んだ配置（1科目=最大1件。ドロップ先講師つき）
  const [placements, setPlacements] = useState<Placement[]>([]);
  // ドラッグ中ペイロード（どの科目カードを掴んでいるか。枠色・可否計算に使う）
  const [dragPayload, setDragPayload] = useState<SubjectDragPayload | null>(null);

  // ---- Step4: 保存 ----
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{
    patternCount: number;
    undecidedCount: number;
    trialConverted: number;
    trialSkipped: number;
    skipped: boolean;
  } | null>(null);

  const schoolId = student?.school_id ?? '';

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // ---- 初期ロード ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError('');
      try {
        const stu = await getStudent(studentId, schoolIds.length > 0 ? schoolIds : undefined);
        if (!stu) {
          if (!cancelled) setLoadError('生徒が見つかりません');
          return;
        }
        const [allSubjects, slots, contractMap, cap, teacherRes] = await Promise.all([
          getSubjects(),
          getActiveTimeSlots(stu.school_id, INDIVIDUAL_FORMATION),
          getStudentContractRatioMap(stu.id),
          getClassCapacity(stu.school_id).catch(() => DEFAULT_CLASS_CAPACITY),
          fetchWithAuth('/api/admin/users?role=teacher')
            .then((r) => r.json())
            .then((d) => (d.users || []) as OnbTeacher[])
            .catch(() => [] as OnbTeacher[]),
        ]);
        if (cancelled) return;

        setStudent(stu);
        setLastName(stu.last_name ?? '');
        setFirstName(stu.first_name ?? '');
        setLastKana(stu.last_name_kana ?? '');
        setFirstKana(stu.first_name_kana ?? '');
        setGrade(stu.grade ?? 7);
        setSchoolName(stu.school_name ?? '');

        setSubjects(allSubjects);
        setTimeSlots([...slots].sort((a, b) => a.slot_number - b.slot_number));
        setRatioMap(new Map(contractMap));
        setMaxStudents((cap ?? DEFAULT_CLASS_CAPACITY).max_students_per_teacher_individual);
        setTeachers(teacherRes);
      } catch (err) {
        if (!cancelled) setLoadError(getUserErrorMessage(err, 'データの取得に失敗しました'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, schoolIds]);

  // ---- Step3: 開始日を含む週の実データ（出勤講師・座席・休講）を取得 ----
  const weekStartStr = useMemo(() => getWeekStartForDate(effectiveFrom), [effectiveFrom]);
  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    (async () => {
      setWeekLoading(true);
      try {
        const weekEnd = new Date(weekStartStr + 'T12:00:00');
        weekEnd.setDate(weekEnd.getDate() + 6);
        const weekEndStr = toLocalDateStr(weekEnd);
        const [dayMapRes, entries, closed] = await Promise.all([
          getAvailabilityDayMap(schoolId, weekStartStr),
          getScheduleEntries(schoolId, weekStartStr, weekEndStr),
          getClosedDays(schoolId, { from: weekStartStr, to: weekEndStr }).catch(() => []),
        ]);
        if (cancelled) return;
        setAvailByDaySlot(dayMapRes.byDayAndSlotNumber);
        setWeekEntries(entries);
        setClosedDates(new Set(closed.map((c) => c.closed_date)));
      } catch (e) {
        if (!cancelled) {
          console.warn('週データの取得に失敗:', e);
          setAvailByDaySlot(new Map());
          setWeekEntries([]);
          setClosedDates(new Set());
        }
      } finally {
        if (!cancelled) setWeekLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId, weekStartStr]);

  // 学年区分で絞った科目（区分に該当ゼロなら全表示にフォールバック）
  const gradeSubjects = useMemo(() => {
    const filtered = filterSubjectsForGrade(subjects, gradeCategoryFromStudentGrade(grade));
    return filtered.length > 0 ? filtered : subjects;
  }, [subjects, grade]);

  const subjectGroups = useMemo(() => groupSubjectsForSelect(gradeSubjects), [gradeSubjects]);

  const subjectById = useMemo(() => {
    const m = new Map<string, Subject>();
    subjects.forEach((s) => m.set(s.id, s));
    return m;
  }, [subjects]);

  const subjectNameById = useMemo(() => {
    const m = new Map<string, string>();
    subjects.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [subjects]);

  const teacherById = useMemo(() => {
    const m = new Map<string, OnbTeacher>();
    teachers.forEach((t) => m.set(t.id, t));
    return m;
  }, [teachers]);

  const selectedSubjects = useMemo(
    () =>
      Array.from(selectedSubjectIds)
        .map((id) => subjectById.get(id))
        .filter((s): s is Subject => !!s),
    [selectedSubjectIds, subjectById]
  );

  const studentName = student ? `${student.last_name} ${student.first_name}` : '';

  // Step2 で確定した受講計画（曜日・時限が揃った科目のみ）。曜日→コマ順で安定ソート。
  const subjectPlans = useMemo<SubjectPlan[]>(() => {
    const plans: SubjectPlan[] = [];
    for (const s of selectedSubjects) {
      const day = dayMap.get(s.id);
      const slotId = slotMap.get(s.id);
      if (day == null || !slotId) continue;
      const slot = timeSlots.find((t) => t.id === slotId);
      if (!slot) continue;
      const is45 = s.duration_minutes === 45;
      plans.push({
        subject: s,
        ratio: ratioMap.get(s.id) ?? 2,
        day,
        slotId,
        slotNumber: slot.slot_number,
        startTime: slot.start_time,
        endTime: slot.end_time,
        durationMinutes: s.duration_minutes ?? null,
        half: is45 ? (halfMap.get(s.id) ?? 'first') : null,
      });
    }
    return plans.sort((a, b) => a.day - b.day || a.slotNumber - b.slotNumber);
  }, [selectedSubjects, dayMap, slotMap, ratioMap, halfMap, timeSlots]);

  // (曜日×コマ) 単位にまとめたミニ座席表の並び（同一コマに複数科目が来たら1枠にまとめる）。
  const combos = useMemo(() => {
    const m = new Map<
      string,
      {
        key: string;
        day: number;
        slotId: string;
        slotNumber: number;
        startTime: string;
        plans: SubjectPlan[];
      }
    >();
    for (const p of subjectPlans) {
      const key = `${p.day}|${p.slotId}`;
      const g = m.get(key) ?? {
        key,
        day: p.day,
        slotId: p.slotId,
        slotNumber: p.slotNumber,
        startTime: p.startTime,
        plans: [],
      };
      g.plans.push(p);
      m.set(key, g);
    }
    return Array.from(m.values()).sort((a, b) => a.day - b.day || a.slotNumber - b.slotNumber);
  }, [subjectPlans]);

  // 科目ID → その科目の配置（担当講師）。未配置＝担当未決定。
  const placementBySubject = useMemo(() => {
    const m = new Map<string, Placement>();
    placements.forEach((p) => m.set(p.subjectId, p));
    return m;
  }, [placements]);

  // ---- Step1: 生徒情報の即時保存 ----
  const saveStudentInfo = useCallback(async () => {
    if (!student) return;
    setIsSavingStudent(true);
    try {
      const updated = await updateStudent(student.id, {
        last_name: lastName.trim() || student.last_name,
        first_name: firstName.trim(),
        // 問合せから転記された値は入力欄を経由しないため、保存時にも必ず揃える
        last_name_kana: toKatakana(lastKana.trim()),
        first_name_kana: toKatakana(firstKana.trim()),
        grade,
        school_name: schoolName.trim() || null,
      });
      setStudent(updated);
      toast.success('生徒情報を保存しました');
      return true;
    } catch (err) {
      toast.error(getUserErrorMessage(err, '生徒情報の保存に失敗しました'));
      return false;
    } finally {
      setIsSavingStudent(false);
    }
  }, [student, lastName, firstName, lastKana, firstKana, grade, schoolName]);

  // Step1 のみモードの完了処理: Step1 の内容を保存して、通塾セットアップ（Step2〜4）を
  // 経由せず生徒詳細へ直接遷移する。通塾設定は生徒詳細から後で行える。
  const finishSingleStep = useCallback(async () => {
    const ok = await saveStudentInfo();
    if (ok === false) return;
    toast.success('生徒登録が完了しました');
    router.push(`/students/${studentId}/schedule`);
  }, [saveStudentInfo, router, studentId]);

  // 指定科目の配置（担当講師）を取り消す（受講コマを変えたら担当は無効化する）。
  const dropPlacementForSubject = useCallback((subjectId: string) => {
    setPlacements((prev) => prev.filter((p) => p.subjectId !== subjectId));
  }, []);

  // ---- Step2: 科目トグルと各項目の変更 ----
  const toggleSubject = (id: string) => {
    setSelectedSubjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // 選択解除した科目の配置は無効化する。
        dropPlacementForSubject(id);
      } else {
        next.add(id);
        if (!ratioMap.has(id)) setRatioMap((m) => new Map(m).set(id, 2));
        // 45分科目は既定で前半にしておく（表示直後から半コマが確定するように）。
        if (subjectById.get(id)?.duration_minutes === 45 && !halfMap.has(id)) {
          setHalfMap((m) => new Map(m).set(id, 'first'));
        }
      }
      return next;
    });
  };

  const setSubjectRatio = (id: string, ratio: 1 | 2) => {
    setRatioMap((m) => new Map(m).set(id, ratio));
  };
  // 曜日・時限は受講コマそのものなので、変更したら担当（配置）を無効化する。
  const setSubjectDay = (id: string, day: number) => {
    setDayMap((m) => new Map(m).set(id, day));
    dropPlacementForSubject(id);
  };
  const setSubjectSlot = (id: string, slotId: string) => {
    setSlotMap((m) => new Map(m).set(id, slotId));
    dropPlacementForSubject(id);
  };
  const setSubjectHalf = (id: string, half: HalfPosition) => {
    setHalfMap((m) => new Map(m).set(id, half));
  };

  // ---- Step3: セル内の講師別データ ----
  // 指定セル（日付×コマ×講師）の実データ在籍（キャンセル・振替元は除外）。
  const activeEntriesFor = useCallback(
    (date: string, slotId: string, teacherId: string): ScheduleEntry[] =>
      weekEntries.filter(
        (e) =>
          e.entry_date === date &&
          e.time_slot_id === slotId &&
          e.teacher_id === teacherId &&
          e.status !== 'cancelled' &&
          e.status !== 'transferred_out'
      ),
    [weekEntries]
  );

  const placementsFor = useCallback(
    (day: number, slotId: string, teacherId: string): Placement[] =>
      placements.filter(
        (p) => p.day === day && p.timeSlotId === slotId && p.teacherId === teacherId
      ),
    [placements]
  );

  // 指定科目に対する講師の相性（指導可否/性別/除外）。evaluateStudentDrop の violation と同基準。
  const compatForSubject = useCallback(
    (subjectId: string, teacher: OnbTeacher): { ok: boolean; reason: string | null } | null => {
      if (!student) return null;
      const teachable = teacher.teachable_subject_ids ?? [];
      if (teachable.length > 0 && !teachable.includes(subjectId)) {
        return { ok: false, reason: '指導科目外の講師です' };
      }
      const excluded = student.excluded_teacher_ids ?? [];
      if (excluded.includes(teacher.id)) {
        return { ok: false, reason: '担当除外指定の講師です' };
      }
      const preferred = student.preferred_teacher_gender;
      if (preferred && teacher.gender && teacher.gender !== preferred) {
        return {
          ok: false,
          reason: `${preferred === 'male' ? '男性' : '女性'}講師希望のため割当不可`,
        };
      }
      return { ok: true, reason: null };
    },
    [student]
  );

  // ドラッグ中: この講師カードに落とせるか（evaluateStudentDrop 流用）。
  // 掴んでいる科目の (曜日, コマ) と一致しないミニ座席表には落とせない。
  const canDropFor = useCallback(
    (date: string, day: number, slotId: string, teacher: OnbTeacher): boolean | null => {
      if (!dragPayload || !student) return null;
      if (dragPayload.day !== day || dragPayload.slotId !== slotId) return false;
      const existing = activeEntriesFor(date, slotId, teacher.id);
      const local = placementsFor(day, slotId, teacher.id);
      const targetActiveEntries = [
        ...existing.map((e) => ({ student_id: e.student_id })),
        ...local.map(() => ({ student_id: student.id })),
      ];
      const decision = evaluateStudentDrop({
        entry: {
          entry_date: '',
          time_slot_id: '',
          teacher_id: '',
          student_id: student.id,
          subject_ids: [dragPayload.subjectId],
          student: {
            id: student.id,
            last_name: student.last_name,
            first_name: student.first_name,
            grade: student.grade,
            preferred_teacher_gender: student.preferred_teacher_gender ?? null,
            excluded_teacher_ids: student.excluded_teacher_ids ?? null,
          },
        },
        target: { date, slotId, teacherId: teacher.id },
        targetActiveEntries,
        targetTeacher: {
          teachable_subject_ids: teacher.teachable_subject_ids ?? null,
          gender: teacher.gender ?? null,
        },
        maxStudentsPerTeacher: maxStudents,
        isClosed: closedDates.has(date),
      });
      return decision.kind === 'drop';
    },
    [dragPayload, student, activeEntriesFor, placementsFor, maxStudents, closedDates]
  );

  // ---- D&D ハンドラ ----
  const handleDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { type?: string; payload?: SubjectDragPayload } | null;
    if (data?.type === 'onb-subject' && data.payload) setDragPayload(data.payload);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const payload = dragPayload;
    setDragPayload(null);
    if (!payload || !e.over || !student) return;
    const parsed = parseDropId(String(e.over.id));
    if (!parsed) return;
    const { day, slotId, teacherId } = parsed;
    // 掴んでいる科目のコマと違うミニ座席表には置けない（理由を出す）。
    if (day !== payload.day || slotId !== payload.slotId) {
      toast.error('この授業は受講科目で選んだ曜日・コマにのみ配置できます');
      return;
    }
    // 同じ科目を二重配置しない（通常は配置済みカードが draggable でないので起きない）。
    if (placements.some((p) => p.subjectId === payload.subjectId)) return;
    const slot = timeSlots.find((s) => s.id === slotId);
    const teacher = teacherById.get(teacherId);
    if (!slot || !teacher) return;
    const date = dateForDow(weekStartStr, day);

    const existing = activeEntriesFor(date, slotId, teacherId);
    const local = placementsFor(day, slotId, teacherId);
    const targetActiveEntries = [
      ...existing.map((en) => ({ student_id: en.student_id })),
      ...local.map(() => ({ student_id: student.id })),
    ];
    const decision = evaluateStudentDrop({
      entry: {
        entry_date: '',
        time_slot_id: '',
        teacher_id: '',
        student_id: student.id,
        subject_ids: [payload.subjectId],
        student: {
          id: student.id,
          last_name: student.last_name,
          first_name: student.first_name,
          grade: student.grade,
          preferred_teacher_gender: student.preferred_teacher_gender ?? null,
          excluded_teacher_ids: student.excluded_teacher_ids ?? null,
        },
      },
      target: { date, slotId, teacherId },
      targetActiveEntries,
      targetTeacher: {
        teachable_subject_ids: teacher.teachable_subject_ids ?? null,
        gender: teacher.gender ?? null,
      },
      maxStudentsPerTeacher: maxStudents,
      isClosed: closedDates.has(date),
    });

    // 入れられない場合は理由をトースト表示（満席・重複・休講・相性）。noop だけ無反応。
    if (decision.kind === 'violation' || decision.kind === 'blocked') {
      toast.error(decision.reason);
      return;
    }
    if (decision.kind === 'noop') return;

    // drop 確定: ローカルに配置を積む（担当＝落とした講師）。
    setPlacements((prev) => [
      ...prev,
      {
        key: `${payload.subjectId}|${teacherId}|${Date.now()}`,
        day,
        date,
        timeSlotId: slotId,
        slotNumber: slot.slot_number,
        startTime: slot.start_time,
        endTime: slot.end_time,
        teacherId,
        subjectId: payload.subjectId,
        ratio: payload.ratio,
        durationMinutes: payload.durationMinutes,
        halfPosition: payload.halfPosition,
      },
    ]);
  };

  const removePlacement = (key: string) => {
    setPlacements((prev) => prev.filter((p) => p.key !== key));
  };

  // ---- ステップ遷移 ----
  const goNext = async () => {
    if (step === 1) {
      const ok = await saveStudentInfo();
      if (ok === false) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      if (selectedSubjectIds.size === 0) {
        toast.error('受講科目を1つ以上選択してください');
        return;
      }
      // 全選択科目に曜日・時限が揃っているか。
      const incomplete = selectedSubjects.filter(
        (s) => dayMap.get(s.id) == null || !slotMap.get(s.id)
      );
      if (incomplete.length > 0) {
        toast.error('各受講科目の曜日と時限を選択してください');
        return;
      }
      // 同一曜日で時間帯が重なるコマ指定は先に是正させる。
      const overlap = findPlanOverlap(subjectPlans);
      if (overlap) {
        toast.error(
          `${DAY_OF_WEEK_LABELS[overlap.day]}曜のコマ指定が重なっています。曜日・時限を見直してください`
        );
        return;
      }
      setStep(3);
      return;
    }
    if (step === 3) {
      // 受講コマは Step2 で確定済み。担当未決定のまま進んでよい（後から座席表で割当可）。
      setStep(4);
      return;
    }
  };

  const goPrev = () => {
    if (step > 1) setStep(step - 1);
  };

  // 通塾設定をスキップして完了（パターン未作成。生徒登録だけで終える）。
  const handleSkip = () => {
    setSaveResult({
      patternCount: 0,
      undecidedCount: 0,
      trialConverted: 0,
      trialSkipped: 0,
      skipped: true,
    });
    toast.success('通塾設定をスキップしました');
  };

  // ---- Step4: 一括保存 ----
  const handleSubmit = async () => {
    if (!student) return;
    setIsSaving(true);
    try {
      // 1a. 新コマ同士（同一曜日で実効時間帯が重なる）の重複 → 是正は Step2（コマ指定）で。
      const overlap = findPlanOverlap(subjectPlans);
      if (overlap) {
        toast.error(
          `${DAY_OF_WEEK_LABELS[overlap.day]}曜のコマ指定が重なっています。曜日・時限を見直してください`
        );
        setIsSaving(false);
        setStep(2);
        return;
      }
      // 1b. DB 既存パターン/エントリとの重複
      for (const p of subjectPlans) {
        const conflict = await checkStudentTimeConflict(studentId, p.day, p.startTime, p.endTime, {
          durationMinutes: p.durationMinutes,
          halfPosition: p.half,
        });
        if (conflict) {
          toast.error(conflict.message);
          setIsSaving(false);
          setStep(2);
          return;
        }
      }

      // 2) 契約 upsert（選択科目ごと）。失敗しても登録は止めない。
      await Promise.all(
        Array.from(selectedSubjectIds).map((sid) =>
          upsertStudentContract(schoolId, studentId, sid, ratioMap.get(sid) ?? 2).catch((e) => {
            console.warn('契約比率の保存に失敗:', e);
          })
        )
      );

      // 3) 通塾日程パターンを作成（科目ごと。担当＝配置した講師 or 未決定=null。effective_from＝開始日）。
      let undecidedCount = 0;
      for (const p of subjectPlans) {
        const teacherId = placementBySubject.get(p.subject.id)?.teacherId ?? null;
        if (!teacherId) undecidedCount++;
        await createRegularPattern(schoolId, {
          student_id: studentId,
          day_of_week: p.day,
          time_slot_id: p.slotId,
          teacher_id: teacherId,
          subject_ids: [p.subject.id],
          seat_label: '',
          period_type: 'regular',
          effective_from: effectiveFrom,
          formation: INDIVIDUAL_FORMATION,
          ratio: p.ratio,
          duration_minutes: p.durationMinutes,
          half_position: p.half,
        });
      }

      // 4) 開始日を含む週の座席表を再生成（パターンをエントリに反映）
      await regenerateWeekForDate(schoolId, effectiveFrom, profile?.id);

      // 5) 問合せ経由なら体験コマを生徒へ引き継ぐ
      let trialConverted = 0;
      let trialSkipped = 0;
      if (inquiryId) {
        try {
          const r = await convertInquiryTrialEntriesToStudent(inquiryId, studentId);
          trialConverted = r.converted;
          trialSkipped = r.skipped;
        } catch (e) {
          console.warn('体験コマの引き継ぎに失敗:', e);
        }
      }

      setSaveResult({
        patternCount: subjectPlans.length,
        undecidedCount,
        trialConverted,
        trialSkipped,
        skipped: false,
      });
      toast.success('通塾セットアップを登録しました');
    } catch (err) {
      toast.error(getUserErrorMessage(err, '登録に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  // ---- 権限・ローディング ----
  if (profile === null) {
    return (
      <AdminLayout headerTitle="通塾セットアップ">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }
  if (!isManager) {
    return (
      <AdminLayout>
        <AccessDenied message="通塾セットアップは教室長以上のみ利用できます" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      headerTitle="通塾セットアップ"
      documentTitle={
        student
          ? `${student.last_name} ${student.first_name}｜通塾セットアップ`
          : '通塾セットアップ'
      }
    >
      <div className="max-w-5xl mx-auto pb-24">
        {loadError && (
          <div className="mb-4 p-4 bg-danger/20 border border-danger rounded-lg">
            <p className="text-sm text-danger">{loadError}</p>
          </div>
        )}

        {isLoading ? (
          <Loading size="md" />
        ) : !student ? null : saveResult ? (
          // ─────────── 完了画面 ───────────
          <div className="flex flex-col items-center text-center py-16 gap-4">
            <CheckCircle2 className="w-14 h-14 text-success" />
            <h1 className="text-xl font-bold text-text-heading">
              {saveResult.skipped ? '生徒登録を完了しました' : '通塾セットアップが完了しました'}
            </h1>
            <p className="text-sm text-text-muted">
              {saveResult.skipped ? (
                <>
                  {student.last_name} {student.first_name}{' '}
                  さんを登録しました。通塾日程は後から「通塾セットアップ」で設定できます。
                </>
              ) : (
                <>
                  {student.last_name} {student.first_name} さんの通塾日程 {saveResult.patternCount}{' '}
                  コマを登録しました。
                  {saveResult.undecidedCount > 0 &&
                    `（うち ${saveResult.undecidedCount} コマは担当未決定。座席表で割り当ててください）`}
                  {saveResult.trialConverted > 0 &&
                    ` 体験コマ ${saveResult.trialConverted} 件を引き継ぎました。`}
                  {saveResult.trialSkipped > 0 &&
                    `（${saveResult.trialSkipped} 件は重複のためスキップ）`}
                </>
              )}
            </p>
            <div className="flex gap-3 mt-4">
              <Link href="/schedule">
                <Button>
                  <CalendarDays className="w-4 h-4 mr-1.5" />
                  座席表を見る
                </Button>
              </Link>
              <Link href={`/students/${studentId}/schedule`}>
                <Button variant="secondary">生徒詳細へ</Button>
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* ステップインジケーター（今は Step1 のみなので出さない） */}
            {!singleStepOnly && (
              <div className="flex items-center justify-between mb-8">
                {[1, 2, 3, 4].map((s) => (
                  <div key={s} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className={`flex items-center justify-center w-9 h-9 rounded-full border-2 text-sm font-medium transition-colors ${
                          s === step
                            ? 'bg-primary border-primary text-white'
                            : s < step
                              ? 'bg-text-heading border-text-heading text-white'
                              : 'bg-surface-raised border-border text-text-muted'
                        }`}
                      >
                        {s < step ? <CheckCircle2 className="w-4 h-4" /> : s}
                      </div>
                      <span
                        className={`text-[11px] ${s === step ? 'text-text-heading font-medium' : 'text-text-muted'}`}
                      >
                        {STEP_LABELS[s - 1]}
                      </span>
                    </div>
                    {s < TOTAL_STEPS && (
                      <div
                        className={`flex-1 h-0.5 mx-2 ${s < step ? 'bg-text-heading' : 'bg-border'}`}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="bg-surface-raised border border-border rounded-xl p-6 min-h-[360px]">
              {/* ─── Step1: 生徒情報の確認 ─── */}
              {step === 1 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-base font-bold text-text-heading mb-1">生徒情報の確認</h2>
                    <p className="text-xs text-text-muted">
                      主要項目をその場で修正できます。詳細な編集は
                      <Link
                        href={`/students/${studentId}/schedule`}
                        className="text-info hover:underline mx-1"
                      >
                        生徒ページ
                      </Link>
                      から行えます。
                      {inquiryId && (
                        <span className="ml-1 inline-block px-2 py-0.5 rounded-full bg-info-subtle text-info text-[11px]">
                          問合せから転記済み
                        </span>
                      )}
                    </p>
                    {singleStepOnly && (
                      <p className="text-xs text-text-muted mt-1">
                        受講科目・通塾日程・担当講師の設定は今はスキップします。生徒詳細ページの「通塾セットアップ」から後で行えます。
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs text-text-muted">姓</label>
                      <input
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs text-text-muted">名</label>
                      <input
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs text-text-muted">セイ（フリガナ）</label>
                      <input
                        value={lastKana}
                        // 検索・並び替えがカナ依存のため、ひらがなで入力されても揃える
                        onChange={(e) => setLastKana(toKatakana(e.target.value))}
                        placeholder="ヤマダ"
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs text-text-muted">メイ（フリガナ）</label>
                      <input
                        value={firstKana}
                        onChange={(e) => setFirstKana(toKatakana(e.target.value))}
                        placeholder="タロウ"
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs text-text-muted">学年</label>
                      <select
                        value={grade}
                        onChange={(e) => setGrade(parseInt(e.target.value, 10))}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
                          <option key={g} value={g}>
                            {formatGradeLabel(g)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs text-text-muted">在籍校（通学先）</label>
                      <input
                        value={schoolName}
                        onChange={(e) => setSchoolName(e.target.value)}
                        placeholder="例：〇〇中学校"
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ─── Step2: 受講科目（科目×曜日×コマ×比率）─── */}
              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-base font-bold text-text-heading mb-1">受講科目</h2>
                    <p className="text-xs text-text-muted">
                      {formatGradeLabel(grade)}{' '}
                      の科目を選び、科目ごとに「比率・曜日・時限」を決めます。45分科目は前半/後半も選びます。ここで「何を・いつ・何対何で」が確定します。
                    </p>
                  </div>
                  {timeSlots.length === 0 && (
                    <div className="p-3 rounded-lg border border-warning/40 bg-warning/10 text-xs text-warning">
                      個別指導のコマ時間が未設定です。設定 →
                      コマ時間から登録すると時限を選べるようになります。
                    </div>
                  )}
                  <div className="space-y-4">
                    {subjectGroups.map((group) => (
                      <div key={group.label}>
                        <p className="text-xs font-medium text-text-body mb-2">{group.label}</p>
                        <div className="space-y-1.5">
                          {group.subjects.map((s) => {
                            const checked = selectedSubjectIds.has(s.id);
                            const is45 = s.duration_minutes === 45;
                            return (
                              <div
                                key={s.id}
                                className="rounded-lg border border-border bg-surface-hover px-3 py-2"
                              >
                                <div className="flex items-center gap-3 flex-wrap">
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleSubject(s.id)}
                                      className="w-4 h-4 accent-primary"
                                    />
                                    <span className="text-sm text-text-body">
                                      {subjectOptionLabel(s)}
                                    </span>
                                  </label>
                                  {checked && (
                                    <div className="flex items-center gap-2 flex-wrap ml-auto">
                                      <select
                                        value={ratioMap.get(s.id) ?? 2}
                                        onChange={(e) =>
                                          setSubjectRatio(s.id, e.target.value === '1' ? 1 : 2)
                                        }
                                        className="px-2 py-1 border border-border rounded text-xs bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                                        aria-label="指導比率"
                                      >
                                        <option value="2">1対2</option>
                                        <option value="1">1対1</option>
                                      </select>
                                      <select
                                        value={dayMap.get(s.id) ?? ''}
                                        onChange={(e) =>
                                          setSubjectDay(s.id, parseInt(e.target.value, 10))
                                        }
                                        className="px-2 py-1 border border-border rounded text-xs bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                                        aria-label="曜日"
                                      >
                                        <option value="" disabled>
                                          曜日
                                        </option>
                                        {SELECTABLE_DAYS.map((d) => (
                                          <option key={d} value={d}>
                                            {DAY_OF_WEEK_LABELS[d]}曜
                                          </option>
                                        ))}
                                      </select>
                                      <select
                                        value={slotMap.get(s.id) ?? ''}
                                        onChange={(e) => setSubjectSlot(s.id, e.target.value)}
                                        className="px-2 py-1 border border-border rounded text-xs bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                                        aria-label="時限"
                                        disabled={timeSlots.length === 0}
                                      >
                                        <option value="" disabled>
                                          時限
                                        </option>
                                        {timeSlots.map((slot) => (
                                          <option key={slot.id} value={slot.id}>
                                            {slot.slot_number}限 {slot.start_time.slice(0, 5)}
                                          </option>
                                        ))}
                                      </select>
                                      {is45 && (
                                        <select
                                          value={halfMap.get(s.id) ?? 'first'}
                                          onChange={(e) =>
                                            setSubjectHalf(
                                              s.id,
                                              e.target.value === 'second' ? 'second' : 'first'
                                            )
                                          }
                                          className="px-2 py-1 border border-border rounded text-xs bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                                          aria-label="45分の位置"
                                        >
                                          <option value="first">前半</option>
                                          <option value="second">後半</option>
                                        </select>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ─── Step3: コマ配置（① 通塾開始日 ／ ② スケジュール）─── */}
              {step === 3 && (
                <DndContext
                  sensors={sensors}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                >
                  <div className="space-y-5">
                    {/* ① 通塾開始日 */}
                    <div className="space-y-2">
                      <h2 className="text-base font-bold text-text-heading">① 通塾開始日</h2>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="date"
                          value={effectiveFrom}
                          onChange={(e) => setEffectiveFrom(e.target.value)}
                          className="px-2 py-1 border border-border rounded text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <button
                          type="button"
                          onClick={() => setEffectiveFrom(toLocalDateStr(new Date()))}
                          className="px-2 py-1 rounded border border-border text-xs text-text-body hover:bg-surface-hover"
                        >
                          今日
                        </button>
                        <button
                          type="button"
                          onClick={() => setEffectiveFrom(firstOfNextMonth())}
                          className="px-2 py-1 rounded border border-border text-xs text-text-body hover:bg-surface-hover"
                        >
                          来月1日
                        </button>
                        <span className="text-[11px] text-text-muted">
                          表示週: {weekStartStr} の週
                        </span>
                      </div>
                    </div>

                    {/* ② スケジュール */}
                    <div className="space-y-3">
                      <div>
                        <h2 className="text-base font-bold text-text-heading">② スケジュール</h2>
                        <p className="text-xs text-text-muted">
                          下のカード（受講科目ごと）を、対応するコマのミニ座席表の講師にドラッグして担当を決めます。1対2は隣の生徒が見えます。担当は後で座席表からでも決められます。
                        </p>
                      </div>

                      <div className={styles.root}>
                        {/* ドラッグ元カード（受講科目の数だけ並ぶ） */}
                        <div className="border border-border rounded-lg p-3 bg-surface-hover space-y-2">
                          <p className="text-xs text-text-muted">
                            科目カードを出勤講師へドラッグ（配置済みは講師名を表示）
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {subjectPlans.map((p) => {
                              const placement = placementBySubject.get(p.subject.id);
                              if (placement) {
                                const t = teacherById.get(placement.teacherId);
                                return (
                                  <div
                                    key={p.subject.id}
                                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-success/50 bg-success/10 text-sm"
                                  >
                                    <span className="font-medium text-text-heading">
                                      {studentName}
                                    </span>
                                    <span className="text-text-body">{p.subject.name}</span>
                                    <span className="text-xs text-success">
                                      配置済み（
                                      {t ? getSurname(t) || t.display_name || t.email : '講師'}）
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => removePlacement(placement.key)}
                                      className="text-xs text-danger hover:underline"
                                    >
                                      解除
                                    </button>
                                  </div>
                                );
                              }
                              const half =
                                p.half === 'first' ? '前' : p.half === 'second' ? '後' : null;
                              return (
                                <OnboardingDragCard
                                  key={p.subject.id}
                                  studentName={studentName}
                                  subjectName={p.subject.name}
                                  ratio={p.ratio}
                                  halfLabel={half}
                                  payload={{
                                    subjectId: p.subject.id,
                                    ratio: p.ratio,
                                    durationMinutes: p.durationMinutes,
                                    halfPosition: p.half,
                                    day: p.day,
                                    slotId: p.slotId,
                                  }}
                                />
                              );
                            })}
                          </div>
                        </div>

                        {/* Step2 で決めた各コマのミニ座席表 */}
                        {combos.length === 0 ? (
                          <p className="text-sm text-text-muted mt-3">
                            受講コマがありません。Step2 で曜日・時限を選んでください。
                          </p>
                        ) : (
                          <div className="space-y-3 mt-3">
                            {combos.map((combo) => {
                              const date = dateForDow(weekStartStr, combo.day);
                              const isClosed = closedDates.has(date);
                              const availIds =
                                availByDaySlot.get(`${combo.day}|${combo.slotNumber}`) ?? [];
                              const cellTeachers = availIds
                                .map((id) => teacherById.get(id))
                                .filter((t): t is OnbTeacher => !!t)
                                .map((t) => ({
                                  id: t.id,
                                  name: getSurname(t) || t.display_name || t.email || '—',
                                  gender: t.gender ?? null,
                                }));
                              return (
                                <MiniSeatingSlot
                                  key={combo.key}
                                  day={combo.day}
                                  slotNumber={combo.slotNumber}
                                  startTime={combo.startTime}
                                  subjectsForCell={combo.plans.map((p) => ({
                                    subjectId: p.subject.id,
                                    subjectName: p.subject.name,
                                    ratio: p.ratio,
                                    half: p.half,
                                  }))}
                                  isClosed={isClosed}
                                  weekLoading={weekLoading}
                                  teachers={cellTeachers}
                                  maxStudents={maxStudents}
                                  dragActive={!!dragPayload}
                                  studentName={studentName}
                                  subjectNameById={subjectNameById}
                                  existingEntriesFor={(tid) =>
                                    activeEntriesFor(date, combo.slotId, tid)
                                  }
                                  placementsFor={(tid) =>
                                    placementsFor(combo.day, combo.slotId, tid)
                                  }
                                  makeDropId={(tid) => makeDropId(combo.day, combo.slotId, tid)}
                                  canDropFor={(tid) => {
                                    const t = teacherById.get(tid);
                                    if (!t) return null;
                                    return canDropFor(date, combo.day, combo.slotId, t);
                                  }}
                                  compatFor={(tid) => {
                                    if (
                                      !dragPayload ||
                                      dragPayload.day !== combo.day ||
                                      dragPayload.slotId !== combo.slotId
                                    ) {
                                      return null;
                                    }
                                    const t = teacherById.get(tid);
                                    if (!t) return null;
                                    return compatForSubject(dragPayload.subjectId, t);
                                  }}
                                  onRemovePlacement={removePlacement}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ドラッグ中プレビュー（カーソル追従。科目カードと同じ体裁・色バッジ無し） */}
                  <DragOverlay>
                    {dragPayload ? (
                      <div className={styles.root}>
                        <div
                          className={styles.tBlock}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 10px',
                            opacity: 0.95,
                          }}
                        >
                          <span style={{ fontWeight: 600, fontSize: 12 }}>{studentName}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-body)' }}>
                            {subjectNameById.get(dragPayload.subjectId) ?? '科目'}
                          </span>
                          <span className={styles.ratioTag}>
                            {dragPayload.ratio === 1 ? '1:1' : '1:2'}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              )}

              {/* ─── Step4: 確認・保存 ─── */}
              {step === 4 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-base font-bold text-text-heading mb-1">確認・保存</h2>
                    <p className="text-xs text-text-muted">
                      内容を確認して「登録する」を押すと、契約・通塾日程・座席表への反映をまとめて実行します。担当未決定の科目も登録され、座席表から後で割り当てできます。
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-text-heading mb-2">
                      通塾開始日：{effectiveFrom}
                    </h3>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-text-heading mb-2">
                      受講コマ（週 {subjectPlans.length} コマ）
                    </h3>
                    {subjectPlans.length === 0 ? (
                      <p className="text-xs text-text-muted">受講コマがありません。</p>
                    ) : (
                      <div className="space-y-1.5">
                        {subjectPlans.map((p) => {
                          const placement = placementBySubject.get(p.subject.id);
                          const t = placement ? teacherById.get(placement.teacherId) : null;
                          return (
                            <div
                              key={`${p.day}|${p.slotId}|${p.subject.id}`}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-hover border border-border text-sm"
                            >
                              <span className="font-medium text-text-heading w-24">
                                {DAY_OF_WEEK_LABELS[p.day]}曜 {p.slotNumber}限
                              </span>
                              <span className="text-text-body flex-1">
                                {p.subject.name}
                                <span className="text-text-muted ml-1">
                                  （{p.ratio === 1 ? '1対1' : '1対2'}
                                  {p.half ? `・45${p.half === 'first' ? '前' : '後'}` : ''}）
                                </span>
                              </span>
                              {t ? (
                                <span className="text-text-muted text-xs">
                                  {getSurname(t) || t.display_name || t.email}
                                </span>
                              ) : (
                                <span className="text-warning text-xs">担当未決定</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* フッターナビ（今は Step1 のみなので専用の単一ボタン） */}
            {singleStepOnly ? (
              <div className="flex items-center justify-end mt-6">
                <Button onClick={finishSingleStep} disabled={isSavingStudent}>
                  {isSavingStudent ? '保存中...' : '登録して生徒詳細へ'}
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between mt-6">
                <div>
                  {step > 1 && (
                    <Button variant="secondary" onClick={goPrev} disabled={isSaving}>
                      <ArrowLeft className="w-4 h-4 mr-1.5" />
                      戻る
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {step === 3 && (
                    <Button variant="secondary" onClick={handleSkip} disabled={isSaving}>
                      通塾設定をスキップして完了
                    </Button>
                  )}
                  {step < TOTAL_STEPS ? (
                    <Button onClick={goNext} disabled={isSavingStudent}>
                      次へ
                      <ArrowRight className="w-4 h-4 ml-1.5" />
                    </Button>
                  ) : (
                    <Button onClick={handleSubmit} disabled={isSaving}>
                      {isSaving ? '登録中...' : '登録する'}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
