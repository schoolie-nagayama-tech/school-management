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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, FileText, Plus, RefreshCw, Send, Settings2, Trash2 } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Button, Modal, Select, ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import {
  getStudentTextbooks,
  getStudentProgress,
  updateStudentProgress,
  createStudentTextbook,
  updateStudentTextbook,
  upsertStudentProgress,
  upsertStudentProgressLesson,
  upsertStudentTextbookSettings,
  createStudentTextbookExam,
  updateStudentTextbookExam,
  deleteStudentTextbook,
  deleteStudentTextbookExam,
} from '@/lib/api/progress';
import SessionRecordingPanel from '@/components/progress/SessionRecordingPanel';
import type { SessionRecordingPanelHandle } from '@/components/progress/SessionRecordingPanel';
import StudentSessionFeed from '@/components/progress/StudentSessionFeed';
import { syncProgressToSession, submitDirectInput } from '@/lib/api/progress-sessions';
import { getStudent } from '@/lib/api/students';
import { getExamTypes, getTextbooks } from '@/lib/api/textbooks';
import {
  getActionGoalsByExams,
  createActionGoal,
  updateActionGoal,
  deleteActionGoal,
  copyActionGoalsFromExam,
} from '@/lib/api/action-goals';
import {
  getExamRanges,
  upsertExamRange,
  createExamRange,
  deleteExamRange,
} from '@/lib/api/exam-ranges';
import type {
  Student,
  StudentTextbookWithDetails,
  CurriculumItemWithProgress,
  ExamType,
  ActionGoal,
  StudentTextbookExamRange,
  StudentTextbookExamRangeInsert,
  Textbook,
} from '@/types/database';
import { getSurname, toSurnameOnly } from '@/lib/utils/teacherName';

// ─────────────────────────────────────────────
// 型
// ─────────────────────────────────────────────
type View = 'cards' | 'table';
type ViewMode = 'admin' | 'meeting';

/**
 * 指導意図のマスタ。教室長はグループ先頭行でこれを1つ選ぶだけ。
 * 面談モードの根拠文はここから自動生成される（自由記述は不要）。
 */
const INTENT_TAGS = [
  '苦手補強',
  '既習の定着',
  '未習の先取り',
  '学校進度に合わせる',
  '直前演習',
  '応用発展',
] as const;
type IntentTag = typeof INTENT_TAGS[number];

/** 指導意図チップの色（控えめ：文字色 + 境界線のみ。背景なし） */
const INTENT_TAG_COLOR: Record<IntentTag, string> = {
  '苦手補強': 'text-red-700 border-red-200',
  '既習の定着': 'text-blue-700 border-blue-200',
  '未習の先取り': 'text-purple-700 border-purple-200',
  '学校進度に合わせる': 'text-emerald-700 border-emerald-200',
  '直前演習': 'text-amber-700 border-amber-200',
  '応用発展': 'text-indigo-700 border-indigo-200',
};

/** タグから面談用の根拠文を自動生成 */
const _INTENT_TAG_RATIONALE: Record<IntentTag, string> = {
  '苦手補強': '過去のテストで失点が多い単元。重点的に演習を重ねて定着を図ります。',
  '既習の定着': '学校で学習済みの範囲。理解の確認と典型問題の再演習で得点源に。',
  '未習の先取り': '学校の進度より前倒しで学習。基礎定着から段階的に進めます。',
  '学校進度に合わせる': '学校の授業と並行して進めることで理解を定着させます。',
  '直前演習': '試験直前の総仕上げ。類題演習で取りこぼしを防ぎます。',
  '応用発展': '基礎が固まった単元の発展問題。得点力の底上げを狙います。',
};

function isIntentTag(v: unknown): v is IntentTag {
  return typeof v === 'string' && (INTENT_TAGS as readonly string[]).includes(v);
}

