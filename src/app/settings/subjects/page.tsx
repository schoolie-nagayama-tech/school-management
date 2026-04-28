'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, Card, CardHeader, CardTitle, CardContent, Input, ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { ChevronLeft, Plus, Save, Trash2, RotateCcw } from 'lucide-react';
import {
  getAllAssessmentSubjects,
  createAssessmentSubject,
  updateAssessmentSubject,
  deactivateAssessmentSubject,
  deleteAssessmentSubject,
  type AssessmentSubject,
} from '@/lib/api/assessmentSubjects';
import { GRADE_LABELS } from '@/types/database';

const SCHOOL_TYPES: AssessmentSubject['school_type'][] = ['小学', '中学', '高校', '共通'];
const CATEGORIES: { value: string; label: string }[] = [
  { value: 'english', label: '英語系' },
  { value: 'math', label: '数学系' },
  { value: 'japanese', label: '国語系' },
  { value: 'science', label: '理科系' },
  { value: 'social', label: '社会系' },
  { value: 'info', label: '情報' },
  { value: 'art', label: '芸術' },
  { value: 'pe', label: '保健体育' },
  { value: 'tech_home', label: '技術・家庭' },
  { value: 'home', label: '家庭' },
  { value: 'life', label: '生活' },
  { value: 'exploration', label: '探究' },
  { value: 'other', label: 'その他' },
];

