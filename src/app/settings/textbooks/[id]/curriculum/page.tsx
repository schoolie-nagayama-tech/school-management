'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { ToastContainer, Loading } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { supabase } from '@/lib/supabase';
import {
  getCurriculumItems,
  createCurriculumItem,
  updateCurriculumItem,
  updateCurriculumOrder,
  updateTextbook,
} from '@/lib/api/textbooks';
import {
  getCurriculumItemsUsage,
  deleteCurriculumItems,
  forceDeleteCurriculumItems,
  mergeCurriculumItems,
  emptyCurriculumItemUsage,
  isCurriculumItemBlocked,
  hasCurriculumItemUsage,
  sumCurriculumItemUsage,
  type CurriculumItemUsage,
} from '@/lib/api/curriculumItemsApi';
import { isOwnerOrAbove } from '@/lib/utils/roles';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableCurriculumRow } from '@/components/textbooks/SortableCurriculumRow';
import type {
  Textbook,
  CurriculumItem,
  CurriculumItemInsert,
  TextbookUpdate,
} from '@/types/database';
import {
  Plus,
  Trash2,
  ChevronLeft,
  Download,
  Upload,
  Settings,
  CheckSquare,
  Square,
  MinusSquare,
} from 'lucide-react';

const ITEM_TYPES: { value: string; label: string; color: string }[] = [
  { value: 'lesson', label: '通常単元', color: 'bg-surfacelue-100 text-text-text-mutedodylue-700' },
  { value: 'chapter', label: '章タイトル', color: 'bg-gray-200 text-gray-700' },
  { value: 'summary', label: 'まとめ', color: 'bg-green-100 text-green-700' },
  { value: 'special', label: '特別', color: 'bg-purple-100 text-purple-700' },
];

interface ItemForm {
  item_number: string;
  title: string;
  item_type: string;
}

const emptyForm: ItemForm = { item_number: '', title: '', item_type: 'lesson' };

