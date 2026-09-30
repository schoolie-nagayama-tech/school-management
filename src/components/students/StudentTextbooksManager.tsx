'use client';

/**
 * 生徒の教材（所持教材・発注中・進行表で管理中・未分類）の「データと操作」（フック）と「表示」（部品）。
 *
 * もとは StudentDetailModal の「基本情報」タブの中にあったものを、生徒ハブ（/students/[id]）でも
 * 使うために切り出した。教室長は生徒一覧から直接ハブへ行くため、モーダルにしか無いと教材を触れなくなる。
 * ★モーダルは講師も使う。見た目・文言・操作の結果・取得のタイミングはモーダルにあったときと同じに保つこと
 *   （講師の出し分けも、モーダルと同じ「role === 'teacher'」の判定のまま表示部品の中で行う）。
 * ★フックと表示を分けてあるのは、モーダルがタブを持つため。表示部品は基本情報タブの中にしか無く、
 *   状態まで部品に持たせるとタブを移るたびに作り直され、取り直し（読み込み表示）と科目の選択の初期化が
 *   起きる。モーダルはフックを自分の階層で呼び（以前状態を持っていたのと同じ場所）、タブを移っても保つ。
 * ★表示部品のルートはフラグメント。モーダルでは親の space-y-6 が「所持教材」「進行表で管理中」「未分類」の
 *   3ブロックの間隔を作っているので、ここで1つの div に包むと間隔が変わってしまう。
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Button, Select, Loading } from '@/components/ui';
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
  updateOrderStatus,
} from '@/lib/api/ordering';
import type { StudentTextbook as DistributedMaterial } from '@/lib/api/ordering';
import type { Student, Textbook } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import { matchesSubjectFilter } from '@/lib/curriculum/subject';
import { Trash2, PackageCheck } from 'lucide-react';

type StudentTextbookRow = Awaited<ReturnType<typeof getStudentTextbooksForProgress>>[number];

// 発注中の表示ラベル。発注時点で is_owned=true になる仕様なので、これらは既に上の
// 「所持教材」にも載っている。配布済みにすると在庫出庫・請求連携が動く（所持の移動ではない）。
const ORDER_STATUS_LABEL: Record<string, string> = {
  ordered: '発注済',
  delivered: '発送済',
  distributed: '配布済',
};

interface UseStudentTextbooksManagerOptions {
  /** 対象の生徒。null のあいだは取得せず、状態を空に戻す */
  student: Pick<Student, 'id' | 'school_id'> | null;
  /**
   * 取得してよいか。モーダルは isOpen を渡す（以前と同じく「開いていて生徒がいる」ときに取得し、
   * 閉じたら空に戻す）。ハブは常に true。
   */
  enabled: boolean;
}

/**
 * 生徒の教材の状態・取得・操作をまとめたフック。表示は StudentTextbooksManager に渡す。
 * ★取得の開始は「enabled かつ student がある」とき、依存は [enabled, student]（モーダルの旧実装と同じ）。
 *   student はオブジェクトの同一性で見るので、ハブなど ID から組み立てる側は useMemo で安定させること。
 */
