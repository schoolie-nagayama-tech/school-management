'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, Modal, Select, ToastContainer, Loading } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import {
  getSeasonalCourse,
  updateSeasonalCourse,
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

  // 季節の背景色
  const getSeasonColor = (season: SeasonType) => {
    switch (season) {
      case 'spring': return 'bg-[#fff9e5] border-[#ffeb3b]';
      case 'summer': return 'bg-[#ffe5e5] border-[#ffb3b3]';
      case 'winter': return 'bg-[#e5f3ff] border-[#bae1ff]';
      default: return 'bg-surface-hover border-border';
    }
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

      {/* 戻るボタン */}
      <div className="mb-4">
        <Link href="/courses">
          <Button variant="secondary" size="sm">
            ← コース一覧に戻る
          </Button>
        </Link>
      </div>

      {/* 基本情報 */}
      <div className={`mb-6 p-6 rounded-xl border-2 ${getSeasonColor(course.season)}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-text-heading">基本情報</h2>
          {!isEditingBasic ? (
            <Button variant="secondary" size="sm" onClick={() => setIsEditingBasic(true)}>
              編集
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setIsEditingBasic(false);
                  setEditName(course.name);
                  setEditSeason(course.season);
                  setEditTargetGrades(course.target_grades);
                  setEditComment(course.comment || '');
                }}
              >
                キャンセル
              </Button>
              <Button variant="primary" size="sm" onClick={handleSaveBasic} disabled={isSaving}>
                保存
              </Button>
            </div>
          )}
        </div>

        {!isEditingBasic ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <span className="text-sm font-medium text-text-body">コース名:</span>
              <p className="text-lg font-bold text-text-heading">{course.name}</p>
            </div>
            <div>
              <span className="text-sm font-medium text-text-body">季節:</span>
              <p className="text-lg font-bold text-text-heading">{SEASON_LABELS[course.season]}</p>
            </div>
            <div>
              <span className="text-sm font-medium text-text-body">対象学年:</span>
              <p className="text-lg font-bold text-text-heading">
                {course.target_grades.map(g => GRADE_LABELS[g] || g).join(', ')}
              </p>
            </div>
            <div>
              <span className="text-sm font-medium text-text-body">合計コマ数:</span>
              <p className="text-lg font-bold text-info">{course.total_koma}コマ</p>
            </div>
            {course.comment && (
              <div className="md:col-span-2">
                <span className="text-sm font-medium text-text-body">コメント:</span>
                <p className="text-text-heading">{course.comment}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-heading mb-1">コース名</label>
              <input
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-heading mb-1">季節</label>
              <div className="flex gap-2">
                {(['spring', 'summer', 'winter'] as SeasonType[]).map(season => (
                  <button
                    key={season}
                    onClick={() => setEditSeason(season)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                      editSeason === season
                        ? season === 'spring'
                          ? 'bg-[#ffeb3b] text-text-heading'
                          : season === 'summer'
                          ? 'bg-[#ff8e8e] text-text-heading'
                          : 'bg-[#8ec5ff] text-text-heading'
                        : 'bg-surface-hover text-text-body'
                    }`}
                  >
                    {SEASON_LABELS[season]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-heading mb-2">対象学年</label>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(grade => (
                  <label
                    key={grade}
                    className={`px-3 py-1.5 rounded-lg cursor-pointer text-sm ${
                      editTargetGrades.includes(grade)
                        ? 'bg-info text-white'
                        : 'bg-surface-hover text-text-body'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={editTargetGrades.includes(grade)}
                      onChange={() => toggleGrade(grade)}
                      className="hidden"
                    />
                    {GRADE_LABELS[grade]}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-heading mb-1">コメント</label>
              <textarea
                value={editComment}
                onChange={e => setEditComment(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-border rounded-lg"
              />
            </div>
          </div>
        )}
      </div>

      {/* テキスト選択 */}
      <div className="mb-6 p-4 bg-surface-raised rounded-xl border border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-text-heading">テキスト</h3>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsAddTextbookModalOpen(true)}
            disabled={(course.textbooks?.length || 0) >= 3}
          >
            + テキスト追加 ({course.textbooks?.length || 0}/3)
          </Button>
        </div>

        {course.textbooks?.length === 0 ? (
          <p className="text-text-body text-center py-4">テキストを追加してください</p>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {course.textbooks?.map(ct => (
              <div
                key={ct.id}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-colors duration-150 cursor-pointer ${
                  selectedTextbookId === ct.textbook_id
                    ? 'bg-info border-info text-text-heading'
                    : 'bg-surface-hover border-surface-hover text-text-body hover:border-info'
                }`}
                onClick={() => setSelectedTextbookId(ct.textbook_id)}
              >
                <span className="font-medium">{ct.textbook?.name}</span>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    handleRemoveTextbook(ct.textbook_id, ct.textbook?.name || '');
                  }}
                  className="text-danger hover:text-danger/80 ml-2 transition-colors duration-150"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* カリキュラム編集 */}
      {selectedTextbookId && (
        <div className="bg-surface-raised rounded-xl border border-border overflow-hidden">
          {/* コントロールパネル */}
          <div className="p-4 bg-surface-hover border-b border-border">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <h3 className="text-lg font-bold text-text-heading">
                カリキュラム設定
                <span className="ml-4 text-info">合計: {calculatedTotalKoma}コマ</span>
              </h3>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveProposalCounts}
                  disabled={isSaving || proposalCountValues.size === 0}
                >
                  {isSaving ? '保存中...' : '提案回数を保存'}
                </Button>
                <Link href={`/courses/${courseId}/apply`}>
                  <Button variant="primary" size="sm">
                    生徒に適用する
                  </Button>
                </Link>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleGroup}
                  disabled={isSaving || selectedItems.size < 2}
                >
                  グループ化 ({selectedItems.size})
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleUngroup}
                  disabled={isSaving || selectedItems.size === 0}
                >
                  グループ解除
                </Button>
              </div>
            </div>
          </div>

          {/* テーブル */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-surface-hover border-b border-border">
                  <th className="px-4 py-3 text-center w-10 border-r border-border">
                    <input
                      type="checkbox"
                      checked={curriculumItems.length > 0 && selectedItems.size === curriculumItems.length}
                      onChange={e => {
                        if (e.target.checked) {
                          setSelectedItems(new Set(curriculumItems.map(item => item.id)));
                        } else {
                          setSelectedItems(new Set());
                        }
                      }}
                      className="w-4 h-4"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-text-heading border-r border-border">
                    単元名
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-text-heading w-28">
                    提案回数
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-text-body">
                      カリキュラム項目がありません
                    </td>
                  </tr>
                ) : (
                  displayRows.map(row => {
                    const groupColor = getGroupColor(row.setting?.group_number);
                    const isChecked = selectedItems.has(row.curriculumItem.id);

                    return (
                      <tr
                        key={row.curriculumItem.id}
                        className={`border-b border-border hover:bg-surface-hover transition-colors duration-150 ${groupColor}`}
                      >
                        <td className="px-4 py-3 text-center border-r border-border">
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
                            className="w-4 h-4"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-text-heading border-r border-border">
                          {row.curriculumItem.item_number && (
                            <span className="text-text-body mr-2">{row.curriculumItem.item_number}</span>
                          )}
                          {row.curriculumItem.title}
                        </td>
                        {row.isGroupStart && (
                          <td
                            className="px-4 py-3 text-center"
                            rowSpan={row.groupRowSpan}
                          >
                            <input
                              type="number"
                              min="0"
                              value={proposalCountValues.get(row.curriculumItem.id) ?? row.groupProposalCount}
                              onChange={e => handleProposalCountChange(row, parseInt(e.target.value) || 0)}
                              className="w-20 px-2 py-1 text-center border border-border rounded"
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
              {displayRows.length > 0 && (
                <tfoot>
                  <tr className="bg-surface-hover font-bold">
                    <td colSpan={2} className="px-4 py-3 text-right text-sm text-text-heading border-r border-border">
                      合計
                    </td>
                    <td className="px-4 py-3 text-center text-lg text-info">
                      {calculatedTotalKoma}コマ
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

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
              <div className="max-h-64 overflow-y-auto space-y-2">
                {availableTextbooks.map(textbook => (
                  <div
                    key={textbook.id}
                    className="p-3 bg-surface-hover rounded-lg border border-border hover:bg-border transition-colors duration-150 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium text-text-heading">{textbook.name}</div>
                      <div className="text-sm text-text-body">
                        {textbook.grade && <span>学年: {textbook.grade}</span>}
                        {textbook.publisher && <span className="ml-2">出版社: {textbook.publisher}</span>}
                        {textbook.subject && <span className="ml-2">科目: {textbook.subject}</span>}
                      </div>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleAddTextbook(textbook.id)}
                    >
                      追加
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* 保存中インジケーター */}
      {isSaving && (
        <div className="fixed bottom-4 right-4 bg-black text-white px-4 py-2 rounded-lg shadow-lg">
          保存中...
        </div>
      )}
      {ConfirmDialog}
    </AdminLayout>
  );
}
