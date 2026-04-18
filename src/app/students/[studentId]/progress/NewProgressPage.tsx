'use client';

/**
 * 新・生徒進捗ページ（Phase 1 リリース）
 *
 * 特徴:
 * - カードビュー（教科書一覧）を入口に
 * - テーブルビューで既存の編集機能を継続
 * - 管理/面談モード切替
 * - ロール別の表示（講師は管理操作を非表示）
 *
 * ロールバック: URL に `?v=legacy` を付けると旧UI（LegacyProgressPage）に切替わる。
 *
 * Phase 2 で接続予定（現状はUIのみ・保存なし）:
 * - 行動目標 (action goals) — 新テーブル必要
 * - 意図タグ (intent tag) — 新カラム必要
 * - 独立した試験範囲マスタ — 新テーブル必要
 *
 * 現状利用している既存データ:
 * - student_textbooks / textbooks / curriculum_items
 * - student_progress / student_progress_lessons
 * - student_textbook_exam / exam_types
 * - student_textbook_settings
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import {
  getStudentTextbooks,
  getStudentProgress,
  updateStudentProgress,
  upsertStudentProgress,
  upsertStudentProgressLesson,
  upsertStudentTextbookSettings,
} from '@/lib/api/progress';
import { getStudent } from '@/lib/api/students';
import { getExamTypes } from '@/lib/api/textbooks';
import type {
  Student,
  StudentTextbookWithDetails,
  CurriculumItemWithProgress,
  ExamType,
} from '@/types/database';

// ─────────────────────────────────────────────
// 型
// ─────────────────────────────────────────────
type View = 'cards' | 'table';
type ViewMode = 'admin' | 'meeting';

// ─────────────────────────────────────────────
// メインページ
// ─────────────────────────────────────────────
export default function NewProgressPage() {
  const params = useParams();
  const studentId = params?.studentId as string;
  const { toasts, removeToast, success, error: toastError } = useToast();
  const { profile } = useAuth();
  const isTeacher = profile?.role === 'teacher';

  // データ状態（既存ロジックを踏襲）
  const [student, setStudent] = useState<Student | null>(null);
  const [studentTextbooks, setStudentTextbooks] = useState<StudentTextbookWithDetails[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [selectedTextbookId, setSelectedTextbookId] = useState<string | null>(null);
  const [progressData, setProgressData] = useState<CurriculumItemWithProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ビュー状態
  const [view, setView] = useState<View>('cards');
  const [viewMode, setViewMode] = useState<ViewMode>('admin');
  const effectiveViewMode: ViewMode = isTeacher ? 'admin' : viewMode;

  // 初期ロード
  useEffect(() => {
    if (!studentId) return;
    (async () => {
      setIsLoading(true);
      try {
        const [s, tbs, ets] = await Promise.all([
          getStudent(studentId),
          getStudentTextbooks(studentId),
          getExamTypes(),
        ]);
        setStudent(s);
        setStudentTextbooks(
          // 講師は下書きを見られない
          isTeacher ? (tbs || []).filter((tb) => !tb.is_draft) : tbs || []
        );
        setExamTypes(ets || []);
      } catch (e) {
        console.error(e);
        toastError('データの取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [studentId, isTeacher, toastError]);

  // テーブルに入った時に progress を取得
  useEffect(() => {
    if (!selectedTextbookId) return;
    (async () => {
      try {
        const rows = await getStudentProgress(selectedTextbookId);
        setProgressData(rows || []);
      } catch (e) {
        console.error(e);
        toastError('進捗データの取得に失敗しました');
      }
    })();
  }, [selectedTextbookId, toastError]);

  const selectedTb = useMemo(
    () => studentTextbooks.find((t) => t.id === selectedTextbookId) ?? null,
    [selectedTextbookId, studentTextbooks]
  );

  const openTextbook = (id: string) => {
    setSelectedTextbookId(id);
    setView('table');
  };

  return (
    <AdminLayout headerTitle="進捗管理">
      {/* ヘッダ */}
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-[#6b7280]">生徒詳細 › 進捗管理</div>
          <h1 className="text-lg font-bold text-[#1f2937]">
            {student?.name ?? '—'}
            {student?.grade && (
              <span className="text-sm font-normal text-[#6b7280] ml-2">
                {gradeLabel(student.grade)}
              </span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {!isTeacher && <ModeSwitcher mode={viewMode} onChange={setViewMode} />}
          <ViewSwitcher view={view} onChange={setView} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-[#1e3a5f] rounded-full animate-spin" />
        </div>
      ) : studentTextbooks.length === 0 ? (
        <EmptyState />
      ) : view === 'cards' ? (
        <CardsView
          textbooks={studentTextbooks}
          role={isTeacher ? 'teacher' : 'manager'}
          viewMode={effectiveViewMode}
          onSelect={openTextbook}
        />
      ) : (
        selectedTb && (
          <TableView
            textbook={selectedTb}
            progress={progressData}
            setProgress={setProgressData}
            examTypes={examTypes}
            textbookTabs={studentTextbooks}
            onSelectTab={setSelectedTextbookId}
            role={isTeacher ? 'teacher' : 'manager'}
            viewMode={effectiveViewMode}
            studentId={studentId}
            onBack={() => setView('cards')}
            success={success}
            toastError={toastError}
          />
        )
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}

// ─────────────────────────────────────────────
// ヘルパー
// ─────────────────────────────────────────────
function gradeLabel(grade: number | null | undefined): string {
  if (grade == null) return '';
  if (grade <= 6) return `小学${grade}年生`;
  if (grade <= 9) return `中学${grade - 6}年生`;
  if (grade <= 12) return `高校${grade - 9}年生`;
  return '';
}

function daysLeftOf(examDate: string | null | undefined): number | null {
  if (!examDate) return null;
  const d = new Date(examDate);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function seasonLabel(season: string | null | undefined): string | null {
  if (!season) return null;
  if (season === 'spring') return '春期';
  if (season === 'summer') return '夏期';
  if (season === 'winter') return '冬期';
  return null;
}

// 停滞判定（最終授業日から14日経過）
function isStalled(tb: StudentTextbookWithDetails): { stalled: boolean; lastDate: string | null } {
  let last: string | null = null;
  const lessons = (tb.curriculum_items || []).flatMap((ci) => ci.lessons || []);
  for (const l of lessons) {
    if (l.lesson_date && (!last || l.lesson_date > last)) last = l.lesson_date;
  }
  if (!last) return { stalled: false, lastDate: null };
  const days = daysLeftOf(last);
  return { stalled: days !== null && days < -14, lastDate: last };
}

function progressStats(tb: StudentTextbookWithDetails): { total: number; done: number } {
  const items = tb.curriculum_items || [];
  const total = items.length;
  const done = items.filter((ci) => (ci.lessons || []).some((l) => l.lesson_date)).length;
  return { total, done };
}

function activeExamOf(tb: StudentTextbookWithDetails): {
  name: string;
  date: string | null;
  daysLeft: number | null;
  targetScore: number | null;
} | null {
  const exams = tb.exams || [];
  if (exams.length === 0) return null;
  // 試験日が未来のもののうち最も近いもの
  const future = exams
    .filter((e) => e.exam_date)
    .map((e) => ({ e, dl: daysLeftOf(e.exam_date) ?? -9999 }))
    .filter((x) => x.dl >= 0)
    .sort((a, b) => a.dl - b.dl);
  const pick = future[0]?.e ?? exams[0];
  return {
    name: pick.exam_name || pick.custom_exam_name || '試験目標',
    date: pick.exam_date,
    daysLeft: daysLeftOf(pick.exam_date),
    targetScore: pick.target_score,
  };
}

// ─────────────────────────────────────────────
// 空状態
// ─────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="bg-white border border-dashed border-[#e5e7eb] rounded-xl p-12 text-center">
      <p className="text-sm text-[#6b7280] mb-2">登録されている教科書がありません。</p>
      <p className="text-xs text-[#9ca3af]">※ 教科書の追加は Phase 2 で本UIに対応予定。暫定的には旧UI（?v=legacy）からご利用ください。</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// スイッチャー
// ─────────────────────────────────────────────
function ModeSwitcher({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[#e5e7eb] bg-white overflow-hidden text-sm">
      {(['admin', 'meeting'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-2.5 py-1.5 transition-colors ${
            mode === m ? 'bg-[#1e3a5f] text-white' : 'text-[#4b5563] hover:bg-[#f3f4f6]'
          }`}
        >
          {m === 'admin' ? '管理' : '面談用'}
        </button>
      ))}
    </div>
  );
}

function ViewSwitcher({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[#e5e7eb] bg-white overflow-hidden text-sm">
      {(['cards', 'table'] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 transition-colors ${
            view === v ? 'bg-[#1e3a5f] text-white' : 'text-[#4b5563] hover:bg-[#f3f4f6]'
          }`}
        >
          {v === 'cards' ? 'カード' : 'テーブル'}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// カードビュー
// ─────────────────────────────────────────────
function CardsView({
  textbooks,
  role,
  viewMode,
  onSelect,
}: {
  textbooks: StudentTextbookWithDetails[];
  role: 'teacher' | 'manager';
  viewMode: ViewMode;
  onSelect: (id: string) => void;
}) {
  const isMeeting = viewMode === 'meeting';
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-[#1f2937]">
          {isMeeting ? '面談用表示（保護者提示）' : '教科書一覧'}
        </h2>
        <p className="text-xs text-[#6b7280] mt-0.5">
          {isMeeting
            ? '保護者面談で画面共有 / PDF配布するためのプレゼンビュー'
            : 'カードをクリックで詳細テーブルへ'}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {textbooks.map((tb) => (
          <TextbookCard
            key={tb.id}
            textbook={tb}
            role={role}
            isMeeting={isMeeting}
            onOpen={() => onSelect(tb.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TextbookCard({
  textbook,
  role,
  isMeeting,
  onOpen,
}: {
  textbook: StudentTextbookWithDetails;
  role: 'teacher' | 'manager';
  isMeeting: boolean;
  onOpen: () => void;
}) {
  const { stalled, lastDate } = isStalled(textbook);
  const { total, done } = progressStats(textbook);
  const activeExam = activeExamOf(textbook);
  const season = seasonLabel(textbook.season);

  const seasonColor =
    textbook.season === 'spring' ? 'border-l-[#f472b6]'
      : textbook.season === 'summer' ? 'border-l-[#fbbf24]'
      : textbook.season === 'winter' ? 'border-l-[#60a5fa]'
      : 'border-l-transparent';

  return (
    <div
      onClick={onOpen}
      className={`bg-white rounded-xl border border-l-4 ${seasonColor} ${stalled ? 'border-amber-300' : 'border-[#e5e7eb]'} p-5 shadow-sm hover:shadow-md transition-all cursor-pointer`}
    >
      {/* ヘッダ */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <span className="text-xs text-[#6b7280]">{textbook.textbook?.subject?.name ?? ''}</span>
            {textbook.is_draft && <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">下書き</span>}
            {season && <span className="text-[10px] px-1.5 py-0.5 bg-[#fef3c7] text-[#92400e] rounded">{season}</span>}
          </div>
          <h3 className="font-semibold text-[#1f2937] truncate">{textbook.textbook?.name ?? '教科書'}</h3>
        </div>
      </div>

      {/* 試験目標（既存 exam データから表示） */}
      {activeExam ? (
        <div className="mb-3 p-4 bg-gradient-to-br from-[#eff6ff] to-[#dbeafe]/50 border border-[#1e40af]/25 rounded-xl">
          <div className="flex items-center justify-between mb-2.5">
            <div>
              <div className="text-[10px] font-bold text-[#1e40af] uppercase tracking-widest mb-0.5">試験目標</div>
              <div className="text-sm font-bold text-[#1e3a5f]">{activeExam.name}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white rounded-lg px-2 py-1.5 text-center">
              <div className="text-[9px] text-[#6b7280] uppercase tracking-wider">残り</div>
              <div>
                <span className="text-xl font-bold text-[#1e3a5f] leading-tight">
                  {activeExam.daysLeft != null ? activeExam.daysLeft : '—'}
                </span>
                {activeExam.daysLeft != null && <span className="text-[10px] text-[#6b7280] ml-0.5">日</span>}
              </div>
            </div>
            <div className="bg-white rounded-lg px-2 py-1.5 text-center">
              <div className="text-[9px] text-[#6b7280] uppercase tracking-wider">目標</div>
              <div>
                <span className="text-xl font-bold text-[#1e3a5f] leading-tight">{activeExam.targetScore ?? '—'}</span>
                {activeExam.targetScore != null && <span className="text-[10px] text-[#6b7280] ml-0.5">点</span>}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-3 p-3 border border-dashed border-[#d1d5db] rounded-lg text-xs text-[#9ca3af] text-center">
          試験目標未設定
        </div>
      )}

      {stalled && (
        <div className="mb-3 px-2.5 py-1.5 bg-amber-50 text-amber-800 text-xs rounded-md border border-amber-200">
          直近進捗なし {lastDate && <span className="text-amber-600">({lastDate} 以降)</span>}
        </div>
      )}

      {/* 進捗サマリー */}
      <div className="text-xs text-[#6b7280]">
        学習済み: {done} / {total} 項目
      </div>

      {/* アクション */}
      <div className="mt-4 flex gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="flex-1 px-3 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm hover:bg-[#2a4d7a]"
        >
          詳細を開く
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// テーブルビュー（Phase 1: 最低限の編集機能 + Phase 2a: 面談モード行可視化）
// ─────────────────────────────────────────────
function TableView({
  textbook,
  progress,
  setProgress,
  examTypes,
  textbookTabs,
  onSelectTab,
  role,
  viewMode,
  studentId,
  onBack,
  success,
  toastError,
}: {
  textbook: StudentTextbookWithDetails;
  progress: CurriculumItemWithProgress[];
  setProgress: (rows: CurriculumItemWithProgress[]) => void;
  examTypes: ExamType[];
  textbookTabs: StudentTextbookWithDetails[];
  onSelectTab: (id: string) => void;
  role: 'teacher' | 'manager';
  viewMode: ViewMode;
  studentId: string;
  onBack: () => void;
  success: (m: string) => void;
  toastError: (m: string) => void;
}) {
  const isMeeting = viewMode === 'meeting';
  const activeExam = activeExamOf(textbook);

  // 面談モードの列可視化: 生徒×教科書ごとに localStorage に保存（都度編集しやすいように）
  // 対象列は保護者に見せる/見せないを選びやすい 6 列のみ。他の講師向け列（引継ぎ/講師名/提案コマ数）は
  // isMeeting 時は常に非表示。申込コマ数も面談では非表示（内部営業指標のため）。
  type MeetingCol = 'proposal' | 'examRange' | 'schoolProgress' | 'lesson1' | 'lesson2' | 'lesson3';
  const colsKey = `meeting-cols:${studentId}:${textbook.id}`;
  const DEFAULT_COLS: Record<MeetingCol, boolean> = {
    proposal: true,
    examRange: true,
    schoolProgress: true,
    lesson1: true,
    lesson2: true,
    lesson3: true,
  };
  const [meetingCols, setMeetingCols] = useState<Record<MeetingCol, boolean>>(DEFAULT_COLS);
  const [colMenuOpen, setColMenuOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(colsKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<Record<MeetingCol, boolean>>;
        setMeetingCols({ ...DEFAULT_COLS, ...parsed });
      } else {
        setMeetingCols(DEFAULT_COLS);
      }
    } catch {
      setMeetingCols(DEFAULT_COLS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colsKey]);

  const toggleCol = (col: MeetingCol) => {
    setMeetingCols((prev) => {
      const next = { ...prev, [col]: !prev[col] };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(colsKey, JSON.stringify(next));
      }
      return next;
    });
  };
  const resetCols = () => {
    setMeetingCols(DEFAULT_COLS);
    if (typeof window !== 'undefined') window.localStorage.removeItem(colsKey);
  };

  const hiddenColCount = Object.values(meetingCols).filter((v) => !v).length;

  // ─── 記録モード ───
  // 1コマで複数単元を進む実情に合わせた一括入力モード
  const todayStr = new Date().toISOString().slice(0, 10);
  const [recording, setRecording] = useState(false);
  const [recordDate, setRecordDate] = useState<string>(todayStr);
  const [recordTeacher, setRecordTeacher] = useState<string>('');
  const [recordNote, setRecordNote] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!recording) setSelectedIds(new Set());
  }, [recording]);

  const toggleSelect = (itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  /**
   * 一括スタンプ: 選択行の N コマ目に recordDate を保存。
   * 事前に student_progress レコードが無い行は upsert で作成してから lesson を upsert する。
   */
  const applyStamp = async (slot: 1 | 2 | 3) => {
    if (selectedIds.size === 0) {
      toastError('記録する行を選択してください');
      return;
    }
    if (!recordDate) {
      toastError('授業日を入力してください');
      return;
    }
    const targets = progress.filter((r) => selectedIds.has(r.id));
    let okCount = 0;
    let ngCount = 0;
    for (const row of targets) {
      try {
        // 進捗レコードが無ければ作成（teacher_name, handover も記録モードの値で上書き）
        let progressId = row.progress?.id;
        const basePatch: Record<string, unknown> = {};
        if (recordTeacher) basePatch.teacher_name = recordTeacher;
        if (recordNote) basePatch.handover = recordNote;
        if (!progressId) {
          const created = await upsertStudentProgress({
            student_textbook_id: textbook.id,
            curriculum_item_id: row.id,
            ...basePatch,
          });
          progressId = created?.id;
        } else if (Object.keys(basePatch).length > 0) {
          await updateStudentProgress(progressId, basePatch);
        }
        if (progressId) {
          await upsertStudentProgressLesson({
            student_progress_id: progressId,
            lesson_number: slot,
            lesson_date: recordDate,
          });
          okCount++;
        } else {
          ngCount++;
        }
      } catch (e) {
        console.error(e);
        ngCount++;
      }
    }
    if (okCount > 0) success(`${okCount}件を${slot}回目に記録しました`);
    if (ngCount > 0) toastError(`${ngCount}件の保存に失敗しました`);
    setSelectedIds(new Set());
    // 進捗データ再取得
    try {
      const rows = await getStudentProgress(textbook.id);
      setProgress(rows || []);
    } catch {
      // noop
    }
  };

  // 編集ハンドラ（既存API呼出し、楽観的更新）
  const updateLocal = (itemId: string, patch: Partial<CurriculumItemWithProgress['progress']>) => {
    setProgress(
      progress.map((row) =>
        row.id === itemId
          ? { ...row, progress: row.progress ? { ...row.progress, ...patch } : null }
          : row
      )
    );
  };

  const saveProgressField = useCallback(
    async (row: CurriculumItemWithProgress, patch: Record<string, unknown>) => {
      try {
        if (row.progress?.id) {
          await updateStudentProgress(row.progress.id, patch);
        } else {
          await upsertStudentProgress({
            student_textbook_id: textbook.id,
            curriculum_item_id: row.id,
            ...patch,
          });
        }
      } catch (e) {
        console.error(e);
        toastError('保存に失敗しました');
      }
    },
    [textbook.id, toastError]
  );

  const saveLessonField = useCallback(
    async (row: CurriculumItemWithProgress, lessonNumber: 1 | 2 | 3, date: string | null) => {
      if (!row.progress?.id) {
        toastError('先に他の項目を埋めて進捗レコードを作成してください');
        return;
      }
      try {
        await upsertStudentProgressLesson({
          student_progress_id: row.progress.id,
          lesson_number: lessonNumber,
          lesson_date: date,
        });
      } catch (e) {
        console.error(e);
        toastError('指導日の保存に失敗しました');
      }
    },
    [toastError]
  );

  return (
    <div>
      {/* ヘッダ */}
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-[#4b5563] hover:text-[#1f2937]">← 教科書一覧</button>
          <h2 className="text-base font-semibold text-[#1f2937]">{textbook.textbook?.name ?? '教科書'}</h2>
          {isMeeting && (
            <span className="px-2 py-0.5 bg-[#fef3c7] text-[#92400e] rounded-full text-[10px] font-semibold uppercase tracking-wider">
              面談用・プラン表示
            </span>
          )}
        </div>
        {!isMeeting && (
          <button
            onClick={() => setRecording((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              recording ? 'bg-[#dc2626] text-white hover:bg-[#b91c1c]' : 'bg-[#1e3a5f] text-white hover:bg-[#2a4d7a]'
            }`}
          >
            {recording ? '記録モード終了' : '＋ 授業を記録'}
          </button>
        )}
      </div>

      {/* 教科書タブ（横並び・サクッと切替） */}
      {textbookTabs.length > 1 && (
        <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
          {textbookTabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => onSelectTab(tb.id)}
              className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap transition-colors ${
                tb.id === textbook.id
                  ? 'bg-[#1e3a5f] text-white'
                  : 'bg-white text-[#4b5563] border border-[#e5e7eb] hover:bg-[#f3f4f6]'
              }`}
            >
              {tb.textbook?.name ?? '—'}
            </button>
          ))}
        </div>
      )}

      {/* 試験目標ブロック（大きく表示） */}
      {activeExam && (
        <div className="mb-4 p-4 bg-gradient-to-br from-[#eff6ff] to-[#dbeafe]/50 border border-[#1e40af]/25 rounded-xl shadow-sm">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-[10px] font-bold text-[#1e40af] uppercase tracking-widest mb-0.5">試験目標</div>
              <div className="text-base font-bold text-[#1e3a5f]">{activeExam.name}</div>
              {activeExam.date && <div className="text-[11px] text-[#6b7280] mt-0.5">試験日: {activeExam.date}</div>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white rounded-lg px-3 py-2 text-center shadow-sm">
              <div className="text-[10px] text-[#6b7280] uppercase tracking-wider font-semibold">残り</div>
              <div>
                <span className="text-2xl font-bold text-[#1e3a5f] leading-tight">
                  {activeExam.daysLeft != null ? activeExam.daysLeft : '—'}
                </span>
                {activeExam.daysLeft != null && <span className="text-[11px] text-[#6b7280] ml-0.5">日</span>}
              </div>
            </div>
            <div className="bg-white rounded-lg px-3 py-2 text-center shadow-sm">
              <div className="text-[10px] text-[#6b7280] uppercase tracking-wider font-semibold">目標</div>
              <div>
                <span className="text-2xl font-bold text-[#1e3a5f] leading-tight">{activeExam.targetScore ?? '—'}</span>
                {activeExam.targetScore != null && <span className="text-[11px] text-[#6b7280] ml-0.5">点</span>}
              </div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-[#6b7280]">
            ※ 行動目標・試験範囲スライダーは Phase 2 で追加予定
          </div>
        </div>
      )}

      {/* 進め方 / 宿題 — 常時表示（面談モードは読み取り専用） */}
      <TextbookSettingsSection textbookId={textbook.id} isMeeting={isMeeting} success={success} toastError={toastError} />

      {/* 面談モード: 列可視化コントロール（列ごとに保護者に見せる/隠す） */}
      {isMeeting && (
        <div className="mb-2 px-3 py-2 bg-[#fff7ed] border border-[#fb923c]/30 rounded-lg flex items-center justify-between flex-wrap gap-2">
          <div className="text-xs text-[#9a3412]">
            <strong>面談モード：</strong>
            列ごとに保護者に見せる/隠すを切替可。{hiddenColCount > 0 ? (
              <span> 現在 <strong>{hiddenColCount}列</strong> を非表示中。</span>
            ) : (
              <span> 全ての対象列を表示中。</span>
            )}
          </div>
          <div className="flex items-center gap-2 relative">
            {hiddenColCount > 0 && (
              <button
                onClick={resetCols}
                className="px-2 py-1 text-[11px] bg-white border border-[#fb923c]/30 text-[#9a3412] rounded hover:bg-[#fef3c7]"
              >
                全列を表示
              </button>
            )}
            <button
              onClick={() => setColMenuOpen((v) => !v)}
              className="px-3 py-1 text-xs font-medium bg-[#1e3a5f] text-white rounded hover:bg-[#2a4d7a]"
            >
              列の表示設定 ▾
            </button>
            {colMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setColMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-20 overflow-hidden">
                  <div className="px-3 py-2 text-[10px] text-[#6b7280] uppercase tracking-wider border-b border-[#f3f4f6] bg-[#f9fafb]">
                    保護者に見せる列を選択
                  </div>
                  {([
                    { key: 'proposal', label: '提案コマ数' },
                    { key: 'examRange', label: '試験範囲' },
                    { key: 'schoolProgress', label: '学校進度' },
                    { key: 'lesson1', label: '1回目' },
                    { key: 'lesson2', label: '2回目' },
                    { key: 'lesson3', label: '3回目' },
                  ] as { key: MeetingCol; label: string }[]).map((c) => (
                    <label key={c.key} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#f9fafb] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={meetingCols[c.key]}
                        onChange={() => toggleCol(c.key)}
                        className="w-4 h-4 accent-[#1e3a5f]"
                      />
                      <span className={meetingCols[c.key] ? 'text-[#1f2937]' : 'text-[#9ca3af]'}>{c.label}</span>
                    </label>
                  ))}
                  <div className="px-3 py-2 text-[10px] text-[#6b7280] border-t border-[#f3f4f6] bg-[#f9fafb]">
                    ※ 引継ぎ・講師名・申込コマ数は面談では常に非表示
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 記録モード: 一括入力バー */}
      {recording && !isMeeting && (
        <div className="mb-2 bg-[#fff7ed] border-2 border-[#fb923c] rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold text-[#9a3412]">記録モード</div>
            <div className="text-xs text-[#9a3412]">1コマで複数単元を進む想定。行にチェック → 「N回目に記録」で一括スタンプ</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-[#9a3412] uppercase mb-1">授業日</label>
              <input type="date" value={recordDate} onChange={(e) => setRecordDate(e.target.value)} className="w-full px-2 py-1.5 border border-[#fb923c] bg-white rounded text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-[#9a3412] uppercase mb-1">担当講師</label>
              <input type="text" value={recordTeacher} onChange={(e) => setRecordTeacher(e.target.value)} placeholder="（空欄なら行の現状維持）" className="w-full px-2 py-1.5 border border-[#fb923c] bg-white rounded text-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-semibold text-[#9a3412] uppercase mb-1">引継ぎメモ（選択行に共通・空欄可）</label>
              <input type="text" value={recordNote} onChange={(e) => setRecordNote(e.target.value)} className="w-full px-2 py-1.5 border border-[#fb923c] bg-white rounded text-sm" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm text-[#9a3412]">
              選択中 <strong className="text-lg">{selectedIds.size}</strong> 件
            </div>
            <div className="flex gap-2">
              <button onClick={() => applyStamp(1)} disabled={selectedIds.size === 0} className="px-3 py-1.5 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2a4d7a] disabled:bg-[#9ca3af] disabled:cursor-not-allowed">
                1回目に記録
              </button>
              <button onClick={() => applyStamp(2)} disabled={selectedIds.size === 0} className="px-3 py-1.5 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2a4d7a] disabled:bg-[#9ca3af] disabled:cursor-not-allowed">
                2回目に記録
              </button>
              <button onClick={() => applyStamp(3)} disabled={selectedIds.size === 0} className="px-3 py-1.5 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2a4d7a] disabled:bg-[#9ca3af] disabled:cursor-not-allowed">
                3回目に記録
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 進捗テーブル */}
      <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-[#f9fafb] border-b border-[#e5e7eb] text-[#6b7280] text-xs">
            <tr>
              {recording && !isMeeting && <th className="px-2 py-2 w-10"></th>}
              <th className="px-3 py-2 text-left w-10">#</th>
              <th className="px-3 py-2 text-left min-w-[180px]">単元名</th>
              {/* 提案: 管理モード常時 / 面談モードは列設定に従う */}
              {(!isMeeting || meetingCols.proposal) && <th className="px-3 py-2 text-left w-20">提案</th>}
              {!isMeeting && <th className="px-3 py-2 text-left w-20">申込</th>}
              {(!isMeeting || meetingCols.examRange) && <th className="px-3 py-2 text-left w-32">試験範囲</th>}
              {(!isMeeting || meetingCols.schoolProgress) && <th className="px-3 py-2 text-left w-28">学校進度</th>}
              {(!isMeeting || meetingCols.lesson1) && <th className="px-3 py-2 text-left w-28">1回目</th>}
              {(!isMeeting || meetingCols.lesson2) && <th className="px-3 py-2 text-left w-28">2回目</th>}
              {(!isMeeting || meetingCols.lesson3) && <th className="px-3 py-2 text-left w-28">3回目</th>}
              {!isMeeting && <th className="px-3 py-2 text-left min-w-[160px]">引継ぎ</th>}
              {!isMeeting && <th className="px-3 py-2 text-left w-24">講師名</th>}
            </tr>
          </thead>
          <tbody>
            {progress.map((row) => (
              <ProgressRow
                key={row.id}
                row={row}
                examTypes={examTypes}
                isMeeting={isMeeting}
                meetingCols={meetingCols}
                recording={recording && !isMeeting}
                selected={selectedIds.has(row.id)}
                onToggleSelect={() => toggleSelect(row.id)}
                onLocalPatch={(patch) => updateLocal(row.id, patch)}
                onSaveProgress={(patch) => saveProgressField(row, patch)}
                onSaveLesson={(n, date) => saveLessonField(row, n, date)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 p-3 bg-white border border-dashed border-[#e5e7eb] rounded-lg text-xs text-[#6b7280]">
        Phase 1 リリース: UI を刷新、既存の編集機能は継続。
        問題があれば URL に <code className="px-1 bg-[#f3f4f6] rounded">?v=legacy</code> を付けて旧UIに戻せます。
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 進行表の1行
// ─────────────────────────────────────────────
type MeetingColMap = { proposal: boolean; examRange: boolean; schoolProgress: boolean; lesson1: boolean; lesson2: boolean; lesson3: boolean };

function ProgressRow({
  row,
  examTypes,
  isMeeting,
  meetingCols,
  recording = false,
  selected = false,
  onToggleSelect,
  onLocalPatch,
  onSaveProgress,
  onSaveLesson,
}: {
  row: CurriculumItemWithProgress;
  examTypes: ExamType[];
  isMeeting: boolean;
  meetingCols: MeetingColMap;
  recording?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onLocalPatch: (patch: Partial<CurriculumItemWithProgress['progress']>) => void;
  onSaveProgress: (patch: Record<string, unknown>) => Promise<void>;
  onSaveLesson: (lessonNumber: 1 | 2 | 3, date: string | null) => Promise<void>;
}) {
  const p = row.progress;
  const lessonDate = (n: 1 | 2 | 3) =>
    (row.lessons || []).find((l) => l.lesson_number === n)?.lesson_date ?? '';
  const groupBadge = p?.group_number ? `G${p.group_number}` : '';
  const examRangeName = examTypes.find((et) => et.id === p?.exam_range_exam_type_id)?.name ?? '';
  const rowClass = selected
    ? 'border-b border-[#f3f4f6] bg-[#fff7ed] cursor-pointer'
    : recording
      ? 'border-b border-[#f3f4f6] hover:bg-[#f9fafb] cursor-pointer'
      : 'border-b border-[#f3f4f6] hover:bg-[#f9fafb]';

  // 列表示判定ヘルパ
  const showProposal = !isMeeting || meetingCols.proposal;
  const showExamRange = !isMeeting || meetingCols.examRange;
  const showSchoolProgress = !isMeeting || meetingCols.schoolProgress;
  const showLesson = (n: 1 | 2 | 3) =>
    !isMeeting || (n === 1 ? meetingCols.lesson1 : n === 2 ? meetingCols.lesson2 : meetingCols.lesson3);

  return (
    <tr
      className={rowClass}
      onClick={recording ? onToggleSelect : undefined}
    >
      {recording && (
        <td className="px-2 py-2.5 text-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 accent-[#fb923c] cursor-pointer"
          />
        </td>
      )}
      <td className="px-3 py-2.5 text-[#6b7280] text-xs">{row.item_number ?? ''}</td>
      <td className="px-3 py-2.5 text-[#1f2937]">
        <div className="flex items-center gap-1.5">
          {groupBadge && <span className="inline-block px-1.5 py-0.5 bg-[#eff6ff] text-[#1e40af] text-[10px] rounded">{groupBadge}</span>}
          <span>{row.title}</span>
        </div>
      </td>
      {/* 提案: 管理モードは常時編集 / 面談モードは列設定に従う読み取り */}
      {showProposal && (
        <td className="px-3 py-2.5">
          {isMeeting ? (
            <span className="text-[#1f2937] text-xs">{p?.proposal_count != null ? `${p.proposal_count}コマ` : '—'}</span>
          ) : (
            <input
              type="number"
              min={0}
              defaultValue={p?.proposal_count ?? ''}
              onBlur={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value);
                onLocalPatch({ proposal_count: v ?? undefined });
                onSaveProgress({ proposal_count: v });
              }}
              className="w-14 px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none text-center"
            />
          )}
        </td>
      )}
      {/* 申込: 管理モードのみ */}
      {!isMeeting && (
        <td className="px-3 py-2.5">
          <input
            type="number"
            min={0}
            defaultValue={p?.application_count ?? ''}
            onBlur={(e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              onLocalPatch({ application_count: v ?? undefined });
              onSaveProgress({ application_count: v });
            }}
            className="w-14 px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none text-center"
          />
        </td>
      )}
      {/* 試験範囲 */}
      {showExamRange && (
        <td className="px-3 py-2.5 text-xs">
          {isMeeting ? (
            examRangeName ? (
              <span className="inline-block px-2 py-0.5 bg-[#eff6ff] text-[#1e40af] rounded-full border border-[#dbeafe] text-[11px]">
                {examRangeName}
              </span>
            ) : (
              <span className="text-[#d1d5db]">—</span>
            )
          ) : (
            <select
              defaultValue={p?.exam_range_exam_type_id ?? ''}
              onChange={(e) => {
                const v = e.target.value || null;
                onLocalPatch({ exam_range_exam_type_id: v ?? undefined });
                onSaveProgress({ exam_range_exam_type_id: v });
              }}
              className="w-full px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none"
            >
              <option value="">—</option>
              {examTypes.map((et) => (
                <option key={et.id} value={et.id}>{et.name}</option>
              ))}
            </select>
          )}
        </td>
      )}
      {/* 学校進度 */}
      {showSchoolProgress && (
        <td className="px-3 py-2.5 text-xs">
          {isMeeting ? (
            <span className="text-[#4b5563]">{p?.school_progress_date ?? '—'}</span>
          ) : (
            <input
              type="date"
              defaultValue={p?.school_progress_date ?? ''}
              onBlur={(e) => {
                const v = e.target.value || null;
                onLocalPatch({ school_progress_date: v ?? undefined });
                onSaveProgress({ school_progress_date: v });
              }}
              className="w-full px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none"
            />
          )}
        </td>
      )}
      {/* 1回目 / 2回目 / 3回目 */}
      {([1, 2, 3] as const).map((n) =>
        showLesson(n) ? (
          <td key={n} className="px-3 py-2.5 text-xs">
            {isMeeting ? (
              <span className="text-[#1f2937]">{(lessonDate(n) || '').replace(/^\d{4}-/, '') || '—'}</span>
            ) : (
              <input
                type="date"
                defaultValue={lessonDate(n)}
                onBlur={(e) => onSaveLesson(n, e.target.value || null)}
                className="w-full px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none"
              />
            )}
          </td>
        ) : null
      )}
      {!isMeeting && (
        <td className="px-3 py-2.5">
          <input
            type="text"
            defaultValue={p?.handover ?? ''}
            placeholder="引継ぎメモ"
            onBlur={(e) => {
              onLocalPatch({ handover: e.target.value || undefined });
              onSaveProgress({ handover: e.target.value || null });
            }}
            className="w-full px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none"
          />
        </td>
      )}
      {!isMeeting && (
        <td className="px-3 py-2.5">
          <input
            type="text"
            defaultValue={p?.teacher_name ?? ''}
            placeholder="講師"
            onBlur={(e) => {
              onLocalPatch({ teacher_name: e.target.value || undefined });
              onSaveProgress({ teacher_name: e.target.value || null });
            }}
            className="w-full px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none"
          />
        </td>
      )}
    </tr>
  );
}

// ─────────────────────────────────────────────
// 進め方・宿題セクション
// ─────────────────────────────────────────────
function TextbookSettingsSection({
  textbookId,
  isMeeting,
  success,
  toastError,
}: {
  textbookId: string;
  isMeeting: boolean;
  success: (m: string) => void;
  toastError: (m: string) => void;
}) {
  // TODO: 既存の getStudentTextbookSettings で初期値取得・upsert で保存
  const save = async (patch: { approach?: string; homework_style?: string }) => {
    try {
      await upsertStudentTextbookSettings({ student_textbook_id: textbookId, ...patch });
    } catch (e) {
      console.error(e);
      toastError('保存に失敗しました');
    }
  };

  if (isMeeting) {
    // 面談モードでは読み取り専用（Phase 2 で実データ表示に）
    return null;
  }

  return (
    <div className="mb-4 bg-white border border-[#e5e7eb] rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1.5">進め方</label>
        <textarea
          className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded text-sm"
          rows={2}
          placeholder="例: ワーク→応用の順。間違えた問題は翌週再演習。"
          onBlur={(e) => save({ approach: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1.5">宿題の出し方</label>
        <textarea
          className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded text-sm"
          rows={2}
          placeholder="例: 次回範囲の予習 + 前回ワークの復習"
          onBlur={(e) => save({ homework_style: e.target.value })}
        />
      </div>
    </div>
  );
}
