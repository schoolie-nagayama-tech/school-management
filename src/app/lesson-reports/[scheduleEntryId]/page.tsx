'use client';

/**
 * 授業報告書フォーム（Stage 4 で進行表と融合）
 *
 * URL: /lesson-reports/[scheduleEntryId]
 *
 * 入力コンセプト（要件定義 §7-4）:
 *   「選ぶものはクリック、質が要る文章だけ手書き」。
 *   講師の仕事を楽にして、授業とコミュニケーションに時間を使えるようにする。
 *   定型文の自動組み立ては陳腐になるため使わない（却下済み）。
 *
 * 画面構成:
 *   - 目標ヘッダー（常時表示・3層）
 *       ① 試験目標（student_textbook_exams: 試験名 / 試験日 / 目標点 / 範囲）… 進行表と同期・表示のみ
 *       ② 行動目標（action_goals）… 進行表と同期・表示のみ
 *       ③ 今日の目標（short_term_goal）… 手入力
 *       ＋ 期日カウントダウン（あと◯日（◯週間）・授業あと◯回）を自動計算して横に表示
 *   - 保護者に公開されるゾーン（緑）: 今日の目標 / 学習内容・学校進度 / 宿題・演習％ / 確認テスト /
 *       講評 / 次回までの宿題（日割り）/ 科目別欄
 *   - 教室内のみのゾーン（グレー破線）: 引継ぎ / 遅刻・宿題未実施フラグ
 *
 * 保存の二系統（どちらも既存の経路をそのまま使う。新しい保存先は作らない）:
 *   1. class_reports … upsertClassReport（提出→室長承認→差し戻しのワークフローは変更なし）
 *   2. 進行表 … recordSession（progress-sessions.ts）。学習単元・学校進度・引継ぎ・フラグは
 *      授業記録パネルとまったく同じ組み立て方で渡す。進行表側から見ても従来どおり読める。
 *      ★ 引継ぎの「セッション/行」分離は意図的な既存設計。ここで独自同期を作らないこと。
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent } from '@/components/ui';
import { Button } from '@/components/ui';
import { ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import { getReportByScheduleEntry, upsertClassReport } from '@/lib/api/class-reports';
import type { ClassReport, ClassReportFormData, SubjectSpecific } from '@/types/class-report';
import { supabase } from '@/lib/supabase';
import { getStudentTextbooks, getStudentProgress } from '@/lib/api/progress';
import { getCurriculumItems } from '@/lib/api/textbooks';
import {
  getFeedGoalsByTextbooks,
  getSessionsByScheduleEntry,
  getSessionsForEdit,
  recordSession,
  type SessionUnitAction,
} from '@/lib/api/progress-sessions';
import type { CurriculumItemWithProgress, StudentTextbookWithDetails } from '@/types/database';
import { ChevronLeft, Plus, X, Save, Send, Eye, Lock, Target, CalendarClock } from 'lucide-react';
import { DemoProgressPreview } from '@/components/lesson-reports/DemoProgressPreview';
import { LessonReportProgressGrid } from '@/components/lesson-reports/LessonReportProgressGrid';
import {
  buildHomeworkDateRows,
  compactHomeworkRows,
  computeExamCountdown,
  formatCountdownDays,
  judgeCheckTestPassed,
  mergeHomeworkRows,
  todayInJst,
  type ExamCountdown,
} from '@/lib/lesson-reports/reportSchedule';

// 座席表系テーブルは Database 型未登録なので any でクエリ
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface ScheduleEntryInfo {
  id: string;
  school_id: string;
  entry_date: string;
  student_id: string;
  teacher_id: string;
  subject_ids: string[];
  time_slot?: { slot_number: number; start_time: string; end_time: string };
  student?: { id: string; last_name: string; first_name: string; grade: number };
  teacher?: { id: string; display_name: string | null; email: string | null };
}

interface StudentTextbookOption {
  id: string;
  textbook_id: number;
  textbook_name: string;
  curriculum_items: Array<{ id: number; title: string; sort_order: number }>;
}

/** 目標ヘッダーに出す中期目標（進行表と同期・この画面では編集しない） */
interface GoalHeader {
  examLabel: string;
  examDate: string | null;
  targetScore: number | null;
  examRange: string | null;
  actionGoals: string[];
}

/** 教材（student_textbook）ごとの進行表グリッド選択状態 */
interface GridSelectionState {
  unitActions: Record<number, 1 | 2 | 3>;
  schoolUnits: Set<number>;
  /** 読込時点で学校進度がついていた単元ID（外されたものを検出してクリアするため） */
  origSchoolUnitIds: number[];
  /** 既存セッションID（再保存時に上書き更新して二重作成を防ぐ） */
  sessionId: string | null;
}

const emptySelection = (): GridSelectionState => ({
  unitActions: {},
  schoolUnits: new Set(),
  origSchoolUnitIds: [],
  sessionId: null,
});

/**
 * 生徒の授業予定日を取得する。
 * - nextLessonDate: 宿題の日割り生成に使う「次回授業日」（振替で入ったコマも授業なので含める）
 * - scheduledDates: 期日カウントダウンの「授業あと◯回」に使う（要件どおり status='scheduled' のみ）
 *
 * 1生徒の未来の予定は多くても数十件なので PostgREST の1000行上限には触れない。
 */
async function getLessonDates(
  studentId: string,
  fromDate: string
): Promise<{ nextLessonDate: string | null; scheduledDates: string[] }> {
  const { data } = await db
    .from('schedule_entries')
    .select('entry_date, status')
    .eq('student_id', studentId)
    .gte('entry_date', fromDate)
    .in('status', ['scheduled', 'transferred_in'])
    .order('entry_date', { ascending: true });

  const rows = (data || []) as Array<{ entry_date: string; status: string }>;
  return {
    nextLessonDate: rows.find((r) => r.entry_date > fromDate)?.entry_date ?? null,
    scheduledDates: rows.filter((r) => r.status === 'scheduled').map((r) => r.entry_date),
  };
}

