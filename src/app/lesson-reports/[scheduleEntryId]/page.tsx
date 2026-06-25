'use client';

/**
 * 授業報告書フォーム
 *
 * URL: /lesson-reports/[scheduleEntryId]
 *
 * 主な機能：
 *  - schedule_entry_id から授業情報・生徒・講師を解決
 *  - 既存報告書があれば編集、無ければ新規作成
 *  - 進行表の中期目標（教材目標 / 行動目標）を上部に表示
 *  - 単元×教材セット（メイン1 + サブN）を可変追加
 *  - スライダー入力（宿題実施率 / 正答率）
 *  - 「下書き保存」「提出（室長承認待ち）」のワークフロー
 *
 * 進行表との転記：
 *  - 学校進度 → 保存時に student_progress に転記（P2-2 では UI のみ、転記は将来追加）
 *  - 単元 → 保存時に student_progress_lessons に転記（同上）
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent } from '@/components/ui';
import { Button } from '@/components/ui';
import { ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { getReportByScheduleEntry, upsertClassReport } from '@/lib/api/class-reports';
import type {
  ClassReport,
  ClassReportFormData,
  HomeworkAssignmentItem,
  SubjectSpecific,
} from '@/types/class-report';
import { supabase } from '@/lib/supabase';
import { getStudentTextbooks } from '@/lib/api/progress';
import { getCurriculumItems } from '@/lib/api/textbooks';
import { ChevronLeft, Plus, X, Save, Send, Wand2 } from 'lucide-react';
import { DemoProgressPreview } from '@/components/lesson-reports/DemoProgressPreview';

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

/** 今日の YYYY-MM-DD */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** date1 - date2 の日数差（正：date1 が後） */
function daysBetween(d1: string, d2: string): number {
  const t1 = new Date(d1 + 'T12:00:00').getTime();
  const t2 = new Date(d2 + 'T12:00:00').getTime();
  return Math.round((t1 - t2) / (24 * 60 * 60 * 1000));
}

/** date を N 日進めた YYYY-MM-DD */
function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 生徒の次の通塾日を schedule_entries から取得（無ければ授業日+7日を返す） */
async function getNextLessonDate(studentId: string, fromDate: string): Promise<string> {
  const { data } = await db
    .from('schedule_entries')
    .select('entry_date')
    .eq('student_id', studentId)
    .gt('entry_date', fromDate)
    .in('status', ['scheduled', 'transferred_in'])
    .order('entry_date', { ascending: true })
    .limit(1);
  if (data && data.length > 0) return (data[0] as { entry_date: string }).entry_date;
  return addDays(fromDate, 7);
}

