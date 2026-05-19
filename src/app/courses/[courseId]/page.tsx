'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Link2, Unlink, Plus, Save, Trash2, Users, X } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Modal, Select, ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import {
  getSeasonalCourse,
  updateSeasonalCourse,
  deleteSeasonalCourse,
  addTextbookToCourse,
  removeTextbookFromCourse,
  getCourseCurriculum,
  saveBulkCourseCurriculum,
  groupCourseCurriculumItems,
  ungroupCourseCurriculumItems,
  convertToCourseCurriculumRows,
} from '@/lib/api/seasonalCourses';
import { getTextbooks } from '@/lib/api/textbooks';
import type {
  SeasonalCourseWithDetails,
  SeasonalCourseCurriculum,
  SeasonType,
  Textbook,
  CurriculumItem,
  CourseCurriculumRow,
} from '@/types/database';
import { SEASON_LABELS, GRADE_LABELS } from '@/types/database';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';

export default function CourseDetailPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const params = useParams();
  const router = useRouter();
  const courseId = params?.courseId as string;
  const { toasts, removeToast, success, error } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [course, setCourse] = useState<SeasonalCourseWithDetails | null>(null);
  const [allTextbooks, setAllTextbooks] = useState<Textbook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // テキスト追加モーダル
  const [isAddTextbookModalOpen, setIsAddTextbookModalOpen] = useState(false);
  const [selectedGradeCategory, setSelectedGradeCategory] = useState<string>('');
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [selectedGrade, setSelectedGrade] = useState<string>('');

  // カリキュラム編集
  const [selectedTextbookId, setSelectedTextbookId] = useState<number | null>(null);
  const [curriculumItems, setCurriculumItems] = useState<CurriculumItem[]>([]);
  const [curriculumSettings, setCurriculumSettings] = useState<SeasonalCourseCurriculum[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [proposalCountValues, setProposalCountValues] = useState<Map<number, number>>(new Map());

  // コース基本情報編集
  const [editName, setEditName] = useState('');
  const [editSeason, setEditSeason] = useState<SeasonType>('summer');
  const [editTargetGrades, setEditTargetGrades] = useState<number[]>([]);
  const [editComment, setEditComment] = useState('');
  const [isEditingBasic, setIsEditingBasic] = useState(false);

  // コース情報を取得
  const fetchCourse = useCallback(async () => {
    if (!courseId) return;
    setIsLoading(true);
    try {
      const data = await getSeasonalCourse(courseId);
      if (data) {
        setCourse(data);
        setEditName(data.name);
        setEditSeason(data.season);
        setEditTargetGrades(data.target_grades);
        setEditComment(data.comment || '');
        // 最初のテキストを選択
        if (data.textbooks?.length > 0 && !selectedTextbookId) {
          setSelectedTextbookId(data.textbooks[0].textbook_id);
        }
      } else {
        error('コースが見つかりません');
        router.push('/courses');
      }
    } catch (err) {
      console.error('Error fetching course:', err);
      error(err instanceof Error ? err.message : 'コース情報の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [courseId, error, router]);

  // テキストマスタを取得
  const fetchTextbooks = useCallback(async () => {
    try {
      const data = await getTextbooks();
      setAllTextbooks(data);
    } catch (err) {
      console.error('Error fetching textbooks:', err);
    }
  }, []);

  // カリキュラム情報を取得
  const fetchCurriculum = useCallback(async () => {
    if (!courseId || !selectedTextbookId) return;
    try {
      const { items, settings } = await getCourseCurriculum(courseId, selectedTextbookId);
      setCurriculumItems(items);
      setCurriculumSettings(settings);
      // 提案回数の値をリセット
      setProposalCountValues(new Map());
    } catch (err) {
      console.error('Error fetching curriculum:', err);
      error(err instanceof Error ? err.message : 'カリキュラムの取得に失敗しました');
    }
  }, [courseId, selectedTextbookId, error]);

  useEffect(() => {
    fetchCourse();
    fetchTextbooks();
  }, [fetchCourse, fetchTextbooks]);

  useEffect(() => {
    if (selectedTextbookId) {
      fetchCurriculum();
      setSelectedItems(new Set());
      // ローカル状態をクリア
      setProposalCountValues(new Map());
    }
  }, [selectedTextbookId, fetchCurriculum]);

  // 表示用データ
  const displayRows = useMemo(() => {
    return convertToCourseCurriculumRows(curriculumItems, curriculumSettings);
  }, [curriculumItems, curriculumSettings]);

  // 合計コマ数を計算（入力中の値も考慮）
  const calculatedTotalKoma = useMemo(() => {
    return displayRows
      .filter(row => row.isGroupStart)
      .reduce((sum, row) => {
        const inputValue = proposalCountValues.get(row.curriculumItem.id);
        return sum + (inputValue !== undefined ? inputValue : row.groupProposalCount);
      }, 0);
  }, [displayRows, proposalCountValues]);

  // 利用可能なテキスト（コースに未追加のもの）
  const availableTextbooks = useMemo(() => {
    if (!course) return [];
    const addedIds = course.textbooks?.map(t => t.textbook_id) || [];
    return allTextbooks.filter(tb => {
      if (addedIds.includes(tb.id)) return false;
      if (selectedGradeCategory && tb.grade_category !== selectedGradeCategory) return false;
      if (selectedSubject && tb.subject !== selectedSubject) return false;
      if (selectedGrade && tb.grade !== selectedGrade) return false;
      return true;
    });
  }, [allTextbooks, course, selectedGradeCategory, selectedSubject, selectedGrade]);

  // 利用可能な科目
  const availableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    allTextbooks.forEach(tb => {
      if (tb.subject) subjects.add(tb.subject);
    });
    return Array.from(subjects).sort();
  }, [allTextbooks]);

  // 利用可能な学年
  const availableGrades = useMemo(() => {
    const grades = new Set<string>();
    allTextbooks.forEach(tb => {
      if (tb.grade) grades.add(tb.grade);
    });
    return Array.from(grades).sort();
  }, [allTextbooks]);

  const handleDeleteCourse = async () => {
    if (!courseId || !course) return;
    if (!(await confirm({
      title: 'コースを削除',
      description: `「${course.name}」を削除しますか？`,
      confirmLabel: '削除',
      variant: 'danger',
    }))) return;
    try {
      await deleteSeasonalCourse(courseId);
      router.push('/courses');
    } catch (err) {
      error(err instanceof Error ? err.message : '削除に失敗しました');
    }
  };

  // 基本情報を保存
  const handleSaveBasic = async () => {
    if (!courseId || !editName.trim()) {
      error('コース名を入力してください');
      return;
    }
    setIsSaving(true);
    try {
      await updateSeasonalCourse(courseId, {
        name: editName.trim(),
        season: editSeason,
        target_grades: editTargetGrades,
        comment: editComment.trim() || null,
        total_koma: calculatedTotalKoma,
      });
      await fetchCourse();
      setIsEditingBasic(false);
      success('コース情報を更新しました');
    } catch (err) {
      console.error('Error updating course:', err);
      error(err instanceof Error ? err.message : 'コース情報の更新に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // テキストを追加
  const handleAddTextbook = async (textbookId: number) => {
    if (!courseId) return;
    if ((course?.textbooks?.length || 0) >= 3) {
      error('テキストは最大3冊までです');
      return;
    }
    setIsSaving(true);
    try {
      await addTextbookToCourse(courseId, textbookId, course?.textbooks?.length || 0);
      await fetchCourse();
      setIsAddTextbookModalOpen(false);
      setSelectedGradeCategory('');
      setSelectedSubject('');
      success('テキストを追加しました');
    } catch (err) {
      console.error('Error adding textbook:', err);
      error(err instanceof Error ? err.message : 'テキストの追加に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // テキストを削除
  const handleRemoveTextbook = async (textbookId: number, textbookName: string) => {
    if (!courseId) return;
    if (!(await confirm({ title: '削除確認', description: `「${textbookName}」をコースから削除しますか？\nカリキュラム設定も削除されます。`, confirmLabel: '削除', variant: 'danger' }))) {
      return;
    }
    setIsSaving(true);
    try {
      await removeTextbookFromCourse(courseId, textbookId);
      await fetchCourse();
      if (selectedTextbookId === textbookId) {
        const remainingTextbooks = course?.textbooks?.filter(t => t.textbook_id !== textbookId) || [];
        setSelectedTextbookId(remainingTextbooks[0]?.textbook_id || null);
      }
      success('テキストを削除しました');
    } catch (err) {
      console.error('Error removing textbook:', err);
      error(err instanceof Error ? err.message : 'テキストの削除に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // 提案回数を更新（ローカル状態のみ、保存はしない）
  const handleProposalCountChange = useCallback((
    row: CourseCurriculumRow,
    value: number
  ) => {
    // 即座に表示を更新（ローカル状態のみ）
    const newValues = new Map(proposalCountValues);
    if (row.isGroupStart) {
      // グループの場合は、グループ内の全アイテムの値を更新
      const groupNumber = row.setting?.group_number;
      if (groupNumber != null) {
        displayRows
          .filter(r => r.setting?.group_number === groupNumber)
          .forEach(r => {
            newValues.set(r.curriculumItem.id, r.curriculumItem.id === row.curriculumItem.id ? value : 0);
          });
      } else {
        newValues.set(row.curriculumItem.id, value);
      }
    } else {
      newValues.set(row.curriculumItem.id, value);
    }
    setProposalCountValues(newValues);
  }, [proposalCountValues, displayRows]);

  // 提案回数を一括保存
  const handleSaveProposalCounts = useCallback(async () => {
    if (!courseId || !selectedTextbookId) return;
    setIsSaving(true);
    try {
      // 変更された値を取得
      const updates: Array<{
        curriculum_item_id: number;
        proposal_count: number;
        group_number: number | null;
      }> = [];

      for (const row of displayRows) {
        if (!row.isGroupStart) continue; // グループの先頭行のみ処理

        const inputValue = proposalCountValues.get(row.curriculumItem.id);
        if (inputValue === undefined) continue; // 変更されていない場合はスキップ

        const groupNumber = row.setting?.group_number;

        if (groupNumber != null) {
          // グループの場合
          const groupItems = displayRows.filter(
            r => r.setting?.group_number === groupNumber
          );
          
          groupItems.forEach((item, index) => {
            updates.push({
              curriculum_item_id: item.curriculumItem.id,
              proposal_count: index === 0 ? inputValue : 0,
              group_number: groupNumber,
            });
          });
        } else {
          // 単独行
          updates.push({
            curriculum_item_id: row.curriculumItem.id,
            proposal_count: inputValue,
            group_number: null,
          });
        }
      }

      if (updates.length === 0) {
        success('変更がありません');
        return;
      }

      // 一括保存
      await saveBulkCourseCurriculum(courseId, selectedTextbookId, updates);

      await fetchCurriculum();
      // 合計コマ数を再計算して更新
      const { items: newItems, settings: newSettings } = await getCourseCurriculum(courseId, selectedTextbookId);
      const newDisplayRows = convertToCourseCurriculumRows(newItems, newSettings);
      const _newTotalKoma = newDisplayRows
        .filter(r => r.isGroupStart)
        .reduce((sum, r) => sum + r.groupProposalCount, 0);
      
      // 全テキストの合計を計算
      let totalKomaAll = 0;
      if (course?.textbooks) {
        for (const ct of course.textbooks) {
          const { items: itemsForTextbook, settings: settingsForTextbook } = await getCourseCurriculum(courseId, ct.textbook_id);
          const rowsForTextbook = convertToCourseCurriculumRows(itemsForTextbook, settingsForTextbook);
          totalKomaAll += rowsForTextbook
            .filter(r => r.isGroupStart)
            .reduce((sum, r) => sum + r.groupProposalCount, 0);
        }
      }
      
      await updateSeasonalCourse(courseId, { total_koma: totalKomaAll });
      await fetchCourse();
      
      // ローカル状態をクリア
      setProposalCountValues(new Map());
      success('提案回数を保存しました');
    } catch (err) {
      console.error('Error saving proposal counts:', err);
      error(err instanceof Error ? err.message : '提案回数の保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  }, [courseId, selectedTextbookId, displayRows, proposalCountValues, course, fetchCurriculum, fetchCourse, error, success]);

  // グループ化
  const handleGroup = async () => {
    if (!courseId || !selectedTextbookId) return;
    if (selectedItems.size < 2) {
      error('グループ化には2つ以上の単元を選択してください');
      return;
    }
    setIsSaving(true);
    try {
      await groupCourseCurriculumItems(courseId, selectedTextbookId, Array.from(selectedItems));
      await fetchCurriculum();
      setSelectedItems(new Set());
      success('グループ化しました');
    } catch (err) {
      console.error('Error grouping items:', err);
      error(err instanceof Error ? err.message : 'グループ化に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // グループ解除
  const handleUngroup = async () => {
    if (!courseId) return;
    if (selectedItems.size === 0) {
      error('解除する単元を選択してください');
      return;
    }
    setIsSaving(true);
    try {
      await ungroupCourseCurriculumItems(courseId, Array.from(selectedItems));
      await fetchCurriculum();
      setSelectedItems(new Set());
      success('グループ解除しました');
    } catch (err) {
      console.error('Error ungrouping items:', err);
      error(err instanceof Error ? err.message : 'グループ解除に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  // グループの背景色
  const getGroupColor = (groupNumber: number | null | undefined): string => {
    if (groupNumber == null) return '';
    const colors = [
      'bg-blue-50',
      'bg-green-50',
      'bg-yellow-50',
      'bg-purple-50',
      'bg-pink-50',
      'bg-orange-50',
    ];
    return colors[(groupNumber - 1) % colors.length];
  };

  const SEASON_BADGE: Record<SeasonType, string> = {
    spring: 'bg-pink-100 text-pink-700',
    summer: 'bg-sky-100 text-sky-700',
    winter: 'bg-slate-100 text-slate-600',
  };

  // 学年チェックボックスの切り替え
  const toggleGrade = (grade: number) => {
    setEditTargetGrades(prev =>
      prev.includes(grade)
        ? prev.filter(g => g !== grade)
        : [...prev, grade].sort((a, b) => a - b)
    );
  };

  if (isLoading) {
    return (
      <AdminLayout headerTitle="コース詳細">
        <Loading size="md" />
      </AdminLayout>
    );
  }

  if (!course) {
    return (
      <AdminLayout headerTitle="コース詳細">
        <div className="flex items-center justify-center py-12">
          <div className="text-danger">コースが見つかりません</div>
        </div>
      </AdminLayout>
    );
  }

  // 権限チェック中
  if (permissionLoading) {
    return (
      <AdminLayout>
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  // 権限なし
  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied message="講習管理ページは教室長以上のみアクセス可能です" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle={`コース編集 - ${course.name}`}>
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <div className="max-w-5xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-5">
          <Link
            href="/courses"
            onClick={(e) => {
              e.preventDefault();
              router.back();
            }}
            className="text-sm text-text-muted hover:text-text-heading inline-flex items-center gap-1 mb-2 transition-colors duration-150"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            講習一覧
          </Link>

          {!isEditingBasic ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-text-heading">{course.name}</h1>
                  <span className={`px-2 py-0.5 text-[11px] font-bold rounded ${SEASON_BADGE[course.season]}`}>
                    {SEASON_LABELS[course.season]}
                  </span>
                  <span className="text-sm font-bold text-accent-ink tabular-nums">
                    {calculatedTotalKoma > 0 ? `${calculatedTotalKoma}コマ` : `${course.total_koma}コマ`}
                  </span>
                </div>
                <p className="text-sm text-text-muted mt-0.5">
                  {course.target_grades.length > 0
                    ? course.target_grades.map(g => GRADE_LABELS[g] || g).join(' ')
                    : '学年未設定'}
                  {course.comment && (
                    <span className="ml-2 text-text-muted/70">— {course.comment}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDeleteCourse}
                  className="p-1.5 text-text-faint hover:text-danger rounded-lg hover:bg-surface-hover transition-[background-color,color] duration-150 ease-out"
                  title="削除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsEditingBasic(true)}
                  className="px-3 py-1.5 text-xs font-medium text-text-body border border-border-default rounded-lg hover:bg-surface-hover transition-[background-color] duration-150 ease-out"
                >
                  編集
                </button>
              </div>
            </div>
          ) : (
            <section className="p-4 bg-surface-raised rounded-xl border border-border-default">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-text-heading">基本情報を編集</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setIsEditingBasic(false);
                      setEditName(course.name);
                      setEditSeason(course.season);
                      setEditTargetGrades(course.target_grades);
                      setEditComment(course.comment || '');
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-text-body border border-border-default rounded-lg hover:bg-surface-hover transition-colors duration-150"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleSaveBasic}
                    disabled={isSaving}
                    className="px-3 py-1.5 text-xs font-medium bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] transition-[filter] duration-150 disabled:opacity-50"
                  >
                    {isSaving ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-text-muted block mb-1">コース名</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-border-default rounded-lg bg-surface-raised focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <div className="flex gap-4">
                  <div>
                    <label className="text-xs font-bold text-text-muted block mb-1">シーズン</label>
                    <div className="flex gap-1">
                      {(['spring', 'summer', 'winter'] as SeasonType[]).map(s => (
                        <button
                          key={s}
                          onClick={() => setEditSeason(s)}
                          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors duration-150 ${
                            editSeason === s
                              ? 'bg-ink text-text-on-primary'
                              : 'bg-surface-hover text-text-body hover:bg-border-default'
                          }`}
                        >
                          {SEASON_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-bold text-text-muted block mb-1">対象学年</label>
                    <div className="flex flex-wrap gap-1">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(grade => (
                        <button
                          key={grade}
                          onClick={() => toggleGrade(grade)}
                          className={`px-2 py-1 text-[11px] rounded-md transition-colors duration-150 ${
                            editTargetGrades.includes(grade)
                              ? 'bg-ink text-text-on-primary font-bold'
                              : 'bg-surface-hover text-text-muted hover:bg-border-default'
                          }`}
                        >
                          {GRADE_LABELS[grade]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-text-muted block mb-1">コメント</label>
                  <input
                    type="text"
                    value={editComment}
                    onChange={e => setEditComment(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm border border-border-default rounded-lg bg-surface-raised focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    placeholder="講習に関するメモ"
                  />
                </div>
              </div>
            </section>
          )}
        </div>

        {!isEditingBasic && (
        <div className="space-y-5">
          {/* テキスト */}
          <section className="p-4 bg-surface-raised rounded-xl border border-border-default">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-text-muted">テキスト</div>
              <button
                onClick={() => setIsAddTextbookModalOpen(true)}
                disabled={(course.textbooks?.length || 0) >= 3}
                className="px-2.5 py-1 text-[11px] font-medium bg-ink text-text-on-primary rounded-md hover:brightness-[0.85] transition-[filter] duration-150 disabled:opacity-40 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                テキスト追加 ({course.textbooks?.length || 0}/3)
              </button>
            </div>
            {course.textbooks?.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-3">テキストを追加してください</p>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {course.textbooks?.map(ct => (
                  <button
                    key={ct.id}
                    onClick={() => setSelectedTextbookId(ct.textbook_id)}
                    className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
                      selectedTextbookId === ct.textbook_id
                        ? 'bg-ink text-text-on-primary'
                        : 'bg-surface-hover text-text-body hover:bg-border-default'
                    }`}
                  >
                    {ct.textbook?.name}
                    <span
                      onClick={e => {
                        e.stopPropagation();
                        handleRemoveTextbook(ct.textbook_id, ct.textbook?.name || '');
                      }}
                      className={`ml-0.5 transition-colors duration-150 ${
                        selectedTextbookId === ct.textbook_id
                          ? 'text-text-on-primary/60 hover:text-text-on-primary'
                          : 'text-text-faint hover:text-danger'
                      }`}
                    >
                      <X className="w-3 h-3" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* カリキュラム設定 */}
          {selectedTextbookId && (
            <section className="bg-surface-raised rounded-xl border border-border-default overflow-hidden">
              <div className="p-4 flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-sm font-bold text-text-heading">
                  対象単元を設定
                  <span className="ml-3 text-accent-ink">{calculatedTotalKoma}コマ</span>
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGroup}
                    disabled={isSaving || selectedItems.size < 2}
                    className="px-2 py-1 text-[11px] bg-surface-hover text-text-muted rounded-md hover:bg-border-default flex items-center gap-1 transition-colors duration-150 disabled:opacity-40"
                  >
                    <Link2 className="w-3 h-3" />
                    グループ化 ({selectedItems.size})
                  </button>
                  <button
                    onClick={handleUngroup}
                    disabled={isSaving || selectedItems.size === 0}
                    className="px-2 py-1 text-[11px] text-text-faint hover:text-text-muted rounded-md transition-colors duration-150 disabled:opacity-40 flex items-center gap-1"
                  >
                    <Unlink className="w-3 h-3" />
                    グループ解除
                  </button>
                  <button
                    onClick={handleSaveProposalCounts}
                    disabled={isSaving || proposalCountValues.size === 0}
                    className="px-3 py-1.5 text-[11px] font-medium bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] transition-[filter] duration-150 disabled:opacity-40 flex items-center gap-1"
                  >
                    <Save className="w-3 h-3" />
                    {isSaving ? '保存中...' : '提案回数を保存'}
                  </button>
                  <Link
                    href={`/courses/${courseId}/apply`}
                    className="px-3 py-1.5 text-[11px] font-medium text-text-body border border-border-default rounded-lg hover:bg-surface-hover transition-colors duration-150 flex items-center gap-1"
                  >
                    <Users className="w-3 h-3" />
                    生徒に適用する
                  </Link>
                </div>
              </div>

              {/* ヘッダーラベル */}
              {displayRows.length > 0 && (
                <div className="flex items-center px-4 py-1.5 border-t border-border-subtle text-[10px] text-text-faint font-medium">
                  <div className="w-7 text-center shrink-0" />
                  <div className="flex-1 pl-1">単元名</div>
                  <div className="w-20 text-center shrink-0">提案回数</div>
                </div>
              )}

              {/* 単元リスト */}
              <div className="border-t border-border-subtle">
                {displayRows.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-text-muted">
                    カリキュラム項目がありません
                  </div>
                ) : (
                  displayRows.map((row, _idx) => {
                    const groupColor = getGroupColor(row.setting?.group_number);
                    const isChecked = selectedItems.has(row.curriculumItem.id);
                    const isGrouped = row.setting?.group_number != null;

                    return (
                      <div
                        key={row.curriculumItem.id}
                        className={`flex items-center px-4 py-2 border-b border-border-subtle last:border-b-0 transition-colors duration-100 ${groupColor} ${
                          isChecked ? 'bg-primary/5' : 'hover:bg-surface-hover/50'
                        }`}
                      >
                        <div className="w-7 shrink-0 flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={e => {
                              const newSet = new Set(selectedItems);
                              if (e.target.checked) {
                                newSet.add(row.curriculumItem.id);
                              } else {
                                newSet.delete(row.curriculumItem.id);
                              }
                              setSelectedItems(newSet);
                            }}
                            className="w-3.5 h-3.5 rounded"
                          />
                        </div>
                        <div className="flex-1 min-w-0 pl-1">
                          <span className="text-sm text-text-heading">
                            {row.curriculumItem.item_number != null && (
                              <span className="text-text-muted mr-1.5 tabular-nums text-xs">{row.curriculumItem.item_number}</span>
                            )}
                            {row.curriculumItem.title}
                          </span>
                          {isGrouped && row.isGroupStart && (
                            <span className="ml-2 text-[10px] text-text-faint">
                              G{row.setting?.group_number} ({row.groupRowSpan}単元)
                            </span>
                          )}
                        </div>
                        {row.isGroupStart && (
                          <div className="w-20 shrink-0 flex justify-center" style={row.groupRowSpan > 1 ? {} : {}}>
                            <input
                              type="number"
                              min="0"
                              value={proposalCountValues.get(row.curriculumItem.id) ?? row.groupProposalCount}
                              onChange={e => handleProposalCountChange(row, parseInt(e.target.value) || 0)}
                              className="w-16 px-2 py-1 text-center text-sm border border-border-default rounded-lg bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary tabular-nums"
                            />
                          </div>
                        )}
                        {!row.isGroupStart && isGrouped && (
                          <div className="w-20 shrink-0" />
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* フッター合計 */}
              {displayRows.length > 0 && (
                <div className="flex items-center px-4 py-2.5 border-t border-border-default bg-surface-hover/50">
                  <div className="flex-1 text-right text-xs font-bold text-text-heading pr-4">合計</div>
                  <div className="w-20 shrink-0 text-center text-sm font-bold text-accent-ink tabular-nums">
                    {calculatedTotalKoma}コマ
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
        )}
      </div>

      {/* テキスト追加モーダル */}
      <Modal
        isOpen={isAddTextbookModalOpen}
        onClose={() => {
          setIsAddTextbookModalOpen(false);
          setSelectedGradeCategory('');
          setSelectedSubject('');
          setSelectedGrade('');
        }}
        title="テキストを追加"
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Select
              label="学年カテゴリ"
              value={selectedGradeCategory}
              onChange={e => {
                setSelectedGradeCategory(e.target.value);
                setSelectedSubject('');
                setSelectedGrade('');
              }}
              options={[
                { value: '', label: 'すべて' },
                { value: 'elementary', label: '小学生' },
                { value: 'middle', label: '中学生' },
                { value: 'high', label: '高校生' },
              ]}
            />
            <Select
              label="学年"
              value={selectedGrade}
              onChange={e => setSelectedGrade(e.target.value)}
              options={[
                { value: '', label: 'すべて' },
                ...availableGrades.map(g => ({ value: g, label: g })),
              ]}
            />
            <Select
              label="科目"
              value={selectedSubject}
              onChange={e => setSelectedSubject(e.target.value)}
              options={[
                { value: '', label: 'すべて' },
                ...availableSubjects.map(s => ({ value: s, label: s })),
              ]}
            />
          </div>

          <div className="border-t border-border pt-4">
            <h4 className="text-sm font-semibold text-text-heading mb-3">テキスト一覧</h4>
            {availableTextbooks.length === 0 ? (
              <p className="text-sm text-text-body text-center py-4">
                追加可能なテキストがありません
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1">
                {availableTextbooks.map(textbook => (
                  <div
                    key={textbook.id}
                    className="p-3 rounded-lg border border-border-subtle hover:bg-surface-hover transition-colors duration-150 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium text-sm text-text-heading">{textbook.name}</div>
                      <div className="text-xs text-text-muted">
                        {textbook.grade && <span>{textbook.grade}</span>}
                        {textbook.publisher && <span className="ml-2">{textbook.publisher}</span>}
                        {textbook.subject && <span className="ml-2">{textbook.subject}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => handleAddTextbook(textbook.id)}
                      className="px-2.5 py-1 text-[11px] font-medium bg-ink text-text-on-primary rounded-md hover:brightness-[0.85] transition-[filter] duration-150"
                    >
                      追加
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {ConfirmDialog}
    </AdminLayout>
  );
}
