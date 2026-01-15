'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, Modal, ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import {
  getSeasonalCourses,
  createSeasonalCourse,
  deleteSeasonalCourse,
} from '@/lib/api/seasonalCourses';
import { getDefaultSchoolId } from '@/lib/api/schools';
import type { SeasonalCourseWithDetails, SeasonType } from '@/types/database';
import { SEASON_LABELS, GRADE_LABELS } from '@/types/database';

export default function CoursesPage() {
  const { toasts, removeToast, success, error } = useToast();
  const [courses, setCourses] = useState<SeasonalCourseWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [filterSeason, setFilterSeason] = useState<SeasonType | ''>('');

  // 新規作成フォーム
  const [newName, setNewName] = useState('');
  const [newSeason, setNewSeason] = useState<SeasonType>('summer');
  const [newTargetGrades, setNewTargetGrades] = useState<number[]>([]);
  const [newComment, setNewComment] = useState('');

  // コース一覧を取得
  const fetchCourses = useCallback(async () => {
    setIsLoading(true);
    try {
      const schoolId = getDefaultSchoolId();
      const data = await getSeasonalCourses(schoolId);
      setCourses(data);
    } catch (err) {
      console.error('Error fetching courses:', err);
      error(err instanceof Error ? err.message : 'コース一覧の取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [error]);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  // コース作成
  const handleCreate = async () => {
    if (!newName.trim()) {
      error('コース名を入力してください');
      return;
    }
    if (newTargetGrades.length === 0) {
      error('対象学年を選択してください');
      return;
    }

    try {
      const schoolId = getDefaultSchoolId();
      await createSeasonalCourse(schoolId, {
        name: newName.trim(),
        season: newSeason,
        target_grades: newTargetGrades,
        comment: newComment.trim() || undefined,
      });
      await fetchCourses();
      setIsCreateModalOpen(false);
      resetForm();
      success('コースを作成しました');
    } catch (err) {
      console.error('Error creating course:', err);
      error(err instanceof Error ? err.message : 'コースの作成に失敗しました');
    }
  };

  // コース削除
  const handleDelete = async (courseId: string, courseName: string) => {
    if (!window.confirm(`「${courseName}」を削除しますか？\nこの操作は取り消せません。`)) {
      return;
    }

    try {
      await deleteSeasonalCourse(courseId);
      await fetchCourses();
      success('コースを削除しました');
    } catch (err) {
      console.error('Error deleting course:', err);
      error(err instanceof Error ? err.message : 'コースの削除に失敗しました');
    }
  };

  // フォームリセット
  const resetForm = () => {
    setNewName('');
    setNewSeason('summer');
    setNewTargetGrades([]);
    setNewComment('');
  };

  // 学年チェックボックスの切り替え
  const toggleGrade = (grade: number) => {
    setNewTargetGrades(prev =>
      prev.includes(grade)
        ? prev.filter(g => g !== grade)
        : [...prev, grade].sort((a, b) => a - b)
    );
  };

  // フィルター済みコース
  const filteredCourses = filterSeason
    ? courses.filter(c => c.season === filterSeason)
    : courses;

  // 季節ごとの背景色
  const getSeasonColor = (season: SeasonType) => {
    switch (season) {
      case 'spring': return 'bg-[#fff9e5] border-[#ffeb3b]';
      case 'summer': return 'bg-[#ffe5e5] border-[#ffb3b3]';
      case 'winter': return 'bg-[#e5f3ff] border-[#bae1ff]';
      default: return 'bg-[#eff0f3] border-[#0d0d0d]';
    }
  };

  const getSeasonBadgeColor = (season: SeasonType) => {
    switch (season) {
      case 'spring': return 'bg-[#ffeb3b] text-[#0d0d0d]';
      case 'summer': return 'bg-[#ff8e8e] text-[#0d0d0d]';
      case 'winter': return 'bg-[#8ec5ff] text-[#0d0d0d]';
      default: return 'bg-[#eff0f3] text-[#0d0d0d]';
    }
  };

  return (
    <AdminLayout headerTitle="講習管理">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* ヘッダー */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-[#0d0d0d]">コース一覧</h2>
          {/* 季節フィルター */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilterSeason('')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filterSeason === ''
                  ? 'bg-[#0d0d0d] text-[#fffffe]'
                  : 'bg-[#eff0f3] text-[#2a2a2a] hover:bg-[#0d0d0d]/10'
              }`}
            >
              すべて
            </button>
            <button
              onClick={() => setFilterSeason('spring')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filterSeason === 'spring'
                  ? 'bg-[#ffeb3b] text-[#0d0d0d] border-2 border-[#ffc107]'
                  : 'bg-[#fff9e5] text-[#2a2a2a] hover:bg-[#ffeb3b]'
              }`}
            >
              春期
            </button>
            <button
              onClick={() => setFilterSeason('summer')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filterSeason === 'summer'
                  ? 'bg-[#ff8e8e] text-[#0d0d0d] border-2 border-[#ff6b6b]'
                  : 'bg-[#ffe5e5] text-[#2a2a2a] hover:bg-[#ffb3b3]'
              }`}
            >
              夏期
            </button>
            <button
              onClick={() => setFilterSeason('winter')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filterSeason === 'winter'
                  ? 'bg-[#8ec5ff] text-[#0d0d0d] border-2 border-[#5aa3ff]'
                  : 'bg-[#e5f3ff] text-[#2a2a2a] hover:bg-[#bae1ff]'
              }`}
            >
              冬期
            </button>
          </div>
        </div>
        <Button
          onClick={() => setIsCreateModalOpen(true)}
          variant="primary"
        >
          + 新規コース作成
        </Button>
      </div>

      {/* コース一覧 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-[#2a2a2a]">読み込み中...</div>
        </div>
      ) : filteredCourses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 bg-[#eff0f3] rounded-xl">
          <p className="text-[#2a2a2a] mb-4">
            {filterSeason
              ? `${SEASON_LABELS[filterSeason]}のコースがありません`
              : 'コースがありません'}
          </p>
          <Button onClick={() => setIsCreateModalOpen(true)} variant="primary">
            コースを作成する
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCourses.map(course => (
            <div
              key={course.id}
              className={`p-4 rounded-xl border-2 ${getSeasonColor(course.season)} transition-shadow hover:shadow-md`}
            >
              {/* ヘッダー */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mb-2 ${getSeasonBadgeColor(course.season)}`}>
                    {SEASON_LABELS[course.season]}
                  </span>
                  <h3 className="text-lg font-bold text-[#0d0d0d]">{course.name}</h3>
                </div>
              </div>

              {/* 情報 */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm text-[#2a2a2a]">
                  <span className="font-medium">対象学年:</span>
                  <span>
                    {course.target_grades.map(g => GRADE_LABELS[g] || g).join(', ')}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm text-[#2a2a2a]">
                  <span className="font-medium">テキスト:</span>
                  <span>{course.textbooks?.length || 0}冊</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-[#2a2a2a]">
                  <span className="font-medium">合計コマ数:</span>
                  <span className="text-[#ff8e3c] font-bold">{course.total_koma}コマ</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-[#2a2a2a]">
                  <span className="font-medium">適用済み:</span>
                  <span>{course.application_count || 0}名</span>
                </div>
                {course.comment && (
                  <div className="text-sm text-[#2a2a2a] mt-2 p-2 bg-white/50 rounded">
                    {course.comment}
                  </div>
                )}
              </div>

              {/* アクション */}
              <div className="flex items-center gap-2 pt-3 border-t border-[#0d0d0d]/10">
                <Link href={`/courses/${course.id}`} className="flex-1">
                  <Button variant="primary" size="sm" className="w-full">
                    編集
                  </Button>
                </Link>
                <Link href={`/courses/${course.id}/apply`} className="flex-1">
                  <Button variant="secondary" size="sm" className="w-full">
                    適用
                  </Button>
                </Link>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleDelete(course.id, course.name)}
                >
                  削除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新規作成モーダル */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          resetForm();
        }}
        title="新規コース作成"
        size="md"
      >
        <div className="space-y-4">
          {/* コース名 */}
          <div>
            <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
              コース名 <span className="text-[#d9376e]">*</span>
            </label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="例：中3夏期 英語基礎"
              className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg"
            />
          </div>

          {/* 季節 */}
          <div>
            <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
              季節 <span className="text-[#d9376e]">*</span>
            </label>
            <div className="flex gap-2">
              {(['spring', 'summer', 'winter'] as SeasonType[]).map(season => (
                <button
                  key={season}
                  onClick={() => setNewSeason(season)}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    newSeason === season
                      ? season === 'spring'
                        ? 'bg-[#ffeb3b] text-[#0d0d0d] border-2 border-[#ffc107]'
                        : season === 'summer'
                        ? 'bg-[#ff8e8e] text-[#0d0d0d] border-2 border-[#ff6b6b]'
                        : 'bg-[#8ec5ff] text-[#0d0d0d] border-2 border-[#5aa3ff]'
                      : 'bg-[#eff0f3] text-[#2a2a2a] hover:bg-[#0d0d0d]/10'
                  }`}
                >
                  {SEASON_LABELS[season]}
                </button>
              ))}
            </div>
          </div>

          {/* 対象学年 */}
          <div>
            <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
              対象学年 <span className="text-[#d9376e]">*</span>
            </label>
            <div className="space-y-2">
              <div className="text-xs text-[#2a2a2a] mb-1">小学生</div>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6].map(grade => (
                  <label
                    key={grade}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      newTargetGrades.includes(grade)
                        ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                        : 'bg-[#eff0f3] text-[#2a2a2a] hover:bg-[#0d0d0d]/10'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={newTargetGrades.includes(grade)}
                      onChange={() => toggleGrade(grade)}
                      className="hidden"
                    />
                    <span className="text-sm">{GRADE_LABELS[grade]}</span>
                  </label>
                ))}
              </div>
              <div className="text-xs text-[#2a2a2a] mb-1 mt-3">中学生</div>
              <div className="flex flex-wrap gap-2">
                {[7, 8, 9].map(grade => (
                  <label
                    key={grade}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      newTargetGrades.includes(grade)
                        ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                        : 'bg-[#eff0f3] text-[#2a2a2a] hover:bg-[#0d0d0d]/10'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={newTargetGrades.includes(grade)}
                      onChange={() => toggleGrade(grade)}
                      className="hidden"
                    />
                    <span className="text-sm">{GRADE_LABELS[grade]}</span>
                  </label>
                ))}
              </div>
              <div className="text-xs text-[#2a2a2a] mb-1 mt-3">高校生</div>
              <div className="flex flex-wrap gap-2">
                {[10, 11, 12].map(grade => (
                  <label
                    key={grade}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      newTargetGrades.includes(grade)
                        ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                        : 'bg-[#eff0f3] text-[#2a2a2a] hover:bg-[#0d0d0d]/10'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={newTargetGrades.includes(grade)}
                      onChange={() => toggleGrade(grade)}
                      className="hidden"
                    />
                    <span className="text-sm">{GRADE_LABELS[grade]}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* コメント */}
          <div>
            <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
              コメント
            </label>
            <textarea
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder="コースの説明など"
              rows={3}
              className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg"
            />
          </div>

          {/* ボタン */}
          <div className="flex justify-end gap-2 pt-4 border-t border-[#0d0d0d]">
            <Button
              variant="secondary"
              onClick={() => {
                setIsCreateModalOpen(false);
                resetForm();
              }}
            >
              キャンセル
            </Button>
            <Button variant="primary" onClick={handleCreate}>
              作成
            </Button>
          </div>
        </div>
      </Modal>
    </AdminLayout>
  );
}
