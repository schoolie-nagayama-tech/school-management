'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, Modal, ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import {
  getSeasonalCourse,
  applyCoursesToStudents,
  getCourseApplications,
} from '@/lib/api/seasonalCourses';
import { getStudents } from '@/lib/api/students';
import type {
  SeasonalCourseWithDetails,
  SeasonalCourseApplication,
  Student,
} from '@/types/database';
import { SEASON_LABELS, GRADE_LABELS } from '@/types/database';

export default function CourseApplyPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params?.courseId as string;
  const { toasts, removeToast, success, error } = useToast();

  const [course, setCourse] = useState<SeasonalCourseWithDetails | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [applications, setApplications] = useState<SeasonalCourseApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);

  // 選択状態
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [applyMode, setApplyMode] = useState<'overwrite' | 'add'>('overwrite');

  // 確認モーダル
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  // フィルター
  const [filterGrade, setFilterGrade] = useState<number | ''>('');
  const [searchKeyword, setSearchKeyword] = useState('');

  // コース情報を取得
  const fetchCourse = useCallback(async () => {
    if (!courseId) return;
    try {
      const data = await getSeasonalCourse(courseId);
      if (data) {
        setCourse(data);
      } else {
        error('コースが見つかりません');
        router.push('/courses');
      }
    } catch (err) {
      console.error('Error fetching course:', err);
      error(err instanceof Error ? err.message : 'コース情報の取得に失敗しました');
    }
  }, [courseId, error, router]);

  // 生徒一覧を取得
  const fetchStudents = useCallback(async () => {
    try {
      const data = await getStudents();
      // 在籍中の生徒のみ
      setStudents(data.filter(s => s.status === 'active'));
    } catch (err) {
      console.error('Error fetching students:', err);
      error(err instanceof Error ? err.message : '生徒一覧の取得に失敗しました');
    }
  }, [error]);

  // 適用履歴を取得
  const fetchApplications = useCallback(async () => {
    if (!courseId) return;
    try {
      const data = await getCourseApplications(courseId);
      setApplications(data);
    } catch (err) {
      console.error('Error fetching applications:', err);
    }
  }, [courseId]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await Promise.all([fetchCourse(), fetchStudents(), fetchApplications()]);
      setIsLoading(false);
    };
    load();
  }, [fetchCourse, fetchStudents, fetchApplications]);

  // 対象学年の生徒のみフィルター
  const targetStudents = useMemo(() => {
    if (!course) return [];
    return students.filter(s => course.target_grades.includes(s.grade));
  }, [students, course]);

  // フィルター済み生徒
  const filteredStudents = useMemo(() => {
    return targetStudents.filter(s => {
      if (filterGrade !== '' && s.grade !== filterGrade) return false;
      if (searchKeyword) {
        const keyword = searchKeyword.toLowerCase();
        const fullName = `${s.last_name}${s.first_name}`.toLowerCase();
        const fullNameKana = `${s.last_name_kana || ''}${s.first_name_kana || ''}`.toLowerCase();
        const studentCode = (s.student_code || '').toLowerCase();
        if (!fullName.includes(keyword) && !fullNameKana.includes(keyword) && !studentCode.includes(keyword)) {
          return false;
        }
      }
      return true;
    });
  }, [targetStudents, filterGrade, searchKeyword]);

  // 適用済み生徒IDのセット
  const appliedStudentIds = useMemo(() => {
    return new Set(applications.map(a => a.student_id));
  }, [applications]);

  // 全選択/全解除
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedStudentIds(new Set(filteredStudents.map(s => s.id)));
    } else {
      setSelectedStudentIds(new Set());
    }
  };

  // 個別選択
  const handleSelectStudent = (studentId: string, checked: boolean) => {
    const newSet = new Set(selectedStudentIds);
    if (checked) {
      newSet.add(studentId);
    } else {
      newSet.delete(studentId);
    }
    setSelectedStudentIds(newSet);
  };

  // 適用実行
  const handleApply = async () => {
    if (!courseId || selectedStudentIds.size === 0) return;
    setIsApplying(true);
    try {
      await applyCoursesToStudents(courseId, Array.from(selectedStudentIds), applyMode);
      await fetchApplications();
      setSelectedStudentIds(new Set());
      setIsConfirmModalOpen(false);
      success(`${selectedStudentIds.size}名に適用しました`);
    } catch (err) {
      console.error('Error applying course:', err);
      error(err instanceof Error ? err.message : '適用に失敗しました');
    } finally {
      setIsApplying(false);
    }
  };

  // 季節の背景色
  const getSeasonColor = (season: string) => {
    switch (season) {
      case 'spring': return 'bg-[#fff9e5] border-[#ffeb3b]';
      case 'summer': return 'bg-[#ffe5e5] border-[#ffb3b3]';
      case 'winter': return 'bg-[#e5f3ff] border-[#bae1ff]';
      default: return 'bg-[#f3f4f6] border-[#e5e7eb]';
    }
  };

  if (isLoading) {
    return (
      <AdminLayout headerTitle="コース適用">
        <div className="flex items-center justify-center py-12">
          <div className="text-[#4b5563]">読み込み中...</div>
        </div>
      </AdminLayout>
    );
  }

  if (!course) {
    return (
      <AdminLayout headerTitle="コース適用">
        <div className="flex items-center justify-center py-12">
          <div className="text-[#ef4444]">コースが見つかりません</div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle={`コース適用 - ${course.name}`}>
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* 戻るボタン */}
      <div className="mb-4 flex gap-2">
        <Link href="/courses">
          <Button variant="secondary" size="sm">
            ← コース一覧
          </Button>
        </Link>
        <Link href={`/courses/${courseId}`}>
          <Button variant="secondary" size="sm">
            コース編集
          </Button>
        </Link>
      </div>

      {/* コース情報サマリー */}
      <div className={`mb-6 p-4 rounded-xl border-2 ${getSeasonColor(course.season)}`}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-xl font-bold text-[#1f2937]">{course.name}</h2>
            <div className="flex items-center gap-4 mt-2 text-sm text-[#4b5563]">
              <span>{SEASON_LABELS[course.season]}</span>
              <span>対象: {course.target_grades.map(g => GRADE_LABELS[g]).join(', ')}</span>
              <span>テキスト: {course.textbooks?.length || 0}冊</span>
              <span className="text-[#3b82f6] font-bold">合計: {course.total_koma}コマ</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-[#4b5563]">適用済み</div>
            <div className="text-2xl font-bold text-[#3b82f6]">{applications.length}名</div>
          </div>
        </div>
      </div>

      {/* 適用モード選択 */}
      <div className="mb-6 p-4 bg-white rounded-xl border border-[#e5e7eb]">
        <h3 className="text-sm font-bold text-[#1f2937] mb-3">適用モード</h3>
        <div className="flex gap-4">
          <label
            className={`flex-1 p-4 rounded-lg border-2 cursor-pointer transition-colors duration-150 ${
              applyMode === 'overwrite'
                ? 'border-[#3b82f6] bg-[#3b82f6]/10'
                : 'border-[#f3f4f6] hover:border-[#3b82f6]'
            }`}
          >
            <input
              type="radio"
              name="applyMode"
              value="overwrite"
              checked={applyMode === 'overwrite'}
              onChange={() => setApplyMode('overwrite')}
              className="hidden"
            />
            <div className="font-bold text-[#1f2937]">上書き</div>
            <div className="text-sm text-[#4b5563] mt-1">
              既存の提案回数を上書きします。グループ化も上書きされます。
            </div>
          </label>
          <label
            className={`flex-1 p-4 rounded-lg border-2 cursor-pointer transition-colors duration-150 ${
              applyMode === 'add'
                ? 'border-[#3b82f6] bg-[#3b82f6]/10'
                : 'border-[#f3f4f6] hover:border-[#3b82f6]'
            }`}
          >
            <input
              type="radio"
              name="applyMode"
              value="add"
              checked={applyMode === 'add'}
              onChange={() => setApplyMode('add')}
              className="hidden"
            />
            <div className="font-bold text-[#1f2937]">加算</div>
            <div className="text-sm text-[#4b5563] mt-1">
              既存の提案回数に加算します。グループ化は上書きされます。
            </div>
          </label>
        </div>
      </div>

      {/* 生徒選択 */}
      <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
        {/* ヘッダー */}
        <div className="p-4 bg-[#f3f4f6] border-b border-[#e5e7eb]">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h3 className="text-lg font-bold text-[#1f2937]">
              対象生徒を選択
              <span className="ml-2 text-sm font-normal text-[#4b5563]">
                （{targetStudents.length}名が対象学年）
              </span>
            </h3>
            <div className="flex items-center gap-4">
              {/* 検索 */}
              <input
                type="text"
                placeholder="氏名・コードで検索"
                value={searchKeyword}
                onChange={e => setSearchKeyword(e.target.value)}
                className="px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm w-48"
              />
              {/* 学年フィルター */}
              <select
                value={filterGrade}
                onChange={e => setFilterGrade(e.target.value ? parseInt(e.target.value) : '')}
                className="px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm"
              >
                <option value="">全学年</option>
                {course.target_grades.map(g => (
                  <option key={g} value={g}>{GRADE_LABELS[g]}</option>
                ))}
              </select>
              {/* 適用ボタン */}
              <Button
                variant="primary"
                onClick={() => setIsConfirmModalOpen(true)}
                disabled={selectedStudentIds.size === 0}
              >
                選択した{selectedStudentIds.size}名に適用
              </Button>
            </div>
          </div>
        </div>

        {/* テーブル */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                <th className="px-4 py-3 text-center w-10 border-r border-[#e5e7eb]">
                  <input
                    type="checkbox"
                    checked={filteredStudents.length > 0 && selectedStudentIds.size === filteredStudents.length}
                    onChange={e => handleSelectAll(e.target.checked)}
                    className="w-4 h-4"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-[#1f2937] border-r border-[#e5e7eb]">
                  氏名
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-[#1f2937] border-r border-[#e5e7eb]">
                  学年
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-[#1f2937]">
                  適用状況
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-[#4b5563]">
                    対象の生徒がいません
                  </td>
                </tr>
              ) : (
                filteredStudents.map(student => {
                  const isApplied = appliedStudentIds.has(student.id);
                  const isChecked = selectedStudentIds.has(student.id);

                  return (
                    <tr
                      key={student.id}
                      className={`border-b border-[#e5e7eb] hover:bg-[#f3f4f6] transition-colors duration-150 ${
                        isChecked ? 'bg-[#3b82f6]/10' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-center border-r border-[#e5e7eb]">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => handleSelectStudent(student.id, e.target.checked)}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-[#1f2937] border-r border-[#e5e7eb]">
                        <Link
                          href={`/students/${student.id}/progress`}
                          className="text-[#1f2937] hover:text-[#3b82f6] hover:underline transition-colors duration-150"
                        >
                          {student.last_name} {student.first_name}
                          {student.last_name_kana && (
                            <span className="ml-2 text-xs text-[#4b5563]">
                              ({student.last_name_kana} {student.first_name_kana})
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-[#4b5563] border-r border-[#e5e7eb]">
                        {GRADE_LABELS[student.grade] || student.grade}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isApplied ? (
                          <span className="inline-block px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                            適用済み
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-1 bg-[#f3f4f6] text-[#4b5563] rounded text-xs">
                            未適用
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 適用履歴 */}
      {applications.length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
          <div className="p-4 bg-[#f3f4f6] border-b border-[#e5e7eb]">
            <h3 className="text-lg font-bold text-[#1f2937]">適用履歴</h3>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-[#1f2937] border-r border-[#e5e7eb]">
                    生徒名
                  </th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-[#1f2937] border-r border-[#e5e7eb]">
                    モード
                  </th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-[#1f2937]">
                    適用日時
                  </th>
                </tr>
              </thead>
              <tbody>
                {applications.map(app => (
                  <tr key={app.id} className="border-b border-[#e5e7eb]/50 hover:bg-[#f3f4f6] transition-colors duration-150">
                    <td className="px-4 py-2 text-sm text-[#1f2937] border-r border-[#e5e7eb]/50">
                      {app.student?.last_name} {app.student?.first_name}
                    </td>
                    <td className="px-4 py-2 text-center text-sm text-[#4b5563] border-r border-[#e5e7eb]/50">
                      {app.applied_mode === 'overwrite' ? '上書き' : '加算'}
                    </td>
                    <td className="px-4 py-2 text-center text-sm text-[#4b5563]">
                      {new Date(app.applied_at).toLocaleString('ja-JP')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 確認モーダル */}
      <Modal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        title="適用の確認"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-[#1f2937]">
            以下の内容で適用します。よろしいですか？
          </p>
          <div className="p-4 bg-[#f3f4f6] rounded-lg space-y-2">
            <div className="flex justify-between">
              <span className="text-[#4b5563]">コース:</span>
              <span className="font-medium text-[#1f2937]">{course.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#4b5563]">対象生徒:</span>
              <span className="font-medium text-[#1f2937]">{selectedStudentIds.size}名</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#4b5563]">モード:</span>
              <span className="font-medium text-[#1f2937]">
                {applyMode === 'overwrite' ? '上書き' : '加算'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#4b5563]">テキスト:</span>
              <span className="font-medium text-[#1f2937]">{course.textbooks?.length || 0}冊</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#4b5563]">合計コマ数:</span>
              <span className="font-medium text-[#3b82f6]">{course.total_koma}コマ</span>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-[#e5e7eb]">
            <Button variant="secondary" onClick={() => setIsConfirmModalOpen(false)}>
              キャンセル
            </Button>
            <Button variant="primary" onClick={handleApply} disabled={isApplying}>
              {isApplying ? '適用中...' : '適用する'}
            </Button>
          </div>
        </div>
      </Modal>
    </AdminLayout>
  );
}
