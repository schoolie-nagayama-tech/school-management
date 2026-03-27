'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { getTextbooks, createTextbook, updateTextbook, deleteTextbook } from '@/lib/api/textbooks';
import type { Textbook, TextbookInsert } from '@/types/database';
import { Plus, Search, Edit2, Trash2, BookOpen, ChevronLeft, ListOrdered } from 'lucide-react';

const SCHOOL_TYPES = ['小学', '中学', '高校'];
const GRADES = ['1年', '2年', '3年', '4年', '5年', '6年', '共通'];
const SUBJECTS = ['英語', '数学', '算数', '国語', '理科', '社会'];

const SUBJECT_COLORS: Record<string, string> = {
  '英語': 'bg-blue-100 text-blue-700',
  '数学': 'bg-red-100 text-red-700',
  '算数': 'bg-red-100 text-red-700',
  '国語': 'bg-green-100 text-green-700',
  '理科': 'bg-purple-100 text-purple-700',
  '社会': 'bg-amber-100 text-amber-700',
};

interface TextbookForm {
  name: string;
  publisher: string;
  school_type: string;
  grade: string;
  subject: string;
  revision_date: string;
}

const emptyForm: TextbookForm = {
  name: '',
  publisher: '',
  school_type: '',
  grade: '',
  subject: '',
  revision_date: '',
};

