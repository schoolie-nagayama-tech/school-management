'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckSquare, Copy, Square } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Button, Loading, InlineLoading } from '@/components/ui';
import { getSeasonalCourses, createSeasonalCourse, deployCourseToSchools } from '@/lib/api/seasonalCourses';
import { useAuth } from '@/contexts/AuthContext';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import type { SeasonalCourseWithDetails, SeasonType } from '@/types/database';
import { SEASON_LABELS, GRADE_LABELS } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';

export default function CoursesPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const { getSelectedSchoolIds, schoolIds } = useAuth();
  const { localSchoolId, setLocalSchoolId, isAllSelected, availableSchools } = useLocalSchoolId();

  const [courses, setCourses] = useState<SeasonalCourseWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 選択状態
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isDeploying, setIsDeploying] = useState(false);

  // 新規作成フォーム
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseSeason, setNewCourseSeason] = useState<SeasonType>('spring');
  const [newCourseGrades, setNewCourseGrades] = useState<number[]>([]);
  const [newCourseTotalKoma, setNewCourseTotalKoma] = useState<number | ''>('');
  const [newCourseComment, setNewCourseComment] = useState('');
  const [applyToAllSchools, setApplyToAllSchools] = useState(false);

  const fetchCourses = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      if (!localSchoolId) {
        setCourses([]);
        return;
      }
      const data = await getSeasonalCourses(localSchoolId);
      setCourses(data);
    } catch (error) {
      console.error('Error fetching courses:', error);
      setErrorMessage(getUserErrorMessage(error, '講習一覧の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [localSchoolId]);

  useEffect(() => {
    if (localSchoolId) {
      fetchCourses();
    }
  }, [fetchCourses, localSchoolId]);

  // 教室切り替え時に選択をリセット
  useEffect(() => {
    setSelected(new Set());
  }, [localSchoolId]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === courses.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(courses.map((c) => c.id)));
    }
  };

  // 全教室に展開
  const handleDeploy = async () => {
    if (selected.size === 0) return;
    const count = selected.size;
    const targetCount = schoolIds.length - 1;
    if (targetCount <= 0) {
      setErrorMessage('展開先の教室がありません');
      return;
    }
    if (!window.confirm(
      `選択した${count}件の講習を他の${targetCount}教室に展開します。\n\n同名・同季節の講習が既にある教室はスキップされます。よろしいですか？`
    )) return;

    setIsDeploying(true);
    setErrorMessage('');
    try {
      let totalCreated = 0;
      let totalSkipped = 0;
      for (const courseId of selected) {
        const { created, skipped } = await deployCourseToSchools(courseId, schoolIds);
        totalCreated += created;
        totalSkipped += skipped;
      }
      setSelected(new Set());
      alert(`${totalCreated}件を作成しました。${totalSkipped}件はスキップされました。`);
      await fetchCourses();
    } catch (error) {
      console.error('Error deploying courses:', error);
      setErrorMessage(getUserErrorMessage(error, '展開に失敗しました'));
    } finally {
      setIsDeploying(false);
    }
  };

  // 新規作成
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCourseName.trim()) {
      setErrorMessage('コース名を入力してください');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const targetSchoolIds = applyToAllSchools ? schoolIds : getSelectedSchoolIds();
      if (targetSchoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        return;
      }
      const courseData = {
        name: newCourseName.trim(),
        season: newCourseSeason,
        target_grades: newCourseGrades,
        total_koma: newCourseTotalKoma === '' ? undefined : Number(newCourseTotalKoma),
        comment: newCourseComment.trim() || undefined,
      };
      await Promise.all(
        targetSchoolIds.map((schoolId) => createSeasonalCourse(schoolId, courseData))
      );
      setIsCreateModalOpen(false);
      setNewCourseName('');
      setNewCourseSeason('spring');
      setNewCourseGrades([]);
      setNewCourseTotalKoma('');
      setNewCourseComment('');
      setApplyToAllSchools(false);
      await fetchCourses();
    } catch (error) {
      console.error('Error creating course:', error);
      setErrorMessage(getUserErrorMessage(error, '講習の作成に失敗しました'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (permissionLoading) {
    return (
      <AdminLayout>
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  const hasSelection = selected.size > 0;
  const canDeploy = schoolIds.length > 1;

  return (
    <AdminLayout headerTitle="講習管理">
      {isAllSelected && (
        <SchoolSwitcher
          schools={availableSchools}
          selectedSchoolId={localSchoolId}
          onChange={setLocalSchoolId}
        />
      )}

      {errorMessage && (
        <div className="mb-6 p-4 bg-danger/10 border border-danger rounded-lg">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-danger" />
            <p className="text-sm text-danger">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* ツールバー */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-heading">講習一覧</h1>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          + 新規講習を作成
        </Button>
      </div>

      {/* 一括操作バー */}
      {!isLoading && courses.length > 0 && canDeploy && (
        <div className={`mb-4 flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors duration-150 ${
          hasSelection ? 'bg-info/5 border-info/30' : 'bg-surface border-border-subtle'
        }`}>
          <button
            onClick={toggleSelectAll}
            className="text-xs text-text-muted hover:text-text-heading transition-colors flex items-center gap-1"
          >
            {selected.size === courses.length
              ? <CheckSquare className="w-3.5 h-3.5 text-info" />
              : <Square className="w-3.5 h-3.5" />
            }
            {hasSelection ? `${selected.size}件選択中` : '一括選択'}
          </button>
          {hasSelection ? (
            <>
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-text-faint hover:text-text-muted"
              >
                解除
              </button>
              <div className="flex-1" />
              <button
                onClick={handleDeploy}
                disabled={isDeploying}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold bg-info text-white rounded-lg hover:bg-info/90 active:scale-[0.97] transition-[colors,transform] duration-150 disabled:opacity-50"
              >
                {isDeploying ? (
                  <InlineLoading size="sm" label="展開中..." />
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    全教室に展開（{schoolIds.length - 1}教室）
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <div className="flex-1" />
              <span className="text-xs text-text-faint">
                チェックして全教室に展開
              </span>
            </>
          )}
        </div>
      )}

      {/* コース一覧 */}
      {isLoading ? (
        <Loading className="min-h-[40vh]" />
      ) : courses.length === 0 ? (
        <div className="bg-surface-raised rounded-xl border border-border p-8 text-center">
          <p className="text-text-body mb-4">講習が登録されていません。</p>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            最初の講習を作成
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => {
            const isChecked = selected.has(course.id);
            return (
              <div
                key={course.id}
                className={`bg-surface-raised rounded-xl border p-6 transition-all duration-150 ${
                  isChecked ? 'border-info ring-1 ring-info/30' : 'border-border'
                }`}
              >
                {/* チェックボックス行 */}
                {canDeploy && (
                  <div className="flex items-center justify-end mb-2 -mt-1 -mr-1">
                    <button
                      onClick={() => toggleSelect(course.id)}
                      className="p-1 text-text-faint hover:text-text-heading transition-colors"
                    >
                      {isChecked
                        ? <CheckSquare className="w-4 h-4 text-info" />
                        : <Square className="w-4 h-4" />
                      }
                    </button>
                  </div>
                )}
                <Link
                  href={`/courses/${course.id}`}
                  className="block hover:opacity-80 transition-opacity duration-150"
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-lg font-bold text-text-heading flex-1">
                      {course.name}
                    </h3>
                    <span className="ml-2 px-2 py-1 text-xs font-bold bg-info/20 text-text-heading rounded">
                      {SEASON_LABELS[course.season]}
                    </span>
                  </div>
                  <div className="space-y-2 text-sm text-text-body">
                    <div>
                      <span className="font-medium">対象学年: </span>
                      {course.target_grades.length > 0
                        ? course.target_grades.map((g) => GRADE_LABELS[g]).join(', ')
                        : '未設定'}
                    </div>
                    {course.total_koma && (
                      <div>
                        <span className="font-medium">合計コマ数: </span>
                        {course.total_koma}コマ
                      </div>
                    )}
                    {course.comment && (
                      <div className="text-xs text-text-body/70 line-clamp-2">
                        {course.comment}
                      </div>
                    )}
                    <div className="pt-2 border-t border-border/10">
                      <span className="font-medium">適用数: </span>
                      {course.application_count || 0}件
                    </div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* 新規作成モーダル */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-surface-raised rounded-xl border border-border p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-text-heading mb-4">新規講習を作成</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-heading mb-1">
                  コース名 <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={newCourseName}
                  onChange={(e) => setNewCourseName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="例: 春期講習 中1数学"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-heading mb-1">
                  季節 <span className="text-danger">*</span>
                </label>
                <select
                  value={newCourseSeason}
                  onChange={(e) => setNewCourseSeason(e.target.value as SeasonType)}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {Object.entries(SEASON_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-heading mb-1">
                  対象学年
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto border border-border rounded-lg p-2">
                  {Object.entries(GRADE_LABELS).map(([gradeStr, label]) => {
                    const grade = Number(gradeStr);
                    return (
                      <label key={grade} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={newCourseGrades.includes(grade)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewCourseGrades([...newCourseGrades, grade]);
                            } else {
                              setNewCourseGrades(newCourseGrades.filter((g) => g !== grade));
                            }
                          }}
                          className="rounded border-border"
                        />
                        <span className="text-sm text-text-heading">{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-heading mb-1">
                  合計コマ数
                </label>
                <input
                  type="number"
                  value={newCourseTotalKoma}
                  onChange={(e) =>
                    setNewCourseTotalKoma(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  min="1"
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="例: 10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-heading mb-1">
                  コメント
                </label>
                <textarea
                  value={newCourseComment}
                  onChange={(e) => setNewCourseComment(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="講習に関するメモ"
                />
              </div>
              {schoolIds.length > 1 && (
                <div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={applyToAllSchools}
                      onChange={(e) => setApplyToAllSchools(e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-sm font-medium text-text-heading">
                      すべての教室に適用（{schoolIds.length}教室）
                    </span>
                  </label>
                  <p className="text-xs text-text-body mt-1 ml-6">
                    チェックを入れると、担当しているすべての教室に同じ講習が作成されます
                  </p>
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  onClick={() => {
                    setIsCreateModalOpen(false);
                    setNewCourseName('');
                    setNewCourseSeason('spring');
                    setNewCourseGrades([]);
                    setNewCourseTotalKoma('');
                    setNewCourseComment('');
                    setApplyToAllSchools(false);
                  }}
                  variant="secondary"
                  className="flex-1"
                >
                  キャンセル
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1"
                >
                  {isSubmitting ? '作成中...' : '作成'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