// ─────────────────────────────────────────────
// メインページ
// ─────────────────────────────────────────────
export default function NewProgressPage() {
  const params = useParams();
  const studentId = params?.studentId as string;
  const { toasts, removeToast, success, error: toastError } = useToast();
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
  const [examRangesByTextbook, setExamRangesByTextbook] = useState<Record<string, StudentTextbookExamRange[]>>({});
  const [isLoading, setIsLoading] = useState(true);

  // ビュー状態
  const [view, setView] = useState<View>('cards');
  const [viewMode, setViewMode] = useState<ViewMode>('admin');
  const effectiveViewMode: ViewMode = isTeacher ? 'admin' : viewMode;

  // テキスト追加モーダル
  const [isAddTextbookModalOpen, setIsAddTextbookModalOpen] = useState(false);
  const [allTextbooks, setAllTextbooks] = useState<Textbook[]>([]);
  const [addModalGradeCategory, setAddModalGradeCategory] = useState<'elementary' | 'middle' | 'high' | ''>('');
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
        const baseTbs = (tbs || []).filter((tb) => (tb as { track_progress?: boolean }).track_progress === true);
        const filteredTbs = isTeacher ? baseTbs.filter((tb) => !tb.is_draft) : baseTbs;
        setStudentTextbooks(filteredTbs);
        setExamTypes(ets || []);
        // 全教科書の active な目標設定の行動目標を一括取得
        const examIds: string[] = [];
        for (const tb of filteredTbs) {
          for (const e of (tb.exams || [])) if (e.id) examIds.push(e.id);
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
  const openAddTextbookModal = useCallback(async (presetSubject?: string) => {
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
  }, [allTextbooks.length, toastError]);

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
      if (!window.confirm(`「${name}」の進行表を削除しますか？\n\n進行データ・テスト目標・提案書も削除されます。この操作は取り消せません。`)) return;
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
        const baseTbs = (tbs || []).filter((tb) => (tb as { track_progress?: boolean }).track_progress === true);
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
      const baseTbs = (tbs || []).filter((tb) => (tb as { track_progress?: boolean }).track_progress === true);
      const filteredTbs = isTeacher ? baseTbs.filter((tb) => !tb.is_draft) : baseTbs;
      setStudentTextbooks(filteredTbs);
      // 行動目標も再取得
      const examIds: string[] = [];
      for (const tb of filteredTbs) {
        for (const e of (tb.exams || [])) if (e.id) examIds.push(e.id);
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

  // 同一科目グループ内で並び順を入れ替え、sort_order を永続化
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

      // 連番で正規化して差分があるものだけ更新
      const updates = reordered
        .map((t, i) => ({ id: t.id, order: i }))
        .filter(({ id, order }) => {
          const cur = studentTextbooks.find((x) => x.id === id)?.sort_order;
          return cur !== order;
        });

      // 楽観更新
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
          {!isTeacher && (
            <Link
              href={`/students/${studentId}/proposals`}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium border border-[#e5e7eb] text-[#4b5563] rounded-lg hover:bg-[#f3f4f6] active:scale-[0.97] transition-[colors,transform] duration-150"
            >
              <FileText className="w-3.5 h-3.5" />
              講習提案
            </Link>
          )}
          {!isTeacher && (
            <Link
              href={`/students/${studentId}/test-prep`}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium border border-[#e5e7eb] text-[#4b5563] rounded-lg hover:bg-[#f3f4f6] active:scale-[0.97] transition-[colors,transform] duration-150"
            >
              <FileText className="w-3.5 h-3.5" />
              テスト対策
            </Link>
          )}
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

// ─────────────────────────────────────────────
// テキスト追加モーダル
// ─────────────────────────────────────────────
function AddTextbookModal({
  isOpen,
  onClose,
  allTextbooks,
  studentTextbooks,
  gradeCategory,
  setGradeCategory,
  subject,
  setSubject,
  search,
  setSearch,
  onAdd,
}: {
  isOpen: boolean;
  onClose: () => void;
  allTextbooks: Textbook[];
  studentTextbooks: StudentTextbookWithDetails[];
  gradeCategory: 'elementary' | 'middle' | 'high' | '';
  setGradeCategory: (v: 'elementary' | 'middle' | 'high' | '') => void;
  subject: string;
  setSubject: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  onAdd: (textbookId: number) => void;
}) {
  const availableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    allTextbooks.forEach((tb) => tb.subject && subjects.add(tb.subject));
    return Array.from(subjects).sort();
  }, [allTextbooks]);

  const filtered = useMemo(() => {
    const existing = new Set(studentTextbooks.map((st) => st.textbook_id));
    return allTextbooks.filter((tb) => {
      if (existing.has(tb.id)) return false;
      if (gradeCategory && tb.grade_category !== gradeCategory) return false;
      if (subject && tb.subject !== subject) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${tb.name} ${tb.publisher ?? ''} ${tb.subject ?? ''} ${tb.grade ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allTextbooks, studentTextbooks, gradeCategory, subject, search]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="テキストを追加" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select
            label="学年カテゴリ"
            value={gradeCategory}
            onChange={(e) => {
              setGradeCategory(e.target.value as 'elementary' | 'middle' | 'high' | '');
            }}
            options={[
              { value: '', label: 'すべて' },
              { value: 'elementary', label: '小学生' },
              { value: 'middle', label: '中学生' },
              { value: 'high', label: '高校生' },
            ]}
          />
          <Select
            label="科目"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            options={[
              { value: '', label: 'すべて' },
              ...availableSubjects.map((s) => ({ value: s, label: s })),
            ]}
          />
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">検索</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="テキスト名・出版社"
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="border-t border-[#e5e7eb] pt-3">
          <div className="text-xs text-[#6b7280] mb-2">{filtered.length} 件</div>
          {filtered.length === 0 ? (
            <p className="text-sm text-[#4b5563] py-6 text-center">条件に一致するテキストがありません</p>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-2">
              {filtered.map((tb) => (
                <div
                  key={tb.id}
                  className="p-3 bg-[#f9fafb] rounded-lg border border-[#e5e7eb] hover:bg-[#f3f4f6] flex items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[#1f2937] truncate">{tb.name}</div>
                    <div className="text-xs text-[#6b7280] mt-0.5">
                      {tb.publisher && <span>{tb.publisher}</span>}
                      {tb.subject && <span className={tb.publisher ? ' ml-2' : ''}>{tb.subject}</span>}
                      {tb.grade && <span className="ml-2">{tb.grade}</span>}
                      {tb.grade_category && (
                        <span className="ml-2">
                          {tb.grade_category === 'elementary'
                            ? '小'
                            : tb.grade_category === 'middle'
                            ? '中'
                            : '高'}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button onClick={() => onAdd(tb.id)} variant="primary" size="sm">
                    追加
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
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

type LessonLike = { lesson_date?: string | null };
type CurriculumItemLike = { lessons?: LessonLike[] };
type TextbookWithItems = StudentTextbookWithDetails & { curriculum_items?: CurriculumItemLike[] };

// 停滞判定（最終授業日から14日経過）
function isStalled(tb: StudentTextbookWithDetails): { stalled: boolean; lastDate: string | null } {
  let last: string | null = null;
  const items = (tb as TextbookWithItems).curriculum_items || [];
  const lessons = items.flatMap((ci) => ci.lessons || []);
  for (const l of lessons) {
    if (l.lesson_date && (!last || l.lesson_date > last)) last = l.lesson_date;
  }
  if (!last) return { stalled: false, lastDate: null };
  const days = daysLeftOf(last);
  return { stalled: days !== null && days < -14, lastDate: last };
}

function progressStats(tb: StudentTextbookWithDetails): { total: number; done: number } {
  const items = (tb as TextbookWithItems).curriculum_items || [];
  const total = items.length;
  const done = items.filter((ci) => (ci.lessons || []).some((l) => l.lesson_date)).length;
  return { total, done };
}

// item_number は DB から文字列で返る場合があるため number に正規化
function itemNo(row: { item_number?: number | string | null }): number | null {
  const v = row?.item_number;
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// 科目を5列（国語/数学/英語/理科/社会）+ その他にカテゴリ分け
const SUBJECT_COLUMNS = ['国語', '数学', '英語', '理科', '社会'] as const;
type SubjectColumn = typeof SUBJECT_COLUMNS[number] | 'その他';

const SUBJECT_COLOR: Record<SubjectColumn, { bg: string; text: string; accent: string }> = {
  '国語': { bg: 'bg-rose-50', text: 'text-rose-800', accent: 'border-rose-300' },
  '数学': { bg: 'bg-blue-50', text: 'text-blue-800', accent: 'border-blue-300' },
  '英語': { bg: 'bg-emerald-50', text: 'text-emerald-800', accent: 'border-emerald-300' },
  '理科': { bg: 'bg-purple-50', text: 'text-purple-800', accent: 'border-purple-300' },
  '社会': { bg: 'bg-amber-50', text: 'text-amber-800', accent: 'border-amber-300' },
  'その他': { bg: 'bg-gray-50', text: 'text-gray-700', accent: 'border-gray-300' },
};

function categorizeSubject(subject: string | null | undefined): SubjectColumn {
  if (!subject) return 'その他';
  const s = String(subject).trim();
  if (/国語|現代文|古文|漢文|古典/.test(s)) return '国語';
  if (/数学|算数/.test(s)) return '数学';
  if (/英語|English/i.test(s)) return '英語';
  if (/理科|物理|化学|生物|地学/.test(s)) return '理科';
  if (/社会|歴史|地理|公民|日本史|世界史|政経|倫理/.test(s)) return '社会';
  return 'その他';
}

function sortByOrder(list: StudentTextbookWithDetails[]): StudentTextbookWithDetails[] {
  return [...list].sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.created_at ?? '').localeCompare(b.created_at ?? '');
  });
}

function activeExamOf(
  tb: StudentTextbookWithDetails,
  examTypes: ExamType[] = []
): {
  id: string;
  exam_type_id: string | null;
  name: string;
  date: string | null;
  daysLeft: number | null;
  targetScore: number | null;
} | null {
  const exams = tb.exams || [];
  if (exams.length === 0) return null;
  const future = exams
    .filter((e) => e.exam_date)
    .map((e) => ({ e, dl: daysLeftOf(e.exam_date) ?? -9999 }))
    .filter((x) => x.dl >= 0)
    .sort((a, b) => a.dl - b.dl);
  const pick = future[0]?.e ?? exams[0];
  const etName = examTypes.find((t) => t.id === pick.exam_type_id)?.name;
  return {
    id: pick.id,
    exam_type_id: pick.exam_type_id ?? null,
    name: etName || pick.custom_exam_name || '目標設定',
    date: pick.exam_date,
    daysLeft: daysLeftOf(pick.exam_date),
    targetScore: pick.target_score,
  };
}

// ─────────────────────────────────────────────
// 空状態
// ─────────────────────────────────────────────
function EmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="bg-white border border-dashed border-[#e5e7eb] rounded-xl p-12 text-center">
      <p className="text-sm text-[#6b7280] mb-4">登録されているテキストがありません。</p>
      {onAdd && (
        <button
          onClick={onAdd}
          className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm hover:bg-[#2a4d7a]"
        >
          + テキストを追加
        </button>
      )}
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
          className={`px-2.5 py-1.5 transition-[background-color,color] duration-150 ease-out ${
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
          className={`px-3 py-1.5 transition-[background-color,color] duration-150 ease-out ${
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
  examTypes,
  actionGoalsByExam,
  role,
  viewMode,
  onSelect,
  onReorder,
  onAddTextbook,
  onTogglePublish,
  onDelete,
}: {
  textbooks: StudentTextbookWithDetails[];
  examTypes: ExamType[];
  actionGoalsByExam: Record<string, ActionGoal[]>;
  role: 'teacher' | 'manager';
  viewMode: ViewMode;
  onSelect: (id: string) => void;
  onReorder: (id: string, direction: 'up' | 'down') => void;
  onAddTextbook?: (presetSubject?: string) => void;
  onTogglePublish?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const isMeeting = viewMode === 'meeting';

  // 科目ごとにグループ化
  const groups = useMemo(() => {
    const map: Record<SubjectColumn, StudentTextbookWithDetails[]> = {
      '国語': [], '数学': [], '英語': [], '理科': [], '社会': [], 'その他': [],
    };
    for (const tb of textbooks) {
      map[categorizeSubject(tb.textbook?.subject)].push(tb);
    }
    for (const k of Object.keys(map) as SubjectColumn[]) {
      map[k] = sortByOrder(map[k]);
    }
    return map;
  }, [textbooks]);

  const hasOther = groups['その他'].length > 0;
  const allColumns: SubjectColumn[] = hasOther ? [...SUBJECT_COLUMNS, 'その他'] : [...SUBJECT_COLUMNS];
  // 空の科目列は非表示
  const columns = allColumns.filter((c) => groups[c].length > 0);
  const colCount = columns.length;
  const colGridClass =
    colCount <= 1 ? 'md:grid-cols-1' :
    colCount === 2 ? 'md:grid-cols-2' :
    colCount === 3 ? 'md:grid-cols-3' :
    colCount === 4 ? 'md:grid-cols-4' :
    colCount === 5 ? 'md:grid-cols-5' :
    'md:grid-cols-6';

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-[#1f2937]">
            {isMeeting ? '面談用表示（保護者提示）' : 'テキスト一覧'}
          </h2>
          <p className="text-xs text-[#6b7280] mt-0.5">
            {isMeeting
              ? '保護者面談で画面共有 / PDF配布するためのプレゼンビュー'
              : '科目別表示 / カードをクリックで詳細テーブルへ / ▲▼で並べ替え'}
          </p>
        </div>
        {onAddTextbook && !isMeeting && (
          <button
            onClick={() => onAddTextbook()}
            className="px-3 py-1.5 bg-[#1e3a5f] text-white rounded-lg text-sm hover:bg-[#2a4d7a]"
          >
            + テキスト追加
          </button>
        )}
      </div>
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 ${colGridClass}`}>
        {columns.map((col) => {
          const tint = SUBJECT_COLOR[col];
          const items = groups[col];
          return (
            <div key={col} className="flex flex-col gap-2">
              <div className={`${tint.bg} ${tint.accent} border rounded-lg px-2 py-2 text-center sticky top-0`}>
                <div className={`${tint.text} text-lg font-bold leading-tight`}>{col}</div>
                <div className="text-[11px] text-[#6b7280] mt-0.5">{items.length} 冊</div>
              </div>
              {items.map((tb, i) => {
                  const ae = activeExamOf(tb, examTypes);
                  const goals = ae ? actionGoalsByExam[ae.id] ?? [] : [];
                  return (
                    <TextbookCard
                      key={tb.id}
                      textbook={tb}
                      subjectColumn={col}
                      activeExam={ae}
                      actionGoals={goals}
                      role={role}
                      isMeeting={isMeeting}
                      onOpen={() => onSelect(tb.id)}
                      canMoveUp={i > 0}
                      canMoveDown={i < items.length - 1}
                      onReorder={(dir) => onReorder(tb.id, dir)}
                      onTogglePublish={onTogglePublish ? () => onTogglePublish(tb.id) : undefined}
                      onDelete={onDelete ? () => onDelete(tb.id) : undefined}
                    />
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TextbookCard({
  textbook,
  subjectColumn,
  activeExam,
  actionGoals,
  role: _role,
  isMeeting: _isMeeting,
  onOpen,
  canMoveUp,
  canMoveDown,
  onReorder,
  onTogglePublish,
  onDelete,
}: {
  textbook: StudentTextbookWithDetails;
  subjectColumn: SubjectColumn;
  activeExam: { id: string; exam_type_id: string | null; name: string; date: string | null; daysLeft: number | null; targetScore: number | null } | null;
  actionGoals: ActionGoal[];
  role: 'teacher' | 'manager';
  isMeeting: boolean;
  onOpen: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onReorder: (dir: 'up' | 'down') => void;
  onTogglePublish?: () => void;
  onDelete?: () => void;
}) {
  const { stalled } = isStalled(textbook);
  const { total, done } = progressStats(textbook);
  const season = seasonLabel(textbook.season);
  const achievedCount = actionGoals.filter((g) => g.achieved).length;
  const tint = SUBJECT_COLOR[subjectColumn];

  const seasonColor =
    textbook.season === 'spring' ? 'border-l-[#f472b6]'
      : textbook.season === 'summer' ? 'border-l-[#fbbf24]'
      : textbook.season === 'winter' ? 'border-l-[#60a5fa]'
      : 'border-l-transparent';

  return (
    <div
      onClick={onOpen}
      className={`bg-white rounded-lg border border-l-4 ${seasonColor} ${stalled ? 'border-amber-300' : 'border-[#e5e7eb]'} ${textbook.is_draft ? 'opacity-70 bg-[#fafafa]' : ''} p-2 shadow-sm hover:shadow-md transition-[box-shadow] duration-150 ease-out cursor-pointer text-xs`}
    >
      {/* 並べ替えボタン（右上） */}
      <div className="flex items-start justify-between gap-1 mb-1">
        <div className={`text-[11px] font-bold ${tint.text}`}>{subjectColumn}</div>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="w-5 h-5 rounded border border-[#e5e7eb] bg-white text-[#9ca3af] hover:text-red-500 hover:border-red-300 hover:bg-red-50 flex items-center justify-center transition-[background-color,color,border-color] duration-150 ease-out active:scale-[0.97]"
              title="削除"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
          {onTogglePublish && (
            <button
              type="button"
              onClick={onTogglePublish}
              className={`w-5 h-5 rounded border leading-none flex items-center justify-center ${
                textbook.is_draft
                  ? 'bg-gray-200 border-gray-400 text-gray-600 hover:bg-gray-300'
                  : 'bg-white border-[#e5e7eb] text-[#1e40af] hover:bg-[#eff6ff]'
              }`}
              title={textbook.is_draft ? '講師に非公開（クリックで公開）' : '講師に公開中（クリックで非公開）'}
            >
              {textbook.is_draft ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          )}
          <button
            type="button"
            disabled={!canMoveUp}
            onClick={() => onReorder('up')}
            className="w-5 h-5 rounded border border-[#e5e7eb] bg-white text-[11px] text-[#6b7280] hover:bg-[#f3f4f6] disabled:opacity-30 disabled:hover:bg-white"
            title="上へ"
          >
            ▲
          </button>
          <button
            type="button"
            disabled={!canMoveDown}
            onClick={() => onReorder('down')}
            className="w-5 h-5 rounded border border-[#e5e7eb] bg-white text-[11px] text-[#6b7280] hover:bg-[#f3f4f6] disabled:opacity-30 disabled:hover:bg-white"
            title="下へ"
          >
            ▼
          </button>
        </div>
      </div>

      {/* タイトル行 */}
      <h3 className="font-semibold text-[#1f2937] text-[13px] leading-tight mb-1 line-clamp-2 break-words">
        {textbook.textbook?.name ?? '教科書'}
      </h3>

      {/* バッジ（学年 / 季節 / 非公開） */}
      <div className="flex items-center gap-1 mb-1.5 flex-wrap">
        {textbook.textbook?.grade && (
          <span className={`text-xs px-2 py-0.5 rounded-md ${tint.bg} ${tint.text} font-bold border ${tint.accent}`}>
            {textbook.textbook.grade}
          </span>
        )}
        {season && (
          <span
            className={`text-xs px-2 py-0.5 rounded-md font-bold border ${
              textbook.season === 'spring' ? 'bg-pink-100 text-pink-800 border-pink-300'
                : textbook.season === 'summer' ? 'bg-orange-100 text-orange-800 border-orange-300'
                : 'bg-sky-100 text-sky-800 border-sky-300'
            }`}
          >
            {season}
          </span>
        )}
        {textbook.is_draft && <span className="text-[11px] px-1.5 py-0.5 bg-gray-200 text-gray-700 rounded font-bold border border-gray-400">非公開</span>}
      </div>

      {/* 目標設定（コンパクト） */}
      {activeExam ? (
        <div className="mb-1.5 p-1.5 bg-gradient-to-br from-[#eff6ff] to-[#dbeafe]/50 border border-[#1e40af]/20 rounded">
          <div className="text-[11px] font-semibold text-[#1e3a5f] truncate mb-0.5">{activeExam.name}</div>
          <div className="flex items-center justify-between gap-1 text-[11px] text-[#1e3a5f]">
            <span>
              残<strong className="text-sm font-bold ml-0.5">{activeExam.daysLeft ?? '—'}</strong>日
            </span>
            <span>
              目標<strong className="text-sm font-bold ml-0.5">{activeExam.targetScore ?? '—'}</strong>
            </span>
            <span>
              行動<strong className="text-sm font-bold ml-0.5">{achievedCount}</strong>/{actionGoals.length}
            </span>
          </div>
        </div>
      ) : (
        <div className="mb-1.5 px-1.5 py-1.5 bg-amber-50 border border-amber-300 rounded text-[11px] text-amber-700 text-center font-medium">
          目標未設定
        </div>
      )}

      {stalled && (
        <div className="mb-1 px-1.5 py-0.5 bg-amber-50 text-amber-800 text-[11px] rounded border border-amber-200 text-center">
          直近進捗なし
        </div>
      )}

      {/* 進捗サマリー */}
      <div className="text-[11px] text-[#6b7280] text-center">
        学習済み {done}/{total}
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
  actionGoalsByExam,
  setActionGoalsByExam,
  examRanges,
  setExamRangesForTextbook,
  textbookTabs,
  onSelectTab,
  role,
  viewMode,
  studentId,
  studentName,
  selfName,
  onBack,
  onRefresh,
  success,
  toastError,
  onTogglePublish,
}: {
  textbook: StudentTextbookWithDetails;
  progress: CurriculumItemWithProgress[];
  setProgress: React.Dispatch<React.SetStateAction<CurriculumItemWithProgress[]>>;
  examTypes: ExamType[];
  actionGoalsByExam: Record<string, ActionGoal[]>;
  setActionGoalsByExam: React.Dispatch<React.SetStateAction<Record<string, ActionGoal[]>>>;
  examRanges: StudentTextbookExamRange[];
  setExamRangesForTextbook: (ranges: StudentTextbookExamRange[]) => void;
  textbookTabs: StudentTextbookWithDetails[];
  onSelectTab: (id: string) => void;
  role: 'teacher' | 'manager';
  viewMode: ViewMode;
  studentId: string;
  studentName: string;
  selfName: string;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  success: (m: string) => void;
  toastError: (m: string) => void;
  onTogglePublish?: (id: string) => void;
}) {
  const isMeeting = viewMode === 'meeting';
  const activeExam = activeExamOf(textbook, examTypes);
  const activeExamGoals = activeExam ? actionGoalsByExam[activeExam.id] ?? [] : [];
  // 目標設定編集モーダル
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [goalModalEditingId, setGoalModalEditingId] = useState<string | null>(null);
  const [rangeModalOpen, setRangeModalOpen] = useState(false);
  /** 編集中の試験範囲 (rangeId) と対象試験 (examTypeId)。新規の場合は rangeId=null */
  const [rangeModalEditing, setRangeModalEditing] = useState<{ rangeId: string | null; examTypeId: string | null }>({ rangeId: null, examTypeId: null });

  // 列可視化: 管理モード / 面談モード共通の1つの設定として保存。
  // 申込・引継ぎ・講師名は面談モードでは列設定に関係なく常時非表示（内部情報のため）。
  type MeetingCol = 'proposal' | 'application' | 'examRange' | 'schoolProgress' | 'lesson1' | 'lesson2' | 'lesson3' | 'handover' | 'homeworkNotDone' | 'tardy' | 'teacherName';
  const colsKey = `progress-cols:${studentId}:${textbook.id}`;
  // デフォルトは「試験範囲・学校進度・1回目・2回目・引継ぎ・宿題未・遅刻・講師名」を表示
  // 提案コマ数／申込コマ数／3回目はデフォルトでは非表示
  const DEFAULT_COLS: Record<MeetingCol, boolean> = {
    proposal: false, application: true, examRange: true, schoolProgress: true,
    lesson1: true, lesson2: true, lesson3: false, handover: true,
    homeworkNotDone: true, tardy: true, teacherName: true,
  };
  const [meetingCols, setMeetingCols] = useState<Record<MeetingCol, boolean>>(DEFAULT_COLS);
  const [colMenuOpen, setColMenuOpen] = useState(false);

  // ESC で列設定ドロップダウンを閉じる
  useEffect(() => {
    if (!colMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [colMenuOpen]);

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

  // メニュー選択肢: 全9列（管理モードで設定・面談モードにも反映）
  const colOptions: { key: MeetingCol; label: string; meetingOnlyHidden?: boolean }[] = [
    { key: 'proposal', label: '提案コマ数' },
    { key: 'application', label: '申込コマ数', meetingOnlyHidden: true },
    { key: 'examRange', label: '試験範囲' },
    { key: 'schoolProgress', label: '学校進度' },
    { key: 'lesson1', label: '1回目' },
    { key: 'lesson2', label: '2回目' },
    { key: 'lesson3', label: '3回目' },
    { key: 'handover', label: '引継ぎ', meetingOnlyHidden: true },
    { key: 'homeworkNotDone', label: '宿題未実施', meetingOnlyHidden: true },
    { key: 'tardy', label: '遅刻', meetingOnlyHidden: true },
    { key: 'teacherName', label: '講師名', meetingOnlyHidden: true },
  ];
  const hiddenColCount = colOptions.filter((o) => !meetingCols[o.key]).length;

  // ─── 一括塗りモード ───
  // 試験範囲 or 指導意図を範囲選択で一括適用する UI
  type PaintMode = null | 'examRange' | 'intent';
  const [paintMode, setPaintMode] = useState<PaintMode>(null);
  const [paintValue, setPaintValue] = useState<string>('');
  // 開始位置は row.id で持つ（item_number が無い行も選択可能にするため）
  const [paintStart, setPaintStart] = useState<string | null>(null);

  useEffect(() => {
    // モード / 値変更時は開始位置をリセット
    setPaintStart(null);
  }, [paintMode, paintValue]);

  // 一括塗りを適用: progress 配列のインデックス [lo..hi] の行に paintValue を設定
  const applyPaint = useCallback(async (startRowId: string, endRowId: string) => {
    if (!paintMode || !paintValue) return;
    const sIdx = progress.findIndex((r) => String(r.id) === startRowId);
    const eIdx = progress.findIndex((r) => String(r.id) === endRowId);
    if (sIdx < 0 || eIdx < 0) return;
    const lo = Math.min(sIdx, eIdx);
    const hi = Math.max(sIdx, eIdx);
    const sliceIds = new Set(progress.slice(lo, hi + 1).map((r) => String(r.id)));
    try {
      if (paintMode === 'examRange') {
        // 独立テーブル登録用: スライスの中で item_number を持つ行から min/max を算出
        const nums = progress
          .slice(lo, hi + 1)
          .map((r) => itemNo(r))
          .filter((n): n is number => n != null);
        if (nums.length > 0) {
          const loN = Math.min(...nums);
          const hiN = Math.max(...nums);
          // 新規セグメントとして追加（複数区間対応: 既存セグメントは保持）
          await createExamRange({
            student_textbook_id: textbook.id,
            exam_type_id: paintValue,
            range_start_item_number: loN,
            range_end_item_number: hiN,
          });
        }
        // per-row 同期: スライス内は付与のみ。スライス外は他セグメントを保護するため解除しない
        await Promise.all(
          progress.map(async (row) => {
            const inSlice = sliceIds.has(String(row.id));
            if (!inSlice) return;
            const hasThis = row.progress?.exam_range_exam_type_id === paintValue;
            if (hasThis) return;
            if (row.progress?.id) {
              await updateStudentProgress(row.progress.id, { exam_range_exam_type_id: paintValue });
            } else {
              await upsertStudentProgress({
                student_textbook_id: textbook.id,
                curriculum_item_id: row.id,
                exam_range_exam_type_id: paintValue,
              });
            }
          })
        );
        const newRanges = await getExamRanges(textbook.id);
        setExamRangesForTextbook(newRanges);
      } else if (paintMode === 'intent') {
        await Promise.all(
          progress.slice(lo, hi + 1).map(async (row) => {
            if (row.progress?.id) {
              await updateStudentProgress(row.progress.id, { intent_tag: paintValue });
            } else {
              await upsertStudentProgress({
                student_textbook_id: textbook.id,
                curriculum_item_id: row.id,
                intent_tag: paintValue,
              });
            }
          })
        );
      }
      // progress 再取得
      const rows = await getStudentProgress(textbook.id);
      setProgress(rows || []);
      success(`${hi - lo + 1}件に一括適用しました`);
      // 適用後は自動でモードを解除
      setPaintMode(null);
      setPaintValue('');
      setPaintStart(null);
    } catch (e) {
      console.error(e);
      toastError('一括適用に失敗しました');
      setPaintStart(null);
    }
  }, [paintMode, paintValue, progress, textbook.id, setProgress, setExamRangesForTextbook, success, toastError]);

  // 行クリック時: paint モード中なら開始→終了の2クリックで適用
  const handlePaintRowClick = useCallback((rowId: string) => {
    if (!paintMode || !paintValue) return false;
    if (paintStart == null) {
      setPaintStart(rowId);
    } else {
      applyPaint(paintStart, rowId);
    }
    return true;
  }, [paintMode, paintValue, paintStart, applyPaint]);

  // ─── セッション記録モード（新UI）───
  const [sessionMode, setSessionMode] = useState(false);
  const sessionPanelRef = useRef<SessionRecordingPanelHandle | null>(null);
  // セッション選択状態（テーブル行ハイライト用）
  const [sessionSelection, setSessionSelection] = useState<{
    unitActions: Record<number, 1 | 2 | 3>;
    schoolUnits: Set<number>;
  } | null>(null);

  // セッション保存後にデータ再読込
  const handleSessionSaved = useCallback(async () => {
    try {
      const rows = await getStudentProgress(textbook.id);
      setProgress(rows || []);
      success('セッションを保存しました');
    } catch {
      // noop
    }
  }, [textbook.id, setProgress, success]);

  // ─── 直接入力 dirty tracking（提出ボタン用） ───
  // セッション記録モード以外で編集された行を追跡
  const [dirtyRows, setDirtyRows] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  // 編集してから提出せず長時間放置されたら true に。ボタンをパルスで注意喚起。
  const [idleAlert, setIdleAlert] = useState(false);

  // テキスト切替時に dirty をリセット
  useEffect(() => { setDirtyRows(new Set()); setIdleAlert(false); }, [textbook.id]);

  const markDirty = useCallback((rowId: string) => {
    if (sessionMode) return; // セッション記録モード中は追跡しない
    setIdleAlert(false); // 編集が入ったらアラートを解除
    setDirtyRows(prev => {
      if (prev.has(rowId)) return prev;
      const next = new Set(prev);
      next.add(rowId);
      return next;
    });
  }, [sessionMode]);

  // 編集が1件以上ある状態で 1時間 (3,600,000ms) 提出されなかったら idleAlert を立てる。
  // markDirty で再編集された場合は idleAlert=false に戻り、タイマーも貼り直し。
  useEffect(() => {
    if (dirtyRows.size === 0) {
      setIdleAlert(false);
      return;
    }
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const timer = setTimeout(() => setIdleAlert(true), ONE_HOUR_MS);
    return () => clearTimeout(timer);
  }, [dirtyRows]);

  // 提出: 直接入力からセッションを生成
  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      const result = await submitDirectInput({
        studentTextbookId: textbook.id,
        teacherName: selfName,
        teacherId: null,
      });
      if (result) {
        success(`${result.linkedCount}件の指導記録を提出しました`);
        setDirtyRows(new Set());
        setIdleAlert(false);
        const rows = await getStudentProgress(textbook.id);
        setProgress(rows || []);
      } else {
        toastError('提出対象の指導記録がありません（指導日を入力してください）');
      }
    } catch (e) {
      console.error(e);
      toastError('提出に失敗しました');
    } finally {
      setSubmitting(false);
    }
  }, [textbook.id, selfName, setProgress, success, toastError]);

  // 編集ハンドラ（既存API呼出し、楽観的更新）
  // progress が null の場合も shell を作って UI を即反映できるようにする
  const updateLocal = (itemId: string, patch: Partial<CurriculumItemWithProgress['progress']>) => {
    setProgress(
      progress.map((row) =>
        String(row.id) === itemId
          ? {
              ...row,
              progress: row.progress
                ? { ...row.progress, ...patch }
                : ({ ...(patch as object), curriculum_item_id: row.id } as unknown as CurriculumItemWithProgress['progress']),
            }
          : row
      )
    );
  };

  const saveProgressField = useCallback(
    async (row: CurriculumItemWithProgress, patch: Record<string, unknown>) => {
      try {
        let saved;
        if (row.progress?.id) {
          saved = await updateStudentProgress(row.progress.id, patch);
        } else {
          saved = await upsertStudentProgress({
            student_textbook_id: textbook.id,
            curriculum_item_id: row.id,
            ...patch,
          });
        }
        // 保存結果を local state に反映（id や null→record への昇格を確定させる）
        if (saved) {
          setProgress((prev: CurriculumItemWithProgress[]) => prev.map((r) =>
            r.id === row.id
              ? { ...r, progress: { ...(r.progress || {}), ...(saved as object) } as CurriculumItemWithProgress['progress'] }
              : r
          ));
        }
        // セッション共有フィールドが変更されたら progress_sessions にも同期（フィード反映）
        const progressId = row.progress?.id || (saved as { id?: string })?.id;
        if (progressId) {
          syncProgressToSession(progressId, patch).catch(console.error);
        }
        markDirty(String(row.id));
      } catch (e) {
        console.error(e);
        toastError('保存に失敗しました');
      }
    },
    [textbook.id, toastError, setProgress, markDirty]
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
        markDirty(String(row.id));
      } catch (e) {
        console.error(e);
        toastError('指導日の保存に失敗しました');
      }
    },
    [toastError, markDirty]
  );

  return (
    <div>
      {/* ヘッダ */}
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={onBack} className="text-sm text-[#4b5563] hover:text-[#1f2937]">← テキスト一覧</button>
          <h2 className="text-base font-semibold text-[#1f2937]">{textbook.textbook?.name ?? '教科書'}</h2>
          {textbook.is_draft && (
            <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded text-[11px] font-bold border border-gray-400">
              非公開
            </span>
          )}
          {isMeeting && (
            <span className="px-2 py-0.5 bg-[#fef3c7] text-[#92400e] rounded-full text-[11px] font-semibold uppercase tracking-wider">
              面談用・プラン表示
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onTogglePublish && !isMeeting && (
            <button
              onClick={() => onTogglePublish(textbook.id)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-[background-color,color,border-color] duration-150 ease-out active:scale-[0.97] inline-flex items-center gap-1.5 ${
                textbook.is_draft
                  ? 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200'
                  : 'bg-white text-[#1e40af] border-[#bfdbfe] hover:bg-[#eff6ff]'
              }`}
              title={textbook.is_draft ? '講師に公開する' : '講師に非公開にする'}
            >
              {textbook.is_draft ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {textbook.is_draft ? '講師非公開中' : '講師に公開中'}
            </button>
          )}
          {/* 列設定ドロップダウン（面談/通常 両モードで使用可能） */}
          <div className="relative">
            <button
              onClick={() => setColMenuOpen((v) => !v)}
              aria-expanded={colMenuOpen}
              aria-haspopup="menu"
              aria-label={`列設定${hiddenColCount > 0 ? `（${hiddenColCount}列非表示中）` : ''}`}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-800 active:scale-[0.97] transition-[background-color,transform,color] duration-150 ease-out flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e3a5f]/40"
            >
              <Settings2 className="w-3.5 h-3.5" />
              列設定
              {hiddenColCount > 0 && (
                <span className="px-1 py-0.5 text-[11px] bg-gray-200 text-gray-700 rounded font-medium">{hiddenColCount}</span>
              )}
            </button>
            {colMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setColMenuOpen(false)} />
                <div role="menu" className="dropdown-enter absolute right-0 top-full mt-1 w-56 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-40 overflow-hidden">
                  <div className="px-3 py-2 text-[11px] text-[#6b7280] uppercase tracking-wider border-b border-[#f3f4f6] bg-[#f9fafb] flex items-center justify-between">
                    <span>{isMeeting ? '保護者に見せる列を選択' : '表示する列を選択'}</span>
                    {hiddenColCount > 0 && (
                      <button onClick={resetCols} className="text-[11px] text-[#1e40af] hover:underline normal-case">
                        全表示
                      </button>
                    )}
                  </div>
                  {colOptions.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#f9fafb] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={meetingCols[c.key]}
                        onChange={() => toggleCol(c.key)}
                        className="w-4 h-4 accent-[#1e3a5f]"
                      />
                      <span className={meetingCols[c.key] ? 'text-[#1f2937]' : 'text-[#9ca3af]'}>
                        {c.label}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          {!isMeeting && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setSessionMode((v) => { if (v) setSessionSelection(null); return !v; }); }}
                disabled={!activeExam && !sessionMode && role === 'teacher'}
                title={!activeExam && role === 'teacher' ? '目標を設定してください' : undefined}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 ease-out ${
                  sessionMode
                    ? 'bg-[#dc2626] text-white hover:bg-[#b91c1c] active:scale-[0.97]'
                    : (!activeExam && role === 'teacher')
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-[#1e3a5f] text-white hover:bg-[#2a4d7a] active:scale-[0.97]'
                }`}
              >
                {sessionMode ? 'セッション終了' : '授業を記録'}
              </button>
              <Link
                href={`/students/${studentId}/proposals`}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-[background-color] duration-150 ease-out active:scale-[0.97] flex items-center gap-1"
              >
                <FileText className="w-3.5 h-3.5" />
                提案書一覧
              </Link>
              <Link
                href={`/students/${studentId}/proposals/new?stbId=${textbook.id}&textbookId=${textbook.textbook_id}&season=${textbook.season || 'summer'}&year=${new Date().getFullYear()}`}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-[background-color] duration-150 ease-out active:scale-[0.97] flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                提案書作成
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* 教科書タブ（横並び・サクッと切替） */}
      {textbookTabs.length > 1 && (
        <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
          {textbookTabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => onSelectTab(tb.id)}
              className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap transition-[background-color,color] duration-150 ease-out ${
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

      {/* ── 試験・設定エリア（コンパクト） ── */}
      <div className="mb-3 space-y-2">
        {/* 目標設定 */}
        {activeExam ? (
          <div className="bg-gradient-to-r from-[#eff6ff] to-[#dbeafe]/50 border border-[#1e40af]/20 rounded-lg px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#1e3a5f]">{activeExam.name}</span>
                {activeExam.date && <span className="text-[11px] text-[#6b7280]">{activeExam.date}</span>}
              </div>
              {!isMeeting && (
                <button
                  onClick={() => { setGoalModalEditingId(activeExam.id); setGoalModalOpen(true); }}
                  className="px-2 py-0.5 text-[11px] bg-white border border-[#1e40af]/20 rounded text-[#1e40af] hover:bg-[#1e40af] hover:text-white transition-[background-color,color] duration-150 ease-out active:scale-[0.97]"
                >
                  編集
                </button>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="text-[9px] text-[#6b7280] font-semibold uppercase">残り</div>
                <span className="text-lg font-bold text-[#1e3a5f]">{activeExam.daysLeft ?? '—'}</span>
                {activeExam.daysLeft != null && <span className="text-[11px] text-[#6b7280]">日</span>}
              </div>
              <div className="text-center">
                <div className="text-[9px] text-[#6b7280] font-semibold uppercase">目標</div>
                <span className="text-lg font-bold text-[#1e3a5f]">{activeExam.targetScore ?? '—'}</span>
                {activeExam.targetScore != null && <span className="text-[11px] text-[#6b7280]">点</span>}
              </div>
              <div className="text-center">
                <div className="text-[9px] text-[#6b7280] font-semibold uppercase">行動目標</div>
                <span className="text-lg font-bold text-[#1e3a5f]">{activeExamGoals.filter((g) => g.achieved).length}</span>
                <span className="text-xs text-[#6b7280]">/{activeExamGoals.length}</span>
              </div>
            </div>
            <ActionGoalsSection
              examId={activeExam.id}
              goals={activeExamGoals}
              allExams={textbook.exams || []}
              examTypes={examTypes}
              isMeeting={isMeeting}
              toastError={toastError}
              success={success}
              onChange={(next) => {
                setActionGoalsByExam((prev) => ({ ...prev, [activeExam.id]: next }));
              }}
            />
          </div>
        ) : (
          <div className="bg-amber-50 border-2 border-amber-400 rounded-lg px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-amber-800">目標が設定されていません</div>
              <div className="text-[11px] text-amber-600 mt-0.5">目標を設定しないと進捗の入力・記録ができません。先に目標を設定してください。</div>
            </div>
            {!isMeeting && (
              <button
                onClick={() => { setGoalModalEditingId(null); setGoalModalOpen(true); }}
                className="px-4 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 transition-[background-color] duration-150 ease-out active:scale-[0.97] whitespace-nowrap"
              >
                目標を設定する
              </button>
            )}
          </div>
        )}

        {/* 進め方 / 宿題 / 試験範囲 — 1つのカードにまとめる */}
        {!isMeeting && (
          <div className="bg-white border border-[#e5e7eb] rounded-lg p-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <TextbookSettingsInline textbookId={textbook.id} toastError={toastError} />
            </div>
            <ExamRangesInline
              textbookId={textbook.id}
              examTypes={examTypes}
              ranges={examRanges}
              progress={progress}
              isMeeting={isMeeting}
              onOpenEdit={(rangeId, examTypeId) => {
                setRangeModalEditing({ rangeId, examTypeId });
                setRangeModalOpen(true);
              }}
              onDelete={async (rangeId) => {
                if (!window.confirm('この試験範囲を削除しますか？')) return;
                try {
                  const target = examRanges.find((r) => r.id === rangeId);
                  await deleteExamRange(rangeId);
                  if (target) {
                    const others = examRanges.filter(
                      (r) => r.id !== rangeId && r.exam_type_id === target.exam_type_id
                    );
                    const inOther = (n: number | null): boolean => {
                      if (n == null) return false;
                      return others.some(
                        (r) => n >= r.range_start_item_number && n <= r.range_end_item_number
                      );
                    };
                    await Promise.all(
                      progress.map(async (row) => {
                        const n = itemNo(row);
                        const hasThis = row.progress?.exam_range_exam_type_id === target.exam_type_id;
                        if (!hasThis) return;
                        const inDeleted =
                          n != null &&
                          n >= target.range_start_item_number &&
                          n <= target.range_end_item_number;
                        if (inDeleted && !inOther(n) && row.progress?.id) {
                          await updateStudentProgress(row.progress.id, { exam_range_exam_type_id: null });
                        }
                      })
                    );
                    const rows = await getStudentProgress(textbook.id);
                    setProgress(rows || []);
                  }
                  setExamRangesForTextbook(examRanges.filter((r) => r.id !== rangeId));
                  success('試験範囲を削除しました');
                } catch (e) {
                  console.error(e);
                  toastError('削除に失敗しました');
                }
              }}
            />
          </div>
        )}
        {/* 面談モードでも試験範囲は表示 */}
        {isMeeting && examRanges.length > 0 && (
          <ExamRangesInline
            textbookId={textbook.id}
            examTypes={examTypes}
            ranges={examRanges}
            progress={progress}
            isMeeting={isMeeting}
            onOpenEdit={() => {}}
            onDelete={() => {}}
          />
        )}

      </div>

      {/* セッション記録モード（新UI） */}
      {sessionMode && !isMeeting && (
        <SessionRecordingPanel
          ref={sessionPanelRef}
          studentTextbookId={textbook.id}
          studentName={studentName}
          textbookName={textbook.textbook?.name ?? '教科書'}
          curriculumItems={progress}
          onSessionSaved={handleSessionSaved}
          onSelectionChange={setSessionSelection}
          canEditSaved={role === 'manager'}
        />
      )}

      {/* 進捗テーブル */}
      <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-[#f9fafb] border-b border-[#e5e7eb] text-[#6b7280] text-xs">
            <tr>
              <th className="px-3 py-2 text-left w-10">#</th>
              <th className="px-3 py-2 text-left min-w-[180px]">単元名</th>
              {meetingCols.proposal && <th className="px-3 py-2 text-left w-20">提案</th>}
              {!isMeeting && meetingCols.application && <th className="px-3 py-2 text-left w-20">申込</th>}
              {meetingCols.examRange && <th className="px-3 py-2 text-left min-w-[140px] whitespace-nowrap">試験範囲</th>}
              {meetingCols.schoolProgress && <th className="px-3 py-2 text-left w-28">学校進度</th>}
              {meetingCols.lesson1 && <th className="px-3 py-2 text-left w-28">1回目</th>}
              {meetingCols.lesson2 && <th className="px-3 py-2 text-left w-28">2回目</th>}
              {meetingCols.lesson3 && <th className="px-3 py-2 text-left w-28">3回目</th>}
              {!isMeeting && meetingCols.handover && <th className="px-3 py-2 text-left min-w-[160px]">引継ぎ</th>}
              {!isMeeting && meetingCols.homeworkNotDone && <th className="px-3 py-2 text-center w-16">宿題未</th>}
              {!isMeeting && meetingCols.tardy && <th className="px-3 py-2 text-center w-16">遅刻</th>}
              {!isMeeting && meetingCols.teacherName && <th className="px-3 py-2 text-left w-24">講師名</th>}
            </tr>
          </thead>
          <tbody>
            {(() => {
              // グループ先頭行を前から走査し、group ごとの指導意図タグを集める
              const groupIntentMap = new Map<number, IntentTag | null>();
              for (let i = 0; i < progress.length; i++) {
                const r = progress[i];
                const g = r.progress?.group_number;
                if (g == null) continue;
                if (!groupIntentMap.has(g)) {
                  const t = r.progress?.intent_tag;
                  groupIntentMap.set(g, isIntentTag(t) ? (t as IntentTag) : null);
                }
              }
              return progress.map((row, idx) => {
                const prev = idx > 0 ? progress[idx - 1] : null;
                const curGroup = row.progress?.group_number ?? null;
                const prevGroup = prev?.progress?.group_number ?? null;
                const groupStart = curGroup == null || prevGroup == null || prevGroup !== curGroup;
                // 非先頭行でも同グループの指導意図を継承表示
                const inheritedTag: IntentTag | null = !groupStart && curGroup != null
                  ? (groupIntentMap.get(curGroup) ?? null)
                  : null;
                const paintActive = !!paintMode && !!paintValue;
                const rowIdStr = String(row.id);
                const isPaintStart = paintStart != null && rowIdStr === paintStart;
                const isPaintCandidate = paintActive && paintStart != null;
                return (
                  <ProgressRow
                    key={row.id}
                    row={row}
                    examTypes={examTypes}
                    isMeeting={isMeeting}
                    meetingCols={meetingCols}
                    groupStart={groupStart}
                    inheritedIntentTag={inheritedTag}
                    selfName={selfName}
                    isTeacher={role === 'teacher'}
                    paintActive={paintActive}
                    paintMode={paintMode}
                    isPaintStart={isPaintStart}
                    isPaintCandidate={isPaintCandidate}
                    sessionMode={sessionMode && !isMeeting}
                    sessionSelection={sessionMode && !isMeeting ? sessionSelection : null}
                    hasGoal={!!activeExam || role === 'manager'}
                    onPaintRowClick={() => handlePaintRowClick(rowIdStr)}
                    onLocalPatch={(patch) => updateLocal(rowIdStr, patch)}
                    onSaveProgress={(patch) => saveProgressField(row, patch)}
                    onSaveLesson={(n, date) => saveLessonField(row, n, date)}
                    onSessionCellToggle={sessionMode ? (cid, col) => sessionPanelRef.current?.handleCellToggle(cid, col) : undefined}
                  />
                );
              });
            })()}
          </tbody>
        </table>
      </div>

      <div className="mt-4 p-3 bg-white border border-dashed border-[#e5e7eb] rounded-lg text-xs text-[#6b7280]">
        UI を刷新中。問題があれば URL に <code className="px-1 bg-[#f3f4f6] rounded">?v=legacy</code> を付けて旧UIに戻せます。
      </div>

      {/* 目標設定 編集/新規モーダル */}
      {goalModalOpen && (
        <ExamGoalEditModal
          textbookId={textbook.id}
          examTypes={examTypes}
          editing={goalModalEditingId ? (textbook.exams || []).find((e) => e.id === goalModalEditingId) ?? null : null}
          onClose={() => setGoalModalOpen(false)}
          onSaved={async () => {
            setGoalModalOpen(false);
            success('目標を保存しました');
            await onRefresh();
          }}
          onDeleted={async () => {
            setGoalModalOpen(false);
            success('目標を削除しました');
            await onRefresh();
          }}
          toastError={toastError}
        />
      )}

      {/* 試験範囲スライダーモーダル（独立セクションから呼び出し） */}
      {rangeModalOpen && (
        <ExamRangeModal
          textbookId={textbook.id}
          progress={progress}
          examTypes={examTypes}
          existingRanges={examRanges}
          initialExamTypeId={rangeModalEditing.examTypeId}
          initialRangeId={rangeModalEditing.rangeId}
          onClose={() => setRangeModalOpen(false)}
          onSaved={async (savedRange) => {
            setRangeModalOpen(false);
            success('試験範囲を保存しました');
            // 独立テーブルの state を更新
            setExamRangesForTextbook(
              examRanges.some((r) => r.id === savedRange.id)
                ? examRanges.map((r) => (r.id === savedRange.id ? savedRange : r))
                : [...examRanges, savedRange]
            );
            // 互換性のため per-row exam_range_exam_type_id も同期更新
            try {
              const rows = await getStudentProgress(textbook.id);
              setProgress(rows || []);
            } catch { /* noop */ }
          }}
          toastError={toastError}
        />
      )}

      {/* 提出フッター: 一括設定 + 入力完了後の提出ボタン
       * - 一括設定（試験範囲/指導意図の塗りつぶしモード）を左に
       * - 編集が1件もない時は提出ボタンが disabled
       * - 提出中はスピナーを表示
       * - 1時間放置されたら submit-idle-pulse で注意喚起
       * - 登場時は下からスライドアップ（submit-footer-enter）
       */}
      {!isMeeting && !sessionMode && (
        <div className="submit-footer-enter sticky bottom-0 z-20 border-t border-gray-200 bg-white px-4 py-2.5 flex items-center gap-3 flex-wrap shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          {/* 一括設定: 試験範囲・指導意図の連続塗りつぶし */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-gray-600">一括:</span>
            <div className="inline-flex rounded overflow-hidden border border-gray-200 text-[11px]">
              {([
                { key: null, label: 'OFF' },
                { key: 'examRange' as const, label: '試験範囲' },
                { key: 'intent' as const, label: '指導意図' },
              ]).map((m) => (
                <button
                  key={m.label}
                  onClick={() => { setPaintMode(m.key); setPaintValue(''); setPaintStart(null); }}
                  className={`px-2 py-0.5 transition-[background-color,color] duration-150 ease-out ${
                    paintMode === m.key
                      ? 'bg-[#1e3a5f] text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {paintMode === 'examRange' && (
              <select value={paintValue} onChange={(e) => { setPaintValue(e.target.value); setPaintStart(null); }} className="px-1.5 py-0.5 text-[11px] border border-gray-200 rounded bg-white">
                <option value="">試験を選択</option>
                {examTypes.map((et) => <option key={et.id} value={et.id}>{et.name}</option>)}
              </select>
            )}
            {paintMode === 'intent' && (
              <select value={paintValue} onChange={(e) => { setPaintValue(e.target.value); setPaintStart(null); }} className="px-1.5 py-0.5 text-[11px] border border-gray-200 rounded bg-white">
                <option value="">意図を選択</option>
                {INTENT_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            {paintMode && paintValue && (() => {
              const startRow = paintStart ? progress.find((r) => String(r.id) === paintStart) : null;
              const startLabel = startRow ? (itemNo(startRow) != null ? `項目${itemNo(startRow)}` : (startRow.title ?? '行')) : null;
              return <span className="text-[11px] text-[#1e40af] font-medium">{paintStart == null ? '開始行をクリック' : `${startLabel} → 終了行をクリック`}</span>;
            })()}
            {paintStart != null && (
              <button onClick={() => setPaintStart(null)} className="text-[11px] text-gray-500 hover:text-gray-800 underline">リセット</button>
            )}
          </div>

          {/* スペーサー */}
          <div className="ml-auto flex items-center gap-3">
            <span
              aria-live="polite"
              className={`text-xs ${
                idleAlert ? 'text-[#dc2626] font-semibold' :
                dirtyRows.size > 0 ? 'text-gray-700 font-medium' : 'text-gray-500'
              }`}
            >
              {idleAlert
                ? '未提出の入力があります'
                : dirtyRows.size > 0
                ? `${dirtyRows.size}件の編集があります`
                : '入力完了後 提出'}
            </span>
            <button
              onClick={handleSubmit}
              disabled={submitting || dirtyRows.size === 0}
              aria-label={dirtyRows.size > 0 ? `${dirtyRows.size}件の編集を提出` : '提出（編集なし）'}
              className={`inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-semibold transition-[background-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e3a5f]/40 ${
                dirtyRows.size > 0
                  ? 'bg-[#1e3a5f] text-white hover:bg-[#2a4d7a] active:scale-[0.97] shadow-sm'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              } ${idleAlert && dirtyRows.size > 0 ? 'submit-idle-pulse' : ''}`}
            >
              {submitting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {submitting ? '提出中…' : '提出'}
              {!submitting && dirtyRows.size > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-white/20 rounded text-[11px] font-medium">
                  {dirtyRows.size}
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 目標設定 編集/新規作成モーダル
 * - 試験名（exam_types マスタから選択 or 自由入力）
 * - 試験日 / 目標点
 * - 削除（編集時のみ）
 */
function ExamGoalEditModal({
  textbookId,
  examTypes,
  editing,
  onClose,
  onSaved,
  onDeleted,
  toastError,
}: {
  textbookId: string;
  examTypes: ExamType[];
  editing: import('@/types/database').StudentTextbookExam | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  toastError: (m: string) => void;
}) {
  const [examTypeId, setExamTypeId] = useState<string>(editing?.exam_type_id ?? '');
  const [customName, setCustomName] = useState<string>(editing?.custom_exam_name ?? '');
  const [examDate, setExamDate] = useState<string>(editing?.exam_date ?? '');
  const [targetScore, setTargetScore] = useState<string>(
    editing?.target_score != null ? String(editing.target_score) : ''
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!examDate) {
      toastError('試験日を入力してください');
      return;
    }
    if (!examTypeId && !customName.trim()) {
      toastError('試験名を選択または入力してください');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        student_textbook_id: textbookId,
        exam_type_id: examTypeId || null,
        custom_exam_name: examTypeId ? null : customName.trim() || null,
        exam_date: examDate,
        target_score: targetScore === '' ? null : Number(targetScore),
      };
      if (editing) {
        await updateStudentTextbookExam(editing.id, payload);
      } else {
        await createStudentTextbookExam(payload);
      }
      onSaved();
    } catch (e) {
      console.error(e);
      toastError('保存に失敗しました');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    if (!window.confirm('この目標を削除しますか？関連する行動目標も一緒に削除されます。')) return;
    setSaving(true);
    try {
      await deleteStudentTextbookExam(editing.id);
      onDeleted();
    } catch (e) {
      console.error(e);
      toastError('削除に失敗しました');
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 animate-[fade-in_150ms_ease-out]" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col pointer-events-auto animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
          <header className="px-6 py-4 border-b border-[#e5e7eb] flex items-center justify-between">
            <h2 className="font-bold text-[#1f2937] text-lg">{editing ? '目標を編集' : '目標を設定'}</h2>
            <button onClick={onClose} className="w-8 h-8 rounded hover:bg-[#f3f4f6] text-[#6b7280] transition-[color] duration-150 ease-out active:scale-[0.97]">✕</button>
          </header>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#6b7280] mb-1">試験名（マスタから選択）</label>
              <select
                value={examTypeId}
                onChange={(e) => { setExamTypeId(e.target.value); if (e.target.value) setCustomName(''); }}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white"
              >
                <option value="">（マスタから選択）</option>
                {examTypes.map((et) => (
                  <option key={et.id} value={et.id}>{et.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b7280] mb-1">または 試験名を自由入力</label>
              <input
                type="text"
                value={customName}
                onChange={(e) => { setCustomName(e.target.value); if (e.target.value) setExamTypeId(''); }}
                placeholder="例: 第1回模試"
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">試験日 *</label>
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-1">目標点</label>
                <input
                  type="number"
                  min={0}
                  value={targetScore}
                  onChange={(e) => setTargetScore(e.target.value)}
                  placeholder="80"
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
                />
              </div>
            </div>
          </div>
          <footer className="px-6 py-4 border-t border-[#e5e7eb] flex items-center justify-between bg-[#f9fafb]">
            {editing ? (
              <button
                onClick={remove}
                disabled={saving}
                className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
              >
                削除
              </button>
            ) : <div />}
            <div className="flex gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#4b5563] hover:bg-[#f3f4f6] rounded-lg">キャンセル</button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-1.5 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg hover:bg-[#2a4d7a] disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// 進行表の1行
// ─────────────────────────────────────────────
type MeetingColMap = {
  proposal: boolean; application: boolean; examRange: boolean; schoolProgress: boolean;
  lesson1: boolean; lesson2: boolean; lesson3: boolean; handover: boolean;
  homeworkNotDone: boolean; tardy: boolean; teacherName: boolean;
};

/** 今日の日付 (YYYY-MM-DD) */
const todayIso = () => new Date().toISOString().slice(0, 10);

function ProgressRow({
  row,
  examTypes,
  isMeeting,
  meetingCols,
  groupStart = true,
  inheritedIntentTag = null,
  selfName = '',
  isTeacher = false,
  paintActive = false,
  paintMode: _paintMode = null,
  isPaintStart = false,
  isPaintCandidate = false,
  sessionMode = false,
  sessionSelection = null,
  hasGoal = true,
  onPaintRowClick,
  onLocalPatch,
  onSaveProgress,
  onSaveLesson,
  onSessionCellToggle,
}: {
  row: CurriculumItemWithProgress;
  examTypes: ExamType[];
  isMeeting: boolean;
  meetingCols: MeetingColMap;
  /** グループ先頭行（指導意図タグを編集できる） */
  groupStart?: boolean;
  /** 非先頭行に継承表示する指導意図タグ（読み取り専用） */
  inheritedIntentTag?: IntentTag | null;
  /** ログイン中ユーザーの display_name（講師名欄の自動補完用） */
  selfName?: string;
  /** 講師権限: 講師名を苗字のみ表示 */
  isTeacher?: boolean;
  /** 一括塗りモードが有効か */
  paintActive?: boolean;
  paintMode?: null | 'examRange' | 'intent';
  isPaintStart?: boolean;
  isPaintCandidate?: boolean;
  /** セッション記録モード */
  sessionMode?: boolean;
  /** セッションの選択状態（ハイライト用） */
  sessionSelection?: { unitActions: Record<number, 1 | 2 | 3>; schoolUnits: Set<number>; sessionDate?: string } | null;
  /** 目標が設定されているか（未設定時は入力を無効化） */
  hasGoal?: boolean;
  onPaintRowClick?: () => void;
  onLocalPatch: (patch: Partial<CurriculumItemWithProgress['progress']>) => void;
  onSaveProgress: (patch: Record<string, unknown>) => Promise<void>;
  onSaveLesson: (lessonNumber: 1 | 2 | 3, date: string | null) => Promise<void>;
  /** セッション記録モード中のセルクリック */
  onSessionCellToggle?: (curriculumItemId: number, column: 'school' | 1 | 2 | 3) => void;
}) {
  const p = row.progress;
  const lessonDate = (n: 1 | 2 | 3) =>
    (p?.lessons || []).find((l) => l.lesson_number === n)?.lesson_date ?? '';
  const groupBadge = p?.group_number ? `G${p.group_number}` : '';
  const examRangeName = examTypes.find((et) => et.id === p?.exam_range_exam_type_id)?.name ?? '';

  // セッション選択状態
  const isSessionSelected = sessionSelection
    ? (row.id in (sessionSelection.unitActions || {})) || sessionSelection.schoolUnits?.has(row.id)
    : false;

  const rowClass = isPaintStart
    ? 'border-b border-[#f3f4f6] bg-[#dbeafe] ring-2 ring-[#1e40af] cursor-pointer'
    : isPaintCandidate
      ? 'border-b border-[#f3f4f6] hover:bg-[#eff6ff] cursor-pointer'
      : paintActive
        ? 'border-b border-[#f3f4f6] hover:bg-[#eff6ff] cursor-pointer'
        : isSessionSelected
          ? 'border-b border-[#f3f4f6] bg-[#1e3a5f]/5'
          : 'border-b border-[#f3f4f6] hover:bg-[#f9fafb]';

  // 列表示判定（管理モードでも meetingCols で制御）
  const showProposal = meetingCols.proposal;
  const showApplication = !isMeeting && meetingCols.application;
  const showExamRange = meetingCols.examRange;
  const showSchoolProgress = meetingCols.schoolProgress;
  const showLesson = (n: 1 | 2 | 3) =>
    n === 1 ? meetingCols.lesson1 : n === 2 ? meetingCols.lesson2 : meetingCols.lesson3;
  const showHandover = !isMeeting && meetingCols.handover;
  const showHomeworkNotDone = !isMeeting && meetingCols.homeworkNotDone;
  const showTardy = !isMeeting && meetingCols.tardy;
  const showTeacherName = !isMeeting && meetingCols.teacherName;

  return (
    <tr
      className={rowClass}
      onClick={paintActive ? onPaintRowClick : undefined}
    >
      <td className="px-3 py-2.5 text-[#6b7280] text-xs">{row.item_number ?? ''}</td>
      <td className="px-3 py-2.5 text-[#1f2937]">
        <div className="flex items-center gap-1.5 flex-wrap">
          {groupBadge && <span className="inline-block px-1.5 py-0.5 bg-[#eff6ff] text-[#1e40af] text-[11px] rounded">{groupBadge}</span>}
          <span>{row.title}</span>
          {/* 指導意図: 先頭行は編集可 / 継承行は薄く表示 */}
          {groupStart ? (
            isMeeting ? (
              (() => {
                const tag = isIntentTag(p?.intent_tag) ? p?.intent_tag as IntentTag : null;
                return tag ? (
                  <span className={`inline-block px-1.5 py-0 border rounded-full text-[11px] bg-white ${INTENT_TAG_COLOR[tag]}`}>
                    {tag}
                  </span>
                ) : null;
              })()
            ) : (
              <IntentTagPicker
                currentTag={isIntentTag(p?.intent_tag) ? p?.intent_tag as IntentTag : null}
                onChange={(t) => {
                  onLocalPatch({ intent_tag: t ?? undefined });
                  onSaveProgress({ intent_tag: t });
                }}
              />
            )
          ) : (
            // 継承行: 薄いゴーストチップ（グループ全体の指導意図が分かるように残す）
            inheritedIntentTag && (
              <span
                className={`inline-block px-1.5 py-0 border border-dashed rounded-full text-[9px] bg-white opacity-50 ${INTENT_TAG_COLOR[inheritedIntentTag]}`}
                title={`このグループの指導意図: ${inheritedIntentTag}`}
              >
                {inheritedIntentTag}
              </span>
            )
          )}
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
      {/* 申込: 管理モードのみ & 列設定 ON */}
      {showApplication && (
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
              value={p?.exam_range_exam_type_id ?? ''}
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
      {showSchoolProgress && (() => {
        const schoolSelected = sessionSelection?.schoolUnits?.has(row.id);
        return (
        <td
          className={`px-3 py-2.5 text-xs ${sessionMode ? 'cursor-pointer' : ''} ${schoolSelected ? 'bg-[#1e3a5f]/15' : sessionMode ? 'hover:bg-[#1e3a5f]/5' : ''}`}
          onClick={sessionMode ? () => onSessionCellToggle?.(row.id, 'school') : undefined}
        >
          {isMeeting ? (
            <span className="text-[#4b5563]">{p?.school_progress_date ?? '—'}</span>
          ) : sessionMode ? (
            <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${schoolSelected ? 'bg-[#1e3a5f] text-white font-medium' : p?.school_progress_date ? 'bg-[#1e3a5f]/10 text-[#1e3a5f] font-medium' : 'text-gray-400'}`}>
              {schoolSelected ? '学校' : p?.school_progress_date ? (p.school_progress_date as string).replace(/^\d{4}-/, '').replace('-', '/') : '—'}
            </span>
          ) : (
            <DateInputWithToday
              value={p?.school_progress_date ?? ''}
              onSave={(v) => {
                onLocalPatch({ school_progress_date: v ?? undefined });
                onSaveProgress({ school_progress_date: v });
              }}
              disabled={!hasGoal}
            />
          )}
        </td>
        );
      })()}
      {/* 1回目 / 2回目 / 3回目 */}
      {([1, 2, 3] as const).map((n) => {
        const lessonSelected = sessionSelection?.unitActions?.[row.id] === n;
        return showLesson(n) ? (
          <td
            key={n}
            className={`px-3 py-2.5 text-xs ${sessionMode ? 'cursor-pointer' : ''} ${lessonSelected ? 'bg-[#1e3a5f]/15' : sessionMode ? 'hover:bg-[#1e3a5f]/5' : ''}`}
            onClick={sessionMode ? () => onSessionCellToggle?.(row.id, n) : undefined}
          >
            {isMeeting ? (
              <span className="text-[#1f2937]">{(lessonDate(n) || '').replace(/^\d{4}-/, '') || '—'}</span>
            ) : sessionMode ? (
              <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${lessonSelected ? 'bg-[#1e3a5f] text-white font-medium' : lessonDate(n) ? 'bg-[#1e3a5f]/10 text-[#1e3a5f] font-medium' : 'text-gray-400'}`}>
                {lessonSelected
                  ? (sessionSelection?.sessionDate ?? '').replace(/^\d{4}-/, '').replace('-', '/') || `${n}回目`
                  : lessonDate(n) ? lessonDate(n).replace(/^\d{4}-/, '').replace('-', '/') : '—'}
              </span>
            ) : (
              <DateInputWithToday
                value={lessonDate(n)}
                onSave={(v) => onSaveLesson(n, v)}
                disabled={!hasGoal}
              />
            )}
          </td>
        ) : null;
      })}
      {showHandover && (
        <td className="px-3 py-2.5">
          {hasGoal ? (
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
          ) : (
            <span className="px-1.5 py-1 text-xs text-[#d1d5db]">—</span>
          )}
        </td>
      )}
      {showHomeworkNotDone && (
        <td className="px-3 py-2.5 text-center">
          <input
            type="checkbox"
            checked={!!p?.homework_not_done}
            onChange={(e) => {
              const next = e.target.checked;
              onLocalPatch({ homework_not_done: next });
              onSaveProgress({ homework_not_done: next });
            }}
            className="w-4 h-4 accent-[#d97706] cursor-pointer"
            disabled={!hasGoal}
          />
        </td>
      )}
      {showTardy && (
        <td className="px-3 py-2.5 text-center">
          <input
            type="checkbox"
            checked={!!p?.tardy}
            onChange={(e) => {
              const next = e.target.checked;
              onLocalPatch({ tardy: next });
              onSaveProgress({ tardy: next });
            }}
            className="w-4 h-4 accent-[#d97706] cursor-pointer"
            disabled={!hasGoal}
          />
        </td>
      )}
      {showTeacherName && (
        <td className="px-3 py-2.5">
          {hasGoal ? (
            <TeacherNameInput
              value={isTeacher ? toSurnameOnly(p?.teacher_name) : (p?.teacher_name ?? '')}
              selfName={selfName}
              onSave={(v) => {
                onLocalPatch({ teacher_name: v ?? undefined });
                onSaveProgress({ teacher_name: v });
              }}
            />
          ) : (
            <span className="px-1.5 py-1 text-xs text-[#d1d5db]">—</span>
          )}
        </td>
      )}
    </tr>
  );
}

/**
 * 指導意図ピッカー (管理モード用)
 * グループ先頭行に表示。クリックで 6 種のプリセットから選択。
 */
function IntentTagPicker({
  currentTag,
  onChange,
}: {
  currentTag: IntentTag | null;
  onChange: (tag: IntentTag | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      {currentTag ? (
        <button
          onClick={() => setOpen(!open)}
          className={`inline-block px-1.5 py-0 border rounded-full text-[11px] bg-white hover:shadow-sm transition-shadow ${INTENT_TAG_COLOR[currentTag]}`}
        >
          {currentTag}
        </button>
      ) : (
        <button
          onClick={() => setOpen(!open)}
          className="inline-block px-1.5 py-0 border border-dashed border-[#d1d5db] rounded-full text-[11px] text-[#9ca3af] hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
        >
          ＋指導意図
        </button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-44 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-20 overflow-hidden origin-top-left animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
            <div className="px-3 py-1.5 text-[11px] text-[#6b7280] uppercase tracking-wider border-b border-[#f3f4f6]">指導意図を選ぶ</div>
            {INTENT_TAGS.map((t) => (
              <button
                key={t}
                onClick={() => { onChange(t); setOpen(false); }}
                className={`w-full px-3 py-1.5 text-left text-xs hover:bg-[#f9fafb] ${currentTag === t ? 'bg-[#eff6ff] font-semibold' : ''}`}
              >
                {t}
              </button>
            ))}
            {currentTag && (
              <button
                onClick={() => { onChange(null); setOpen(false); }}
                className="w-full px-3 py-1.5 text-left text-[11px] text-[#6b7280] hover:bg-red-50 border-t border-[#f3f4f6]"
              >
                指導意図を外す
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 日付セル入力: クリックで編集モードに入る。
 * 空欄時は「今日」クイックボタン表示。値があるときはクリックで再編集可能。
 * onSave は YYYY-MM-DD 形式または null で呼ばれる。
 */
function DateInputWithToday({
  value,
  onSave,
  disabled = false,
}: {
  value: string;
  onSave: (v: string | null) => void;
  disabled?: boolean;
}) {
  const [localVal, setLocalVal] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setLocalVal(value), [value]);

  const isEmpty = !localVal;

  if (disabled) {
    return (
      <span className="px-1.5 py-1 text-xs text-[#d1d5db]">—</span>
    );
  }

  const commit = (v: string) => {
    const next = v || null;
    if ((next ?? '') !== (value ?? '')) onSave(next);
    setEditing(false);
  };

  // 値があって非編集中: テキスト表示 + クリアボタン
  if (!isEmpty && !editing) {
    return (
      <div className="flex items-center gap-0.5 group">
        <button
          onClick={(e) => { e.stopPropagation(); setEditing(true); setTimeout(() => inputRef.current?.showPicker?.(), 50); }}
          className="px-1.5 py-1 text-xs text-[#1f2937] hover:bg-[#f3f4f6] rounded transition-[background-color] duration-150 ease-out cursor-pointer"
          title="クリックで日付を変更"
        >
          {localVal.replace(/^\d{4}-/, '').replace('-', '/')}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setLocalVal(''); onSave(null); }}
          className="px-1 py-0.5 text-[11px] text-[#9ca3af] hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          title="日付をクリア"
        >
          ×
        </button>
      </div>
    );
  }

  // 空欄 or 編集モード: input + ボタン
  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="date"
        value={localVal}
        autoFocus={editing}
        onChange={(e) => { setLocalVal(e.target.value); }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
        onClick={(e) => e.stopPropagation()}
        className="flex-1 min-w-0 px-1.5 py-1 text-xs border border-[#1e3a5f] bg-white rounded outline-none"
      />
      {isEmpty && !editing && (
        <button
          onClick={(e) => { e.stopPropagation(); const t = todayIso(); setLocalVal(t); onSave(t); }}
          className="px-1.5 py-0.5 text-[11px] bg-[#eff6ff] text-[#1e40af] border border-[#dbeafe] rounded hover:bg-[#dbeafe] whitespace-nowrap"
          title="今日の日付を入力"
        >
          今日
        </button>
      )}
      {editing && (
        <button
          onClick={(e) => { e.stopPropagation(); setLocalVal(''); onSave(null); setEditing(false); }}
          className="px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50 rounded"
          title="日付をクリア"
        >
          取消
        </button>
      )}
    </div>
  );
}

/**
 * 講師名入力: 空欄時に「自分を入れる」チップで即補完。
 */
function TeacherNameInput({
  value,
  selfName,
  onSave,
}: {
  value: string;
  selfName: string;
  onSave: (v: string | null) => void;
}) {
  const [localVal, setLocalVal] = useState(value);
  useEffect(() => setLocalVal(value), [value]);
  const isEmpty = !localVal;
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={(e) => {
          const v = e.target.value || null;
          if ((v ?? '') !== (value ?? '')) onSave(v);
        }}
        placeholder="講師"
        onClick={(e) => e.stopPropagation()}
        className="flex-1 min-w-0 px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none"
      />
      {isEmpty && selfName && (
        <button
          onClick={(e) => { e.stopPropagation(); setLocalVal(selfName); onSave(selfName); }}
          className="px-1.5 py-0.5 text-[11px] bg-[#eff6ff] text-[#1e40af] border border-[#dbeafe] rounded hover:bg-[#dbeafe] whitespace-nowrap"
          title={`${selfName}（自分）を入力`}
        >
          自分
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 行動目標セクション
// - 追加: タイトル + 任意カウンター目標
// - チェック: achieved 切替
// - カウンター: current/target を ± で増減
// - 削除: 個別
// - 過去試験から一括コピー: examGoals テンプレから複製
// ─────────────────────────────────────────────
function ActionGoalsSection({
  examId,
  goals,
  allExams,
  examTypes,
  isMeeting,
  toastError,
  success,
  onChange,
}: {
  examId: string;
  goals: ActionGoal[];
  allExams: import('@/types/database').StudentTextbookExam[];
  examTypes: ExamType[];
  isMeeting: boolean;
  toastError: (m: string) => void;
  success: (m: string) => void;
  onChange: (next: ActionGoal[]) => void;
}) {
  const [newTitle, setNewTitle] = useState('');
  const [newCounter, setNewCounter] = useState<number | ''>('');
  const [copyOpen, setCopyOpen] = useState(false);

  // 複製元候補: 他の目標設定
  const copySources = allExams.filter((e) => e.id !== examId);

  const add = async () => {
    const title = newTitle.trim();
    if (!title) return;
    try {
      const created = await createActionGoal({
        student_textbook_exam_id: examId,
        title,
        counter_target: newCounter === '' ? null : Number(newCounter),
        counter_current: 0,
        achieved: false,
        sort_order: goals.length,
      });
      onChange([...goals, created]);
      setNewTitle('');
      setNewCounter('');
    } catch (e) {
      console.error(e);
      toastError('行動目標の追加に失敗しました');
    }
  };

  const patch = async (id: string, patchData: Partial<ActionGoal>) => {
    const prevList = goals;
    const optimistic = goals.map((g) => (g.id === id ? { ...g, ...patchData } as ActionGoal : g));
    onChange(optimistic);
    try {
      const updated = await updateActionGoal(id, patchData);
      onChange(optimistic.map((g) => (g.id === id ? updated : g)));
    } catch (e) {
      console.error(e);
      toastError('保存に失敗しました');
      onChange(prevList);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('この行動目標を削除しますか？')) return;
    try {
      await deleteActionGoal(id);
      onChange(goals.filter((g) => g.id !== id));
    } catch (e) {
      console.error(e);
      toastError('削除に失敗しました');
    }
  };

  const copyFrom = async (sourceExamId: string) => {
    setCopyOpen(false);
    try {
      const copied = await copyActionGoalsFromExam(sourceExamId, examId);
      onChange([...goals, ...copied]);
      success(`${copied.length}件の行動目標を複製しました`);
    } catch (e) {
      console.error(e);
      toastError('複製に失敗しました');
    }
  };

  return (
    <div className="pt-3 border-t border-[#1e40af]/15">
      {/* リスト */}
      <div className="space-y-1.5 mb-3">
        {goals.length === 0 ? (
          <div className="text-xs text-[#9ca3af] text-center py-3">
            まだ行動目標がありません。目標達成のための具体的な行動を追加しましょう。
          </div>
        ) : (
          goals.map((g) => (
            <ActionGoalRow
              key={g.id}
              goal={g}
              isMeeting={isMeeting}
              onPatch={(d) => patch(g.id, d)}
              onDelete={() => remove(g.id)}
            />
          ))
        )}
      </div>
      {/* 追加フォーム（面談モードでは非表示） */}
      {!isMeeting && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="例: 毎朝英単語50個を覚える"
            className="flex-1 min-w-[200px] px-2 py-1.5 text-sm bg-white border border-[#e5e7eb] rounded focus:outline-none focus:border-[#1e3a5f]"
          />
          <input
            type="number"
            min={0}
            value={newCounter}
            onChange={(e) => setNewCounter(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="回数(任意)"
            className="w-24 px-2 py-1.5 text-sm bg-white border border-[#e5e7eb] rounded focus:outline-none focus:border-[#1e3a5f]"
          />
          <button
            onClick={add}
            disabled={!newTitle.trim()}
            className="px-3 py-1.5 text-xs bg-[#1e3a5f] text-white rounded hover:bg-[#2a4d7a] disabled:bg-[#9ca3af]"
          >
            追加
          </button>
          {copySources.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setCopyOpen((v) => !v)}
                className="px-3 py-1.5 text-xs bg-white border border-[#1e40af]/20 text-[#1e40af] rounded hover:bg-[#eff6ff]"
              >
                過去の目標から複製 ▾
              </button>
              {copyOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setCopyOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-20 overflow-hidden origin-top-right animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
                    {copySources.map((e) => {
                      const name = examTypes.find((t) => t.id === e.exam_type_id)?.name || e.custom_exam_name || '試験';
                      return (
                        <button
                          key={e.id}
                          onClick={() => copyFrom(e.id)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-[#f9fafb] border-b border-[#f3f4f6] last:border-0"
                        >
                          <div className="font-medium text-[#1f2937]">{name}</div>
                          <div className="text-[11px] text-[#6b7280] mt-0.5">{e.exam_date} / 目標{e.target_score ?? '—'}点</div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionGoalRow({
  goal,
  isMeeting,
  onPatch,
  onDelete,
}: {
  goal: ActionGoal;
  isMeeting: boolean;
  onPatch: (patch: Partial<ActionGoal>) => void;
  onDelete: () => void;
}) {
  const toggleAchieved = () => onPatch({ achieved: !goal.achieved });
  const incCounter = () => {
    if (goal.counter_target == null) return;
    const next = Math.min(goal.counter_target, (goal.counter_current ?? 0) + 1);
    onPatch({ counter_current: next, achieved: next >= goal.counter_target });
  };
  const decCounter = () => {
    if (goal.counter_target == null) return;
    const next = Math.max(0, (goal.counter_current ?? 0) - 1);
    onPatch({ counter_current: next, achieved: goal.counter_target != null && next >= goal.counter_target });
  };

  return (
    <div className="flex items-center gap-2 bg-white rounded px-2 py-1.5 group">
      <button
        onClick={toggleAchieved}
        disabled={isMeeting}
        className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 text-xs ${
          goal.achieved ? 'bg-green-500 text-white' : 'bg-white border border-[#d1d5db]'
        } ${isMeeting ? 'cursor-default' : 'hover:border-[#1e3a5f]'}`}
      >
        {goal.achieved ? '✓' : ''}
      </button>
      <span className={`flex-1 text-sm ${goal.achieved ? 'line-through text-[#9ca3af]' : 'text-[#1f2937]'}`}>
        {goal.title}
      </span>
      {goal.counter_target != null && (
        <div className="flex items-center gap-1 bg-[#f3f4f6] rounded px-1 py-0.5">
          {!isMeeting && (
            <button onClick={decCounter} className="w-5 h-5 rounded hover:bg-white text-[#6b7280] text-xs">−</button>
          )}
          <span className="text-xs font-medium text-[#1f2937] font-mono min-w-[40px] text-center">
            {goal.counter_current ?? 0}/{goal.counter_target}
          </span>
          {!isMeeting && (
            <button onClick={incCounter} className="w-5 h-5 rounded hover:bg-white text-[#6b7280] text-xs">＋</button>
          )}
        </div>
      )}
      {!isMeeting && (
        <button
          onClick={onDelete}
          className="w-6 h-6 rounded hover:bg-red-50 text-[#9ca3af] hover:text-red-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          title="削除"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 進め方・宿題（インライン — 外枠は親が描画）
// ─────────────────────────────────────────────
function TextbookSettingsInline({
  textbookId,
  toastError,
}: {
  textbookId: string;
  toastError: (m: string) => void;
}) {
  const save = async (patch: { approach?: string; homework_style?: string }) => {
    try {
      await upsertStudentTextbookSettings(textbookId, patch);
    } catch (e) {
      console.error(e);
      toastError('保存に失敗しました');
    }
  };

  return (
    <>
      <div>
        <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">進め方</label>
        <textarea
          className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded text-sm resize-none"
          rows={2}
          placeholder="例: ワーク→応用の順。間違えた問題は翌週再演習。"
          onBlur={(e) => save({ approach: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">宿題の出し方</label>
        <textarea
          className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded text-sm resize-none"
          rows={2}
          placeholder="例: 次回範囲の予習 + 前回ワークの復習"
          onBlur={(e) => save({ homework_style: e.target.value })}
        />
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// 試験範囲セクション（独立: 目標設定の有無と無関係）
// 教科書に設定済みの範囲をチップで一覧 + 追加/編集/削除
// ─────────────────────────────────────────────
function _ExamRangesSection({
  textbookId: _textbookId,
  examTypes,
  ranges,
  progress,
  isMeeting,
  onOpenEdit,
  onDelete,
}: {
  textbookId: string;
  examTypes: ExamType[];
  ranges: StudentTextbookExamRange[];
  progress: CurriculumItemWithProgress[];
  isMeeting: boolean;
  onOpenEdit: (rangeId: string | null, examTypeId: string | null) => void;
  onDelete: (rangeId: string) => void;
}) {
  const titleOfItem = (no: number) =>
    progress.find((p) => itemNo(p) === no)?.title ?? `項目${no}`;

  return (
    <div className="mb-4 bg-white border border-[#e5e7eb] rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-[#f3f4f6] bg-[#f9fafb]">
        <div className="text-xs font-semibold text-[#4b5563]">試験範囲</div>
        {!isMeeting && (
          <button
            onClick={() => onOpenEdit(null, null)}
            className="px-2.5 py-1 text-xs bg-white border border-[#1e3a5f]/20 rounded text-[#1e3a5f] hover:bg-[#1e3a5f] hover:text-white transition-[background-color,color] duration-150 ease-out active:scale-[0.97]"
          >
            ＋ 範囲を追加
          </button>
        )}
      </div>
      <div className="p-3">
        {ranges.length === 0 ? (
          <div className="text-xs text-[#9ca3af] text-center py-2">
            まだ試験範囲が設定されていません。
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {ranges.map((r) => {
              const name = examTypes.find((t) => t.id === r.exam_type_id)?.name ?? '試験';
              const startTitle = titleOfItem(r.range_start_item_number);
              const endTitle = titleOfItem(r.range_end_item_number);
              const label = r.range_start_item_number === r.range_end_item_number
                ? startTitle
                : `${startTitle} 〜 ${endTitle}`;
              return (
                <div key={r.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#eff6ff] border border-[#dbeafe] rounded-lg text-xs">
                  <strong className="text-[#1e3a5f]">{name}</strong>
                  <span className="text-[#6b7280]">|</span>
                  <span className="text-[#1f2937]">{label}</span>
                  <span className="text-[11px] text-[#6b7280]">
                    （項目{r.range_start_item_number}〜{r.range_end_item_number}）
                  </span>
                  {!isMeeting && (
                    <>
                      <button
                        onClick={() => onOpenEdit(r.id, r.exam_type_id)}
                        className="ml-1 px-1.5 py-0.5 text-[11px] text-[#1e40af] hover:bg-white rounded"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => onDelete(r.id)}
                        className="px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50 rounded"
                      >
                        削除
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// 試験範囲インライン（カード内に埋め込み用。外枠なし）
// ─────────────────────────────────────────────
function ExamRangesInline({
  textbookId: _textbookId,
  examTypes,
  ranges,
  progress,
  isMeeting,
  onOpenEdit,
  onDelete,
}: {
  textbookId: string;
  examTypes: ExamType[];
  ranges: StudentTextbookExamRange[];
  progress: CurriculumItemWithProgress[];
  isMeeting: boolean;
  onOpenEdit: (rangeId: string | null, examTypeId: string | null) => void;
  onDelete: (rangeId: string) => void;
}) {
  const titleOfItem = (no: number) =>
    progress.find((p) => itemNo(p) === no)?.title ?? `項目${no}`;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <label className="text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider">試験範囲</label>
        {!isMeeting && (
          <button
            onClick={() => onOpenEdit(null, null)}
            className="px-2 py-0.5 text-[11px] bg-[#f9fafb] border border-[#e5e7eb] rounded text-[#1e3a5f] hover:bg-[#1e3a5f] hover:text-white transition-[background-color,color] duration-150 ease-out active:scale-[0.97]"
          >
            ＋ 追加
          </button>
        )}
      </div>
      {ranges.length === 0 ? (
        <div className="text-[11px] text-[#9ca3af]">未設定</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {ranges.map((r) => {
            const name = examTypes.find((t) => t.id === r.exam_type_id)?.name ?? '試験';
            const startTitle = titleOfItem(r.range_start_item_number);
            const endTitle = titleOfItem(r.range_end_item_number);
            const label = r.range_start_item_number === r.range_end_item_number
              ? startTitle
              : `${startTitle} 〜 ${endTitle}`;
            return (
              <span key={r.id} className="inline-flex items-center gap-1 px-2 py-1 bg-[#eff6ff] border border-[#dbeafe] rounded text-[11px]">
                <strong className="text-[#1e3a5f]">{name}</strong>
                <span className="text-[#6b7280]">|</span>
                <span className="text-[#1f2937]">{label}</span>
                <span className="text-[11px] text-[#6b7280]">（{r.range_start_item_number}〜{r.range_end_item_number}）</span>
                {!isMeeting && (
                  <>
                    <button onClick={() => onOpenEdit(r.id, r.exam_type_id)} className="px-1 text-[11px] text-[#1e40af] hover:underline">編集</button>
                    <button onClick={() => onDelete(r.id)} className="px-1 text-[11px] text-red-500 hover:underline">削除</button>
                  </>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 試験範囲モーダル (スライダー + 項目ピル) — 独立テーブル対応
// 選択した試験 (exam_type_id) に対して項目範囲を設定。
// 独立テーブル student_textbook_exam_ranges に保存し、
// 互換性のため student_progress.exam_range_exam_type_id も同期更新する。
// ─────────────────────────────────────────────
function ExamRangeModal({
  textbookId,
  progress,
  examTypes,
  existingRanges,
  initialExamTypeId,
  initialRangeId,
  onClose,
  onSaved,
  toastError,
}: {
  textbookId: string;
  progress: CurriculumItemWithProgress[];
  examTypes: ExamType[];
  existingRanges: StudentTextbookExamRange[];
  initialExamTypeId: string | null;
  initialRangeId: string | null;
  onClose: () => void;
  onSaved: (saved: StudentTextbookExamRange) => void;
  toastError: (m: string) => void;
}) {
  const sorted = [...progress].filter((p) => itemNo(p) != null).sort((a, b) => (itemNo(a) ?? 0) - (itemNo(b) ?? 0));
  const min = (sorted[0] ? itemNo(sorted[0]) : null) ?? 1;
  const max = (sorted[sorted.length - 1] ? itemNo(sorted[sorted.length - 1]) : null) ?? min;

  const [examTypeId, setExamTypeId] = useState<string>(initialExamTypeId ?? '');
  // 編集時は対象セグメントの範囲を初期値にする（新規追加時は min/max）
  const initExisting = initialRangeId
    ? existingRanges.find((r) => r.id === initialRangeId)
    : undefined;
  const [rangeStart, setRangeStart] = useState<number>(initExisting?.range_start_item_number ?? min);
  const [rangeEnd, setRangeEnd] = useState<number>(initExisting?.range_end_item_number ?? max);
  const [saving, setSaving] = useState(false);

  // 試験を切り替えたら min/max にリセット（新規追加モード時のみ）
  useEffect(() => {
    if (!examTypeId || initialRangeId) return;
    setRangeStart(min);
    setRangeEnd(max);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examTypeId]);

  const save = async () => {
    if (!examTypeId) { toastError('試験を選択してください'); return; }
    setSaving(true);
    try {
      // 1. 独立テーブルに保存（id があれば update、無ければ新規 insert）
      const saved = await upsertExamRange({
        ...(initialRangeId ? { id: initialRangeId } : {}),
        student_textbook_id: textbookId,
        exam_type_id: examTypeId,
        range_start_item_number: rangeStart,
        range_end_item_number: rangeEnd,
      } as StudentTextbookExamRangeInsert & { id?: string });
      // 2. per-row の exam_range_exam_type_id を同期
      //    同じ試験の「他のセグメント」は保護する（複数区間対応）
      const otherSegments = existingRanges.filter(
        (r) => r.exam_type_id === examTypeId && r.id !== saved.id
      );
      const inOther = (n: number | null): boolean => {
        if (n == null) return false;
        return otherSegments.some((r) => n >= r.range_start_item_number && n <= r.range_end_item_number);
      };
      // 今回保存した範囲に含まれる行（番号なし中間行も内包）
      let startIdx = -1;
      let endIdx = -1;
      for (let i = 0; i < progress.length; i++) {
        const n = itemNo(progress[i]);
        if (n == null) continue;
        if (n >= rangeStart && n <= rangeEnd) {
          if (startIdx < 0) startIdx = i;
          endIdx = i;
        }
      }
      const inRangeIds = new Set<string>();
      if (startIdx >= 0 && endIdx >= 0) {
        for (let i = startIdx; i <= endIdx; i++) inRangeIds.add(String(progress[i].id));
      }
      const tasks: Promise<unknown>[] = [];
      for (const row of progress) {
        const n = itemNo(row);
        const inRange = inRangeIds.has(String(row.id));
        const hasThis = row.progress?.exam_range_exam_type_id === examTypeId;
        if (inRange && !hasThis) {
          if (row.progress?.id) {
            tasks.push(updateStudentProgress(row.progress.id, { exam_range_exam_type_id: examTypeId }));
          } else {
            tasks.push(upsertStudentProgress({
              student_textbook_id: textbookId,
              curriculum_item_id: row.id,
              exam_range_exam_type_id: examTypeId,
            }));
          }
        } else if (!inRange && hasThis && !inOther(n)) {
          // 他セグメントに含まれない行のみ解除
          if (row.progress?.id) {
            tasks.push(updateStudentProgress(row.progress.id, { exam_range_exam_type_id: null }));
          }
        }
      }
      await Promise.all(tasks);
      onSaved(saved);
    } catch (e) {
      console.error(e);
      toastError('試験範囲の保存に失敗しました');
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40 animate-[fade-in_150ms_ease-out]" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col pointer-events-auto animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
          <header className="px-6 py-4 border-b border-[#e5e7eb] flex items-center justify-between">
            <h2 className="font-bold text-[#1f2937] text-lg">{initialRangeId ? '試験範囲を編集' : '試験範囲を設定'}</h2>
            <button onClick={onClose} className="w-8 h-8 rounded hover:bg-[#f3f4f6] text-[#6b7280] transition-[color] duration-150 ease-out active:scale-[0.97]">✕</button>
          </header>
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* 対象の試験（マスタから選択） */}
            <div>
              <label className="block text-xs font-medium text-[#6b7280] mb-1.5">対象の試験（マスタから選択）</label>
              <select
                value={examTypeId}
                onChange={(e) => setExamTypeId(e.target.value)}
                disabled={!!initialRangeId}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white"
              >
                <option value="">選択してください</option>
                {examTypes.map((et) => {
                  const segs = existingRanges.filter((r) => r.exam_type_id === et.id);
                  const hint = segs.length === 0
                    ? ''
                    : segs.length === 1
                      ? ` （設定済: 項目${segs[0].range_start_item_number}〜${segs[0].range_end_item_number}）`
                      : ` （設定済: ${segs.length}区間）`;
                  return (
                    <option key={et.id} value={et.id}>
                      {et.name}{hint}
                    </option>
                  );
                })}
              </select>
              <p className="text-[11px] text-[#6b7280] mt-1">
                目標設定の有無と関係なく、試験名に対して独立に範囲を設定できます。
              </p>
            </div>

            {examTypeId && (
              <div>
                <label className="block text-xs font-medium text-[#6b7280] mb-2">
                  範囲 <span className="text-[#1f2937] ml-1">項目 {rangeStart} 〜 {rangeEnd}（{rangeEnd - rangeStart + 1}項目）</span>
                </label>
                <RangeSlider
                  min={min}
                  max={max}
                  start={rangeStart}
                  end={rangeEnd}
                  onChange={(s, e) => { setRangeStart(s); setRangeEnd(e); }}
                />
                <div className="mt-3 flex flex-wrap gap-1">
                  {sorted.map((r) => {
                    const n = itemNo(r) ?? 0;
                    const inRange = n >= rangeStart && n <= rangeEnd;
                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          if (n < rangeStart) setRangeStart(n);
                          else if (n > rangeEnd) setRangeEnd(n);
                          else if (n - rangeStart < rangeEnd - n) setRangeStart(n);
                          else setRangeEnd(n);
                        }}
                        className={`px-2 py-1 text-[11px] rounded border transition-[background-color,color,border-color] duration-150 ease-out whitespace-nowrap ${
                          inRange
                            ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                            : 'bg-white text-[#4b5563] border-[#e5e7eb] hover:bg-[#f3f4f6]'
                        }`}
                        title={r.title}
                      >
                        {n}. {r.title.length > 14 ? r.title.slice(0, 14) + '…' : r.title}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex gap-1">
                  <button onClick={() => { setRangeStart(min); setRangeEnd(max); }} className="text-[11px] px-2 py-0.5 bg-[#f3f4f6] rounded hover:bg-[#e5e7eb]">全範囲</button>
                  <button onClick={() => { setRangeStart(Math.max(min, max - 7)); setRangeEnd(max); }} className="text-[11px] px-2 py-0.5 bg-[#f3f4f6] rounded hover:bg-[#e5e7eb]">直近8項目</button>
                </div>
              </div>
            )}
          </div>
          <footer className="px-6 py-4 border-t border-[#e5e7eb] flex items-center justify-end gap-2 bg-[#f9fafb]">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-[#4b5563] hover:bg-[#f3f4f6] rounded-lg">キャンセル</button>
            <button
              onClick={save}
              disabled={saving || !examTypeId}
              className="px-4 py-1.5 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg hover:bg-[#2a4d7a] disabled:opacity-50"
            >
              {saving ? '保存中...' : '範囲を保存'}
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// ダブルハンドルのレンジスライダー
// ─────────────────────────────────────────────
function RangeSlider({
  min,
  max,
  start,
  end,
  onChange,
}: {
  min: number;
  max: number;
  start: number;
  end: number;
  onChange: (s: number, e: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);

  // onChange を ref で保持し、useEffect の依存配列から外す
  // （インライン関数が毎レンダーで再生成されてもドラッグが途切れない）
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const startRef = useRef(start);
  startRef.current = start;
  const endRef = useRef(end);
  endRef.current = end;

  const pct = (v: number) => ((v - min) / Math.max(1, max - min)) * 100;

  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (ev: PointerEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const val = Math.round(min + ratio * (max - min));
      if (dragging === 'start') onChangeRef.current(Math.min(val, endRef.current), endRef.current);
      else onChangeRef.current(startRef.current, Math.max(val, startRef.current));
    };
    const up = () => setDragging(null);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', up);
    };
  }, [dragging, min, max]);

  return (
    <div className="relative h-10 select-none touch-none" ref={trackRef}>
      <div className="absolute top-1/2 -translate-y-1/2 w-full h-1.5 bg-[#e5e7eb] rounded-full" />
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1.5 bg-[#1e3a5f] rounded-full"
        style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }}
      />
      <button
        type="button"
        onPointerDown={(e) => { e.preventDefault(); setDragging('start'); }}
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 bg-white border-2 border-[#1e3a5f] rounded-full cursor-grab active:cursor-grabbing shadow-md hover:scale-110 transition-transform z-10"
        style={{ left: `${pct(start)}%` }}
        title={`開始: 項目${start}`}
      />
      <button
        type="button"
        onPointerDown={(e) => { e.preventDefault(); setDragging('end'); }}
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 bg-white border-2 border-[#1e3a5f] rounded-full cursor-grab active:cursor-grabbing shadow-md hover:scale-110 transition-transform z-10"
        style={{ left: `${pct(end)}%` }}
        title={`終了: 項目${end}`}
      />
    </div>
  );
}
