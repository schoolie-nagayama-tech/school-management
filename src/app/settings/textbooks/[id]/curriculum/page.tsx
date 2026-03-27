'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { supabase } from '@/lib/supabase';
import {
  getCurriculumItems,
  createCurriculumItem,
  updateCurriculumItem,
  deleteCurriculumItem,
} from '@/lib/api/textbooks';
import type { Textbook, CurriculumItem, CurriculumItemInsert } from '@/types/database';
import {
  Plus,
  Edit2,
  Trash2,
  ChevronLeft,
  GripVertical,
  Download,
  Upload,
} from 'lucide-react';

const ITEM_TYPES: { value: string; label: string; color: string }[] = [
  { value: 'lesson', label: '通常単元', color: 'bg-blue-100 text-blue-700' },
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
  const textbookId = Number(params.id);
  const { profile } = useAuth();
  const { toasts, removeToast, success: toastSuccess, error: toastError } = useToast();
  const isManager = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  const [textbook, setTextbook] = useState<Textbook | null>(null);
  const [items, setItems] = useState<CurriculumItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ItemForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Bulk import
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

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
          item_number: form.item_number ? Number(form.item_number) : null,
          title: form.title.trim(),
          item_type: form.item_type,
        });
        toastSuccess('項目を更新しました');
      } else {
        const maxSort = items.length > 0 ? Math.max(...items.map(i => i.sort_order)) : 0;
        const data: CurriculumItemInsert = {
          textbook_id: textbookId,
          item_number: form.item_number ? Number(form.item_number) : null,
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

  const handleDelete = async (id: number) => {
    if (!window.confirm('この項目を削除しますか？')) return;
    try {
      await deleteCurriculumItem(id);
      toastSuccess('項目を削除しました');
      loadData();
    } catch (e) {
      toastError(`削除に失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
    }
  };

  // Bulk import
  const handleBulkImport = async () => {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toastError('テキストを入力してください');
      return;
    }
    setBulkSaving(true);
    try {
      const maxSort = items.length > 0 ? Math.max(...items.map(i => i.sort_order)) : 0;
      let sortOrder = maxSort + 1;

      for (const line of lines) {
        const parts = line.split('\t');
        let itemNumber: number | null = null;
        let title = '';
        let itemType = 'lesson';

        if (parts.length >= 3) {
          // number \t title \t type
          itemNumber = parts[0] ? Number(parts[0]) || null : null;
          title = parts[1];
          const typeMap: Record<string, string> = {
            '通常単元': 'lesson', 'lesson': 'lesson',
            '章タイトル': 'chapter', 'chapter': 'chapter',
            'まとめ': 'summary', 'summary': 'summary',
            '特別': 'special', 'special': 'special',
          };
          itemType = typeMap[parts[2]] || 'lesson';
        } else if (parts.length === 2) {
          // number \t title
          itemNumber = parts[0] ? Number(parts[0]) || null : null;
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

  // CSV Export
  const handleExport = () => {
    if (items.length === 0) return;
    const bom = '\uFEFF';
    const header = '教材名,番号,タイトル,種別';
    const rows = items.map(i => {
      const typeLabel = ITEM_TYPES.find(t => t.value === i.item_type)?.label || i.item_type || '';
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

  const getTypeInfo = (type: string | null) => ITEM_TYPES.find(t => t.value === type) || ITEM_TYPES[0];

  if (!isManager) return <AccessDenied />;

  return (
    <AdminLayout headerTitle="カリキュラム管理">
      <div className="max-w-4xl mx-auto py-6 px-4">
        {/* Header */}
        <div className="mb-6">
          <Link href="/settings/textbooks" className="inline-flex items-center text-sm text-[#6b7280] hover:text-[#374151] mb-4">
            <ChevronLeft className="w-4 h-4 mr-1" />教材マスタに戻る
          </Link>
          {loading ? (
            <div className="text-[#9ca3af]">読み込み中...</div>
          ) : textbook ? (
            <>
              <h1 className="text-xl font-bold text-[#1f2937]">{textbook.name}</h1>
              <div className="flex items-center gap-2 mt-1 text-sm text-[#6b7280]">
                {textbook.publisher && <span>{textbook.publisher}</span>}
                {textbook.school_type && <span className="px-1.5 py-0.5 bg-[#f3f4f6] rounded text-xs">{textbook.school_type}</span>}
                {textbook.grade && <span>{textbook.grade}</span>}
                {textbook.subject && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{textbook.subject}</span>}
              </div>
            </>
          ) : (
            <div className="text-red-500">教材が見つかりません</div>
          )}
        </div>

        {/* Actions */}
        {textbook && (
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2c4f7c] transition-colors"
            >
              <Plus className="w-4 h-4" />項目を追加
            </button>
            <button
              onClick={() => setShowBulkModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-[#d1d5db] text-sm text-[#374151] rounded-lg hover:bg-[#f9fafb] transition-colors"
            >
              <Upload className="w-4 h-4" />一括登録
            </button>
            {items.length > 0 && (
              <button
                onClick={handleExport}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-[#d1d5db] text-sm text-[#374151] rounded-lg hover:bg-[#f9fafb] transition-colors"
              >
                <Download className="w-4 h-4" />CSV出力
              </button>
            )}
            <span className="text-sm text-[#6b7280] ml-auto">{items.length}件</span>
          </div>
        )}

        {/* Items Table */}
        <div className="bg-white border border-[#e5e7eb] rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-[#9ca3af]">読み込み中...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-[#9ca3af]">
              カリキュラム項目がありません
              <br />
              <button onClick={openAddModal} className="mt-2 text-[#1e3a5f] hover:underline text-sm">
                + 項目を追加する
              </button>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-[#f9fafb] border-b border-[#e5e7eb]">
                  <th className="w-8 px-2"></th>
                  <th className="text-center px-3 py-2.5 text-xs font-medium text-[#6b7280] w-16">No.</th>
                  <th className="text-left px-3 py-2.5 text-xs font-medium text-[#6b7280]">タイトル</th>
                  <th className="text-center px-3 py-2.5 text-xs font-medium text-[#6b7280] w-24">種別</th>
                  <th className="text-center px-3 py-2.5 text-xs font-medium text-[#6b7280] w-24">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e7eb]">
                {items.map(item => {
                  const typeInfo = getTypeInfo(item.item_type);
                  const isChapter = item.item_type === 'chapter';
                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-[#f9fafb] transition-colors ${isChapter ? 'bg-[#f3f4f6]' : ''}`}
                    >
                      <td className="px-2 text-center text-[#d1d5db]">
                        <GripVertical className="w-4 h-4 inline" />
                      </td>
                      <td className="px-3 py-2.5 text-center text-sm text-[#6b7280]">
                        {item.item_number || '-'}
                      </td>
                      <td className={`px-3 py-2.5 text-sm ${isChapter ? 'font-bold text-[#1f2937]' : 'text-[#374151]'}`}>
                        {item.title}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded ${typeInfo.color}`}>
                          {typeInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEditModal(item)}
                            className="p-1.5 text-[#6b7280] hover:text-[#1e3a5f] hover:bg-[#f3f4f6] rounded transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="p-1.5 text-[#6b7280] hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Add/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowModal(false)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-[#1f2937] mb-4">
                {editingId ? '項目を編集' : '項目を追加'}
              </h2>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1">番号</label>
                    <input
                      type="text"
                      value={form.item_number}
                      onChange={e => setForm({ ...form, item_number: e.target.value })}
                      className="w-full px-3 py-2 border border-[#d1d5db] rounded-lg text-sm"
                      placeholder="1"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-[#374151] mb-1">種別</label>
                    <select
                      value={form.item_type}
                      onChange={e => setForm({ ...form, item_type: e.target.value })}
                      className="w-full px-3 py-2 border border-[#d1d5db] rounded-lg text-sm bg-white"
                    >
                      {ITEM_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1">タイトル *</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    className="w-full px-3 py-2 border border-[#d1d5db] rounded-lg text-sm"
                    placeholder="例: be動詞の過去形"
                    autoFocus
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-[#6b7280]">
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2c4f7c] disabled:opacity-50"
                >
                  {saving ? '保存中...' : editingId ? '更新' : '追加'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Import Modal */}
        {showBulkModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBulkModal(false)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-[#1f2937] mb-2">一括登録</h2>
              <p className="text-sm text-[#6b7280] mb-3">
                1行に1項目を入力してください。Excelからの貼り付けにも対応しています。
              </p>
              <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-lg p-3 mb-3 text-xs text-[#6b7280] space-y-1">
                <div><strong>形式:</strong></div>
                <div>・タイトルのみ: <code>be動詞の過去形</code></div>
                <div>・番号 + タイトル（タブ区切り）: <code>1→be動詞の過去形</code></div>
                <div>・番号 + タイトル + 種別: <code>1→be動詞の過去形→通常単元</code></div>
                <div className="mt-1"><strong>自動判定:</strong> ◆ → まとめ、■ → 特別、【】→ 章タイトル</div>
              </div>
              <textarea
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                rows={10}
                className="w-full px-3 py-2 border border-[#d1d5db] rounded-lg text-sm font-mono resize-y"
                placeholder={`【第1章 be動詞】\n1\tI am ～.\n2\tYou are ～.\n◆ まとめテスト`}
                autoFocus
              />
              <div className="text-xs text-[#9ca3af] mt-1">
                {bulkText.split('\n').filter(l => l.trim()).length}行
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setShowBulkModal(false)} className="px-4 py-2 text-sm text-[#6b7280]">
                  キャンセル
                </button>
                <button
                  onClick={handleBulkImport}
                  disabled={bulkSaving || !bulkText.trim()}
                  className="px-4 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2c4f7c] disabled:opacity-50"
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