export default function CurriculumPage() {
  const params = useParams();
  const router = useRouter();
  const textbookId = Number(params.id);
  const { profile } = useAuth();
  const { toasts, removeToast, success: toastSuccess, error: toastError } = useToast();
  const isManager =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';
  // 参照ごと削除・付け替えは全教室のデータに影響するため admin / owner のみ（API 側の requireAdmin と同じ境界）
  const canForceEdit = isOwnerOrAbove(profile?.role);

  const [textbook, setTextbook] = useState<Textbook | null>(null);
  const [items, setItems] = useState<CurriculumItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ItemForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  // 教材情報編集モーダル
  const [showTextbookModal, setShowTextbookModal] = useState(false);
  const [textbookForm, setTextbookForm] = useState({
    name: '',
    publisher: '',
    school_type: '',
    grade: '',
    subject: '',
  });
  const [textbookSaving, setTextbookSaving] = useState(false);

  // 選択削除
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // 削除確認（使用状況つき）。単体削除・一括削除の両方がこのモーダルを通る
  const [deleteTargets, setDeleteTargets] = useState<CurriculumItem[]>([]);
  const [deleteUsage, setDeleteUsage] = useState<Record<number, CurriculumItemUsage>>({});
  const [usageLoading, setUsageLoading] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');

  // Bulk import
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  // 並べ替え（D&D）
  const [isReordering, setIsReordering] = useState(false);
  const sensors = useSensors(
    // ボタン上のクリック（編集/削除）と区別するため、8px動かしてからドラッグ開始
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [tbResult, itemsData] = await Promise.all([
        supabase.from('textbooks').select('*').eq('id', textbookId).single(),
        getCurriculumItems(textbookId),
      ]);
      if (tbResult.error) throw new Error(tbResult.error.message);
      setTextbook(tbResult.data as Textbook);
      setItems(itemsData);
    } catch (e) {
      toastError(`読み込みに失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
    } finally {
      setLoading(false);
    }
  }, [textbookId, toastError]);

  useEffect(() => {
    if (isManager && textbookId) loadData();
  }, [isManager, textbookId]); // eslint-disable-line react-hooks/exhaustive-deps

  // CRUD
  const openAddModal = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEditModal = (item: CurriculumItem) => {
    setEditingId(item.id);
    setForm({
      item_number: item.item_number?.toString() || '',
      title: item.title,
      item_type: item.item_type || 'lesson',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toastError('タイトルを入力してください');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updateCurriculumItem(editingId, {
          // ★ 番号は数値化しない。「1-8」「第15回」のような番号が実データに入っており、
          //   Number() を通すと NaN → null になって番号が消える。
          item_number: form.item_number.trim() || null,
          title: form.title.trim(),
          item_type: form.item_type,
        });
        toastSuccess('項目を更新しました');
      } else {
        const maxSort = items.length > 0 ? Math.max(...items.map((i) => i.sort_order)) : 0;
        const data: CurriculumItemInsert = {
          textbook_id: textbookId,
          item_number: form.item_number.trim() || null,
          title: form.title.trim(),
          item_type: form.item_type,
          sort_order: maxSort + 1,
        };
        await createCurriculumItem(data);
        toastSuccess('項目を追加しました');
      }
      setShowModal(false);
      loadData();
    } catch (e) {
      toastError(`保存に失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
    } finally {
      setSaving(false);
    }
  };

  // ---- 削除（使用状況を確認してから実行する） ----
  //
  // ★ 単元は進行表（student_progress）から ON DELETE RESTRICT で参照されているため、
  //   一度でも生徒の進行表に載った単元は DB が削除を拒否する。生の Postgres エラーを
  //   そのまま出すと理由が伝わらないので、先に使用状況を取ってモーダルで見せる。
  const openDeleteModal = async (targets: CurriculumItem[]) => {
    if (targets.length === 0) return;
    setDeleteTargets(targets);
    setDeleteUsage({});
    setMergeMode(false);
    setMergeTargetId('');
    setUsageLoading(true);
    try {
      setDeleteUsage(await getCurriculumItemsUsage(targets.map((t) => t.id)));
    } catch (e) {
      toastError(
        `使用状況の確認に失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`
      );
      setDeleteTargets([]);
    } finally {
      setUsageLoading(false);
    }
  };

  /** モーダルを閉じて状態を捨てる（処理完了直後に使う内部用） */
  const closeDeleteModalForce = () => {
    setDeleteTargets([]);
    setDeleteUsage({});
    setMergeMode(false);
    setMergeTargetId('');
  };

  const closeDeleteModal = () => {
    if (deleteBusy) return;
    closeDeleteModalForce();
  };

  const usageOf = (id: number) => deleteUsage[id] ?? emptyCurriculumItemUsage();
  const blockedTargets = deleteTargets.filter((t) => isCurriculumItemBlocked(usageOf(t.id)));
  const freeTargets = deleteTargets.filter((t) => !isCurriculumItemBlocked(usageOf(t.id)));
  const totalUsage = sumCurriculumItemUsage(deleteTargets.map((t) => usageOf(t.id)));

  /** 使用中のものはスキップして削除する（途中で中断しないので部分削除に気づけないことがない） */
  const runDelete = async () => {
    setDeleteBusy(true);
    try {
      const { deleted, blocked } = await deleteCurriculumItems(deleteTargets.map((t) => t.id));
      if (deleted.length > 0) toastSuccess(`${deleted.length}件の項目を削除しました`);
      await loadData();
      if (blocked.length === 0) {
        setSelectedIds(new Set());
        setSelectionMode(false);
        closeDeleteModalForce();
      } else {
        // 残った使用中のものは、付け替え・参照ごと削除を選べるようモーダルに残す
        toastError(`使用中の${blocked.length}件は削除できませんでした`);
        const blockedIds = new Set(blocked.map((b) => b.id));
        setDeleteTargets((prev) => prev.filter((t) => blockedIds.has(t.id)));
        setDeleteUsage(Object.fromEntries(blocked.map((b) => [b.id, b.usage])));
        setSelectedIds(blockedIds);
      }
    } catch (e) {
      toastError(`削除に失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
    } finally {
      setDeleteBusy(false);
    }
  };

  /** 進行表などの参照行ごと消す。講評・引継ぎも失われるので二段確認する */
  const runForceDelete = async () => {
    const message =
      `使用中の${deleteTargets.length}件を、参照ごと削除します。\n\n` +
      `・進行表 ${totalUsage.progress}行（講評・引継ぎを含む）\n` +
      `・テスト対策提案書 ${totalUsage.testPrep}行\n` +
      `・講習提案書 ${totalUsage.seasonalProposal}行\n` +
      `・講習カリキュラム ${totalUsage.seasonalCourse}行\n` +
      `・授業報告の指導単元 ${totalUsage.lessonReport}件\n\n` +
      'これらは元に戻せません。実行しますか？';
    if (!window.confirm(message)) return;
    setDeleteBusy(true);
    try {
      const { deleted } = await forceDeleteCurriculumItems(deleteTargets.map((t) => t.id));
      toastSuccess(`${deleted.length}件を参照ごと削除しました`);
      setSelectedIds(new Set());
      setSelectionMode(false);
      closeDeleteModalForce();
      await loadData();
    } catch (e) {
      toastError(`削除に失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
    } finally {
      setDeleteBusy(false);
    }
  };

  /** 別の単元にまとめる（付け替え）。進行表や提案書の実績を正しい単元に移してから削除する */
  const runMerge = async () => {
    const toId = Number(mergeTargetId);
    if (!Number.isInteger(toId) || toId <= 0) {
      toastError('まとめ先の単元を選んでください');
      return;
    }
    setDeleteBusy(true);
    try {
      const { moved, dropped } = await mergeCurriculumItems(
        deleteTargets.map((t) => t.id),
        toId
      );
      const target = items.find((i) => i.id === toId);
      toastSuccess(
        `「${target?.title ?? ''}」にまとめました（付け替え${moved}行` +
          (dropped > 0 ? ` / 重複${dropped}行を整理` : '') +
          '）'
      );
      setSelectedIds(new Set());
      setSelectionMode(false);
      closeDeleteModalForce();
      await loadData();
    } catch (e) {
      toastError(`付け替えに失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleDelete = (id: number) => {
    const item = items.find((i) => i.id === id);
    if (item) openDeleteModal([item]);
  };

  // 並べ替え確定: 楽観的に並べ替え→sort_orderを保存。失敗時は元に戻す。
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const newItems = arrayMove(items, oldIndex, newIndex);
    const previous = items;
    setItems(newItems); // 楽観的更新
    setIsReordering(true);
    try {
      await updateCurriculumOrder(newItems.map((it, idx) => ({ id: it.id, sort_order: idx + 1 })));
    } catch (e) {
      setItems(previous); // 失敗したら元の順序に戻す
      toastError(`並び順の保存に失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
    } finally {
      setIsReordering(false);
    }
  };

  // Bulk import
  const handleBulkImport = async () => {
    const lines = bulkText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toastError('テキストを入力してください');
      return;
    }
    setBulkSaving(true);
    try {
      const maxSort = items.length > 0 ? Math.max(...items.map((i) => i.sort_order)) : 0;
      let sortOrder = maxSort + 1;

      for (const line of lines) {
        const parts = line.split('\t');
        // 番号は文字列のまま扱う（「1-8」「第15回」のような番号が実際に使われている）
        let itemNumber: string | null = null;
        let title = '';
        let itemType = 'lesson';

        if (parts.length >= 3) {
          // number \t title \t type
          itemNumber = parts[0]?.trim() || null;
          title = parts[1];
          const typeMap: Record<string, string> = {
            通常単元: 'lesson',
            lesson: 'lesson',
            章タイトル: 'chapter',
            chapter: 'chapter',
            まとめ: 'summary',
            summary: 'summary',
            特別: 'special',
            special: 'special',
          };
          itemType = typeMap[parts[2]] || 'lesson';
        } else if (parts.length === 2) {
          // number \t title
          itemNumber = parts[0]?.trim() || null;
          title = parts[1];
        } else {
          // title only
          title = parts[0];
        }

        // Auto-detect type from markers
        if (title.startsWith('◆')) {
          itemType = 'summary';
          title = title.replace(/^◆\s*/, '');
        } else if (title.startsWith('■')) {
          itemType = 'special';
          title = title.replace(/^■\s*/, '');
        } else if (title.startsWith('【')) {
          itemType = 'chapter';
        }

        if (title.trim()) {
          await createCurriculumItem({
            textbook_id: textbookId,
            item_number: itemNumber,
            title: title.trim(),
            item_type: itemType,
            sort_order: sortOrder++,
          });
        }
      }

      toastSuccess(`${lines.length}件の項目を追加しました`);
      setShowBulkModal(false);
      setBulkText('');
      loadData();
    } catch (e) {
      toastError(`一括登録に失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
    } finally {
      setBulkSaving(false);
    }
  };

  // 教材情報編集
  const openTextbookModal = () => {
    if (!textbook) return;
    setTextbookForm({
      name: textbook.name || '',
      publisher: textbook.publisher || '',
      school_type: textbook.school_type || '',
      grade: textbook.grade || '',
      subject: textbook.subject || '',
    });
    setShowTextbookModal(true);
  };

  const handleTextbookSave = async () => {
    if (!textbookForm.name.trim()) {
      toastError('教材名を入力してください');
      return;
    }
    setTextbookSaving(true);
    try {
      const update: TextbookUpdate = {
        name: textbookForm.name.trim(),
        publisher: textbookForm.publisher.trim() || null,
        school_type: textbookForm.school_type || null,
        grade: textbookForm.grade || null,
        subject: textbookForm.subject || null,
      };
      await updateTextbook(textbookId, update);
      toastSuccess('教材情報を更新しました');
      setShowTextbookModal(false);
      loadData();
    } catch (e) {
      toastError(`更新に失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
    } finally {
      setTextbookSaving(false);
    }
  };

  // 選択削除
  const toggleSelection = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    openDeleteModal(items.filter((i) => selectedIds.has(i.id)));
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  // CSV Export
  const handleExport = () => {
    if (items.length === 0) return;
    const bom = '\uFEFF';
    const header = '教材名,番号,タイトル,種別';
    const rows = items.map((i) => {
      const typeLabel = ITEM_TYPES.find((t) => t.value === i.item_type)?.label || i.item_type || '';
      return [
        textbook?.name || '',
        i.item_number?.toString() || '',
        `"${(i.title || '').replace(/"/g, '""')}"`,
        typeLabel,
      ].join(',');
    });
    const csv = bom + header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${textbook?.name || 'curriculum'}_目次.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getTypeInfo = (type: string | null) =>
    ITEM_TYPES.find((t) => t.value === type) || ITEM_TYPES[0];

  if (!isManager) return <AccessDenied />;

  return (
    <AdminLayout headerTitle="カリキュラム管理">
      <div>
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center text-sm text-text-muted hover:text-text-heading mb-4 transition-colors duration-150"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            教材マスタに戻る
          </button>
          {loading ? (
            <Loading size="sm" label="読み込み中..." />
          ) : textbook ? (
            <>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-text-heading">{textbook.name}</h1>
                <button
                  onClick={openTextbookModal}
                  className="p-1.5 text-text-muted hover:text-ink hover:bg-surface-hover rounded transition-colors duration-150"
                  title="教材情報を編集"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1 text-sm text-text-muted">
                {textbook.publisher && <span>{textbook.publisher}</span>}
                {textbook.school_type && (
                  <span className="px-1.5 py-0.5 bg-surface-hover rounded text-xs">
                    {textbook.school_type}
                  </span>
                )}
                {textbook.grade && <span>{textbook.grade}</span>}
                {textbook.subject && (
                  <span className="px-1.5 py-0.5 bg-surfacelue-50 text-text-text-mutedodylue-700 rounded text-xs">
                    {textbook.subject}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="text-red-500">教材が見つかりません</div>
          )}
        </div>

        {/* Actions */}
        {textbook && (
          <div className="flex items-center gap-2 mb-4">
            {selectionMode ? (
              <>
                <button
                  onClick={handleBulkDelete}
                  disabled={selectedIds.size === 0 || deleteBusy || usageLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors duration-150"
                >
                  <Trash2 className="w-4 h-4" />
                  {`${selectedIds.size}件を削除`}
                </button>
                <button
                  onClick={exitSelectionMode}
                  className="inline-flex items-center gap-1.5 px-3 py-2 border border-border text-sm text-text-heading rounded-lg hover:bg-surface transition-colors duration-150"
                >
                  キャンセル
                </button>
                <span className="text-sm text-text-muted ml-auto">
                  {selectedIds.size} / {items.length}件 選択中
                </span>
              </>
            ) : (
              <>
                <button
                  onClick={openAddModal}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-ink text-white text-sm rounded-lg hover:bg-ink/80 transition-colors duration-150"
                >
                  <Plus className="w-4 h-4" />
                  項目を追加
                </button>
                <button
                  onClick={() => setShowBulkModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 border border-border text-sm text-text-heading rounded-lg hover:bg-surface transition-colors duration-150"
                >
                  <Upload className="w-4 h-4" />
                  一括登録
                </button>
                {items.length > 0 && (
                  <>
                    <button
                      onClick={handleExport}
                      className="inline-flex items-center gap-1.5 px-3 py-2 border border-border text-sm text-text-heading rounded-lg hover:bg-surface transition-colors duration-150"
                    >
                      <Download className="w-4 h-4" />
                      CSV出力
                    </button>
                    <button
                      onClick={() => setSelectionMode(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 border border-border text-sm text-text-heading rounded-lg hover:bg-surface transition-colors duration-150"
                    >
                      <CheckSquare className="w-4 h-4" />
                      選択削除
                    </button>
                  </>
                )}
                <span className="text-sm text-text-muted ml-auto">{items.length}件</span>
              </>
            )}
          </div>
        )}

        {/* Items Table */}
        <div className="bg-surface-raised border border-border rounded-lg overflow-hidden">
          {loading ? (
            <Loading size="md" />
          ) : items.length === 0 ? (
            <div className="p-8 text-text-dangeraintenter text-text-faint">
              カリキュラム項目がありません
              <br />
              <button onClick={openAddModal} className="mt-2 text-ink hover:underline text-sm">
                + 項目を追加する
              </button>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <table className="w-full">
                <thead>
                  <tr className="bg-surface border-infoorderorder border-border">
                    {selectionMode ? (
                      <th className="w-10 px-2 text-center">
                        <button
                          onClick={toggleSelectAll}
                          className="p-1 text-text-muted hover:text-ink"
                        >
                          {selectedIds.size === items.length ? (
                            <CheckSquare className="w-4 h-4 text-ink" />
                          ) : selectedIds.size > 0 ? (
                            <MinusSquare className="w-4 h-4 text-ink" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </th>
                    ) : (
                      <th className="w-8 px-2"></th>
                    )}
                    <th className="px-3 py-2.5 text-center text-xs font-medium text-text-muted w-16">
                      No.
                    </th>
                    <th className="text-left px-3 py-2.5 text-xs font-medium text-text-muted">
                      タイトル
                    </th>
                    <th className="px-3 py-2.5 text-center text-xs font-medium text-text-muted w-24">
                      種別
                    </th>
                    {!selectionMode && (
                      <th className="px-3 py-2.5 text-center text-xs font-medium text-text-muted w-24">
                        操作
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {selectionMode
                    ? items.map((item) => {
                        const typeInfo = getTypeInfo(item.item_type);
                        const isChapter = item.item_type === 'chapter';
                        const isSelected = selectedIds.has(item.id);
                        return (
                          <tr
                            key={item.id}
                            className={`hover:bg-surface transition-colors ${isChapter ? 'bg-surface-hover' : ''} ${isSelected ? 'bg-blue-50' : ''}`}
                            onClick={() => toggleSelection(item.id)}
                            style={{ cursor: 'pointer' }}
                          >
                            <td className="px-2 text-center">
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 inline text-ink" />
                              ) : (
                                <Square className="w-4 h-4 inline text-text-muted" />
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center text-sm text-text-muted">
                              {item.item_number || '-'}
                            </td>
                            <td
                              className={`px-3 py-2.5 text-sm ${isChapter ? 'font-bold text-text-heading' : 'text-text-heading'}`}
                            >
                              {item.title}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded ${typeInfo.color}`}>
                                {typeInfo.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    : null}
                  {!selectionMode && (
                    <SortableContext
                      items={items.map((i) => i.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {items.map((item) => {
                        const typeInfo = getTypeInfo(item.item_type);
                        return (
                          <SortableCurriculumRow
                            key={item.id}
                            item={item}
                            typeLabel={typeInfo.label}
                            typeColor={typeInfo.color}
                            isChapter={item.item_type === 'chapter'}
                            disabled={isReordering}
                            onEdit={openEditModal}
                            onDelete={handleDelete}
                          />
                        );
                      })}
                    </SortableContext>
                  )}
                </tbody>
              </table>
            </DndContext>
          )}
        </div>

        {/* Delete Modal（使用状況を見せてから消す／まとめる） */}
        {deleteTargets.length > 0 && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={closeDeleteModal}
          >
            <div
              className="bg-surface-raised rounded-xl shadow-xl w-full max-w-lg mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-text-heading mb-4">
                {deleteTargets.length === 1
                  ? '単元を削除'
                  : `${deleteTargets.length}件の単元を削除`}
              </h2>

              {usageLoading ? (
                <Loading size="sm" label="使用状況を確認中..." />
              ) : (
                <>
                  {/* 削除対象 */}
                  <div className="border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto mb-4">
                    {deleteTargets.map((t) => {
                      const u = usageOf(t.id);
                      return (
                        <div
                          key={t.id}
                          className="flex items-center gap-2 px-3 py-2 text-sm text-text-heading"
                        >
                          <span className="text-text-muted w-8 shrink-0 text-right">
                            {t.item_number || '-'}
                          </span>
                          <span className="flex-1 truncate">{t.title}</span>
                          {isCurriculumItemBlocked(u) ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 shrink-0">
                              使用中
                            </span>
                          ) : hasCurriculumItemUsage(u) ? (
                            <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0">
                              講習で参照
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded bg-surface-hover text-text-muted shrink-0">
                              未使用
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* 削除できない理由 */}
                  {blockedTargets.length > 0 && (
                    <div className="border border-red-200 bg-red-50 rounded-lg p-3 mb-3 text-sm">
                      <div className="font-medium text-red-800 mb-1">
                        {blockedTargets.length}件は使用中のため削除できません
                      </div>
                      <ul className="text-red-700 text-xs space-y-0.5">
                        {totalUsage.progress > 0 && (
                          <li>進行表 {totalUsage.progress}行（講評・引継ぎを含む）</li>
                        )}
                        {totalUsage.testPrep > 0 && (
                          <li>テスト対策提案書 {totalUsage.testPrep}行</li>
                        )}
                      </ul>
                      <div className="text-xs text-red-700 mt-2">
                        誤字や番号違いなら削除せず「編集」で直せます（進行表・提案書の表示も一斉に直ります）。
                        単元そのものが不要なら、実績を残したまま正しい単元に「まとめる」ことができます。
                      </div>
                    </div>
                  )}

                  {/* 削除しても止まらないが、一緒に消える／書き換わるもの */}
                  {(totalUsage.seasonalProposal > 0 ||
                    totalUsage.seasonalCourse > 0 ||
                    totalUsage.lessonReport > 0) && (
                    <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 mb-3 text-xs text-amber-800">
                      <div>削除すると、次からも一緒に消えます（全教室が対象）。</div>
                      <ul className="mt-1 space-y-0.5">
                        {totalUsage.seasonalProposal > 0 && (
                          <li>講習提案書 {totalUsage.seasonalProposal}行</li>
                        )}
                        {totalUsage.seasonalCourse > 0 && (
                          <li>講習カリキュラム {totalUsage.seasonalCourse}行</li>
                        )}
                        {totalUsage.lessonReport > 0 && (
                          <li>授業報告の指導単元 {totalUsage.lessonReport}件</li>
                        )}
                      </ul>
                    </div>
                  )}

                  {freeTargets.length > 0 && blockedTargets.length > 0 && (
                    <div className="text-xs text-text-muted mb-3">
                      「使用していない{freeTargets.length}件を削除」を押すと、消せるものだけ削除して
                      使用中のものはこの画面に残ります。
                    </div>
                  )}

                  {/* まとめ先の選択 */}
                  {mergeMode && (
                    <div className="border border-border rounded-lg p-3 mb-3">
                      <label className="block text-sm font-medium text-text-heading mb-1">
                        まとめ先の単元
                      </label>
                      <select
                        value={mergeTargetId}
                        onChange={(e) => setMergeTargetId(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised"
                      >
                        <option value="">選択してください</option>
                        {items
                          .filter((i) => !deleteTargets.some((t) => t.id === i.id))
                          .map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.item_number ? `${i.item_number}. ` : ''}
                              {i.title}
                            </option>
                          ))}
                      </select>
                      <div className="text-xs text-text-muted mt-2">
                        進行表・提案書の参照をこの単元に付け替えてから、選択した単元を削除します。
                        両方を持っている生徒はまとめ先の行を残します。
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap justify-end gap-2 mt-6">
                    <button
                      onClick={closeDeleteModal}
                      disabled={deleteBusy}
                      className="px-4 py-2 text-sm text-text-muted disabled:opacity-50"
                    >
                      キャンセル
                    </button>

                    {/* 使用中がある場合の逃げ道（admin / owner のみ） */}
                    {blockedTargets.length > 0 && canForceEdit && !mergeMode && (
                      <>
                        <button
                          onClick={() => setMergeMode(true)}
                          disabled={deleteBusy}
                          className="px-4 py-2 border border-border text-sm text-text-heading rounded-lg hover:bg-surface disabled:opacity-50"
                        >
                          別の単元にまとめる
                        </button>
                        <button
                          onClick={runForceDelete}
                          disabled={deleteBusy}
                          className="px-4 py-2 border border-red-300 text-sm text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50"
                        >
                          参照ごと削除
                        </button>
                      </>
                    )}

                    {mergeMode && (
                      <button
                        onClick={runMerge}
                        disabled={deleteBusy || !mergeTargetId}
                        className="px-4 py-2 bg-ink text-white text-sm rounded-lg hover:bg-ink/80 disabled:opacity-50"
                      >
                        {deleteBusy ? '実行中...' : 'まとめて削除'}
                      </button>
                    )}

                    {!mergeMode && freeTargets.length > 0 && (
                      <button
                        onClick={runDelete}
                        disabled={deleteBusy}
                        className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
                      >
                        {deleteBusy
                          ? '削除中...'
                          : blockedTargets.length > 0
                            ? `使用していない${freeTargets.length}件を削除`
                            : `${freeTargets.length}件を削除`}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Add/Edit Modal */}
        {showModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-surfacelack/40"
            onClick={() => setShowModal(false)}
          >
            <div
              className="bg-surface-raised rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-text-heading mb-4">
                {editingId ? '項目を編集' : '項目を追加'}
              </h2>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-text-heading mb-1">番号</label>
                    <input
                      type="text"
                      value={form.item_number}
                      onChange={(e) => setForm({ ...form, item_number: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm"
                      placeholder="1"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-text-heading mb-1">種別</label>
                    <select
                      value={form.item_type}
                      onChange={(e) => setForm({ ...form, item_type: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised"
                    >
                      {ITEM_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-heading mb-1">
                    タイトル *
                  </label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm"
                    placeholder="例: be動詞の過去形"
                    autoFocus
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-text-muted"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-ink text-white text-sm rounded-lg hover:bg-ink/80 disabled:opacity-50"
                >
                  {saving ? '保存中...' : editingId ? '更新' : '追加'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Textbook Edit Modal */}
        {showTextbookModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-surfacelack/40"
            onClick={() => setShowTextbookModal(false)}
          >
            <div
              className="bg-surface-raised rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-text-heading mb-4">教材情報を編集</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-text-heading mb-1">
                    教材名 *
                  </label>
                  <input
                    type="text"
                    value={textbookForm.name}
                    onChange={(e) => setTextbookForm({ ...textbookForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-heading mb-1">出版社</label>
                  <input
                    type="text"
                    value={textbookForm.publisher}
                    onChange={(e) =>
                      setTextbookForm({ ...textbookForm, publisher: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-text-heading mb-1">
                      学校種別
                    </label>
                    <select
                      value={textbookForm.school_type}
                      onChange={(e) =>
                        setTextbookForm({ ...textbookForm, school_type: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised"
                    >
                      <option value="">未設定</option>
                      <option value="小学">小学</option>
                      <option value="中学">中学</option>
                      <option value="高校">高校</option>
                      <option value="共通">共通</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-heading mb-1">学年</label>
                    <input
                      type="text"
                      value={textbookForm.grade}
                      onChange={(e) => setTextbookForm({ ...textbookForm, grade: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm"
                      placeholder="例: 1年"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-heading mb-1">教科</label>
                    <select
                      value={textbookForm.subject}
                      onChange={(e) =>
                        setTextbookForm({ ...textbookForm, subject: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised"
                    >
                      <option value="">未設定</option>
                      <option value="英語">英語</option>
                      <option value="数学">数学</option>
                      <option value="算数">算数</option>
                      <option value="国語">国語</option>
                      <option value="理科">理科</option>
                      <option value="社会">社会</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setShowTextbookModal(false)}
                  className="px-4 py-2 text-sm text-text-muted"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleTextbookSave}
                  disabled={textbookSaving}
                  className="px-4 py-2 bg-ink text-white text-sm rounded-lg hover:bg-ink/80 disabled:opacity-50"
                >
                  {textbookSaving ? '保存中...' : '更新'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Import Modal */}
        {showBulkModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-surfacelack/40"
            onClick={() => setShowBulkModal(false)}
          >
            <div
              className="bg-surface-raised rounded-xl shadow-xl w-full max-w-lg mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-text-heading mb-2">一括登録</h2>
              <p className="text-sm text-text-muted mb-3">
                1行に1項目を入力してください。Excelからの貼り付けにも対応しています。
              </p>
              <div className="bg-surface border border-border rounded-lg p-3 mb-3 text-xs text-text-muted space-y-1">
                <div>
                  <strong>形式:</strong>
                </div>
                <div>
                  ・タイトルのみ: <code>be動詞の過去形</code>
                </div>
                <div>
                  ・番号 + タイトル（タブ区切り）: <code>1→be動詞の過去形</code>
                </div>
                <div>
                  ・番号 + タイトル + 種別: <code>1→be動詞の過去形→通常単元</code>
                </div>
                <div className="mt-1">
                  <strong>自動判定:</strong> ◆ → まとめ、■ → 特別、【】→ 章タイトル
                </div>
              </div>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={10}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm font-mono resize-y"
                placeholder={`【第1章 be動詞】\n1\tI am ～.\n2\tYou are ～.\n◆ まとめテスト`}
                autoFocus
              />
              <div className="text-xs text-text-faint mt-1">
                {bulkText.split('\n').filter((l) => l.trim()).length}行
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 text-sm text-text-muted"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleBulkImport}
                  disabled={bulkSaving || !bulkText.trim()}
                  className="px-4 py-2 bg-ink text-white text-sm rounded-lg hover:bg-ink/80 disabled:opacity-50"
                >
                  {bulkSaving ? '登録中...' : '一括登録'}
                </button>
              </div>
            </div>
          </div>
        )}

        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    </AdminLayout>
  );
}
