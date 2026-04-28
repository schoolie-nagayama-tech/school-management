'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { getTextbooks, createTextbook, updateTextbook, deleteTextbook } from '@/lib/api/textbooks';
import type { Textbook, TextbookInsert } from '@/types/database';
import { Plus, Search, Edit2, Trash2, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';

const SCHOOL_TYPES = ['小学', '中学', '高校'];
const GRADES = ['1年', '2年', '3年', '4年', '5年', '6年', '共通'];
const SUBJECTS = ['英語', '数学', '算数', '国語', '理科', '社会'];

const SUBJECT_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  '英語': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  '数学': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500' },
  '算数': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500' },
  '国語': { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500' },
  '理科': { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
  '社会': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
};

const DEFAULT_COLORS = { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', dot: 'bg-gray-400' };

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
  const router = useRouter();
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

  // Filter & Sort
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
    const SUBJECT_ORDER = ['英語', '数学', '算数', '国語', '理科', '社会'];
    const GRADE_ORDER = ['1年', '2年', '3年', '4年', '5年', '6年', '共通'];
    result = [...result].sort((a, b) => {
      const stA = SCHOOL_TYPES.indexOf(a.school_type || '');
      const stB = SCHOOL_TYPES.indexOf(b.school_type || '');
      if (stA !== stB) return (stA === -1 ? 999 : stA) - (stB === -1 ? 999 : stB);
      const subjA = SUBJECT_ORDER.indexOf(a.subject || '');
      const subjB = SUBJECT_ORDER.indexOf(b.subject || '');
      if (subjA !== subjB) return (subjA === -1 ? 999 : subjA) - (subjB === -1 ? 999 : subjB);
      const grA = GRADE_ORDER.indexOf(a.grade || '');
      const grB = GRADE_ORDER.indexOf(b.grade || '');
      if (grA !== grB) return (grA === -1 ? 999 : grA) - (grB === -1 ? 999 : grB);
      return a.name.localeCompare(b.name, 'ja');
    });
    return result;
  }, [textbooks, schoolTypeFilter, gradeFilter, subjectFilter, search]);

  // Group by school_type → subject
  const grouped = useMemo(() => {
    const groups: { key: string; schoolType: string; subject: string; items: Textbook[] }[] = [];
    const map = new Map<string, Textbook[]>();
    for (const t of filtered) {
      const key = `${t.school_type || '未分類'}__${t.subject || '未分類'}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    map.forEach((items, key) => {
      const [schoolType, subject] = key.split('__');
      groups.push({ key, schoolType, subject, items });
    });
    return groups;
  }, [filtered]);

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

  const openEditModal = (e: React.MouseEvent, t: Textbook) => {
    e.stopPropagation();
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

  const handleDelete = async (e: React.MouseEvent, id: number, name: string) => {
    e.stopPropagation();
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
      <div className="max-w-[1600px] mx-auto py-6 px-4">
        {/* Header */}
        <div className="mb-6">
          <Link href="/settings" className="inline-flex items-center text-sm text-[#6b7280] hover:text-[#374151] mb-4">
            <ChevronLeft className="w-4 h-4 mr-1" />設定に戻る
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-[#1f2937]">教材マスタ管理</h1>
              <p className="text-sm text-[#6b7280] mt-1">教材をクリックするとカリキュラム（目次）を管理できます</p>
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
        <div className="bg-white border border-[#e5e7eb] rounded-lg p-3 mb-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af]" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="教材名・出版社で検索..."
                className="w-full pl-9 pr-3 py-1.5 border border-[#d1d5db] rounded-lg text-sm focus:ring-1 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
              />
            </div>
            <select
              value={schoolTypeFilter}
              onChange={e => { setSchoolTypeFilter(e.target.value); setGradeFilter(''); }}
              className="px-3 py-1.5 border border-[#d1d5db] rounded-lg text-sm bg-white"
            >
              <option value="">種別: 全て</option>
              {SCHOOL_TYPES.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
            <select
              value={gradeFilter}
              onChange={e => setGradeFilter(e.target.value)}
              className="px-3 py-1.5 border border-[#d1d5db] rounded-lg text-sm bg-white"
            >
              <option value="">学年: 全て</option>
              {availableGrades.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select
              value={subjectFilter}
              onChange={e => setSubjectFilter(e.target.value)}
              className="px-3 py-1.5 border border-[#d1d5db] rounded-lg text-sm bg-white"
            >
              <option value="">科目: 全て</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Count */}
        <div className="text-xs text-[#9ca3af] mb-3">
          {filtered.length}件 / {textbooks.length}件
        </div>

        {/* Content */}
        {loading ? (
          <div className="bg-white border border-[#e5e7eb] rounded-lg p-12 text-center text-[#9ca3af]">読み込み中...</div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-[#e5e7eb] rounded-lg p-12 text-center text-[#9ca3af]">
            教材が見つかりません
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(group => {
              const colors = SUBJECT_COLORS[group.subject] || DEFAULT_COLORS;
              return (
                <div key={group.key}>
                  {/* Group Header */}
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                    <h2 className="text-sm font-semibold text-[#374151]">
                      {group.schoolType} / {group.subject}
                    </h2>
                    <span className="text-xs text-[#9ca3af]">{group.items.length}件</span>
                  </div>

                  {/* Cards */}
                  <div className="space-y-1">
                    {group.items.map(t => (
                      <div
                        key={t.id}
                        onClick={() => router.push(`/settings/textbooks/${t.id}/curriculum`)}
                        className={`group flex items-center gap-3 px-4 py-3 bg-white border rounded-lg cursor-pointer
                          hover:${colors.bg} hover:${colors.border} border-[#e5e7eb] hover:border-[#d1d5db]
                          hover:shadow-sm transition-[box-shadow,border-color,background-color] duration-150 ease-out`}
                      >
                        {/* Subject Indicator */}
                        <div className={`flex-shrink-0 w-1 h-8 rounded-full ${colors.dot} opacity-40 group-hover:opacity-100 transition-opacity`} />

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-[#1f2937] truncate">{t.name}</span>
                            {t.publisher && (
                              <span className="flex-shrink-0 text-xs text-[#9ca3af]">{t.publisher}</span>
                            )}
                          </div>
                        </div>

                        {/* Tags */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-[#f3f4f6] text-[#6b7280]">
                            {t.grade || '-'}
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => openEditModal(e, t)}
                            className="p-1.5 text-[#9ca3af] hover:text-[#1e3a5f] hover:bg-white rounded transition-colors"
                            title="編集"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => handleDelete(e, t.id, t.name)}
                            className="p-1.5 text-[#9ca3af] hover:text-red-500 hover:bg-white rounded transition-colors"
                            title="削除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Arrow */}
                        <ChevronRight className="w-4 h-4 text-[#d1d5db] group-hover:text-[#9ca3af] flex-shrink-0 transition-colors" />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

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
                    placeholder="例: フォレスタ 英語I"
                    autoFocus
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
