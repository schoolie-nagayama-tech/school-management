'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Modal, Button, Select, Loading } from '@/components/ui';
import { getDefaultSchoolId } from '@/lib/api/schools';
import {
  getStudentTextbooks as getStudentTextbooksForProgress,
  createStudentTextbook,
  deleteStudentTextbook,
  updateStudentTextbook,
} from '@/lib/api/progress';
import { getTextbooks } from '@/lib/api/textbooks';
import {
  getStudentTextbooks as getDistributedMaterials,
  deleteDistributedMaterial,
} from '@/lib/api/ordering';
import type { StudentTextbook as DistributedMaterial } from '@/lib/api/ordering';
import { listAssessments } from '@/lib/api/assessments';
import type { Student, Textbook, AssessmentWithScores } from '@/types/database';
import {
  GRADE_LABELS,
  STATUS_LABELS,
  STATUS_COLORS,
  ASSESSMENT_NAME_LABELS,
  SUBJECT_LABELS,
} from '@/types/database';
import { InterviewList } from './InterviewList';
import { AttendanceMatrix } from './AttendanceMatrix';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import { Trash2, ExternalLink } from 'lucide-react';

interface StudentDetailModalProps {
  isOpen: boolean;
  student: Student | null;
  onClose: () => void;
  onEdit: (student: Student) => void;
  /** 削除（論理削除） */
  onDelete?: (student: Student) => Promise<void>;
}

type TabType = 'basic' | 'scores' | 'interviews' | 'schedule';

type StudentTextbookRow = Awaited<ReturnType<typeof getStudentTextbooksForProgress>>[number];

// assessments の学年→ラベルのためのサブジェクト列
const FIVE_SUBJECTS = ['english', 'math', 'japanese', 'social', 'science'] as const;

function formatScoreRow(a: AssessmentWithScores): {
  label: string;
  subjects: Array<{ code: string; value: number | null }>;
  total: number | null;
} {
  const map = new Map<string, number | null>();
  for (const s of a.scores) map.set(s.subject, s.value);
  const subjects = FIVE_SUBJECTS.map((code) => ({ code, value: map.get(code) ?? null }));
  const totals = subjects.map((s) => s.value).filter((v): v is number => v != null);
  const total = totals.length > 0 ? totals.reduce((a, b) => a + b, 0) : null;
  const label = ASSESSMENT_NAME_LABELS[a.name_code] ?? a.name_code;
  return { label, subjects, total };
}

