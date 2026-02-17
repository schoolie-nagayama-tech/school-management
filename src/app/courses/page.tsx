'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button } from '@/components/ui';
import { getSeasonalCourses, createSeasonalCourse } from '@/lib/api/seasonalCourses';
import { useAuth } from '@/contexts/AuthContext';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import type { SeasonalCourseWithDetails, SeasonType } from '@/types/database';
import { SEASON_LABELS, GRADE_LABELS } from '@/types/database';

export default function CoursesPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const { getSelectedSchoolIds, selectedSchoolId, schoolIds } = useAuth();

  const [courses, setCourses] = useState<SeasonalCourseWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 新規作成フォーム
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseSeason, setNewCourseSeason] = useState<SeasonType>('spring');
  const [newCourseGrades, setNewCourseGrades] = useState<number[]>([]);
  const [newCourseTotalKoma, setNewCourseTotalKoma] = useState<number | ''>('');
  const [newCourseComment, setNewCourseComment] = useState('');
  const [applyToAllSchools, setApplyToAllSchools] = useState(false);

  // コース一覧を取得
  const fetchCourses = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setCourses([]);
        return;
      }

      // 複数教室が選択されている場合は最初の教室を使用（講習管理は単一教室のみ）
      const schoolId = schoolIds[0];
      const data = await getSeasonalCourses(schoolId);
      setCourses(data);
    } catch (error) {
      console.error('Error fetching courses:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '講習一覧の取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds]);

  // 初回読み込みと教室選択変更時の再読み込み
  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchCourses();
    }
  }, [fetchCourses, selectedSchoolId]);

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
      // すべての教室に適用する場合
      const targetSchoolIds = applyToAllSchools ? schoolIds : getSelectedSchoolIds();
      
      if (targetSchoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        return;
      }

      // 各教室に講習を作成
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
      setErrorMessage(
        error instanceof Error ? error.message : '講習の作成に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 権限チェック中
  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-[#4b5563]">読み込み中...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // 権限なし
  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="講習管理">
      {/* エラーメッセージ */}
      {errorMessage && (
        <div className="mb-6 p-4 bg-[#ef4444]/10 border border-[#ef4444] rounded-lg">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-[#ef4444]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-sm text-[#ef4444]">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* ツールバー */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1f2937]">講習一覧</h1>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          + 新規講習を作成
        </Button>
      </div>

      {/* コース一覧 */}
      {isLoading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-[#4b5563]">読み込み中...</p>
          </div>
        </div>
      ) : courses.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center">
          <p className="text-[#4b5563] mb-4">講習が登録されていません。</p>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            最初の講習を作成
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Link
              key={course.id}
              href={`/courses/${course.id}`}
              className="bg-white rounded-xl border border-[#e5e7eb] p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-lg font-bold text-[#1f2937] flex-1">
                  {course.name}
                </h3>
                <span className="ml-2 px-2 py-1 text-xs font-bold bg-[#3b82f6]/20 text-[#1f2937] rounded">
                  {SEASON_LABELS[course.season]}
                </span>
              </div>
              <div className="space-y-2 text-sm text-[#4b5563]">
                <div>
                  <span className="font-medium">対象学年: </span>
                  {course.target_grades.length > 0
                    ? course.target_grades
                        .map((g) => GRADE_LABELS[g])
                        .join(', ')
                    : '未設定'}
                </div>
                {course.total_koma && (
                  <div>
                    <span className="font-medium">合計コマ数: </span>
                    {course.total_koma}コマ
                  </div>
                )}
                {course.comment && (
                  <div className="text-xs text-[#4b5563]/70 line-clamp-2">
                    {course.comment}
                  </div>
                )}
                <div className="pt-2 border-t border-[#e5e7eb]/10">
                  <span className="font-medium">適用数: </span>
                  {course.application_count || 0}件
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* 新規作成モーダル */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-[#1f2937] mb-4">新規講習を作成</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#1f2937] mb-1">
                  コース名 <span className="text-[#ef4444]">*</span>
                </label>
                <input
                  type="text"
                  value={newCourseName}
                  onChange={(e) => setNewCourseName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                  placeholder="例: 春期講習 中1数学"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1f2937] mb-1">
                  季節 <span className="text-[#ef4444]">*</span>
                </label>
                <select
                  value={newCourseSeason}
                  onChange={(e) => setNewCourseSeason(e.target.value as SeasonType)}
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                >
                  {Object.entries(SEASON_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1f2937] mb-1">
                  対象学年
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto border border-[#e5e7eb] rounded-lg p-2">
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
                              setNewCourseGrades(
                                newCourseGrades.filter((g) => g !== grade)
                              );
                            }
                          }}
                          className="rounded border-[#e5e7eb]"
                        />
                        <span className="text-sm text-[#1f2937]">{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1f2937] mb-1">
                  合計コマ数
                </label>
                <input
                  type="number"
                  value={newCourseTotalKoma}
                  onChange={(e) =>
                    setNewCourseTotalKoma(
                      e.target.value === '' ? '' : Number(e.target.value)
                    )
                  }
                  min="1"
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                  placeholder="例: 10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1f2937] mb-1">
                  コメント
                </label>
                <textarea
                  value={newCourseComment}
                  onChange={(e) => setNewCourseComment(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
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
                      className="rounded border-[#e5e7eb]"
                    />
                    <span className="text-sm font-medium text-[#1f2937]">
                      すべての教室に適用（{schoolIds.length}教室）
                    </span>
                  </label>
                  <p className="text-xs text-[#4b5563] mt-1 ml-6">
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