export function useStudentTextbooksManager({
  student,
  enabled,
}: UseStudentTextbooksManagerOptions) {
  const { confirm, ConfirmDialog } = useConfirm();
  const { success, error: toastError } = useToast();

  const [textbooks, setTextbooks] = useState<StudentTextbookRow[]>([]);
  const [distributedMaterials, setDistributedMaterials] = useState<DistributedMaterial[]>([]);
  // 「配布済みにする」処理中の発注ID（連打防止・ボタンのローディング表示用）
  const [distributingOrderId, setDistributingOrderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 教材追加用
  const [availableTextbooks, setAvailableTextbooks] = useState<Textbook[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<string>('all');
  const [selectedTextbookId, setSelectedTextbookId] = useState<string>('');
  const [isAddingTextbook, setIsAddingTextbook] = useState(false);

  // 教材データを読み込み（学校種別フィルタなし：全教材を表示）
  // ★1000行の切り捨てについて: 生徒の教材・発注は student_id で絞っているので1000行には届かない。
  //   教材マスタ（getTextbooks）は絞り込みなしだが、有効な教材は 654 件（2026-09-30 本番）。
  const loadTextbooks = useCallback(async (id: string) => {
    const [rows, masters, distributed] = await Promise.all([
      getStudentTextbooksForProgress(id).catch(() => []),
      getTextbooks().catch(() => []),
      // 発注中（発注済・発送済）の表示用。配布済は is_owned=true の所持教材として別途表示される。
      getDistributedMaterials(id, ['ordered', 'delivered']).catch(() => []),
    ]);
    setTextbooks(rows);
    setAvailableTextbooks(masters);
    setDistributedMaterials(distributed);
  }, []);

  useEffect(() => {
    if (enabled && student) {
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
  }, [enabled, student, loadTextbooks]);

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
    return (
      availableTextbooks
        .filter((t) => !alreadyLinked.has(t.id))
        // 科目が空の教材（過去問など1冊で全科目を扱うもの）はどの科目で絞っても残す
        .filter((t) =>
          matchesSubjectFilter(t.subject, selectedSubject === 'all' ? '' : selectedSubject)
        )
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
        })
    );
  }, [availableTextbooks, textbooks, selectedSubject]);

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

  // 発注中の教材を「配布済み」にする。従来は教材発注画面からしか変更できず不便だったため、
  // 生徒詳細からも（講師含む全ロールで）操作できるようにした。
  // 所持(is_owned)は発注時点で既に付いているため、ここでの主な役割は在庫出庫・請求連携
  // （updateOrderStatus が material_orders.status=distributed・在庫出庫・請求連携までまとめて行う。
  // markMaterialOwned は冪等な安全網として再度呼ばれるだけ）。
  // 在庫/請求は権限が無ければ内部で握りつぶされ、配布自体は成立する。
  const handleMarkDistributed = async (dm: DistributedMaterial) => {
    if (!student) return;
    const ok = await confirm({
      title: '配布済みにする',
      description: `「${dm.textbookName}」を配布済みにしますか？`,
      confirmLabel: '配布済みにする',
    });
    if (!ok) return;
    setDistributingOrderId(dm.orderId);
    try {
      await updateOrderStatus(dm.orderId, 'distributed');
      await loadTextbooks(student.id);
      success('配布済みにしました');
    } catch (e) {
      console.error('Error marking distributed:', e);
      toastError(e instanceof Error ? e.message : '配布済みへの変更に失敗しました');
    } finally {
      setDistributingOrderId(null);
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

  return {
    textbooks,
    distributedMaterials,
    distributingOrderId,
    isLoading,
    selectedSubject,
    setSelectedSubject,
    selectedTextbookId,
    setSelectedTextbookId,
    isAddingTextbook,
    subjectsInMaster,
    filteredMasterTextbooks,
    handleAddTextbook,
    handleRemoveTextbook,
    handleRemoveDistributed,
    handleMarkDistributed,
    updateStTextbookFlag,
    ConfirmDialog,
  };
}

export type StudentTextbooksManagerState = ReturnType<typeof useStudentTextbooksManager>;

interface StudentTextbooksManagerProps {
  /** useStudentTextbooksManager の戻り値 */
  manager: StudentTextbooksManagerState;
  /**
   * 「所持教材」の見出しを出さない。生徒ハブではセクションの見出し（「教材」）と重なるため。
   * 既定は false（モーダルの見た目のまま）。「進行表で管理中」「未分類」の小見出しは区別に要るので残す。
   */
  hideTitle?: boolean;
}

/** 教材の表示。状態と操作はすべて manager（useStudentTextbooksManager）から受け取る */
export function StudentTextbooksManager({
  manager,
  hideTitle = false,
}: StudentTextbooksManagerProps) {
  const { profile } = useAuth();
  // モーダルと同じ判定（講師は所持・進行表のチェック、手動追加、削除を出さない）。
  // ★isManagerOrAbove に置き換えない。未ログイン等で role が無いときの振る舞いが変わってしまう。
  const isTeacher = profile?.role === 'teacher';
  const {
    textbooks,
    distributedMaterials,
    distributingOrderId,
    isLoading,
    selectedSubject,
    setSelectedSubject,
    selectedTextbookId,
    setSelectedTextbookId,
    isAddingTextbook,
    subjectsInMaster,
    filteredMasterTextbooks,
    handleAddTextbook,
    handleRemoveTextbook,
    handleRemoveDistributed,
    handleMarkDistributed,
    updateStTextbookFlag,
    ConfirmDialog,
  } = manager;

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

  return (
    <>
      {/* 所持教材 */}
      <div>
        {!hideTitle && <h3 className="text-sm font-semibold text-[#1f2937] mb-3">所持教材</h3>}

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
                    label: filteredMasterTextbooks.length === 0 ? '候補なし' : '選択してください',
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
          所持している・届く予定の教材です（発注・手動追加で入る）。「所持」ON
          のものは発注候補から除外されます。「進行表で管理」は別軸で、ONにすると進行表に進捗欄が出ます。
        </p>
        {isLoading ? (
          <Loading size="md" />
        ) : ownedTextbooks.length === 0 && distributedMaterials.length === 0 ? (
          <p className="text-sm text-[#4b5563]/60">所持教材はありません</p>
        ) : (
          <div className="space-y-1.5">{ownedTextbooks.map(renderTextbookRow)}</div>
        )}

        {/* 発注中（未配布。発注時点で既に上の「所持教材」にも載っている） */}
        {!isLoading && distributedMaterials.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-[#6b7280] mb-1.5">
              発注中（未配布・発注時点で所持教材に載っています。配布済みにすると在庫と請求に反映されます）
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
                    {/* 配布済みにする（全ロール可）。所持は発注時点で既に付いているので、
                        押すと在庫の出庫・請求連携（単語練習帳の自動記入など）が動く */}
                    <button
                      type="button"
                      onClick={() => handleMarkDistributed(dm)}
                      disabled={distributingOrderId === dm.orderId}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-white bg-[#1e3a5f] rounded hover:bg-[#16304d] disabled:opacity-50 transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
                      title="配布済みにする（在庫・請求に反映）"
                    >
                      <PackageCheck className="w-3 h-3" />
                      {distributingOrderId === dm.orderId ? '処理中…' : '配布済みにする'}
                    </button>
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

      {ConfirmDialog}
    </>
  );
}