export function StudentDetailModal({
  isOpen,
  student,
  onClose,
  onEdit,
  onDelete,
}: StudentDetailModalProps) {
  const { profile } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const { success, error: toastError } = useToast();
  const isTeacher = profile?.role === 'teacher';
  const [textbooks, setTextbooks] = useState<StudentTextbookRow[]>([]);
  const [distributedMaterials, setDistributedMaterials] = useState<DistributedMaterial[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('basic');
  const schoolId = getDefaultSchoolId();

  // 教材追加用
  const [availableTextbooks, setAvailableTextbooks] = useState<Textbook[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string>('all');
  const [selectedTextbookId, setSelectedTextbookId] = useState<string>('');
  const [isAddingTextbook, setIsAddingTextbook] = useState(false);

  // 成績タブ用
  const [assessments, setAssessments] = useState<AssessmentWithScores[]>([]);
  const [isLoadingScores, setIsLoadingScores] = useState(false);

  const tabs: { key: TabType; label: string }[] = [
    { key: 'basic', label: '基本情報' },
    { key: 'scores', label: '成績' },
    ...(isTeacher ? [] : [{ key: 'schedule' as const, label: '通塾日程' }]),
    { key: 'interviews', label: '面談記録' },
  ];

  // 教材データを読み込み（学校種別フィルタなし：全教材を表示）
  const loadTextbooks = useCallback(async (studentId: string) => {
    const [rows, masters, distributed] = await Promise.all([
      getStudentTextbooksForProgress(studentId).catch(() => []),
      getTextbooks().catch(() => []),
      // 発注中（発注済・発送済）の表示用。配布済は is_owned=true の所持教材として別途表示される。
      getDistributedMaterials(studentId, ['ordered', 'delivered']).catch(() => []),
    ]);
    setTextbooks(rows);
    setAvailableTextbooks(masters);
    setDistributedMaterials(distributed);
  }, []);

  useEffect(() => {
    if (isOpen && student) {
      setIsLoading(true);
      loadTextbooks(student.id)
        .catch((error) => console.error('Error fetching student data:', error))
        .finally(() => setIsLoading(false));
    } else {
      setTextbooks([]);
      setDistributedMaterials([]);
      setAvailableTextbooks([]);
      setSelectedSubject('all');
      setSelectedTextbookId('');
    }
  }, [isOpen, student, loadTextbooks]);

  // 成績データを読み込み（成績タブに切り替えたときに取得）
  useEffect(() => {
    if (!isOpen || !student || activeTab !== 'scores') return;
    setIsLoadingScores(true);
    listAssessments(student.id)
      .then(setAssessments)
      .catch(() => setAssessments([]))
      .finally(() => setIsLoadingScores(false));
  }, [isOpen, student, activeTab]);

  // 科目ごとに教材マスタを分類
  const subjectsInMaster = useMemo(() => {
    const set = new Set<string>();
    for (const t of availableTextbooks) {
      if (t.subject) set.add(t.subject);
    }
    return Array.from(set).sort();
  }, [availableTextbooks]);

  const filteredMasterTextbooks = useMemo(() => {
    const alreadyLinked = new Set(textbooks.map((t) => t.textbook_id));
    const SCHOOL_ORDER: Record<string, number> = { 小学: 1, 中学: 2, 高校: 3 };
    const GRADE_ORDER: Record<string, number> = {
      '1年': 1,
      '2年': 2,
      '3年': 3,
      '4年': 4,
      '5年': 5,
      '6年': 6,
      共通: 7,
    };
    return availableTextbooks
      .filter((t) => !alreadyLinked.has(t.id))
      .filter((t) => selectedSubject === 'all' || t.subject === selectedSubject)
      .sort((a, b) => {
        // 学校種別 → テキスト名 → 学年
        const sa = SCHOOL_ORDER[a.school_type ?? ''] ?? 99;
        const sb = SCHOOL_ORDER[b.school_type ?? ''] ?? 99;
        if (sa !== sb) return sa - sb;
        const nameCmp = (a.name ?? '').localeCompare(b.name ?? '', 'ja');
        if (nameCmp !== 0) return nameCmp;
        const ga = GRADE_ORDER[a.grade ?? ''] ?? 99;
        const gb = GRADE_ORDER[b.grade ?? ''] ?? 99;
        return ga - gb;
      });
  }, [availableTextbooks, textbooks, selectedSubject]);

  // 最新1件ずつ（カテゴリ別）
  const latestByCategory = useMemo(() => {
    const groups: Record<'regular_test' | 'report_card' | 'mock', AssessmentWithScores | null> = {
      regular_test: null,
      report_card: null,
      mock: null,
    };
    for (const a of assessments) {
      const cat = a.category as 'regular_test' | 'report_card' | 'mock';
      const existing = groups[cat];
      if (!existing) {
        groups[cat] = a;
        continue;
      }
      // 学年→月の新しい順
      const keyNew = `${String(a.grade).padStart(2, '0')}-${a.exam_month ?? '0000-00'}`;
      const keyOld = `${String(existing.grade).padStart(2, '0')}-${existing.exam_month ?? '0000-00'}`;
      if (keyNew > keyOld) groups[cat] = a;
    }
    return groups;
  }, [assessments]);

  if (!student) return null;

  const handleEdit = () => {
    onEdit(student);
  };

  const handleAddTextbook = async () => {
    if (!selectedTextbookId || !student) return;
    setIsAddingTextbook(true);
    try {
      await createStudentTextbook({
        school_id: student.school_id,
        student_id: student.id,
        textbook_id: Number(selectedTextbookId),
        // 手動追加は「所持」扱い（発注候補から除外される）
        is_owned: true,
      });
      await loadTextbooks(student.id);
      setSelectedTextbookId('');
      success('教材を追加しました');
    } catch (e) {
      console.error('Error adding textbook:', e);
      toastError(e instanceof Error ? e.message : '教材の追加に失敗しました');
    } finally {
      setIsAddingTextbook(false);
    }
  };

  const handleRemoveTextbook = async (row: StudentTextbookRow) => {
    if (!student) return;
    const ok = await confirm({
      title: '教材を削除',
      description: `「${row.textbook?.name ?? '教材'}」を削除しますか？`,
      confirmLabel: '削除',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteStudentTextbook(row.id);
      await loadTextbooks(student.id);
      success('教材を削除しました');
    } catch (e) {
      console.error('Error deleting textbook:', e);
      toastError('教材の削除に失敗しました');
    }
  };

  const handleRemoveDistributed = async (dm: DistributedMaterial) => {
    if (!student) return;
    const ok = await confirm({
      title: '配布教材を削除',
      description: `「${dm.textbookName}」を所持教材から削除しますか？\n使い終わった教材を外して再発注できるようにします。`,
      confirmLabel: '削除',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDistributedMaterial(dm.orderId, student.id);
      await loadTextbooks(student.id);
      success('配布教材を削除しました');
    } catch (e) {
      console.error('Error deleting distributed material:', e);
      toastError('配布教材の削除に失敗しました');
    }
  };

  // 所持(is_owned)・進行表管理(track_progress)を更新する共通ハンドラ（楽観更新→失敗時リロード）
  const updateStTextbookFlag = async (
    tbId: string,
    patch: { track_progress?: boolean; is_owned?: boolean }
  ) => {
    setTextbooks((prev) =>
      prev.map((row) => (row.id === tbId ? ({ ...row, ...patch } as typeof row) : row))
    );
    try {
      await updateStudentTextbook(tbId, patch);
    } catch (err) {
      console.error('student_textbook 更新失敗:', err);
      if (student) await loadTextbooks(student.id);
    }
  };

  // 教材1行（所持教材・進行表で管理中の両セクションで共用）。
  // 「所持」「進行表で管理」は独立トグル。所持ONの教材は発注候補から除外される。
  const renderTextbookRow = (tb: (typeof textbooks)[number]) => {
    const tracked = (tb as { track_progress?: boolean }).track_progress ?? false;
    const owned = (tb as { is_owned?: boolean }).is_owned ?? false;
    return (
      <div
        key={tb.id}
        className="flex items-center justify-between px-3 py-1.5 bg-white rounded-lg border border-[#e5e7eb]"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-[#1f2937] truncate">
            {tb.textbook
              ? [
                  tb.textbook.school_type,
                  tb.textbook.grade,
                  tb.textbook.subject,
                  tb.textbook.name,
                  tb.textbook.publisher,
                ]
                  .filter(Boolean)
                  .join(' / ')
              : '（不明な教材）'}
          </span>
          {tb.season && (
            <span className="text-[10px] text-[#4b5563] bg-gray-100 px-1.5 py-0.5 rounded">
              {tb.season === 'spring' ? '春期' : tb.season === 'summer' ? '夏期' : '冬期'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!isTeacher && (
            <label
              className="flex items-center gap-1 text-[11px] text-[#4b5563] cursor-pointer select-none"
              title="所持していると発注候補から除外されます"
            >
              <input
                type="checkbox"
                checked={owned}
                onChange={(e) => updateStTextbookFlag(tb.id, { is_owned: e.target.checked })}
                className="w-3.5 h-3.5 accent-[#1e3a5f]"
              />
              所持
            </label>
          )}
          {!isTeacher && (
            <label
              className="flex items-center gap-1 text-[11px] text-[#4b5563] cursor-pointer select-none"
              title="進行表ページに進捗欄を出すか"
            >
              <input
                type="checkbox"
                checked={tracked}
                onChange={(e) => updateStTextbookFlag(tb.id, { track_progress: e.target.checked })}
                className="w-3.5 h-3.5 accent-[#1e3a5f]"
              />
              進行表で管理
            </label>
          )}
          {!isTeacher && (
            <button
              type="button"
              onClick={() => handleRemoveTextbook(tb)}
              className="p-1 text-gray-400 hover:text-red-500 rounded transition-[color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
              aria-label="教材を削除"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  };

  // 所持教材 = is_owned=true（発注配布/手動）。進行表で管理中 = track_progress=true（公開等）。独立軸なので両方に出ることがある。
  const ownedTextbooks = textbooks.filter((tb) => (tb as { is_owned?: boolean }).is_owned);
  const progressTextbooks = textbooks.filter(
    (tb) => (tb as { track_progress?: boolean }).track_progress
  );
  // 「所持」も「進行表で管理」も OFF のレコード。チェックを外しても自動削除はしない方針のため、
  // どちらのセクションにも出ず宙に浮く（手動追加の候補からも textbook_id 重複で外れる）と
  // 画面から触れなくなる。ここで未分類として可視化し、ゴミ箱からのみ削除できるようにする。
  const orphanTextbooks = textbooks.filter(
    (tb) =>
      !(tb as { is_owned?: boolean }).is_owned &&
      !(tb as { track_progress?: boolean }).track_progress
  );

  // 発注中（発注済・発送済。まだ未所持＝配布で is_owned=true になる）
  const ORDER_STATUS_LABEL: Record<string, string> = {
    ordered: '発注済',
    delivered: '発送済',
    distributed: '配布済',
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="生徒詳細" size="2xl">
      <div className="space-y-6">
        {/* タブ */}
        <div className="flex border-b border-[#e5e7eb] -mx-6 px-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-[color,border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                activeTab === tab.key
                  ? 'border-[#3b82f6] text-[#3b82f6]'
                  : 'border-transparent text-[#4b5563] hover:text-[#1f2937]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* タブコンテンツ */}
        {activeTab === 'basic' && (
          <>
            {/* 基本情報 */}
            <div>
              <h3 className="text-sm font-semibold text-[#1f2937] mb-3">基本情報</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#4b5563]">在籍状況</label>
                  <div className="mt-1">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[student.status]}`}
                    >
                      {STATUS_LABELS[student.status]}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[#4b5563]">氏名</label>
                  <p className="mt-1 text-sm text-[#1f2937]">
                    {student.last_name} {student.first_name}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-[#4b5563]">フリガナ</label>
                  <p className="mt-1 text-sm text-[#4b5563]">
                    {student.last_name_kana} {student.first_name_kana}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-[#4b5563]">学年</label>
                  <p className="mt-1 text-sm text-[#1f2937]">
                    {GRADE_LABELS[student.grade] || student.grade}
                  </p>
                </div>
              </div>
            </div>

            {/* 学校情報 */}
            {(student.school_name || student.class_name || student.club) && (
              <div>
                <h3 className="text-sm font-semibold text-[#1f2937] mb-3">学校情報</h3>
                <div className="grid grid-cols-2 gap-4">
                  {student.school_name && (
                    <div>
                      <label className="text-xs text-[#4b5563]">学校名</label>
                      <p className="mt-1 text-sm text-[#1f2937]">{student.school_name}</p>
                    </div>
                  )}
                  {student.class_name && (
                    <div>
                      <label className="text-xs text-[#4b5563]">クラス</label>
                      <p className="mt-1 text-sm text-[#1f2937]">{student.class_name}</p>
                    </div>
                  )}
                  {student.club && (
                    <div className="col-span-2">
                      <label className="text-xs text-[#4b5563]">部活</label>
                      <p className="mt-1 text-sm text-[#1f2937]">{student.club}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 所持教材 */}
            <div>
              <h3 className="text-sm font-semibold text-[#1f2937] mb-3">所持教材</h3>

              {/* 手動追加フォーム（講師には非表示） */}
              {!isTeacher && (
                <div className="flex flex-wrap items-end gap-2 mb-3 p-3 bg-[#f8fafc] rounded-lg border border-[#e5e7eb]">
                  <div className="min-w-[120px]">
                    <label className="block text-xs text-[#4b5563] mb-1">科目</label>
                    <Select
                      value={selectedSubject}
                      onChange={(e) => {
                        setSelectedSubject(e.target.value);
                        setSelectedTextbookId('');
                      }}
                      options={[
                        { value: 'all', label: 'すべて' },
                        ...subjectsInMaster.map((s) => ({ value: s, label: s })),
                      ]}
                      disabled={isAddingTextbook}
                    />
                  </div>
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs text-[#4b5563] mb-1">教材</label>
                    <Select
                      value={selectedTextbookId}
                      onChange={(e) => setSelectedTextbookId(e.target.value)}
                      options={[
                        {
                          value: '',
                          label:
                            filteredMasterTextbooks.length === 0 ? '候補なし' : '選択してください',
                        },
                        ...filteredMasterTextbooks.map((t) => ({
                          value: String(t.id),
                          label: [t.school_type, t.grade, t.name, t.publisher]
                            .filter(Boolean)
                            .join(' / '),
                        })),
                      ]}
                      disabled={isAddingTextbook || filteredMasterTextbooks.length === 0}
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={handleAddTextbook}
                    disabled={!selectedTextbookId || isAddingTextbook}
                    size="sm"
                  >
                    {isAddingTextbook ? '追加中...' : '追加'}
                  </Button>
                </div>
              )}

              <p className="text-[11px] text-[#6b7280] mb-2">
                物理的に所持している教材です（配布・手動追加で入る）。「所持」ON
                のものは発注候補から除外されます。「進行表で管理」は別軸で、ONにすると進行表に進捗欄が出ます。
              </p>
              {isLoading ? (
                <Loading size="md" />
              ) : ownedTextbooks.length === 0 && distributedMaterials.length === 0 ? (
                <p className="text-sm text-[#4b5563]/60">所持教材はありません</p>
              ) : (
                <div className="space-y-1.5">{ownedTextbooks.map(renderTextbookRow)}</div>
              )}

              {/* 発注中（発注済・発送済。配布すると所持教材に入る） */}
              {!isLoading && distributedMaterials.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] text-[#6b7280] mb-1.5">
                    発注中（配布すると所持教材に入ります）
                  </p>
                  <div className="space-y-1">
                    {distributedMaterials.map((dm) => (
                      <div
                        key={dm.orderId}
                        className="flex items-center justify-between px-3 py-1.5 bg-gray-50 rounded-lg border border-[#e5e7eb]"
                      >
                        <span className="text-sm text-[#1f2937] min-w-0 truncate">
                          {dm.textbookName}
                          {dm.quantity > 1 && (
                            <span className="text-xs text-[#4b5563] ml-1">x{dm.quantity}</span>
                          )}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-[#4b5563] bg-gray-100 px-1.5 py-0.5 rounded">
                            {ORDER_STATUS_LABEL[dm.status] ?? '発注'}
                          </span>
                          {!isTeacher && (
                            <button
                              onClick={() => handleRemoveDistributed(dm)}
                              className="p-0.5 text-gray-300 hover:text-red-500 transition-[color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
                              title="発注を取り消す"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 進行表で管理中（track_progress=true。所持とは独立） */}
            {!isLoading && progressTextbooks.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-[#1f2937] mb-1.5">進行表で管理中</h3>
                <p className="text-[11px] text-[#6b7280] mb-2">
                  進行表に進捗欄が出る教材です。所持していれば「所持」も ON
                  にしてください（発注候補から除外されます）。
                </p>
                <div className="space-y-1.5">{progressTextbooks.map(renderTextbookRow)}</div>
              </div>
            )}

            {/* 未分類（所持・進行表どちらも OFF）。チェックを外しても自動では消えないので、
                不要なものはゴミ箱から削除する。手動追加時に候補へ戻すにはここから削除する。 */}
            {!isLoading && orphanTextbooks.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-[#1f2937] mb-1.5">未分類</h3>
                <p className="text-[11px] text-[#6b7280] mb-2">
                  「所持」も「進行表で管理」も OFF
                  の教材です。チェックを外しても自動では消えません。不要ならゴミ箱から削除してください（削除すると手動追加の候補に戻ります）。
                </p>
                <div className="space-y-1.5">{orphanTextbooks.map(renderTextbookRow)}</div>
              </div>
            )}

            {/* 登録・更新日時 */}
            <div>
              <h3 className="text-sm font-semibold text-[#1f2937] mb-3">登録情報</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#4b5563]">登録日時</label>
                  <p className="mt-1 text-sm text-[#1f2937]">
                    {new Date(student.created_at).toLocaleString('ja-JP')}
                  </p>
                </div>
                <div>
                  <label className="text-xs text-[#4b5563]">更新日時</label>
                  <p className="mt-1 text-sm text-[#1f2937]">
                    {new Date(student.updated_at).toLocaleString('ja-JP')}
                  </p>
                </div>
              </div>
            </div>

            {/* アクションボタン */}
            <div className="flex justify-between pt-4 border-t border-[#e5e7eb]">
              <div>
                {!isTeacher && onDelete && (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: '削除確認',
                          description: `${student.last_name} ${student.first_name} を削除しますか？論理削除され、一覧から非表示になります。`,
                          confirmLabel: '削除',
                          variant: 'danger',
                        }))
                      )
                        return;
                      await onDelete(student);
                      onClose();
                    }}
                  >
                    削除
                  </Button>
                )}
              </div>
              <div className="flex gap-3">
                <Button type="button" variant="secondary" onClick={onClose}>
                  閉じる
                </Button>
                {!isTeacher && (
                  <Button type="button" onClick={handleEdit}>
                    編集
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'schedule' && !isTeacher && student && (
          <AttendanceMatrix
            studentId={student.id}
            schoolId={student.school_id ?? schoolId}
            studentGrade={student.grade}
            canEdit={!isTeacher}
          />
        )}

        {activeTab === 'scores' && student && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1f2937]">最新の成績</h3>
              <a
                href={`/students/${student.id}/scores`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[#3b82f6] hover:text-[#1e3a5f] hover:underline"
              >
                詳細を別タブで開く <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {isLoadingScores ? (
              <Loading size="md" />
            ) : (
              <div className="space-y-4">
                {(['regular_test', 'report_card', 'mock'] as const).map((cat) => {
                  const a = latestByCategory[cat];
                  const heading =
                    cat === 'regular_test' ? '定期テスト' : cat === 'report_card' ? '内申' : '模試';
                  if (!a) {
                    return (
                      <div
                        key={cat}
                        className="bg-[#f8fafc] rounded-lg border border-[#e5e7eb] p-3"
                      >
                        <div className="text-xs font-semibold text-[#6b7280] mb-1">{heading}</div>
                        <p className="text-sm text-[#9ca3af]">データなし</p>
                      </div>
                    );
                  }
                  const row = formatScoreRow(a);
                  const gradeLabel = GRADE_LABELS[a.grade] ?? `学年${a.grade}`;
                  return (
                    <div key={cat} className="bg-white rounded-lg border border-[#e5e7eb] p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-semibold text-[#1e3a5f]">{heading}</div>
                        <div className="text-xs text-[#4b5563]">
                          {gradeLabel}・{row.label}
                          {a.exam_month && ` (${a.exam_month})`}
                        </div>
                      </div>
                      <div className="grid grid-cols-6 gap-1 text-center text-xs">
                        {row.subjects.map((s) => (
                          <div key={s.code}>
                            <div className="text-[10px] text-[#6b7280]">
                              {SUBJECT_LABELS[s.code] ?? s.code}
                            </div>
                            <div className="text-sm font-medium text-[#1f2937]">
                              {s.value ?? '—'}
                            </div>
                          </div>
                        ))}
                        <div>
                          <div className="text-[10px] text-[#6b7280]">5科合計</div>
                          <div className="text-sm font-bold text-[#1e3a5f]">{row.total ?? '—'}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'interviews' && student && (
          <div className="h-[60vh] overflow-y-auto pr-2">
            <InterviewList studentId={student.id} schoolId={student.school_id ?? schoolId} />
          </div>
        )}
      </div>
      {ConfirmDialog}
    </Modal>
  );
}
