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
import { ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import {
  getStudentTextbooks,
  getStudentProgress,
  createStudentTextbook,
  updateStudentTextbook,
  deleteStudentTextbook,
} from '@/lib/api/progress';
import StudentSessionFeed from '@/components/progress/StudentSessionFeed';
import { getStudent } from '@/lib/api/students';
import { getExamTypes, getTextbooks } from '@/lib/api/textbooks';
import { getActionGoalsByExams } from '@/lib/api/action-goals';
import { getExamRanges } from '@/lib/api/exam-ranges';
import type {
  Student,
  StudentTextbookWithDetails,
  CurriculumItemWithProgress,
  ExamType,
  ActionGoal,
  StudentTextbookExamRange,
  Textbook,
} from '@/types/database';
import { getSurname } from '@/lib/utils/teacherName';

import {
  categorizeSubject,
  gradeLabel,
  sortByOrder,
  type View,
  type ViewMode,
} from './newProgress.shared';
import { AddTextbookModal } from './AddTextbookModal';
import { EmptyState } from './EmptyState';
import { ModeSwitcher } from './ModeSwitcher';
import { ViewSwitcher } from './ViewSwitcher';
import { CardsView } from './CardsView';
import { TableView } from './TableView';

// ─────────────────────────────────────────────
// メインページ
// ─────────────────────────────────────────────
export default function NewProgressPage() {
  const params = useParams();
  const studentId = params?.studentId as string;
  const { toasts, removeToast, success, error: toastError, info: toastInfo } = useToast();
  const { profile, getSelectedSchoolIds, isLoading: authLoading } = useAuth();
  const isTeacher = profile?.role === 'teacher';

  // データ状態（既存ロジックを踏襲）
  const [student, setStudent] = useState<Student | null>(null);
  const [studentTextbooks, setStudentTextbooks] = useState<StudentTextbookWithDetails[]>([]);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [selectedTextbookId, setSelectedTextbookId] = useState<string | null>(null);
  const [progressData, setProgressData] = useState<CurriculumItemWithProgress[]>([]);
  /** 行動目標: key = student_textbook_exam_id, value = ActionGoal[] */
  const [actionGoalsByExam, setActionGoalsByExam] = useState<Record<string, ActionGoal[]>>({});
  /** 試験範囲: key = student_textbook_id, value = ExamRange[] （独立したテーブル） */
  const [examRangesByTextbook, setExamRangesByTextbook] = useState<
    Record<string, StudentTextbookExamRange[]>
  >({});
  const [isLoading, setIsLoading] = useState(true);

  // ビュー状態
  const [view, setView] = useState<View>('cards');
  const [viewMode, setViewMode] = useState<ViewMode>('admin');
  const effectiveViewMode: ViewMode = isTeacher ? 'admin' : viewMode;

  // テキスト追加モーダル
  const [isAddTextbookModalOpen, setIsAddTextbookModalOpen] = useState(false);
  const [allTextbooks, setAllTextbooks] = useState<Textbook[]>([]);
  const [addModalGradeCategory, setAddModalGradeCategory] = useState<
    'elementary' | 'middle' | 'high' | ''
  >('');
  const [addModalSubject, setAddModalSubject] = useState<string>('');
  const [addModalSearch, setAddModalSearch] = useState<string>('');

  // 初期ロード
  useEffect(() => {
    if (!studentId || authLoading) return;
    (async () => {
      setIsLoading(true);
      try {
        const schoolIds = getSelectedSchoolIds();
        // 生徒情報を先に取得（school_id を試験名マスタ取得に使うため）
        const [s, tbs] = await Promise.all([
          getStudent(studentId, schoolIds.length > 0 ? schoolIds : undefined),
          getStudentTextbooks(studentId),
        ]);
        // 生徒の所属教室の試験名マスタを取得
        const ets = await getExamTypes(s?.school_id ?? undefined);
        setStudent(s);
        // 進行表で管理しないものは除外（所持教材一覧では別途扱う）
        const baseTbs = (tbs || []).filter(
          (tb) => (tb as { track_progress?: boolean }).track_progress === true
        );
        const filteredTbs = isTeacher ? baseTbs.filter((tb) => !tb.is_draft) : baseTbs;
        setStudentTextbooks(filteredTbs);
        setExamTypes(ets || []);
        // 全教科書の active な目標設定の行動目標を一括取得
        const examIds: string[] = [];
        for (const tb of filteredTbs) {
          for (const e of tb.exams || []) if (e.id) examIds.push(e.id);
        }
        if (examIds.length > 0) {
          try {
            const map = await getActionGoalsByExams(examIds);
            setActionGoalsByExam(map);
          } catch {
            setActionGoalsByExam({});
          }
        }
        // 各教科書の試験範囲を並行取得（独立テーブル）
        try {
          const rangePairs = await Promise.all(
            filteredTbs.map(async (tb) => ({ id: tb.id, ranges: await getExamRanges(tb.id) }))
          );
          const rangeMap: Record<string, StudentTextbookExamRange[]> = {};
          for (const { id, ranges } of rangePairs) rangeMap[id] = ranges;
          setExamRangesByTextbook(rangeMap);
        } catch {
          setExamRangesByTextbook({});
        }
      } catch (e) {
        console.error(e);
        toastError('データの取得に失敗しました');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [studentId, isTeacher, toastError, authLoading, getSelectedSchoolIds]);

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

  // テキスト追加モーダルを開く時にテキスト一覧をロード
  const openAddTextbookModal = useCallback(
    async (presetSubject?: string) => {
      setAddModalSubject(presetSubject ?? '');
      setAddModalGradeCategory('');
      setAddModalSearch('');
      setIsAddTextbookModalOpen(true);
      if (allTextbooks.length === 0) {
        try {
          const list = await getTextbooks();
          setAllTextbooks(list || []);
        } catch (e) {
          console.error(e);
          toastError('テキスト一覧の取得に失敗しました');
        }
      }
    },
    [allTextbooks.length, toastError]
  );

  // 公開/非公開 切替（is_draft=true が講師に対して非公開）
  const handleTogglePublish = useCallback(
    async (textbookId: string) => {
      const tb = studentTextbooks.find((t) => t.id === textbookId);
      if (!tb) return;
      const next = !tb.is_draft;
      // 楽観更新
      setStudentTextbooks((prev) =>
        prev.map((t) => (t.id === textbookId ? { ...t, is_draft: next } : t))
      );
      try {
        await updateStudentTextbook(textbookId, { is_draft: next });
        success(next ? '講師に非公開にしました' : '講師に公開しました');
      } catch (e) {
        console.error(e);
        // ロールバック
        setStudentTextbooks((prev) =>
          prev.map((t) => (t.id === textbookId ? { ...t, is_draft: !next } : t))
        );
        toastError('公開状態の変更に失敗しました');
      }
    },
    [studentTextbooks, success, toastError]
  );

  // テキスト削除
  const handleDeleteTextbook = useCallback(
    async (textbookId: string) => {
      const tb = studentTextbooks.find((t) => t.id === textbookId);
      if (!tb) return;
      const name = tb.textbook?.name ?? 'テキスト';
      if (
        !window.confirm(
          `「${name}」の進行表を削除しますか？\n\n進行データ・テスト目標も削除されます（提案書は削除されず、リンクが外れて下書きとして残ります）。この操作は取り消せません。`
        )
      )
        return;
      try {
        await deleteStudentTextbook(textbookId);
        setStudentTextbooks((prev) => prev.filter((t) => t.id !== textbookId));
        if (selectedTextbookId === textbookId) {
          setSelectedTextbookId(null);
          setView('cards');
        }
        success(`「${name}」を削除しました`);
      } catch (e) {
        console.error(e);
        toastError('削除に失敗しました');
      }
    },
    [studentTextbooks, selectedTextbookId, success, toastError]
  );

  // テキスト追加実行
  const handleAddTextbook = useCallback(
    async (textbookId: number) => {
      if (!student) return;
      try {
        await createStudentTextbook({
          school_id: student.school_id,
          student_id: studentId,
          textbook_id: textbookId,
          is_active: true,
          track_progress: true,
        });
        const tbs = await getStudentTextbooks(studentId);
        const baseTbs = (tbs || []).filter(
          (tb) => (tb as { track_progress?: boolean }).track_progress === true
        );
        const filteredTbs = isTeacher ? baseTbs.filter((tb) => !tb.is_draft) : baseTbs;
        setStudentTextbooks(filteredTbs);
        setIsAddTextbookModalOpen(false);
        success('テキストを追加しました');
      } catch (e) {
        console.error(e);
        toastError(e instanceof Error ? e.message : 'テキストの追加に失敗しました');
      }
    },
    [student, studentId, isTeacher, success, toastError]
  );

  // テキスト一覧＋関連データを再取得（モーダル保存後にページ遷移せず反映するため）
  const refreshTextbooks = useCallback(async () => {
    try {
      const tbs = await getStudentTextbooks(studentId);
      const baseTbs = (tbs || []).filter(
        (tb) => (tb as { track_progress?: boolean }).track_progress === true
      );
      const filteredTbs = isTeacher ? baseTbs.filter((tb) => !tb.is_draft) : baseTbs;
      setStudentTextbooks(filteredTbs);
      // 行動目標も再取得
      const examIds: string[] = [];
      for (const tb of filteredTbs) {
        for (const e of tb.exams || []) if (e.id) examIds.push(e.id);
      }
      if (examIds.length > 0) {
        const map = await getActionGoalsByExams(examIds);
        setActionGoalsByExam(map);
      } else {
        setActionGoalsByExam({});
      }
      // 選択中テキストの進捗も再取得
      if (selectedTextbookId) {
        const rows = await getStudentProgress(selectedTextbookId);
        setProgressData(rows || []);
      }
    } catch (e) {
      console.error(e);
    }
  }, [studentId, isTeacher, selectedTextbookId]);

  // 並べ替え後の配列を sort_order へ正規化して永続化する（差分があるものだけ更新）。
  // 楽観更新してから保存し、失敗時はトーストのみ（次回取得時に実データへ揃う）。
  const persistReorder = useCallback(
    async (reordered: StudentTextbookWithDetails[]) => {
      const updates = reordered
        .map((t, i) => ({ id: t.id, order: i }))
        .filter(({ id, order }) => {
          const cur = studentTextbooks.find((x) => x.id === id)?.sort_order;
          return cur !== order;
        });
      if (updates.length === 0) return;

      setStudentTextbooks((prev) =>
        prev.map((t) => {
          const u = updates.find((x) => x.id === t.id);
          return u ? { ...t, sort_order: u.order } : t;
        })
      );

      try {
        await Promise.all(updates.map((u) => updateStudentTextbook(u.id, { sort_order: u.order })));
      } catch (e) {
        console.error(e);
        toastError('並べ替えの保存に失敗しました');
      }
    },
    [studentTextbooks, toastError]
  );

  // 同一科目グループ内で並び順を1つ入れ替え（▲▼ボタン用）
  const handleReorder = useCallback(
    async (textbookId: string, direction: 'up' | 'down') => {
      const target = studentTextbooks.find((t) => t.id === textbookId);
      if (!target) return;
      const group = categorizeSubject(target.textbook?.subject);
      const siblings = sortByOrder(
        studentTextbooks.filter((t) => categorizeSubject(t.textbook?.subject) === group)
      );
      const idx = siblings.findIndex((t) => t.id === textbookId);
      if (idx < 0) return;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= siblings.length) return;

      const reordered = [...siblings];
      [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
      await persistReorder(reordered);
    },
    [studentTextbooks, persistReorder]
  );

  // 同一科目グループ内でドラッグ&ドロップ並び替え（教室長以上のみ。TextbookCard/CardsView で権限ガード済み）。
  // 異なる科目グループ間のドロップは並び順の意味が無いため無視する。
  const handleReorderDrag = useCallback(
    async (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const from = studentTextbooks.find((t) => t.id === fromId);
      const to = studentTextbooks.find((t) => t.id === toId);
      if (!from || !to) return;
      const group = categorizeSubject(from.textbook?.subject);
      if (categorizeSubject(to.textbook?.subject) !== group) return;

      const siblings = sortByOrder(
        studentTextbooks.filter((t) => categorizeSubject(t.textbook?.subject) === group)
      );
      const fromIdx = siblings.findIndex((t) => t.id === fromId);
      const toIdx = siblings.findIndex((t) => t.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;

      const reordered = [...siblings];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      await persistReorder(reordered);
    },
    [studentTextbooks, persistReorder]
  );

  return (
    <AdminLayout headerTitle="進捗管理">
      {/* ヘッダ */}
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-[#6b7280]">生徒詳細 › 進捗管理</div>
          <h1 className="text-lg font-bold text-[#1f2937]">
            {student ? `${student.last_name} ${student.first_name}` : '—'}
            {student?.grade && (
              <span className="text-sm font-normal text-[#6b7280] ml-2">
                {gradeLabel(student.grade)}
              </span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* テスト対策・講習提案書はテーブルのツールバー側に配置（上部メニューには置かない） */}
          {!isTeacher && <ModeSwitcher mode={viewMode} onChange={setViewMode} />}
          <ViewSwitcher view={view} onChange={setView} />
        </div>
      </div>

      {/* 生徒ミニフィード（カードビュー時、教師以外） */}
      {!isTeacher && view === 'cards' && !isLoading && studentTextbooks.length > 0 && (
        <div className="mb-4">
          <StudentSessionFeed studentId={studentId} />
        </div>
      )}

      {isLoading ? (
        <Loading className="py-20" />
      ) : studentTextbooks.length === 0 ? (
        <EmptyState onAdd={!isTeacher ? () => openAddTextbookModal() : undefined} />
      ) : view === 'cards' ? (
        <CardsView
          textbooks={studentTextbooks}
          examTypes={examTypes}
          actionGoalsByExam={actionGoalsByExam}
          role={isTeacher ? 'teacher' : 'manager'}
          viewMode={effectiveViewMode}
          onSelect={openTextbook}
          onReorder={handleReorder}
          onReorderDrag={!isTeacher ? handleReorderDrag : undefined}
          onAddTextbook={!isTeacher ? openAddTextbookModal : undefined}
          onTogglePublish={!isTeacher ? handleTogglePublish : undefined}
          onDelete={!isTeacher ? handleDeleteTextbook : undefined}
        />
      ) : (
        selectedTb && (
          <TableView
            textbook={selectedTb}
            progress={progressData}
            setProgress={setProgressData}
            examTypes={examTypes}
            actionGoalsByExam={actionGoalsByExam}
            setActionGoalsByExam={setActionGoalsByExam}
            examRanges={examRangesByTextbook[selectedTb.id] ?? []}
            setExamRangesForTextbook={(ranges) =>
              setExamRangesByTextbook((prev) => ({ ...prev, [selectedTb.id]: ranges }))
            }
            textbookTabs={studentTextbooks}
            onSelectTab={setSelectedTextbookId}
            onTogglePublish={!isTeacher ? handleTogglePublish : undefined}
            role={isTeacher ? 'teacher' : 'manager'}
            viewMode={effectiveViewMode}
            studentId={studentId}
            studentName={student ? `${student.last_name} ${student.first_name}` : ''}
            selfName={isTeacher ? getSurname(profile) : (profile?.display_name ?? '')}
            onBack={() => setView('cards')}
            onRefresh={refreshTextbooks}
            success={success}
            toastError={toastError}
            toastInfo={toastInfo}
          />
        )
      )}

      {/* テキスト追加モーダル */}
      <AddTextbookModal
        isOpen={isAddTextbookModalOpen}
        onClose={() => setIsAddTextbookModalOpen(false)}
        allTextbooks={allTextbooks}
        studentTextbooks={studentTextbooks}
        gradeCategory={addModalGradeCategory}
        setGradeCategory={setAddModalGradeCategory}
        subject={addModalSubject}
        setSubject={setAddModalSubject}
        search={addModalSearch}
        setSearch={setAddModalSearch}
        onAdd={handleAddTextbook}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