export default function TextbookMasterPage() {
  const { profile } = useAuth();
  const { toasts, removeToast, success: toastSuccess, error: toastError } = useToast();
  const isManager = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [schoolTypeFilter, setSchoolTypeFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TextbookForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadTextbooks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getTextbooks();
      setTextbooks(data);
    } catch (e) {
      toastError(`教材の読み込みに失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    if (isManager) loadTextbooks();
  }, [isManager]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter
  const filtered = useMemo(() => {
    let result = textbooks;
    if (schoolTypeFilter) result = result.filter(t => t.school_type === schoolTypeFilter);
    if (gradeFilter) result = result.filter(t => t.grade === gradeFilter);
    if (subjectFilter) result = result.filter(t => t.subject === subjectFilter);
    if (search.trim()) {
      const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter(t => {
        const s = [t.name, t.publisher, t.school_type, t.grade, t.subject].filter(Boolean).join(' ').toLowerCase();
        return terms.every(term => s.includes(term));
      });
    }
    // Sort: school_type → subject → grade → name
    const SUBJECT_ORDER = ['英語', '数学', '算数', '国語', '理科', '社会'];
    result = [...result].sort((a, b) => {
      const stA = SCHOOL_TYPES.indexOf(a.school_type || '');
      const stB = SCHOOL_TYPES.indexOf(b.school_type || '');
      if (stA !== stB) return (stA === -1 ? 999 : stA) - (stB === -1 ? 999 : stB);
      const subjA = SUBJECT_ORDER.indexOf(a.subject || '');
      const subjB = SUBJECT_ORDER.indexOf(b.subject || '');
      if (subjA !== subjB) return (subjA === -1 ? 999 : subjA) - (subjB === -1 ? 999 : subjB);
      return (a.grade || '').localeCompare(b.grade || '', 'ja');
    });
    return result;
  }, [textbooks, schoolTypeFilter, gradeFilter, subjectFilter, search]);

  // Available grades based on school type
  const availableGrades = useMemo(() => {
    if (schoolTypeFilter === '小学') return ['1年', '2年', '3年', '4年', '5年', '6年', '共通'];
    if (schoolTypeFilter === '中学' || schoolTypeFilter === '高校') return ['1年', '2年', '3年', '共通'];
    return GRADES;
  }, [schoolTypeFilter]);

  // CRUD
  const openAddModal = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEditModal = (t: Textbook) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      publisher: t.publisher || '',
      school_type: t.school_type || '',
      grade: t.grade || '',
      subject: t.subject || '',
      revision_date: t.revision_date || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toastError('教材名を入力してください');
      return;
    }
    if (!form.school_type) {
      toastError('学校種別を選択してください');
      return;
    }
    setSaving(true);
    try {
      const gradeCategory = form.school_type === '小学' ? 'elementary' : form.school_type === '中学' ? 'middle' : form.school_type === '高校' ? 'high' : undefined;
      const data: TextbookInsert = {
        name: form.name.trim(),
        publisher: form.publisher.trim() || null,
        school_type: form.school_type || null,
        grade: form.grade || null,
        subject: form.subject || null,
        revision_date: form.revision_date || null,
        grade_category: gradeCategory || null,
      };
      if (editingId) {
        await updateTextbook(editingId, data);
        toastSuccess('教材を更新しました');
      } else {
        await createTextbook(data);
        toastSuccess('教材を追加しました');
      }
      setShowModal(false);
      loadTextbooks();
    } catch (e) {
      toastError(`保存に失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`「${name}」を削除しますか？\n紐づくカリキュラムも全て削除されます。`)) return;
    try {
      await deleteTextbook(id);
      toastSuccess('教材を削除しました');
      loadTextbooks();
    } catch (e) {
      toastError(`削除に失敗しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
    }
  };

  if (!isManager) return <AccessDenied />;

  return (
    <AdminLayout headerTitle="教材マスタ管理">
      <div className="max-w-6xl mx-auto py-6 px-4">
        {/* Header */}
        <div className="mb-6">
          <Link href="/settings" className="inline-flex items-center text-sm text-[#6b7280] hover:text-[#374151] mb-4">
            <ChevronLeft className="w-4 h-4 mr-1" />設定に戻る
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-[#1f2937]">教材マスタ管理</h1>
              <p className="text-sm text-[#6b7280] mt-1">教材の追加・編集・カリキュラム管理</p>
            </div>
            <button
              onClick={openAddModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2c4f7c] transition-colors"
            >
              <Plus className="w-4 h-4" />教材を追加
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border border-[#e5e7eb] rounded-lg p-4 mb-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af]" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="教材名で検索..."
                className="w-full pl-9 pr-3 py-2 border border-[#d1d5db] rounded-lg text-sm focus:ring-1 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
              />
            </div>
            <select
              value={schoolTypeFilter}
              onChange={e => { setSchoolTypeFilter(e.target.value); setGradeFilter(''); }}
              className="px-3 py-2 border border-[#d1d5db] rounded-lg text-sm bg-white"
            >
              <option value="">学校種別: 全て</option>
              {SCHOOL_TYPES.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
            <select
              value={gradeFilter}
              onChange={e => setGradeFilter(e.target.value)}
              className="px-3 py-2 border border-[#d1d5db] rounded-lg text-sm bg-white"
            >
              <option value="">学年: 全て</option>
              {availableGrades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select
              value={subjectFilter}
              onChange={e => setSubjectFilter(e.target.value)}
              className="px-3 py-2 border border-[#d1d5db] rounded-lg text-sm bg-white"
            >
              <option value="">科目: 全て</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Count */}
        <div className="text-sm text-[#6b7280] mb-3">
          {filtered.length}件 / {textbooks.length}件
        </div>

        {/* Table */}
        <div className="bg-white border border-[#e5e7eb] rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-[#9ca3af]">読み込み中...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-[#9ca3af]">教材が見つかりません</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-[#f9fafb] border-b border-[#e5e7eb]">
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#6b7280] uppercase">教材名</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[#6b7280] uppercase w-24">出版社</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-[#6b7280] uppercase w-20">種別</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-[#6b7280] uppercase w-16">学年</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-[#6b7280] uppercase w-16">科目</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-[#6b7280] uppercase w-32">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e7eb]">
                {filtered.map(t => (
                  <tr key={t.id} className="hover:bg-[#f9fafb] transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-sm text-[#1f2937]">{t.name}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-[#6b7280]">{t.publisher || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs px-2 py-0.5 rounded bg-[#f3f4f6] text-[#4b5563]">{t.school_type || '-'}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-[#6b7280]">{t.grade || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      {t.subject ? (
                        <span className={`text-xs px-2 py-0.5 rounded ${SUBJECT_COLORS[t.subject] || 'bg-gray-100 text-gray-700'}`}>
                          {t.subject}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Link
                          href={`/settings/textbooks/${t.id}/curriculum`}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[#1e3a5f] hover:bg-[#e8edf3] rounded transition-colors"
                          title="カリキュラム"
                        >
                          <ListOrdered className="w-3.5 h-3.5" />目次
                        </Link>
                        <button
                          onClick={() => openEditModal(t)}
                          className="p-1.5 text-[#6b7280] hover:text-[#1e3a5f] hover:bg-[#f3f4f6] rounded transition-colors"
                          title="編集"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(t.id, t.name)}
                          className="p-1.5 text-[#6b7280] hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="削除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowModal(false)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-[#1f2937] mb-4">
                <BookOpen className="w-5 h-5 inline mr-2 text-[#1e3a5f]" />
                {editingId ? '教材を編集' : '教材を追加'}
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1">教材名 *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border border-[#d1d5db] rounded-lg text-sm focus:ring-1 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
                    placeholder="例: フォレスタ 英語Ⅰ"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1">出版社</label>
                  <input
                    type="text"
                    value={form.publisher}
                    onChange={e => setForm({ ...form, publisher: e.target.value })}
                    className="w-full px-3 py-2 border border-[#d1d5db] rounded-lg text-sm focus:ring-1 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
                    placeholder="例: SPRIX"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1">学校種別 *</label>
                    <select
                      value={form.school_type}
                      onChange={e => setForm({ ...form, school_type: e.target.value, grade: '' })}
                      className="w-full px-3 py-2 border border-[#d1d5db] rounded-lg text-sm bg-white"
                    >
                      <option value="">選択</option>
                      {SCHOOL_TYPES.map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1">学年</label>
                    <select
                      value={form.grade}
                      onChange={e => setForm({ ...form, grade: e.target.value })}
                      className="w-full px-3 py-2 border border-[#d1d5db] rounded-lg text-sm bg-white"
                    >
                      <option value="">選択</option>
                      {(form.school_type === '小学'
                        ? ['1年', '2年', '3年', '4年', '5年', '6年', '共通']
                        : form.school_type
                          ? ['1年', '2年', '3年', '共通']
                          : GRADES
                      ).map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#374151] mb-1">科目</label>
                    <select
                      value={form.subject}
                      onChange={e => setForm({ ...form, subject: e.target.value })}
                      className="w-full px-3 py-2 border border-[#d1d5db] rounded-lg text-sm bg-white"
                    >
                      <option value="">選択</option>
                      {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#374151] mb-1">改訂日</label>
                  <input
                    type="text"
                    value={form.revision_date}
                    onChange={e => setForm({ ...form, revision_date: e.target.value })}
                    className="w-full px-3 py-2 border border-[#d1d5db] rounded-lg text-sm focus:ring-1 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
                    placeholder="例: 20250401"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-[#6b7280] hover:text-[#374151] transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2c4f7c] disabled:opacity-50 transition-colors"
                >
                  {saving ? '保存中...' : editingId ? '更新' : '追加'}
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
