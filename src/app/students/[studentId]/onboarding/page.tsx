'use client';

/**
 * 入会オンボーディングウィザード（教室長向け）。
 *
 * 入会処理から「担当講師の決定」までを 1 つの流れで完結させる（設計: docs/small-group-programming-schedule-plan.md §2.13）。
 *
 * 入口:
 *  1. 問合せ詳細「生徒として登録」→ 生徒作成後 `/students/[id]/onboarding?inquiryId=...` へ遷移
 *  2. 生徒詳細（StudentDetailModal）に「通塾セットアップ」導線（通塾日程 0 件のときのみ表示）
 *
 * ステップ:
 *  1. 生徒情報の確認（主要4項目のインライン編集。ここだけ即時 updateStudent）
 *  2. 受講科目と比率（学年区分で絞った科目を複数選択＋1対2/1対1）
 *  3. 通塾日程（週間ミニグリッド。空き講師数を表示し、セルに科目を割り付ける）
 *  4. 担当講師（各コマにマッチング候補を上位表示 → 選択 or 未決定）
 *  5. 確認・一括保存（契約 upsert・パターン作成・週再生成・体験コマ引き継ぎ）
 *
 * 途中離脱では何も書かれない（Step1 の生徒情報修正のみ例外で即時保存）。保存は Step5 で一括。
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { AdminLayout } from '@/components/layouts';
import { Loading, Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { getStudent, updateStudent } from '@/lib/api/students';
import { getSubjects } from '@/lib/api/subjects';
import {
  getTimeSlots,
  createRegularPattern,
  checkStudentTimeConflict,
  regenerateWeekForDate,
  convertInquiryTrialEntriesToStudent,
} from '@/lib/api/schedule';
import { getAvailabilityDayMap } from '@/lib/api/teacher-availability';
import {
  getStudentContractRatioMap,
  upsertStudentContract,
} from '@/lib/api/student-subject-contracts';
import {
  getPatternMatchCandidates,
  type PatternMatchCandidate,
  type UnassignedPatternRow,
} from '@/lib/api/pattern-matching';
import {
  gradeCategoryFromStudentGrade,
  filterSubjectsForGrade,
  groupSubjectsForSelect,
  subjectOptionLabel,
} from '@/lib/utils/subjectOptions';
import { INDIVIDUAL_FORMATION, DAY_OF_WEEK_LABELS } from '@/types/schedule';
import type { HalfPosition, ScheduleTimeSlot } from '@/types/schedule';
import type { Student, Subject } from '@/types/database';
import { CheckCircle2, ArrowRight, ArrowLeft, Users, CalendarDays, X } from 'lucide-react';

// 週間グリッドの列＝月〜土（個別指導は日曜運用しない想定。設計の週間ミニグリッド）。
const GRID_DAYS = [1, 2, 3, 4, 5, 6];

const TOTAL_STEPS = 5;
const STEP_LABELS = ['生徒情報', '受講科目', '通塾日程', '担当講師', '確認'];

/** 数値学年 → 表示ラベル（小/中/高）。 */
function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}

/** "HH:MM[:SS]" → 分。 */
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/**
 * 45 分授業の実効時間帯を導出する（schedule.ts の computeEffectiveTimeRange と同等・クライアント版）。
 * 前半=開始〜+45分 / 後半=終了−45分〜終了 / それ以外はコマ全体。新コマ同士の重複判定に使う。
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

/** 1コマ（週次パターン1行に対応）。セル（曜日×コマ時間）ごとに1つ。 */
interface Koma {
  /** セルキー `${day}|${timeSlotId}` */
  key: string;
  day: number;
  timeSlotId: string;
  slotNumber: number;
  startTime: string;
  endTime: string;
  subjectIds: string[];
  ratio: 1 | 2;
  durationMinutes: number | null;
  halfPosition: HalfPosition;
  /** 選択された担当講師（Step4）。null=未決定のまま。 */
  teacherId: string | null;
}