export default function LessonReportFormPage() {
  const params = useParams();
  const router = useRouter();
  // 将来 useAuth から取得した profile を使った権限制御を入れる予定（今は schedule_entry の teacher_id をそのまま使用）
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
  const [nextLessonDate, setNextLessonDate] = useState<string>('');

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
      const demoEntry: ScheduleEntryInfo = {
        id: 'demo',
        school_id: 'demo',
        entry_date: '2026-05-28',
        student_id: 'demo-student',
        teacher_id: 'demo-teacher',
        subject_ids: ['demo-eng'],
        time_slot: { slot_number: 3, start_time: '16:20', end_time: '17:50' },
        student: { id: 'demo-student', last_name: '山田', first_name: '太郎', grade: 8 },
        teacher: { id: 'demo-teacher', display_name: '田中 花子', email: null },
      };
      setEntry(demoEntry);
      setNextLessonDate('2026-06-04');
      const demoTextbooks: StudentTextbookOption[] = [
        {
          id: 'tb-main',
          textbook_id: 1,
          textbook_name: 'New Horizon 中2 英語',
          curriculum_items: [
            { id: 1, title: 'Unit 6 現在完了形', sort_order: 1 },
            { id: 2, title: 'Unit 7 不定詞', sort_order: 2 },
          ],
        },
        {
          id: 'tb-sub',
          textbook_id: 2,
          textbook_name: '英文法ドリル',
          curriculum_items: [{ id: 3, title: '現在完了形（継続）', sort_order: 1 }],
        },
      ];
      setTextbookOptions(demoTextbooks);
      setForm({
        schedule_entry_id: 'demo',
        student_id: 'demo-student',
        teacher_id: 'demo-teacher',
        lesson_date: '2026-05-28',
        short_term_goal: '現在完了形（継続・経験・完了）の使い分けを理解し、例文を5つ作れる',
        mid_term_goal_snapshot: '英文法 Unit 5〜8 を完了し、1学期期末で 80 点以上を取る',
        mid_action_goal_snapshot: '宿題を毎回提出し、間違えた問題を翌日に必ず復習する',
        school_progress: '教科書 p.62 現在完了形（継続用法）',
        homework_completion_pct: 90,
        homework_correct_pct: 75,
        today_correct_pct: 85,
        vocab_test_score: 18,
        vocab_test_total: 20,
        vocab_test_passed: true,
        check_test_score: 8,
        check_test_total: 10,
        check_test_passed: true,
        review_comment:
          '現在完了形の「継続」用法はよく理解できていました。have/has の使い分けも問題ありません。次回は「経験」用法（ever / never）を中心に進めます。',
        homework_assignments: [
          { date: '2026-05-29', text: '英文法ドリル p.23〜24（現在完了形・経験）' },
          { date: '2026-05-30', text: '単語練習 Unit 6（46〜49）3回ずつ' },
          { date: '2026-06-01', text: '教科書 p.63 音読 + Q&A ノート作成' },
        ],
        subject_specific: {
          kind: 'vocab',
          range: 'Unit 6 単語',
          pages: '46-49',
          times_per_day: 3,
          duration: '1週間',
        },
        status: 'draft',
        units: [
          {
            student_textbook_id: 'tb-main',
            is_main: true,
            curriculum_item_ids: [1],
            page_start: 48,
            page_end: 52,
            display_order: 0,
          },
          {
            student_textbook_id: 'tb-sub',
            is_main: false,
            curriculum_item_ids: [3],
            page_start: 20,
            page_end: 22,
            display_order: 1,
          },
        ],
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

      // 2. 次回授業日を取得（宿題日付割当用）
      const next = await getNextLessonDate(info.student_id, info.entry_date);
      setNextLessonDate(next);

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

      if (report) {
        // 既存値でフォームを埋める
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
          units: (report.units ?? []).map((u, idx) => ({
            id: u.id,
            student_textbook_id: u.student_textbook_id,
            is_main: u.is_main,
            curriculum_item_ids: u.curriculum_item_ids,
            page_start: u.page_start,
            page_end: u.page_end,
            display_order: u.display_order ?? idx,
          })),
        });
      } else {
        // 新規：基本情報だけセット。メイン教材セットを1つデフォルト追加
        const defaultUnit =
          options.length > 0
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
        setForm((f) => ({
          ...f,
          student_id: info.student_id,
          teacher_id: info.teacher_id,
          lesson_date: info.entry_date,
          units: defaultUnit,
        }));
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : '初期化に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [scheduleEntryId, toastError, isDemo]);

  useEffect(() => {
    load();
  }, [load]);

  // 講評の行数カウント
  const reviewLineCount = useMemo(
    () => (form.review_comment ? form.review_comment.split('\n').length : 0),
    [form.review_comment]
  );

  // 宿題日付の自動入力：授業の翌日から1日ずつ順に振り、次回授業日でクランプ。
  // 「等分配（コマ数で日を割る）」をやめ、「次回授業日までの連続した日付」を入れる方式。
  // 行が次回授業日までの日数より多い場合は、超過分は次回授業日に丸める。
  const autoDistributeHomeworkDates = useCallback(() => {
    const base = form.lesson_date || todayStr();
    const updated = form.homework_assignments.map((a, i) => {
      let d = addDays(base, i + 1); // 授業翌日 = i:0、翌々日 = i:1 ...
      if (nextLessonDate && d > nextLessonDate) d = nextLessonDate; // 次回授業日でクランプ
      return { ...a, date: d };
    });
    setForm((f) => ({ ...f, homework_assignments: updated }));
  }, [form.lesson_date, form.homework_assignments, nextLessonDate]);

  // 宿題行操作：追加時、その行の日付も「授業翌日からの連番（次回授業日でクランプ）」で自動セット。
  const addHomeworkRow = () =>
    setForm((f) => {
      const base = f.lesson_date || todayStr();
      const i = f.homework_assignments.length;
      let d = addDays(base, i + 1);
      if (nextLessonDate && d > nextLessonDate) d = nextLessonDate;
      return {
        ...f,
        homework_assignments: [...f.homework_assignments, { date: d, text: '' }],
      };
    });
  const removeHomeworkRow = (idx: number) =>
    setForm((f) => ({
      ...f,
      homework_assignments: f.homework_assignments.filter((_, i) => i !== idx),
    }));
  const updateHomeworkRow = (idx: number, patch: Partial<HomeworkAssignmentItem>) =>
    setForm((f) => ({
      ...f,
      homework_assignments: f.homework_assignments.map((a, i) =>
        i === idx ? { ...a, ...patch } : a
      ),
    }));

  // 教材セット操作
  const addUnit = (isMain: boolean) =>
    setForm((f) => ({
      ...f,
      units: [
        ...f.units,
        {
          student_textbook_id: textbookOptions[0]?.id ?? '',
          is_main: isMain,
          curriculum_item_ids: [],
          page_start: null,
          page_end: null,
          display_order: f.units.length,
        },
      ],
    }));
  const removeUnit = (idx: number) =>
    setForm((f) => ({ ...f, units: f.units.filter((_, i) => i !== idx) }));
  const updateUnit = (idx: number, patch: Partial<ClassReportFormData['units'][number]>) =>
    setForm((f) => ({
      ...f,
      units: f.units.map((u, i) => (i === idx ? { ...u, ...patch } : u)),
    }));

  // 保存
  const handleSave = async (nextStatus: 'draft' | 'submitted') => {
    if (!entry) return;
    // デモモードは保存・提出しない（見本のため）
    if (isDemo) {
      toastError('これは入力画面の見本です。実際の授業からはここで保存・提出できます。');
      return;
    }
    setIsSaving(true);
    try {
      await upsertClassReport(entry.school_id, { ...form, status: nextStatus });
      success(nextStatus === 'draft' ? '下書き保存しました' : '提出しました（室長承認待ち）');
      if (nextStatus === 'submitted') {
        router.push('/today');
      } else {
        // 再取得して existingReport を最新化
        await load();
      }
    } catch (e) {
      toastError(e instanceof Error ? e.message : '保存に失敗しました');
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
    <AdminLayout>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="space-y-4">
        {/* デモモードの注記バナー */}
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

        {/* 1. 目標 */}
        <Section title="1. 目標">
          <Field
            label="中期: 教材目標 (進行表から取得・スナップショット)"
            hint="保存時点の進行表内容を保存します"
          >
            <textarea
              className="w-full px-3 py-2 border rounded-md text-sm bg-surface"
              rows={2}
              value={form.mid_term_goal_snapshot}
              onChange={(e) => setForm((f) => ({ ...f, mid_term_goal_snapshot: e.target.value }))}
              placeholder="例：期末テスト Unit 1-7 で 85点以上を取る"
            />
          </Field>
          <Field label="中期: 行動目標 (進行表から取得・スナップショット)">
            <textarea
              className="w-full px-3 py-2 border rounded-md text-sm bg-surface"
              rows={2}
              value={form.mid_action_goal_snapshot}
              onChange={(e) => setForm((f) => ({ ...f, mid_action_goal_snapshot: e.target.value }))}
              placeholder="例：英文を音読し、不定詞の3用法を例文で説明できる"
            />
          </Field>
          <Field label="短期: この授業の目標" hint="↑ 中期目標を踏まえて入力">
            <input
              type="text"
              className="w-full px-3 py-2 border-2 border-info rounded-md text-sm"
              value={form.short_term_goal}
              onChange={(e) => setForm((f) => ({ ...f, short_term_goal: e.target.value }))}
              placeholder="例：不定詞の名詞用法を5問以上正しく訳せる"
            />
          </Field>
        </Section>

        {/* 2. 学校進度 */}
        <Section title="2. 学校進度">
          <Field
            label="学校進度（保存時に進行表に転記されます）"
            hint="進行表と同期するため、教材の単元から選択します。教材が未登録の場合のみ自由入力になります"
          >
            {textbookOptions.length === 0 ? (
              // 教材未登録時のフォールバック：自由入力
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-md text-sm"
                value={form.school_progress}
                onChange={(e) => setForm((f) => ({ ...f, school_progress: e.target.value }))}
                placeholder="例: Unit 5 - Lesson 2"
              />
            ) : (
              <select
                className="w-full px-3 py-2 border rounded-md text-sm bg-white"
                value={form.school_progress}
                onChange={(e) => setForm((f) => ({ ...f, school_progress: e.target.value }))}
              >
                <option value="">選択してください</option>
                {/* 既存の自由記述値が選択肢に無い場合は、その値を先頭に残して消えないようにする */}
                {form.school_progress &&
                  !textbookOptions.some((opt) =>
                    opt.curriculum_items.some(
                      (it) => `${opt.textbook_name} / ${it.title}` === form.school_progress
                    )
                  ) && <option value={form.school_progress}>{form.school_progress}（既存）</option>}
                {textbookOptions.map((opt) => (
                  <optgroup key={opt.id} label={opt.textbook_name}>
                    {opt.curriculum_items
                      .slice()
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((it) => {
                        const label = `${opt.textbook_name} / ${it.title}`;
                        return (
                          <option key={it.id} value={label}>
                            {it.title}
                          </option>
                        );
                      })}
                  </optgroup>
                ))}
              </select>
            )}
          </Field>
        </Section>

        {/* 3. 今日の授業内容（教材セット） */}
        <Section title="3. 今日の授業内容（教材×単元、保存時に進行表へ転記）">
          <div className="space-y-3">
            {form.units.map((u, idx) => {
              const opt = textbookOptions.find((o) => o.id === u.student_textbook_id);
              return (
                <div
                  key={idx}
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
                      {textbookOptions.map((o) => (
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

                  <Field label="授業単元（複数選択可）">
                    <div className="flex flex-wrap gap-1 p-2 border rounded-md bg-white min-h-[40px]">
                      {u.curriculum_item_ids.map((itemId) => {
                        const item = opt?.curriculum_items.find((c) => c.id === itemId);
                        return (
                          <span
                            key={itemId}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-info text-white text-xs rounded"
                          >
                            {item?.title ?? `単元#${itemId}`}
                            <button
                              type="button"
                              onClick={() =>
                                updateUnit(idx, {
                                  curriculum_item_ids: u.curriculum_item_ids.filter(
                                    (id) => id !== itemId
                                  ),
                                })
                              }
                              className="hover:opacity-70 transition-opacity duration-150 ease-[var(--ease-out)]"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                      <select
                        value=""
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!Number.isNaN(v) && !u.curriculum_item_ids.includes(v)) {
                            updateUnit(idx, {
                              curriculum_item_ids: [...u.curriculum_item_ids, v],
                            });
                          }
                        }}
                        className="px-2 py-0.5 text-xs border rounded text-info"
                      >
                        <option value="">+ 単元追加</option>
                        {opt?.curriculum_items
                          .filter((c) => !u.curriculum_item_ids.includes(c.id))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                      </select>
                    </div>
                  </Field>

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="開始ページ">
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-sm font-semibold pointer-events-none">
                          p.
                        </span>
                        <input
                          type="number"
                          className="w-full pl-7 pr-2 py-1 border rounded text-sm"
                          value={u.page_start ?? ''}
                          onChange={(e) =>
                            updateUnit(idx, {
                              page_start:
                                e.target.value === '' ? null : parseInt(e.target.value, 10),
                            })
                          }
                        />
                      </div>
                    </Field>
                    <Field label="終了ページ">
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-sm font-semibold pointer-events-none">
                          p.
                        </span>
                        <input
                          type="number"
                          className="w-full pl-7 pr-2 py-1 border rounded text-sm"
                          value={u.page_end ?? ''}
                          onChange={(e) =>
                            updateUnit(idx, {
                              page_end: e.target.value === '' ? null : parseInt(e.target.value, 10),
                            })
                          }
                        />
                      </div>
                    </Field>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => addUnit(false)}
              className="w-full py-2 border-2 border-dashed border-info rounded-md text-sm text-info hover:bg-info-subtle transition-colors duration-150 active:scale-[0.98] ease-[cubic-bezier(0.23,1,0.32,1)]"
            >
              <Plus className="inline w-4 h-4 mr-1" />
              サブ教材セットを追加（補助教材）
            </button>
          </div>
        </Section>

        {/* 4. 宿題・テスト */}
        <Section title="4. 宿題・テスト結果">
          <SliderField
            label="宿題実施状況"
            value={form.homework_completion_pct}
            onChange={(v) => setForm((f) => ({ ...f, homework_completion_pct: v }))}
          />
          <SliderField
            label="宿題正答率"
            value={form.homework_correct_pct}
            onChange={(v) => setForm((f) => ({ ...f, homework_correct_pct: v }))}
          />
          <TestRow
            label="英単語テスト"
            score={form.vocab_test_score}
            total={form.vocab_test_total}
            passed={form.vocab_test_passed}
            onScoreChange={(v) => setForm((f) => ({ ...f, vocab_test_score: v }))}
            onTotalChange={(v) => setForm((f) => ({ ...f, vocab_test_total: v }))}
            onPassedChange={(v) => setForm((f) => ({ ...f, vocab_test_passed: v }))}
          />
          <TestRow
            label="確認テスト"
            score={form.check_test_score}
            total={form.check_test_total}
            passed={form.check_test_passed}
            onScoreChange={(v) => setForm((f) => ({ ...f, check_test_score: v }))}
            onTotalChange={(v) => setForm((f) => ({ ...f, check_test_total: v }))}
            onPassedChange={(v) => setForm((f) => ({ ...f, check_test_passed: v }))}
          />
          <SliderField
            label="本日の問題正答率"
            value={form.today_correct_pct}
            onChange={(v) => setForm((f) => ({ ...f, today_correct_pct: v }))}
          />
        </Section>

        {/* 5. 講評 */}
        <Section title="5. 講評">
          <textarea
            className="w-full px-3 py-2 border rounded-md text-sm"
            rows={5}
            value={form.review_comment}
            onChange={(e) => setForm((f) => ({ ...f, review_comment: e.target.value }))}
            placeholder="5行程度で記入"
          />
          <div className="text-xs text-text-muted mt-1">現在 {reviewLineCount} 行 / 推奨 5 行</div>
        </Section>

        {/* 6. 次回までの宿題 */}
        <Section title="6. 次回までの宿題（授業翌日〜次回授業日に自動割当）">
          <div className="text-xs text-text-muted mb-2 p-2 bg-info-subtle rounded">
            次回授業: <strong>{nextLessonDate}</strong> ・ 残り{' '}
            <strong>{daysBetween(nextLessonDate, form.lesson_date || todayStr())}日</strong>
            <button
              type="button"
              onClick={autoDistributeHomeworkDates}
              className="ml-2 px-2 py-0.5 text-xs bg-info text-white rounded transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.95]"
            >
              <Wand2 className="inline w-3 h-3 mr-1" />
              次回授業日まで日付を入れる
            </button>
          </div>
          <div className="space-y-1">
            {form.homework_assignments.map((a, idx) => (
              <div key={idx} className="grid grid-cols-[100px_1fr_30px] gap-2 items-center">
                <input
                  type="date"
                  value={a.date}
                  onChange={(e) => updateHomeworkRow(idx, { date: e.target.value })}
                  className="px-2 py-1 border rounded text-xs"
                />
                <input
                  type="text"
                  value={a.text}
                  onChange={(e) => updateHomeworkRow(idx, { text: e.target.value })}
                  className="px-2 py-1 border rounded text-sm"
                  placeholder="例: ワーク p.30-31"
                />
                <button
                  type="button"
                  onClick={() => removeHomeworkRow(idx)}
                  className="text-text-faint hover:text-danger transition-colors duration-150 active:scale-[0.90]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addHomeworkRow}
              className="w-full py-2 border-2 border-dashed border-info rounded text-sm text-info hover:bg-info-subtle transition-colors duration-150 active:scale-[0.98] ease-[cubic-bezier(0.23,1,0.32,1)]"
            >
              <Plus className="inline w-4 h-4 mr-1" />
              宿題枠を追加
            </button>
          </div>
        </Section>

        {/* 7. 科目別欄 */}
        <Section title="7. 科目別欄">
          <SubjectSpecificField
            value={form.subject_specific}
            onChange={(v) => setForm((f) => ({ ...f, subject_specific: v }))}
          />
        </Section>

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

        {/* デモ時のみ：報告書の下に進行表イメージ（教材×単元テーブル + 時系列フィード）。
            「講師は進行表を見ながら報告書を書き起こす」動線を1ページで検討するためのダミー。
            将来は同一ページに本物の進行表を埋め込む想定。 */}
        {isDemo && <DemoProgressPreview />}
      </div>
    </AdminLayout>
  );
}

// ---------- 小コンポーネント ----------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h2 className="text-xs font-bold text-text-muted uppercase tracking-wide">{title}</h2>
        {children}
      </CardContent>
    </Card>
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
      <label className="block text-xs font-semibold text-text-muted mb-1">{label}</label>
      <div className="grid grid-cols-[1fr_60px] gap-3 items-center">
        <input
          type="range"
          min={0}
          max={100}
          value={value ?? 0}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="w-full"
        />
        <div className="text-lg font-bold text-info text-right tabular-nums">
          {value ?? '-'}
          <span className="text-xs text-text-muted font-medium">%</span>
        </div>
      </div>
    </div>
  );
}

function TestRow({
  label,
  score,
  total,
  passed,
  onScoreChange,
  onTotalChange,
  onPassedChange,
}: {
  label: string;
  score: number | null;
  total: number | null;
  passed: boolean | null;
  onScoreChange: (v: number | null) => void;
  onTotalChange: (v: number | null) => void;
  onPassedChange: (v: boolean | null) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_70px_70px_140px] gap-2 items-end p-2 bg-surface rounded">
      <div className="text-sm font-semibold pb-1">{label}</div>
      <input
        type="number"
        value={score ?? ''}
        onChange={(e) => onScoreChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
        className="px-2 py-1 border rounded text-sm text-center"
      />
      <input
        type="number"
        value={total ?? ''}
        onChange={(e) => onTotalChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
        className="px-2 py-1 border rounded text-sm text-center"
      />
      <div className="flex border rounded overflow-hidden">
        <button
          type="button"
          onClick={() => onPassedChange(true)}
          className={`flex-1 py-1 text-xs font-bold transition-[background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] ${passed === true ? 'bg-success text-white' : 'text-text-muted'}`}
        >
          合格
        </button>
        <button
          type="button"
          onClick={() => onPassedChange(false)}
          className={`flex-1 py-1 text-xs font-bold transition-[background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] ${passed === false ? 'bg-danger text-white' : 'text-text-muted'}`}
        >
          不合格
        </button>
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

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <label>種別:</label>
        <select
          value={kind}
          onChange={(e) => {
            const k = e.target.value as SubjectSpecific['kind'];
            if (k === 'none') onChange({ kind: 'none' });
            else
              onChange({
                kind: k,
                range: v?.range ?? '',
                pages: v?.pages ?? '',
                times_per_day: v?.times_per_day ?? 5,
                duration: v?.duration ?? '1週間',
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