export default function LessonReportFormPage() {
  const params = useParams();
  const router = useRouter();
  const { profile } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const scheduleEntryId = params.scheduleEntryId as string;
  // デモモード: /lesson-reports/demo でアクセスすると、DBを使わずダミーデータで
  // 実際の入力フォームを開く。保存・提出は無効化（見本のため）。
  const isDemo = scheduleEntryId === 'demo';

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [entry, setEntry] = useState<ScheduleEntryInfo | null>(null);
  const [existingReport, setExistingReport] = useState<ClassReport | null>(null);
  const [textbookOptions, setTextbookOptions] = useState<StudentTextbookOption[]>([]);
  const [nextLessonDate, setNextLessonDate] = useState<string | null>(null);
  const [scheduledDates, setScheduledDates] = useState<string[]>([]);
  const [goalHeader, setGoalHeader] = useState<GoalHeader | null>(null);

  // 進行表グリッド（教材ごとの単元行）と、その選択状態
  const [gridRows, setGridRows] = useState<Record<string, CurriculumItemWithProgress[]>>({});
  const [selections, setSelections] = useState<Record<string, GridSelectionState>>({});

  // 内部ゾーン（進行表の授業記録と同じ保存先へ書く項目）
  const [handover, setHandover] = useState('');
  const [homeworkNotDone, setHomeworkNotDone] = useState(false);
  const [tardy, setTardy] = useState(false);

  // フォーム状態
  const [form, setForm] = useState<ClassReportFormData>({
    schedule_entry_id: scheduleEntryId,
    student_id: '',
    teacher_id: '',
    lesson_date: '',
    short_term_goal: '',
    mid_term_goal_snapshot: '',
    mid_action_goal_snapshot: '',
    school_progress: '',
    homework_completion_pct: null,
    homework_correct_pct: null,
    today_correct_pct: null,
    vocab_test_score: null,
    vocab_test_total: null,
    vocab_test_passed: null,
    check_test_score: null,
    check_test_total: null,
    check_test_passed: null,
    review_comment: '',
    homework_assignments: [],
    subject_specific: null,
    status: 'draft',
    units: [],
  });

  // ---- 初期データ取得 ----
  const load = useCallback(async () => {
    setIsLoading(true);
    // デモモード: DBを使わずダミーデータで実フォームを表示
    if (isDemo) {
      loadDemo({
        setEntry,
        setNextLessonDate,
        setScheduledDates,
        setGoalHeader,
        setTextbookOptions,
        setGridRows,
        setSelections,
        setHandover,
        setForm,
      });
      setIsLoading(false);
      return;
    }
    try {
      // 1. schedule_entry を取得
      const { data: entryRow, error: entryErr } = await db
        .from('schedule_entries')
        .select(
          '*, time_slot:schedule_time_slots(slot_number, start_time, end_time), student:students(id, last_name, first_name, grade), teacher:user_profiles!schedule_entries_teacher_id_fkey(id, display_name, email)'
        )
        .eq('id', scheduleEntryId)
        .single();
      if (entryErr || !entryRow) {
        toastError('授業情報の取得に失敗しました');
        return;
      }
      const e = entryRow as ScheduleEntryInfo & {
        time_slot?:
          | { slot_number: number; start_time: string; end_time: string }
          | Array<{ slot_number: number; start_time: string; end_time: string }>;
        student?: ScheduleEntryInfo['student'] | Array<NonNullable<ScheduleEntryInfo['student']>>;
        teacher?: ScheduleEntryInfo['teacher'] | Array<NonNullable<ScheduleEntryInfo['teacher']>>;
      };
      const info: ScheduleEntryInfo = {
        id: e.id,
        school_id: e.school_id,
        entry_date: e.entry_date,
        student_id: e.student_id,
        teacher_id: e.teacher_id,
        subject_ids: e.subject_ids || [],
        time_slot: Array.isArray(e.time_slot) ? e.time_slot[0] : e.time_slot,
        student: Array.isArray(e.student) ? e.student[0] : e.student,
        teacher: Array.isArray(e.teacher) ? e.teacher[0] : e.teacher,
      };
      setEntry(info);

      // 2. 授業予定日（次回授業日＝宿題の日割り / 予定件数＝カウントダウン）。
      //    報告書を後日書くこともあるので、授業日と今日の早いほうから拾う。
      const today = todayInJst();
      const fromDate = info.entry_date < today ? info.entry_date : today;
      const lessonDates = await getLessonDates(info.student_id, fromDate);
      setNextLessonDate(lessonDates.nextLessonDate);
      setScheduledDates(lessonDates.scheduledDates);

      // 3. 生徒の student_textbooks + 各 textbook の curriculum_items を取得
      const textbooks = await getStudentTextbooks(info.student_id);
      const trackable = textbooks.filter((st) => st.track_progress !== false);
      const options: StudentTextbookOption[] = await Promise.all(
        trackable.map(async (st) => {
          const items = await getCurriculumItems(st.textbook_id);
          return {
            id: st.id,
            textbook_id: st.textbook_id,
            textbook_name: st.textbook?.name ?? `教材#${st.textbook_id}`,
            curriculum_items: items.map((it) => ({
              id: it.id,
              title: it.title,
              sort_order: it.sort_order,
            })),
          };
        })
      );
      setTextbookOptions(options);

      // 4. 既存報告書を取得（あれば編集モード）
      const report = await getReportByScheduleEntry(scheduleEntryId);
      setExistingReport(report);

      const units = report
        ? (report.units ?? []).map((u, idx) => ({
            id: u.id,
            student_textbook_id: u.student_textbook_id,
            is_main: u.is_main,
            curriculum_item_ids: u.curriculum_item_ids,
            page_start: u.page_start,
            page_end: u.page_end,
            display_order: u.display_order ?? idx,
          }))
        : options.length > 0
          ? [
              {
                student_textbook_id: options[0].id,
                is_main: true,
                curriculum_item_ids: [] as number[],
                page_start: null,
                page_end: null,
                display_order: 0,
              },
            ]
          : [];

      if (report) {
        setForm({
          schedule_entry_id: scheduleEntryId,
          student_id: report.student_id,
          teacher_id: report.teacher_id,
          lesson_date: report.lesson_date,
          short_term_goal: report.short_term_goal ?? '',
          mid_term_goal_snapshot: report.mid_term_goal_snapshot ?? '',
          mid_action_goal_snapshot: report.mid_action_goal_snapshot ?? '',
          school_progress: report.school_progress ?? '',
          homework_completion_pct: report.homework_completion_pct,
          homework_correct_pct: report.homework_correct_pct,
          today_correct_pct: report.today_correct_pct,
          // 単語テストは UI から外したが、過去データを消さないよう値はそのまま持ち回る
          vocab_test_score: report.vocab_test_score,
          vocab_test_total: report.vocab_test_total,
          vocab_test_passed: report.vocab_test_passed,
          check_test_score: report.check_test_score,
          check_test_total: report.check_test_total,
          check_test_passed: report.check_test_passed,
          review_comment: report.review_comment ?? '',
          homework_assignments: report.homework_assignments ?? [],
          subject_specific: report.subject_specific ?? null,
          status: report.status,
          units,
        });
      } else {
        setForm((f) => ({
          ...f,
          student_id: info.student_id,
          teacher_id: info.teacher_id,
          lesson_date: info.entry_date,
          units,
        }));
      }

      // 5. 目標ヘッダー（メイン教材の試験目標＋行動目標）。既存の一括取得関数を再利用する。
      const mainStbId = (units.find((u) => u.is_main) ?? units[0])?.student_textbook_id ?? null;
      setGoalHeader(mainStbId ? await loadGoalHeader(mainStbId, trackable) : null);

      // 6. このコマに既に紐づいているセッションを復元（下書き保存の再開・再提出で
      //    セッションが増殖しないよう sessionId を握っておく）
      await restoreSessions(
        scheduleEntryId,
        units,
        setSelections,
        setHandover,
        setHomeworkNotDone,
        setTardy
      );
    } catch (err) {
      toastError(err instanceof Error ? err.message : '初期化に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [scheduleEntryId, toastError, isDemo]);

  useEffect(() => {
    load();
  }, [load]);

  // ---- 進行表グリッドの行を、フォームで選ばれている教材ぶんだけ取得 ----
  const wantedTextbookIds = useMemo(
    () => form.units.map((u) => u.student_textbook_id).filter(Boolean),
    [form.units]
  );
  // 取得済み／取得中の教材IDを覚えて二重フェッチを防ぐ
  const fetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (isDemo) return;
    const missing = wantedTextbookIds.filter((id) => !fetchedRef.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => fetchedRef.current.add(id));
    (async () => {
      for (const id of missing) {
        try {
          const rows = await getStudentProgress(id);
          setGridRows((prev) => ({ ...prev, [id]: rows }));
        } catch (err) {
          console.error('進行表グリッドの取得に失敗:', err);
          fetchedRef.current.delete(id); // 失敗したら次の描画で再試行できるようにする
        }
      }
    })();
  }, [wantedTextbookIds, isDemo]);

  // ---- 次回までの宿題: 授業翌日〜次回授業日の日付行を自動生成 ----
  useEffect(() => {
    if (isDemo || !form.lesson_date) return;
    setForm((f) => ({
      ...f,
      homework_assignments: mergeHomeworkRows(
        buildHomeworkDateRows({ lessonDate: f.lesson_date, nextLessonDate }),
        f.homework_assignments
      ),
    }));
    // lesson_date と nextLessonDate が確定したときだけ組み直す（入力中は触らない）
  }, [form.lesson_date, nextLessonDate, isDemo]);

  // ---- 期日カウントダウン ----
  const countdown: ExamCountdown | null = useMemo(
    () =>
      computeExamCountdown({
        examDate: goalHeader?.examDate,
        today: todayInJst(),
        lessonDates: scheduledDates,
      }),
    [goalHeader?.examDate, scheduledDates]
  );

  // 確認テストの合否は得点から自動判定する（講師が合否ボタンを押さなくて済むように）
  const checkTestPassed = useMemo(
    () => judgeCheckTestPassed(form.check_test_score, form.check_test_total),
    [form.check_test_score, form.check_test_total]
  );

  const reviewLineCount = useMemo(
    () => (form.review_comment ? form.review_comment.split('\n').length : 0),
    [form.review_comment]
  );

  // ---- グリッドのセルクリック（進行表の授業記録とまったく同じ操作） ----
  const handleCellToggle = useCallback(
    (studentTextbookId: string, curriculumItemId: number, column: 'school' | 1 | 2 | 3) => {
      setSelections((prev) => {
        const cur = prev[studentTextbookId] ?? emptySelection();
        if (column === 'school') {
          const next = new Set(cur.schoolUnits);
          if (next.has(curriculumItemId)) next.delete(curriculumItemId);
          else next.add(curriculumItemId);
          return { ...prev, [studentTextbookId]: { ...cur, schoolUnits: next } };
        }
        const next = { ...cur.unitActions };
        if (next[curriculumItemId] === column) delete next[curriculumItemId];
        else next[curriculumItemId] = column;
        return { ...prev, [studentTextbookId]: { ...cur, unitActions: next } };
      });
    },
    []
  );

  // 教材セット操作
  const usedTextbookIds = new Set(form.units.map((u) => u.student_textbook_id));
  const addUnit = () => {
    // 同じ教材を2つのセットに入れると選択状態（教材IDで保持）が二重になるため、未使用の教材だけ追加できる
    const free = textbookOptions.find((o) => !usedTextbookIds.has(o.id));
    if (!free) {
      toastError('追加できる教材がありません');
      return;
    }
    setForm((f) => ({
      ...f,
      units: [
        ...f.units,
        {
          student_textbook_id: free.id,
          is_main: false,
          curriculum_item_ids: [],
          page_start: null,
          page_end: null,
          display_order: f.units.length,
        },
      ],
    }));
  };
  const removeUnit = (idx: number) =>
    setForm((f) => ({ ...f, units: f.units.filter((_, i) => i !== idx) }));
  const updateUnit = (idx: number, patch: Partial<ClassReportFormData['units'][number]>) =>
    setForm((f) => ({
      ...f,
      units: f.units.map((u, i) => (i === idx ? { ...u, ...patch } : u)),
    }));

  const updateHomeworkText = (idx: number, text: string) =>
    setForm((f) => ({
      ...f,
      homework_assignments: f.homework_assignments.map((a, i) => (i === idx ? { ...a, text } : a)),
    }));

  // プリント等テキスト外の教材の自由記述。専用の列が無いので subject_specific(jsonb) に同居させる
  const extraMaterials = form.subject_specific?.extra_materials ?? '';
  const setExtraMaterials = (v: string) =>
    setForm((f) => ({
      ...f,
      subject_specific: { ...(f.subject_specific ?? { kind: 'none' }), extra_materials: v },
    }));

  // ---- 保存 ----
  const handleSave = async (nextStatus: 'draft' | 'submitted') => {
    if (!entry) return;
    if (isDemo) {
      toastError('これは入力画面の見本です。実際の授業からはここで保存・提出できます。');
      return;
    }
    setIsSaving(true);
    try {
      // 学習単元は進行表グリッドの選択が正。保存直前に units へ反映する
      const units = form.units.map((u) => ({
        ...u,
        curriculum_item_ids: Object.keys(selections[u.student_textbook_id]?.unitActions ?? {}).map(
          Number
        ),
      }));

      // 学校進度（class_reports 側は text 列）は、グリッドで選ばれた学校単元から組み立てる
      const schoolProgressText = buildSchoolProgressText(
        form.units,
        selections,
        gridRows,
        textbookOptions
      );

      const payload: ClassReportFormData = {
        ...form,
        units,
        school_progress: schoolProgressText || form.school_progress,
        // 中期目標は保存時点の進行表内容をスナップショットする（この画面では編集しない）
        mid_term_goal_snapshot: goalHeader
          ? formatExamGoal(goalHeader)
          : form.mid_term_goal_snapshot,
        mid_action_goal_snapshot: goalHeader
          ? goalHeader.actionGoals.join(' ・ ')
          : form.mid_action_goal_snapshot,
        // 合否は得点からの自動判定を保存する
        check_test_passed: checkTestPassed,
        // 空欄の日は保存しない
        homework_assignments: compactHomeworkRows(form.homework_assignments),
        status: nextStatus,
      };

      await upsertClassReport(entry.school_id, payload);

      // 進行表への転記（学習単元・学校進度・引継ぎ・フラグ）。
      // 授業記録パネルと同じ組み立てで既存の recordSession をそのまま呼ぶ。
      await syncToProgress({
        entry,
        units: form.units,
        selections,
        gridRows,
        handover,
        homeworkNotDone,
        tardy,
        teacherName: entry.teacher?.display_name || profile?.display_name || '',
        onSessionSaved: (stbId, sessionId) =>
          setSelections((prev) => ({
            ...prev,
            [stbId]: {
              ...(prev[stbId] ?? emptySelection()),
              sessionId,
              origSchoolUnitIds: Array.from(prev[stbId]?.schoolUnits ?? []),
            },
          })),
      });

      success(nextStatus === 'draft' ? '下書き保存しました' : '提出しました（室長承認待ち）');
      if (nextStatus === 'submitted') {
        router.push('/today');
      } else {
        await load();
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <AdminLayout>
        <Loading />
      </AdminLayout>
    );
  }

  if (!entry) {
    return (
      <AdminLayout>
        <div className="p-6">授業情報が見つかりませんでした</div>
      </AdminLayout>
    );
  }

  const studentName = entry.student
    ? `${entry.student.last_name} ${entry.student.first_name}`
    : entry.student_id;
  const grade = entry.student?.grade ?? 0;
  const gradeLabel = grade <= 6 ? `小${grade}` : grade <= 9 ? `中${grade - 6}` : `高${grade - 9}`;
  const teacherName = entry.teacher?.display_name || entry.teacher?.email || '';
  const slotLabel = entry.time_slot ? `${entry.time_slot.slot_number}限` : '';

  return (
    <AdminLayout documentTitle={`${studentName}｜授業報告書`}>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="space-y-4">
        {isDemo && (
          <div className="rounded-lg bg-warning-subtle border border-warning/30 px-3 py-2 text-xs text-warning">
            <strong>入力画面の見本（ダミーデータ）</strong>
            です。実際の授業からはここで記入して保存・提出します。このページでは保存されません。
          </div>
        )}

        {/* ヘッダー */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ChevronLeft className="w-4 h-4 mr-1" />
            戻る
          </Button>
          <h1 className="text-lg font-bold">授業報告書</h1>
          {existingReport && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                existingReport.status === 'draft'
                  ? 'bg-surface text-text-body'
                  : existingReport.status === 'submitted'
                    ? 'bg-warning-subtle text-warning'
                    : existingReport.status === 'approved'
                      ? 'bg-success-subtle text-success'
                      : 'bg-danger-subtle text-danger'
              }`}
            >
              {existingReport.status === 'draft'
                ? '下書き'
                : existingReport.status === 'submitted'
                  ? '承認待ち'
                  : existingReport.status === 'approved'
                    ? '公開済み'
                    : '差し戻し'}
            </span>
          )}
        </div>

        {/* 授業情報サマリ */}
        <Card>
          <CardContent className="p-4 bg-ink text-white rounded-md">
            <div className="text-xs opacity-70 uppercase tracking-wide">
              {form.lesson_date} {slotLabel}
            </div>
            <div className="text-xl font-bold mt-1">
              {studentName} <span className="text-sm font-normal opacity-80">（{gradeLabel}）</span>
            </div>
            <div className="text-sm mt-1 opacity-80">講師: {teacherName}</div>
          </CardContent>
        </Card>

        {existingReport?.status === 'rejected' && existingReport.rejection_reason && (
          <div className="bg-danger-subtle border border-danger rounded p-3 text-sm text-danger">
            <div className="font-medium">差し戻し理由:</div>
            <div className="mt-1 whitespace-pre-wrap">{existingReport.rejection_reason}</div>
          </div>
        )}

        {/* 目標ヘッダー（進行表と同期の中期目標＋期日カウントダウン） */}
        <GoalHeaderCard goal={goalHeader} countdown={countdown} />

        {/* ── 保護者に公開されるゾーン ── */}
        <Zone
          kind="public"
          title="保護者に公開される内容（承認後にマイページへ）"
          icon={<Eye className="w-3.5 h-3.5" />}
        >
          <Field
            label="今日の目標（手入力）"
            hint="↑ 上の中期目標を踏まえて、この授業のゴールを1文で"
          >
            <input
              type="text"
              className="w-full px-3 py-2 border-2 border-info rounded-md text-sm"
              value={form.short_term_goal}
              onChange={(e) => setForm((f) => ({ ...f, short_term_goal: e.target.value }))}
              placeholder="例：不定詞の名詞用法を5問以上正しく訳せる"
            />
          </Field>

          {/* 学習内容・学校進度 ＝ 進行表グリッドの埋め込み */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1">
              学習内容・学校進度
              <span className="ml-2 px-2 py-0.5 rounded-full bg-info-subtle text-info text-[10px] font-bold">
                進行表の行をクリックで選択（記入方式は進行表と同じ）
              </span>
            </label>
            <div className="space-y-3">
              {form.units.map((u, idx) => {
                const opt = textbookOptions.find((o) => o.id === u.student_textbook_id);
                const sel = selections[u.student_textbook_id] ?? emptySelection();
                return (
                  <div
                    key={u.student_textbook_id || idx}
                    className={`p-3 border rounded-md ${
                      u.is_main ? 'border-info border-2 bg-info-subtle/30' : 'bg-surface'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          u.is_main ? 'bg-info text-white' : 'bg-gray-500 text-white'
                        }`}
                      >
                        {u.is_main ? 'メイン' : 'サブ'}
                      </span>
                      <select
                        value={u.student_textbook_id}
                        onChange={(e) => updateUnit(idx, { student_textbook_id: e.target.value })}
                        className="flex-1 px-2 py-1 border rounded text-sm font-semibold"
                      >
                        {textbookOptions
                          // 他のセットで使っている教材は選ばせない（選択状態は教材IDで持つため）
                          .filter(
                            (o) => o.id === u.student_textbook_id || !usedTextbookIds.has(o.id)
                          )
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.textbook_name}
                            </option>
                          ))}
                      </select>
                      {!u.is_main && (
                        <button
                          type="button"
                          className="text-text-faint hover:text-danger transition-colors duration-150 active:scale-[0.90]"
                          onClick={() => removeUnit(idx)}
                          title="このセットを削除"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <LessonReportProgressGrid
                      textbookName={opt?.textbook_name ?? '教材'}
                      rows={gridRows[u.student_textbook_id] ?? []}
                      selection={{
                        unitActions: sel.unitActions,
                        schoolUnits: sel.schoolUnits,
                        sessionDate: form.lesson_date,
                      }}
                      onCellToggle={(cid, col) => handleCellToggle(u.student_textbook_id, cid, col)}
                      isTeacher={profile?.role === 'teacher'}
                    />

                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <Field label="開始ページ">
                        <PageInput
                          value={u.page_start}
                          onChange={(v) => updateUnit(idx, { page_start: v })}
                        />
                      </Field>
                      <Field label="終了ページ">
                        <PageInput
                          value={u.page_end}
                          onChange={(v) => updateUnit(idx, { page_end: v })}
                        />
                      </Field>
                    </div>
                  </div>
                );
              })}
              {textbookOptions.length > usedTextbookIds.size && (
                <button
                  type="button"
                  onClick={addUnit}
                  className="w-full py-2 border-2 border-dashed border-info rounded-md text-sm text-info hover:bg-info-subtle transition-colors duration-150 active:scale-[0.98] ease-[cubic-bezier(0.23,1,0.32,1)]"
                >
                  <Plus className="inline w-4 h-4 mr-1" />
                  サブ教材セットを追加（補助教材）
                </button>
              )}
            </div>
            <p className="text-[10px] text-text-faint mt-2 mb-1">
              プリント・テキスト外の教材はこちらに（自由記述）
            </p>
            <input
              type="text"
              className="w-full px-3 py-2 border rounded-md text-sm"
              value={extraMaterials}
              onChange={(e) => setExtraMaterials(e.target.value)}
              placeholder="例: 計算プリント（分数係数）を10問"
            />
          </div>

          {/* 宿題・演習（すべてスライダー） */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-2">
              宿題・演習（すべてスライダー）
            </label>
            <div className="space-y-2">
              <SliderField
                label="やってきた量"
                value={form.homework_completion_pct}
                onChange={(v) => setForm((f) => ({ ...f, homework_completion_pct: v }))}
              />
              <SliderField
                label="宿題の正答率"
                value={form.homework_correct_pct}
                onChange={(v) => setForm((f) => ({ ...f, homework_correct_pct: v }))}
              />
              <SliderField
                label="今日の演習の正答率"
                value={form.today_correct_pct}
                onChange={(v) => setForm((f) => ({ ...f, today_correct_pct: v }))}
              />
            </div>
          </div>

          {/* 確認テスト（1本に統合・合否は自動判定） */}
          <CheckTestField
            score={form.check_test_score}
            total={form.check_test_total}
            passed={checkTestPassed}
            onScoreChange={(v) => setForm((f) => ({ ...f, check_test_score: v }))}
            onTotalChange={(v) => setForm((f) => ({ ...f, check_test_total: v }))}
          />

          {/* 講評（手書き） */}
          <Field label="講評（手書き・保護者が読む文章）">
            <textarea
              className="w-full px-3 py-2 border rounded-md text-sm"
              rows={5}
              value={form.review_comment}
              onChange={(e) => setForm((f) => ({ ...f, review_comment: e.target.value }))}
              placeholder="5行程度で記入"
            />
            <div className="text-xs text-text-muted mt-1">
              現在 {reviewLineCount} 行 / 推奨 5 行
            </div>
          </Field>

          {/* 次回までの宿題（日割り） */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1">
              次回までの宿題（日割り）
              <span className="ml-2 px-2 py-0.5 rounded-full bg-info-subtle text-info text-[10px] font-bold">
                次回授業日までの日付を自動生成
              </span>
            </label>
            {nextLessonDate ? (
              <p className="text-[10px] text-text-faint mb-2">
                次回授業: {formatDateLabel(nextLessonDate)}（この日の行は入力なしでOK）
              </p>
            ) : (
              <p className="text-[10px] text-text-faint mb-2">
                次回授業日が未定のため、翌日から7日分の行を出しています
              </p>
            )}
            <div className="space-y-1">
              {form.homework_assignments.map((a, idx) => {
                const isNext = !!nextLessonDate && a.date === nextLessonDate;
                return (
                  <div key={a.date || idx} className="grid grid-cols-[92px_1fr] gap-2 items-center">
                    <span
                      className={`px-2 py-1 rounded text-[11px] font-bold text-center tabular-nums ${
                        isNext ? 'bg-surface text-text-muted' : 'bg-info-subtle text-info'
                      }`}
                    >
                      {formatDateLabel(a.date)}
                    </span>
                    <input
                      type="text"
                      value={a.text}
                      onChange={(e) => updateHomeworkText(idx, e.target.value)}
                      className="px-2 py-1 border rounded text-sm"
                      placeholder={isNext ? '（次回授業日・入力なしでOK）' : '例: ワーク p.30-31'}
                    />
                  </div>
                );
              })}
              {form.homework_assignments.length === 0 && (
                <p className="text-xs text-text-faint">授業日が未確定のため日割り行を作れません</p>
              )}
            </div>
          </div>

          {/* 科目別欄（既存機能。保護者に見える宿題の一部として公開ゾーンに置く） */}
          <Field label="科目別欄（単語・計算・漢字の反復練習）">
            <SubjectSpecificField
              value={form.subject_specific}
              onChange={(v) => setForm((f) => ({ ...f, subject_specific: v }))}
            />
          </Field>
        </Zone>

        {/* ── 教室内のみのゾーン ── */}
        <Zone
          kind="internal"
          title="教室内のみ（保護者には出ません）"
          icon={<Lock className="w-3.5 h-3.5" />}
        >
          <Field
            label="引継ぎ（手書き・次の担当講師・室長へ）"
            hint="進行表の授業記録と同じ保存先（progress_sessions）に書き込まれます"
          >
            <textarea
              className="w-full px-3 py-2 border rounded-md text-sm"
              rows={3}
              value={handover}
              onChange={(e) => setHandover(e.target.value)}
              placeholder="次の講師への引継ぎを入力..."
            />
          </Field>
          <Field label="フラグ">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={tardy}
                  onChange={(e) => setTardy(e.target.checked)}
                  className="w-4 h-4 accent-[#d97706]"
                />
                <span className="text-sm text-text-body">遅刻</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={homeworkNotDone}
                  onChange={(e) => setHomeworkNotDone(e.target.checked)}
                  className="w-4 h-4 accent-[#d97706]"
                />
                <span className="text-sm text-text-body">宿題未実施</span>
              </label>
            </div>
          </Field>
        </Zone>

        {/* フッター */}
        <div className="sticky bottom-0 bg-white border-t p-3 flex items-center gap-2 -mx-4 px-4">
          <span className="text-xs text-text-muted flex-1">
            {existingReport?.updated_at
              ? `最終保存: ${new Date(existingReport.updated_at).toLocaleString('ja-JP')}`
              : '未保存'}
          </span>
          <Button variant="outline" onClick={() => router.back()} disabled={isSaving}>
            キャンセル
          </Button>
          <Button variant="outline" onClick={() => handleSave('draft')} disabled={isSaving}>
            <Save className="w-4 h-4 mr-1" />
            下書き保存
          </Button>
          <Button onClick={() => handleSave('submitted')} disabled={isSaving}>
            <Send className="w-4 h-4 mr-1" />
            {isSaving ? '保存中...' : '提出 (室長承認待ち)'}
          </Button>
        </div>

        {isDemo && <DemoProgressPreview />}
      </div>
    </AdminLayout>
  );
}

// ---------- 保存ヘルパー ----------

/** 目標ヘッダーの試験目標を1行のテキストにする（class_reports のスナップショット列用） */
function formatExamGoal(g: GoalHeader): string {
  const parts = [g.examLabel];
  if (g.targetScore != null) parts.push(`${g.targetScore}点`);
  const head = parts.join(' ');
  return g.examRange ? `${head}（範囲: ${g.examRange}）` : head;
}

/** 日付ラベル 'YYYY-MM-DD' → 'M/D(曜)' */
function formatDateLabel(date: string): string {
  if (!date) return '';
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${w})`;
}

/**
 * グリッドで学校進度としてマークされた単元から、class_reports.school_progress（text列）の
 * 表示文字列を組み立てる。進行表側の実データ（student_progress.school_progress_date）は
 * recordSession が書くので、ここは保護者に見せる文言だけを作る。
 */
function buildSchoolProgressText(
  units: ClassReportFormData['units'],
  selections: Record<string, GridSelectionState>,
  gridRows: Record<string, CurriculumItemWithProgress[]>,
  textbookOptions: StudentTextbookOption[]
): string {
  const labels: string[] = [];
  for (const u of units) {
    const sel = selections[u.student_textbook_id];
    if (!sel || sel.schoolUnits.size === 0) continue;
    const rows = gridRows[u.student_textbook_id] ?? [];
    const tbName =
      textbookOptions.find((o) => o.id === u.student_textbook_id)?.textbook_name ?? '教材';
    for (const row of rows) {
      if (sel.schoolUnits.has(row.id)) labels.push(`${tbName} / ${row.title}`);
    }
  }
  return labels.join('、');
}

/**
 * 進行表への転記。教材（student_textbook）ごとに既存の recordSession をそのまま呼ぶ。
 * primaryCurriculumItemId の算出も授業記録パネル（SessionRecordingPanel）と同じ規則:
 * 触れた単元のうちカリキュラム順で一番下の行に引継ぎ・フラグを書く。
 */
async function syncToProgress(params: {
  entry: ScheduleEntryInfo;
  units: ClassReportFormData['units'];
  selections: Record<string, GridSelectionState>;
  gridRows: Record<string, CurriculumItemWithProgress[]>;
  handover: string;
  homeworkNotDone: boolean;
  tardy: boolean;
  teacherName: string;
  onSessionSaved: (studentTextbookId: string, sessionId: string) => void;
}): Promise<void> {
  const {
    entry,
    units,
    selections,
    gridRows,
    handover,
    homeworkNotDone,
    tardy,
    teacherName,
    onSessionSaved,
  } = params;

  for (const u of units) {
    const stbId = u.student_textbook_id;
    const sel = selections[stbId];
    if (!sel) continue;

    const hasContent =
      Object.keys(sel.unitActions).length > 0 ||
      sel.schoolUnits.size > 0 ||
      !!handover ||
      homeworkNotDone ||
      tardy;
    // 何も入力が無い教材で空のセッションを作らない。ただし既にセッションがある場合は
    // 「入力を消した」編集なので更新は通す
    if (!hasContent && !sel.sessionId) continue;

    const unitActions: SessionUnitAction[] = Object.entries(sel.unitActions).map(([cid, ln]) => ({
      curriculumItemId: Number(cid),
      lessonNumber: ln,
    }));

    // 触れた単元のうちカリキュラム順で最後のものを primary にする
    const rows = gridRows[stbId] ?? [];
    const touched = new Set([
      ...Object.keys(sel.unitActions).map(Number),
      ...Array.from(sel.schoolUnits),
    ]);
    let primaryCurriculumItemId: number | null = null;
    for (const row of rows) {
      if (touched.has(row.id)) primaryCurriculumItemId = row.id;
    }

    // 編集で学校進度から外された単元を検出してクリアする
    const clearSchoolProgressUnits = sel.origSchoolUnitIds.filter((id) => !sel.schoolUnits.has(id));

    const session = await recordSession({
      studentTextbookId: stbId,
      sessionDate: entry.entry_date,
      teacherId: entry.teacher_id,
      teacherName,
      handover,
      homeworkNotDone,
      tardy,
      unitActions,
      schoolProgressUnits: Array.from(sel.schoolUnits),
      scheduleEntryId: entry.id,
      sessionId: sel.sessionId,
      primaryCurriculumItemId,
      clearSchoolProgressUnits,
    });
    onSessionSaved(stbId, session.id);
  }
}

/** 目標ヘッダーを組み立てる。試験目標・行動目標は既存の一括取得関数を再利用する */
async function loadGoalHeader(
  mainStbId: string,
  textbooks: StudentTextbookWithDetails[]
): Promise<GoalHeader | null> {
  const goals = await getFeedGoalsByTextbooks([mainStbId]);
  const summary = goals[mainStbId];
  if (!summary?.exam) return null;
  // exam_range は getFeedGoalsByTextbooks が返さないので、取得済みの教材の exams から拾う
  const examRow = textbooks
    .find((tb) => tb.id === mainStbId)
    ?.exams?.find((e) => e.id === summary.exam!.id);
  return {
    examLabel: summary.exam.label,
    examDate: summary.exam.examDate,
    targetScore: summary.exam.targetScore,
    examRange: examRow?.exam_range ?? null,
    actionGoals: summary.actionGoals.map((g) => g.title),
  };
}

/**
 * このコマに紐づく既存セッションから、グリッド選択・引継ぎ・フラグを復元する。
 * - セッションの識別は schedule_entry_id（下書きを何度保存してもセッションを増やさない）
 * - 指導単元 / 学校進度は既存の getSessionsForEdit で復元する
 */
async function restoreSessions(
  scheduleEntryId: string,
  units: ClassReportFormData['units'],
  setSelections: (v: Record<string, GridSelectionState>) => void,
  setHandover: (v: string) => void,
  setHomeworkNotDone: (v: boolean) => void,
  setTardy: (v: boolean) => void
): Promise<void> {
  const byTextbook = await getSessionsByScheduleEntry(scheduleEntryId);
  const next: Record<string, GridSelectionState> = {};
  let handoverSet = false;

  for (const u of units) {
    const stbId = u.student_textbook_id;
    const session = byTextbook[stbId];
    if (!session) {
      next[stbId] = emptySelection();
      continue;
    }
    // 指導単元・学校進度の復元（既存関数を利用。取りこぼしても sessionId があるので
    // セッションが増殖することはない）
    let unitActions: Record<number, 1 | 2 | 3> = {};
    let schoolUnitIds: number[] = [];
    try {
      const editable = await getSessionsForEdit(stbId, 50);
      const hit = editable.find((e) => e.session.id === session.id);
      if (hit) {
        unitActions = hit.unitActions;
        schoolUnitIds = hit.schoolUnitIds;
      }
    } catch (err) {
      console.error('セッションの復元に失敗:', err);
    }
    next[stbId] = {
      unitActions,
      schoolUnits: new Set(schoolUnitIds),
      origSchoolUnitIds: schoolUnitIds,
      sessionId: session.id,
    };
    // 引継ぎ・フラグはコマ単位の情報。最初に見つかったセッションの値を採用する
    if (!handoverSet) {
      setHandover(session.handover ?? '');
      setHomeworkNotDone(session.homework_not_done);
      setTardy(session.tardy);
      handoverSet = true;
    }
  }
  setSelections(next);
}

// ---------- 小コンポーネント ----------

/**
 * ゾーンUI: 書いた内容が保護者に出るか／教室内に留まるかを視覚的に分ける。
 * 緑＝公開（承認後にマイページへ）／グレー破線＝内部。
 */
function Zone({
  kind,
  title,
  icon,
  children,
}: {
  kind: 'public' | 'internal';
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const isPublic = kind === 'public';
  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        isPublic ? 'border-success/40' : 'border-border border-dashed'
      }`}
    >
      <div
        className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-bold tracking-wide ${
          isPublic ? 'bg-success-subtle text-success' : 'bg-surface text-text-muted'
        }`}
      >
        {icon}
        {title}
      </div>
      <div className="bg-white p-4 space-y-4">{children}</div>
    </div>
  );
}

/** 目標ヘッダー: 中期目標（試験・行動）は表示のみ。期日カウントダウンを横に出す */
function GoalHeaderCard({
  goal,
  countdown,
}: {
  goal: GoalHeader | null;
  countdown: ExamCountdown | null;
}) {
  if (!goal) {
    return (
      <div className="rounded-lg border border-border bg-white px-4 py-3 text-xs text-text-muted">
        <Target className="inline w-3.5 h-3.5 mr-1.5 -mt-0.5" />
        この生徒のメイン教材に試験目標が未設定です（目標は進行表で設定します）
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-white px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-[13px]">
        <span className="text-[10px] font-bold tracking-wide text-text-muted w-14 shrink-0">
          試験目標
        </span>
        <span className="font-semibold text-text-heading">{formatExamGoal(goal)}</span>
        {/* 期日カウントダウン（試験目標が無い生徒には出ない） */}
        {countdown && (
          <span className="ml-auto flex gap-1.5 shrink-0">
            <span
              className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold tabular-nums ${
                countdown.expired ? 'bg-surface text-text-muted' : 'bg-warning-subtle text-warning'
              }`}
            >
              <CalendarClock className="inline w-3 h-3 mr-1 -mt-0.5" />
              {goal.examDate?.slice(5).replace('-', '/')} ・ {formatCountdownDays(countdown)}
            </span>
            {!countdown.expired && (
              <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold tabular-nums bg-info-subtle text-info">
                授業あと{countdown.lessonsLeft}回
              </span>
            )}
          </span>
        )}
      </div>
      {goal.actionGoals.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-[13px]">
          <span className="text-[10px] font-bold tracking-wide text-text-muted w-14 shrink-0">
            行動目標
          </span>
          <span className="font-semibold text-text-heading">{goal.actionGoals.join(' ・ ')}</span>
          <span className="ml-auto px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-ink-subtle text-ink shrink-0">
            進行表と同期
          </span>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-text-muted mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-text-faint mt-1">{hint}</p>}
    </div>
  );
}

function PageInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-sm font-semibold pointer-events-none">
        p.
      </span>
      <input
        type="number"
        className="w-full pl-7 pr-2 py-1 border rounded text-sm"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
      />
    </div>
  );
}

/** ％入力はすべてスライダー（5%刻み・値をラベル表示） */
function SliderField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div>
      <div className="text-[10.5px] text-text-faint mb-1">{label}</div>
      <div className="grid grid-cols-[1fr_60px] gap-3 items-center">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={value ?? 0}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="w-full"
          aria-label={label}
        />
        <div className="text-lg font-bold text-info text-right tabular-nums">
          {value ?? '-'}
          <span className="text-xs text-text-muted font-medium">%</span>
        </div>
      </div>
    </div>
  );
}

/** 数値ステッパー（タイピングを減らす。直接入力も残す） */
function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  label,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  min?: number;
  label: string;
}) {
  const bump = (d: number) => onChange(Math.max(min, (value ?? 0) + d));
  return (
    <div className="inline-flex items-center border rounded-lg overflow-hidden bg-white">
      <button
        type="button"
        onClick={() => bump(-step)}
        aria-label={`${label}を減らす`}
        className="w-8 h-8 flex items-center justify-center text-text-muted hover:bg-surface transition-colors duration-150 active:scale-[0.95]"
      >
        −
      </button>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
        aria-label={label}
        className="w-12 px-1 py-1 text-sm text-center border-x outline-none tabular-nums"
      />
      <button
        type="button"
        onClick={() => bump(step)}
        aria-label={`${label}を増やす`}
        className="w-8 h-8 flex items-center justify-center text-text-muted hover:bg-surface transition-colors duration-150 active:scale-[0.95]"
      >
        ＋
      </button>
    </div>
  );
}

/**
 * 確認テスト（単語/確認は運用上分けられないため1本に統合）。
 * 合否は得点から自動判定するので、講師は点数だけ入れればよい。
 */
function CheckTestField({
  score,
  total,
  passed,
  onScoreChange,
  onTotalChange,
}: {
  score: number | null;
  total: number | null;
  passed: boolean | null;
  onScoreChange: (v: number | null) => void;
  onTotalChange: (v: number | null) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-text-muted mb-1">
        確認テスト（1本に統合）
      </label>
      <div className="flex items-center gap-2 flex-wrap">
        <Stepper value={score} onChange={onScoreChange} label="確認テストの得点" />
        <span className="text-sm text-text-muted">/</span>
        <Stepper value={total} onChange={onTotalChange} label="確認テストの満点" />
        {passed === null ? (
          <span className="text-[11px] text-text-faint">点数を入れると合否を自動判定します</span>
        ) : (
          <span
            className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${
              passed ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'
            }`}
          >
            {passed ? '合格' : '不合格'}（自動判定）
          </span>
        )}
      </div>
    </div>
  );
}

function SubjectSpecificField({
  value,
  onChange,
}: {
  value: SubjectSpecific | null;
  onChange: (v: SubjectSpecific | null) => void;
}) {
  const kind = value?.kind ?? 'none';
  // 'none' 以外は { kind, range, pages, times_per_day, duration } を持つ統一構造
  const v = (value && value.kind !== 'none' ? value : null) as Exclude<
    SubjectSpecific,
    { kind: 'none' }
  > | null;
  // プリント自由記述（extra_materials）は kind に依らず保持する
  const extra = value?.extra_materials;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <label>種別:</label>
        <select
          value={kind}
          onChange={(e) => {
            const k = e.target.value as SubjectSpecific['kind'];
            if (k === 'none') onChange({ kind: 'none', extra_materials: extra });
            else
              onChange({
                kind: k,
                range: v?.range ?? '',
                pages: v?.pages ?? '',
                times_per_day: v?.times_per_day ?? 5,
                duration: v?.duration ?? '1週間',
                extra_materials: extra,
              });
          }}
          className="px-2 py-1 border rounded text-sm"
        >
          <option value="none">なし</option>
          <option value="vocab">英語：単語練習</option>
          <option value="calc">数学：計算練習</option>
          <option value="kanji">国語：漢字練習</option>
        </select>
      </div>

      {kind !== 'none' && v && (
        <div className="p-3 bg-warning-subtle border border-warning rounded-md grid grid-cols-2 md:grid-cols-4 gap-2">
          <Field label="練習範囲">
            <input
              type="text"
              value={v.range}
              onChange={(e) => onChange({ ...v, range: e.target.value } as SubjectSpecific)}
              className="w-full px-2 py-1 border rounded text-sm"
            />
          </Field>
          <Field label="ページ">
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-xs pointer-events-none">
                p.
              </span>
              <input
                type="text"
                value={v.pages}
                onChange={(e) => onChange({ ...v, pages: e.target.value } as SubjectSpecific)}
                className="w-full pl-7 pr-2 py-1 border rounded text-sm"
              />
            </div>
          </Field>
          <Field label="1日の練習回数">
            <select
              value={v.times_per_day}
              onChange={(e) =>
                onChange({ ...v, times_per_day: parseInt(e.target.value, 10) } as SubjectSpecific)
              }
              className="w-full px-2 py-1 border rounded text-sm"
            >
              <option value={3}>3回</option>
              <option value={5}>5回</option>
              <option value={10}>10回</option>
            </select>
          </Field>
          <Field label="期間">
            <select
              value={v.duration}
              onChange={(e) => onChange({ ...v, duration: e.target.value } as SubjectSpecific)}
              className="w-full px-2 py-1 border rounded text-sm"
            >
              <option value="3日間">3日間</option>
              <option value="1週間">1週間</option>
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}

// ---------- デモモード ----------

/**
 * /lesson-reports/demo 用のダミーデータ。DBを引かずに実フォームの見た目を確認するため、
 * 進行表グリッドの行も合成する（保存・提出は無効）。
 */
function loadDemo(setters: {
  setEntry: (v: ScheduleEntryInfo) => void;
  setNextLessonDate: (v: string | null) => void;
  setScheduledDates: (v: string[]) => void;
  setGoalHeader: (v: GoalHeader | null) => void;
  setTextbookOptions: (v: StudentTextbookOption[]) => void;
  setGridRows: (v: Record<string, CurriculumItemWithProgress[]>) => void;
  setSelections: (v: Record<string, GridSelectionState>) => void;
  setHandover: (v: string) => void;
  setForm: (v: ClassReportFormData) => void;
}) {
  const lessonDate = todayInJst();
  const next = buildHomeworkDateRows({ lessonDate, nextLessonDate: null });
  const nextLessonDate = next[next.length - 1] ?? null;

  setters.setEntry({
    id: 'demo',
    school_id: 'demo',
    entry_date: lessonDate,
    student_id: 'demo-student',
    teacher_id: 'demo-teacher',
    subject_ids: ['demo-math'],
    time_slot: { slot_number: 5, start_time: '18:00', end_time: '19:30' },
    student: { id: 'demo-student', last_name: '山田', first_name: '花子', grade: 8 },
    teacher: { id: 'demo-teacher', display_name: '佐々木 先生', email: null },
  });
  setters.setNextLessonDate(nextLessonDate);
  // 期日カウントダウンの見本用に、試験日までの授業予定を数件置く
  setters.setScheduledDates([1, 4, 8, 11].map((d) => addDaysLocal(lessonDate, d)));
  setters.setGoalHeader({
    examLabel: '期末テスト 数学',
    examDate: addDaysLocal(lessonDate, 14),
    targetScore: 80,
    examRange: '一次関数まで',
    actionGoals: ['ノートに途中式を残す', '宿題は日割りでその日のうちに'],
  });

  const options: StudentTextbookOption[] = [
    {
      id: 'tb-main',
      textbook_id: 1,
      textbook_name: '新中学問題集 数学2年',
      curriculum_items: [
        { id: 1, title: '連立方程式の利用', sort_order: 1 },
        { id: 2, title: '一次関数の式', sort_order: 2 },
        { id: 3, title: '一次関数の利用', sort_order: 3 },
        { id: 4, title: '一次関数のグラフ', sort_order: 4 },
      ],
    },
  ];
  setters.setTextbookOptions(options);
  setters.setGridRows({
    'tb-main': options[0].curriculum_items.map((it) => ({
      id: it.id,
      textbook_id: 1,
      title: it.title,
      item_number: it.sort_order,
      item_type: null,
      sort_order: it.sort_order,
      created_at: '',
      progress: null,
    })) as unknown as CurriculumItemWithProgress[],
  });
  setters.setSelections({
    'tb-main': {
      unitActions: { 2: 1 },
      schoolUnits: new Set([3]),
      origSchoolUnitIds: [3],
      sessionId: null,
    },
  });
  setters.setHandover(
    '符号ミスは減ってきたが、分数係数が入ると手が止まる。次回は分数係数の変化の割合から。丸付けは自走OK。'
  );
  setters.setForm({
    schedule_entry_id: 'demo',
    student_id: 'demo-student',
    teacher_id: 'demo-teacher',
    lesson_date: lessonDate,
    short_term_goal: '一次関数の変化の割合を自力で求められるようにする',
    mid_term_goal_snapshot: '',
    mid_action_goal_snapshot: '',
    school_progress: '',
    homework_completion_pct: 90,
    homework_correct_pct: 75,
    today_correct_pct: 85,
    vocab_test_score: null,
    vocab_test_total: null,
    vocab_test_passed: null,
    check_test_score: 15,
    check_test_total: 20,
    check_test_passed: true,
    review_comment:
      '変化の割合の意味をグラフと式の両方から確認しました。符号ミスがまだ出ますが、後半は自力で正確に求められています。次回は式からグラフを描く練習に進みます。',
    homework_assignments: next.map((d, i) => ({
      date: d,
      text: i === 0 ? '新中問 p.59 の基本問題' : i === 1 ? '新中問 p.60 ＋ 昨日の間違い直し' : '',
    })),
    subject_specific: { kind: 'none', extra_materials: '計算プリント（分数係数）を10問' },
    status: 'draft',
    units: [
      {
        student_textbook_id: 'tb-main',
        is_main: true,
        curriculum_item_ids: [2],
        page_start: 54,
        page_end: 58,
        display_order: 0,
      },
    ],
  });
}

/** デモ用の日付加算（reportSchedule の addDays を使うと import が循環しないので直接利用） */
function addDaysLocal(date: string, n: number): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}