const GRADE_RANGE_BY_TYPE: Record<AssessmentSubject['school_type'], number[]> = {
  小学: [1, 2, 3, 4, 5, 6],
  中学: [7, 8, 9],
  高校: [10, 11, 12],
  共通: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

export default function SubjectsSettingsPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessSettings
  );
  const { toasts, removeToast, success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [subjects, setSubjects] = useState<AssessmentSubject[]>([]);
  const [filterType, setFilterType] = useState<AssessmentSubject['school_type'] | 'all'>('高校');
  const [showInactive, setShowInactive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [editing, setEditing] = useState<AssessmentSubject | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);

  // 編集パネルが出たらスクロール＆フォーカス
  useEffect(() => {
    if (!editing && !isCreating) return;
    const el = editorRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const firstInput = el.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
    firstInput?.focus();
  }, [editing, isCreating]);

  const fetchAll = async () => {
    setIsLoading(true);
    try {
      const list = await getAllAssessmentSubjects();
      setSubjects(list);
    } catch (e) {
      console.error(e);
      toastError('科目マスタの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => { fetchAll(); }, []);

  const filtered = useMemo(() => {
    return subjects
      .filter((s) => filterType === 'all' || s.school_type === filterType)
      .filter((s) => showInactive || s.is_active);
  }, [subjects, filterType, showInactive]);

  const groupedByType = useMemo(() => {
    const map = new Map<string, AssessmentSubject[]>();
    for (const s of filtered) {
      const key = s.school_type;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [filtered]);

  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">読み込み中...</div>
      </AdminLayout>
    );
  }
  if (!hasPermission) {
    return <AdminLayout><AccessDenied /></AdminLayout>;
  }

  return (
    <AdminLayout headerTitle="成績表科目マスタ">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Link href="/settings" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
          <ChevronLeft className="w-4 h-4 mr-1" />
          設定一覧に戻る
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>成績表科目マスタ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-gray-600">
              成績ページで使う科目を管理します。系統文（カテゴリ）が同じものは集計・アラートで一緒に扱われます。
              標準科目（システム）は無効化のみ、教室追加分は完全に削除できます。
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-gray-700 flex items-center gap-2">
                学校種別:
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as AssessmentSubject['school_type'] | 'all')}
                  className="px-2 py-1 border border-gray-300 rounded text-sm bg-white"
                >
                  <option value="all">すべて</option>
                  {SCHOOL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="text-sm text-gray-700 flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="w-4 h-4"
                />
                無効化済みも表示
              </label>
              <Button onClick={() => { setIsCreating(true); setEditing(null); }} size="sm">
                <Plus className="w-4 h-4 mr-1" />新規追加
              </Button>
            </div>
          </CardContent>
        </Card>

        {(isCreating || editing) && (
          <div ref={editorRef} className="subject-editor-enter">
            <SubjectEditor
              key={editing?.id ?? 'new'}
              initial={editing}
              onCancel={() => { setIsCreating(false); setEditing(null); }}
              onSaved={async () => {
                setIsCreating(false);
                setEditing(null);
                await fetchAll();
                success('保存しました');
              }}
              onError={(msg) => toastError(msg)}
            />
          </div>
        )}

        {isLoading ? (
          <div className="text-center text-sm text-gray-500 py-8">読み込み中...</div>
        ) : (
          Array.from(groupedByType.entries()).map(([type, list]) => (
            <Card key={type}>
              <CardHeader>
                <CardTitle className="text-base">{type}（{list.length}件）</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-2 py-2 font-medium">科目名</th>
                        <th className="text-left px-2 py-2 font-medium">略称</th>
                        <th className="text-left px-2 py-2 font-medium">対象学年</th>
                        <th className="text-left px-2 py-2 font-medium">カテゴリ</th>
                        <th className="text-left px-2 py-2 font-medium">状態</th>
                        <th className="text-right px-2 py-2 font-medium w-32">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((s) => (
                        <tr
                          key={s.id}
                          className={`border-b border-gray-100 hover:bg-gray-50 ${!s.is_active ? 'opacity-50' : ''}`}
                        >
                          <td className="px-2 py-2">
                            {s.name}
                            {s.is_system && <span className="ml-2 text-[10px] text-gray-400">標準</span>}
                            {s.is_required && <span className="ml-2 text-[10px] bg-red-50 text-red-600 px-1 rounded">必履修</span>}
                          </td>
                          <td className="px-2 py-2 text-gray-600">{s.short_name ?? '-'}</td>
                          <td className="px-2 py-2 text-gray-600 text-xs">
                            {s.applicable_grades.map((g) => GRADE_LABELS[g]).join('・')}
                          </td>
                          <td className="px-2 py-2 text-gray-600">
                            {CATEGORIES.find((c) => c.value === s.category)?.label ?? s.category}
                          </td>
                          <td className="px-2 py-2">
                            {s.is_active ? (
                              <span className="text-xs text-green-700">有効</span>
                            ) : (
                              <span className="text-xs text-gray-400">無効</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => { setEditing(s); setIsCreating(false); }}
                              className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1"
                            >
                              編集
                            </button>
                            {!s.is_active ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  await updateAssessmentSubject(s.id, { is_active: true });
                                  await fetchAll();
                                  success('有効化しました');
                                }}
                                className="text-xs text-emerald-600 hover:text-emerald-800 px-2 py-1"
                                title="有効化"
                              >
                                <RotateCcw className="w-3.5 h-3.5 inline" />
                              </button>
                            ) : s.is_system ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!(await confirm({ title: '無効化', description: `${s.name} を無効化しますか？（標準科目のため削除はできません）`, confirmLabel: '無効化', variant: 'danger' }))) return;
                                  try { await deactivateAssessmentSubject(s.id); await fetchAll(); success('無効化しました'); }
                                  catch (e) { toastError(e instanceof Error ? e.message : '失敗しました'); }
                                }}
                                className="text-xs text-amber-600 hover:text-amber-800 px-2 py-1"
                                title="無効化"
                              >
                                <Trash2 className="w-3.5 h-3.5 inline" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!(await confirm({ title: '削除', description: `${s.name} を完全に削除しますか？`, confirmLabel: '削除', variant: 'danger' }))) return;
                                  try { await deleteAssessmentSubject(s.id); await fetchAll(); success('削除しました'); }
                                  catch (e) { toastError(e instanceof Error ? e.message : '失敗しました'); }
                                }}
                                className="text-xs text-red-600 hover:text-red-800 px-2 py-1"
                                title="削除"
                              >
                                <Trash2 className="w-3.5 h-3.5 inline" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {ConfirmDialog}
    </AdminLayout>
  );
}

function SubjectEditor({
  initial,
  onCancel,
  onSaved,
  onError,
}: {
  initial: AssessmentSubject | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [shortName, setShortName] = useState(initial?.short_name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [schoolType, setSchoolType] = useState<AssessmentSubject['school_type']>(initial?.school_type ?? '高校');
  const [grades, setGrades] = useState<number[]>(initial?.applicable_grades ?? []);
  const [category, setCategory] = useState(initial?.category ?? 'other');
  const [isRequired, setIsRequired] = useState(initial?.is_required ?? false);
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 999);
  const [saving, setSaving] = useState(false);

  const toggleGrade = (g: number) => {
    setGrades((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g].sort((a, b) => a - b));
  };

  const save = async () => {
    if (!name.trim()) return onError('科目名を入力してください');
    if (!isEdit && !code.trim()) return onError('コードを入力してください（一意の英数字）');
    if (grades.length === 0) return onError('対象学年を1つ以上選択してください');
    setSaving(true);
    try {
      if (isEdit && initial) {
        await updateAssessmentSubject(initial.id, {
          name: name.trim(),
          short_name: shortName.trim() || null,
          school_type: schoolType,
          applicable_grades: grades,
          category,
          is_required: isRequired,
          sort_order: sortOrder,
        });
      } else {
        await createAssessmentSubject({
          code: code.trim(),
          name: name.trim(),
          short_name: shortName.trim() || null,
          school_type: schoolType,
          applicable_grades: grades,
          category,
          is_required: isRequired,
          sort_order: sortOrder,
        });
      }
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{isEdit ? '科目を編集' : '科目を追加'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">科目名 *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：英語コミュニケーションⅠ" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">略称</label>
            <Input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="例：英コⅠ" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">コード {!isEdit && '*'}</label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="例：hs_eng_com_1"
              disabled={isEdit}
            />
            {isEdit && <p className="text-[10px] text-gray-400 mt-1">コードは編集できません</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">学校種別 *</label>
            <select
              value={schoolType}
              onChange={(e) => {
                const t = e.target.value as AssessmentSubject['school_type'];
                setSchoolType(t);
                setGrades((prev) => prev.filter((g) => GRADE_RANGE_BY_TYPE[t].includes(g)));
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              {SCHOOL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">カテゴリ *</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">並び順</label>
            <Input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">対象学年 *</label>
          <div className="flex flex-wrap gap-2">
            {GRADE_RANGE_BY_TYPE[schoolType].map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => toggleGrade(g)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors duration-150 ${
                  grades.includes(g)
                    ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {GRADE_LABELS[g]}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isRequired}
            onChange={(e) => setIsRequired(e.target.checked)}
            className="w-4 h-4"
          />
          必履修科目として扱う
        </label>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>キャンセル</Button>
          <Button onClick={save} disabled={saving}>
            <Save className="w-4 h-4 mr-1" />
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