export default function OnboardingPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const studentId = params.studentId as string;
  const inquiryId = searchParams.get('inquiryId');

  const { profile, schoolIds } = useAuth();
  const isManager = isManagerOrAbove(profile?.role);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(1);

  // ---- 読み込みデータ ----
  const [student, setStudent] = useState<Student | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [timeSlots, setTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  // 空き状況: `${day}|${slotNumber}` → 出勤可能講師数
  const [availByDaySlot, setAvailByDaySlot] = useState<Map<string, number>>(new Map());

  // ---- Step1: 生徒情報のインライン編集 ----
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastKana, setLastKana] = useState('');
  const [firstKana, setFirstKana] = useState('');
  const [grade, setGrade] = useState<number>(7);
  const [schoolName, setSchoolName] = useState('');
  const [isSavingStudent, setIsSavingStudent] = useState(false);

  // ---- Step2: 受講科目と比率 ----
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<Set<string>>(new Set());
  const [ratioMap, setRatioMap] = useState<Map<string, 1 | 2>>(new Map());

  // ---- Step3: 通塾日程（セルキー → コマ） ----
  const [komas, setKomas] = useState<Record<string, Koma>>({});
  // 下部パネルで編集中のセル
  const [activeCellKey, setActiveCellKey] = useState<string | null>(null);

  // ---- Step4: マッチング候補（コマキー → 候補配列） ----
  const [candidatesByKoma, setCandidatesByKoma] = useState<Record<string, PatternMatchCandidate[]>>(
    {}
  );
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  // ---- Step5: 保存 ----
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{
    patternCount: number;
    trialConverted: number;
    trialSkipped: number;
  } | null>(null);

  const schoolId = student?.school_id ?? '';

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
        // 科目・コマ時間・空き状況・契約比率を並行取得
        const [allSubjects, slots, dayMap, contractMap] = await Promise.all([
          getSubjects(),
          getTimeSlots(stu.school_id, INDIVIDUAL_FORMATION),
          getAvailabilityDayMap(stu.school_id),
          getStudentContractRatioMap(stu.id),
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
        // 個別コマ時間を slot_number 昇順で
        setTimeSlots(
          [...slots].filter((s) => s.is_active).sort((a, b) => a.slot_number - b.slot_number)
        );
        setRatioMap(new Map(contractMap));

        // 空き講師数マップに変換
        const counts = new Map<string, number>();
        dayMap.byDayAndSlotNumber.forEach((users, key) => counts.set(key, users.length));
        setAvailByDaySlot(counts);
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

  const selectedSubjects = useMemo(
    () =>
      Array.from(selectedSubjectIds)
        .map((id) => subjectById.get(id))
        .filter((s): s is Subject => !!s),
    [selectedSubjectIds, subjectById]
  );

  // ---- Step1: 生徒情報の即時保存 ----
  const saveStudentInfo = useCallback(async () => {
    if (!student) return;
    setIsSavingStudent(true);
    try {
      const updated = await updateStudent(student.id, {
        last_name: lastName.trim() || student.last_name,
        first_name: firstName.trim(),
        last_name_kana: lastKana.trim(),
        first_name_kana: firstKana.trim(),
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

  // ---- Step2: 科目トグル ----
  const toggleSubject = (id: string) => {
    setSelectedSubjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        // 契約比率が未設定なら既定 1対2 を入れておく
        if (!ratioMap.has(id)) setRatioMap((m) => new Map(m).set(id, 2));
      }
      return next;
    });
  };

  const setSubjectRatio = (id: string, ratio: 1 | 2) => {
    setRatioMap((m) => new Map(m).set(id, ratio));
  };

  // ---- Step3: セルのコマ科目を更新（ライブ反映） ----
  // セル（曜日×コマ）に割り付ける科目を差し替える。1科目のみ選択かつ45分なら半コマ位置を持つ。
  const setKomaSubjects = (
    cellKey: string,
    day: number,
    slot: ScheduleTimeSlot,
    subjectIds: string[]
  ) => {
    setKomas((prev) => {
      const next = { ...prev };
      if (subjectIds.length === 0) {
        delete next[cellKey];
        return next;
      }
      const single = subjectIds.length === 1 ? subjectById.get(subjectIds[0]) : null;
      const dur = single?.duration_minutes ?? null;
      // 比率: 単一科目ならその契約比率、複数なら 1対2 既定（RegularPatternForm と同じ方針）
      const ratio: 1 | 2 = single ? (ratioMap.get(single.id) ?? 2) : 2;
      const existing = prev[cellKey];
      const half: HalfPosition = dur === 45 ? (existing?.halfPosition ?? 'first') : null;
      next[cellKey] = {
        key: cellKey,
        day,
        timeSlotId: slot.id,
        slotNumber: slot.slot_number,
        startTime: slot.start_time,
        endTime: slot.end_time,
        subjectIds,
        ratio,
        durationMinutes: dur,
        halfPosition: half,
        teacherId: existing?.teacherId ?? null,
      };
      return next;
    });
  };

  const toggleKomaSubject = (
    cellKey: string,
    day: number,
    slot: ScheduleTimeSlot,
    subjectId: string
  ) => {
    const current = komas[cellKey]?.subjectIds ?? [];
    const nextIds = current.includes(subjectId)
      ? current.filter((x) => x !== subjectId)
      : [...current, subjectId];
    setKomaSubjects(cellKey, day, slot, nextIds);
  };

  const setKomaHalf = (cellKey: string, half: HalfPosition) => {
    setKomas((prev) => {
      const k = prev[cellKey];
      if (!k) return prev;
      return { ...prev, [cellKey]: { ...k, halfPosition: half } };
    });
  };

  const removeKoma = (cellKey: string) => {
    setKomas((prev) => {
      const next = { ...prev };
      delete next[cellKey];
      return next;
    });
    if (activeCellKey === cellKey) setActiveCellKey(null);
  };

  const komaList = useMemo(
    () => Object.values(komas).sort((a, b) => a.day - b.day || a.slotNumber - b.slotNumber),
    [komas]
  );

  // ---- Step4: 候補ロード（Step3→Step4 遷移時） ----
  const loadCandidates = useCallback(async () => {
    if (!schoolId) return;
    setLoadingCandidates(true);
    try {
      const results: Record<string, PatternMatchCandidate[]> = {};
      // 各コマについて合成パターン行を作り候補を取得（パターン未作成でも候補が出せる。
      // getPatternMatchCandidates は pattern.id を候補生成に使わないため合成行で足りる）。
      await Promise.all(
        komaList.map(async (k) => {
          const row: UnassignedPatternRow = {
            id: k.key,
            school_id: schoolId,
            student_id: studentId,
            day_of_week: k.day,
            time_slot_id: k.timeSlotId,
            subject_ids: k.subjectIds,
            period_type: 'regular',
            time_slot: {
              id: k.timeSlotId,
              slot_number: k.slotNumber,
              start_time: k.startTime,
              end_time: k.endTime,
            },
          };
          try {
            const cands = await getPatternMatchCandidates(schoolId, row);
            results[k.key] = cands.slice(0, 5);
          } catch {
            results[k.key] = [];
          }
        })
      );
      setCandidatesByKoma(results);
    } finally {
      setLoadingCandidates(false);
    }
  }, [schoolId, komaList, studentId]);

  const selectKomaTeacher = (cellKey: string, teacherId: string | null) => {
    setKomas((prev) => {
      const k = prev[cellKey];
      if (!k) return prev;
      return { ...prev, [cellKey]: { ...k, teacherId } };
    });
  };

  // ---- ステップ遷移 ----
  const goNext = async () => {
    if (step === 1) {
      // Step1 の生徒情報は即時保存してから進む
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
      setStep(3);
      return;
    }
    if (step === 3) {
      if (komaList.length === 0) {
        toast.error('通塾コマを1つ以上設定してください');
        return;
      }
      // 各コマに科目が入っているか（空セルは komas に載らないので通常は不要だが念のため）
      if (komaList.some((k) => k.subjectIds.length === 0)) {
        toast.error('科目が未設定のコマがあります');
        return;
      }
      setStep(4);
      void loadCandidates();
      return;
    }
    if (step === 4) {
      setStep(5);
      return;
    }
  };

  const goPrev = () => {
    if (step > 1) setStep(step - 1);
  };

  // ---- Step5: 一括保存 ----
  const handleSubmit = async () => {
    if (!student) return;
    setIsSaving(true);
    try {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      // 1) 生徒重複の事前検査（DB既存＋新コマ同士）。1件でも重複なら Step3 へ戻す。
      // 1a. 新コマ同士（同一曜日で実効時間帯が重なる別スロット）の重複
      for (let i = 0; i < komaList.length; i++) {
        for (let j = i + 1; j < komaList.length; j++) {
          const a = komaList[i];
          const b = komaList[j];
          if (a.day !== b.day) continue;
          const ra = effectiveRange(a.startTime, a.endTime, a.durationMinutes, a.halfPosition);
          const rb = effectiveRange(b.startTime, b.endTime, b.durationMinutes, b.halfPosition);
          if (ra.start < rb.end && rb.start < ra.end) {
            toast.error(
              `${DAY_OF_WEEK_LABELS[a.day]}曜のコマ同士で時間帯が重なっています。通塾日程を見直してください`
            );
            setIsSaving(false);
            setStep(3);
            return;
          }
        }
      }
      // 1b. DB 既存パターン/エントリとの重複
      for (const k of komaList) {
        const conflict = await checkStudentTimeConflict(studentId, k.day, k.startTime, k.endTime, {
          durationMinutes: k.durationMinutes,
          halfPosition: k.halfPosition,
        });
        if (conflict) {
          toast.error(conflict.message);
          setIsSaving(false);
          setStep(3);
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

      // 3) 通塾日程パターンを作成（コマごと）
      for (const k of komaList) {
        await createRegularPattern(schoolId, {
          student_id: studentId,
          day_of_week: k.day,
          time_slot_id: k.timeSlotId,
          teacher_id: k.teacherId,
          subject_ids: k.subjectIds,
          seat_label: '',
          period_type: 'regular',
          effective_from: todayStr,
          formation: INDIVIDUAL_FORMATION,
          ratio: k.ratio,
          duration_minutes: k.durationMinutes,
          half_position: k.halfPosition,
        });
      }

      // 4) 今週・来週の座席表を再生成（パターンをエントリに反映）
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekStr = `${nextWeek.getFullYear()}-${String(nextWeek.getMonth() + 1).padStart(2, '0')}-${String(nextWeek.getDate()).padStart(2, '0')}`;
      await regenerateWeekForDate(schoolId, todayStr, profile?.id);
      await regenerateWeekForDate(schoolId, nextWeekStr, profile?.id);

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

      setSaveResult({ patternCount: komaList.length, trialConverted, trialSkipped });
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
      <div className="max-w-4xl mx-auto pb-24">
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
            <h1 className="text-xl font-bold text-text-heading">通塾セットアップが完了しました</h1>
            <p className="text-sm text-text-muted">
              {student.last_name} {student.first_name} さんの通塾日程 {saveResult.patternCount}{' '}
              コマを登録しました。
              {saveResult.trialConverted > 0 &&
                ` 体験コマ ${saveResult.trialConverted} 件を引き継ぎました。`}
              {saveResult.trialSkipped > 0 &&
                `（${saveResult.trialSkipped} 件は重複のためスキップ）`}
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
            {/* ステップインジケーター */}
            <div className="flex items-center justify-between mb-8">
              {[1, 2, 3, 4, 5].map((s) => (
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
                      <label className="block text-xs text-text-muted">姓（かな）</label>
                      <input
                        value={lastKana}
                        onChange={(e) => setLastKana(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-xs text-text-muted">名（かな）</label>
                      <input
                        value={firstKana}
                        onChange={(e) => setFirstKana(e.target.value)}
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
                            {gradeLabel(g)}
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

              {/* ─── Step2: 受講科目と比率 ─── */}
              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-base font-bold text-text-heading mb-1">受講科目と比率</h2>
                    <p className="text-xs text-text-muted">
                      {gradeLabel(grade)}{' '}
                      の科目を選び、科目ごとに指導比率を設定します。45分科目は表示に「（45分）」が付きます。
                    </p>
                  </div>
                  <div className="space-y-4">
                    {subjectGroups.map((group) => (
                      <div key={group.label}>
                        <p className="text-xs font-medium text-text-body mb-2">{group.label}</p>
                        <div className="space-y-1.5">
                          {group.subjects.map((s) => {
                            const checked = selectedSubjectIds.has(s.id);
                            return (
                              <div
                                key={s.id}
                                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border bg-surface-hover"
                              >
                                <label className="flex items-center gap-2 cursor-pointer flex-1">
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
                                  <select
                                    value={ratioMap.get(s.id) ?? 2}
                                    onChange={(e) =>
                                      setSubjectRatio(s.id, e.target.value === '1' ? 1 : 2)
                                    }
                                    className="px-2 py-1 border border-border rounded text-xs bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                                  >
                                    <option value="2">1対2</option>
                                    <option value="1">1対1</option>
                                  </select>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ─── Step3: 通塾日程（週間ミニグリッド） ─── */}
              {step === 3 && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-base font-bold text-text-heading mb-1">通塾日程</h2>
                    <p className="text-xs text-text-muted">
                      コマをクリックし、下のパネルで入れる科目を選びます。数字は出勤可能な講師の人数（空き目安）です。複数コマ選択で週複数回になります。
                    </p>
                  </div>

                  {timeSlots.length === 0 ? (
                    <p className="text-sm text-text-muted">
                      個別指導のコマ時間が未設定です。設定 → コマ時間から登録してください。
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr>
                            <th className="p-1 text-text-muted font-normal w-16"></th>
                            {GRID_DAYS.map((d) => (
                              <th key={d} className="p-1 text-text-heading font-medium">
                                {DAY_OF_WEEK_LABELS[d]}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {timeSlots.map((slot) => (
                            <tr key={slot.id}>
                              <td className="p-1 text-text-muted whitespace-nowrap align-top">
                                {slot.slot_number}限
                                <br />
                                <span className="text-[10px]">{slot.start_time.slice(0, 5)}</span>
                              </td>
                              {GRID_DAYS.map((d) => {
                                const cellKey = `${d}|${slot.id}`;
                                const koma = komas[cellKey];
                                const avail = availByDaySlot.get(`${d}|${slot.slot_number}`) ?? 0;
                                const isActive = activeCellKey === cellKey;
                                return (
                                  <td key={d} className="p-0.5 align-top">
                                    <button
                                      type="button"
                                      onClick={() => setActiveCellKey(isActive ? null : cellKey)}
                                      className={`w-full min-h-[52px] rounded-md border p-1 text-left transition-colors ${
                                        koma
                                          ? 'border-primary bg-primary/10'
                                          : isActive
                                            ? 'border-primary bg-surface-hover'
                                            : 'border-border bg-surface-raised hover:bg-surface-hover'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-text-muted">
                                          {avail}人
                                        </span>
                                        {koma && koma.halfPosition && (
                                          <span className="text-[9px] px-1 rounded bg-info-subtle text-info">
                                            {koma.halfPosition === 'first' ? '45前' : '45後'}
                                          </span>
                                        )}
                                      </div>
                                      {koma && (
                                        <div className="mt-0.5 flex flex-wrap gap-0.5">
                                          {koma.subjectIds.map((sid) => (
                                            <span
                                              key={sid}
                                              className="px-1 py-0.5 rounded bg-primary text-white text-[10px] leading-none"
                                            >
                                              {subjectById.get(sid)?.name ?? '科目'}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* 下部パネル: アクティブセルへの科目割り付け */}
                  {activeCellKey &&
                    (() => {
                      const [dStr, slotId] = activeCellKey.split('|');
                      const d = parseInt(dStr, 10);
                      const slot = timeSlots.find((s) => s.id === slotId);
                      if (!slot) return null;
                      const koma = komas[activeCellKey];
                      const single =
                        koma && koma.subjectIds.length === 1
                          ? subjectById.get(koma.subjectIds[0])
                          : null;
                      const is45 = single?.duration_minutes === 45;
                      return (
                        <div className="border border-border rounded-lg p-4 bg-surface-hover">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-medium text-text-heading">
                              {DAY_OF_WEEK_LABELS[d]}曜 {slot.slot_number}限（
                              {slot.start_time.slice(0, 5)}-{slot.end_time.slice(0, 5)}
                              ）に入れる科目
                            </h3>
                            <button
                              type="button"
                              onClick={() => setActiveCellKey(null)}
                              className="p-1 text-text-muted hover:text-text-heading"
                              aria-label="閉じる"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          {selectedSubjects.length === 0 ? (
                            <p className="text-xs text-text-muted">
                              Step2 で受講科目を選択してください。
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {selectedSubjects.map((s) => {
                                const on = koma?.subjectIds.includes(s.id) ?? false;
                                return (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => toggleKomaSubject(activeCellKey, d, slot, s.id)}
                                    className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${
                                      on
                                        ? 'border-primary bg-primary text-white'
                                        : 'border-border bg-surface-raised text-text-body hover:bg-surface-hover'
                                    }`}
                                  >
                                    {subjectOptionLabel(s)}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {/* 45分単一科目のみ前半/後半を選ぶ */}
                          {is45 && koma && (
                            <div className="mt-3 flex items-center gap-2">
                              <span className="text-xs text-text-muted">45分の位置:</span>
                              <select
                                value={koma.halfPosition ?? 'first'}
                                onChange={(e) =>
                                  setKomaHalf(activeCellKey, e.target.value as HalfPosition)
                                }
                                className="px-2 py-1 border border-border rounded text-xs bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary"
                              >
                                <option value="first">前半</option>
                                <option value="second">後半</option>
                              </select>
                            </div>
                          )}
                          {koma && (
                            <button
                              type="button"
                              onClick={() => removeKoma(activeCellKey)}
                              className="mt-3 text-xs text-danger hover:underline"
                            >
                              このコマを解除
                            </button>
                          )}
                        </div>
                      );
                    })()}

                  {komaList.length > 0 && (
                    <p className="text-xs text-text-muted">設定済み: 週 {komaList.length} コマ</p>
                  )}
                </div>
              )}

              {/* ─── Step4: 担当講師 ─── */}
              {step === 4 && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-base font-bold text-text-heading mb-1">担当講師</h2>
                    <p className="text-xs text-text-muted">
                      各コマの候補から担当を選びます。決めずに「未決定のまま」進むと、後で一括マッチングに乗ります。
                    </p>
                  </div>
                  {loadingCandidates ? (
                    <Loading size="md" />
                  ) : (
                    <div className="space-y-3">
                      {komaList.map((k) => {
                        const cands = candidatesByKoma[k.key] ?? [];
                        return (
                          <div key={k.key} className="border border-border rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm font-medium text-text-heading">
                                {DAY_OF_WEEK_LABELS[k.day]}曜 {k.slotNumber}限
                              </span>
                              <span className="text-xs text-text-muted">
                                {k.subjectIds
                                  .map((sid) => subjectById.get(sid)?.name)
                                  .filter(Boolean)
                                  .join('・')}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {/* 未決定のまま（既定） */}
                              <button
                                type="button"
                                onClick={() => selectKomaTeacher(k.key, null)}
                                className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                                  k.teacherId === null
                                    ? 'border-primary bg-primary/10 text-text-heading'
                                    : 'border-border bg-surface-raised text-text-muted hover:bg-surface-hover'
                                }`}
                              >
                                未決定のまま
                              </button>
                              {cands.length === 0 ? (
                                <span className="text-xs text-text-muted self-center">
                                  候補なし（未決定のまま進む）
                                </span>
                              ) : (
                                cands.map((c) => (
                                  <button
                                    key={c.user_id}
                                    type="button"
                                    onClick={() => selectKomaTeacher(k.key, c.user_id)}
                                    className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                                      k.teacherId === c.user_id
                                        ? 'border-primary bg-primary text-white'
                                        : 'border-border bg-surface-raised text-text-body hover:bg-surface-hover'
                                    }`}
                                  >
                                    <span className="font-medium">
                                      {c.display_name || c.email || '講師'}
                                    </span>
                                    <span className="ml-1.5 opacity-70">スコア{c.score}</span>
                                    {c.reasons.length > 0 && (
                                      <span className="ml-1.5 opacity-70">
                                        {c.reasons.join('/')}
                                      </span>
                                    )}
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ─── Step5: 確認・保存 ─── */}
              {step === 5 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-base font-bold text-text-heading mb-1">確認・保存</h2>
                    <p className="text-xs text-text-muted">
                      内容を確認して「登録する」を押すと、契約・通塾日程・座席表への反映をまとめて実行します。
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-text-heading mb-2">受講科目</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedSubjects.map((s) => (
                        <span
                          key={s.id}
                          className="px-2.5 py-1 rounded-full bg-surface-hover border border-border text-xs text-text-body"
                        >
                          {subjectOptionLabel(s)}（{ratioMap.get(s.id) === 1 ? '1対1' : '1対2'}）
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-text-heading mb-2">
                      通塾日程（週 {komaList.length} コマ）
                    </h3>
                    <div className="space-y-1.5">
                      {komaList.map((k) => {
                        const teacher =
                          k.teacherId === null
                            ? '未決定'
                            : (candidatesByKoma[k.key]?.find((c) => c.user_id === k.teacherId)
                                ?.display_name ??
                              candidatesByKoma[k.key]?.find((c) => c.user_id === k.teacherId)
                                ?.email ??
                              '選択済み');
                        return (
                          <div
                            key={k.key}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-hover border border-border text-sm"
                          >
                            <span className="font-medium text-text-heading w-24">
                              {DAY_OF_WEEK_LABELS[k.day]}曜 {k.slotNumber}限
                            </span>
                            <span className="text-text-body flex-1">
                              {k.subjectIds
                                .map((sid) => subjectById.get(sid)?.name)
                                .filter(Boolean)
                                .join('・')}
                              <span className="text-text-muted ml-1">
                                （{k.ratio === 1 ? '1対1' : '1対2'}
                                {k.halfPosition
                                  ? `・45${k.halfPosition === 'first' ? '前' : '後'}`
                                  : ''}
                                ）
                              </span>
                            </span>
                            <span className="text-text-muted text-xs flex items-center gap-1">
                              <Users className="w-3.5 h-3.5" />
                              {teacher}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* フッターナビ */}
            <div className="flex items-center justify-between mt-6">
              <div>
                {step > 1 && (
                  <Button variant="secondary" onClick={goPrev} disabled={isSaving}>
                    <ArrowLeft className="w-4 h-4 mr-1.5" />
                    戻る
                  </Button>
                )}
              </div>
              <div>
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
          </>
        )}
      </div>
    </AdminLayout>
  );
}
