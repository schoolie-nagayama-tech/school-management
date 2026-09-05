'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckSquare, Search, Square, Users } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { ToastContainer, Loading, InlineLoading } from '@/components/ui';
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
import { SEASON_COLORS } from '@/components/course-shared/seasonBadge';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';

export default function CourseApplyPage() {
  // 権限チェックはデータ取得より先に置く（この画面には権限判定がそもそも無かった）
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const params = useParams();
  const router = useRouter();
  const courseId = params?.courseId as string;
  const { toasts, removeToast, success, error } = useToast();

  const [course, setCourse] = useState<SeasonalCourseWithDetails | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [applications, setApplications] = useState<SeasonalCourseApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);

  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  // 下書き登録では実質未使用だが、applyCoursesToStudents の履歴記録の applied_mode 値として渡す
  const [applyMode] = useState<'overwrite' | 'add'>('overwrite');
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  const [filterGrade, setFilterGrade] = useState<number | ''>('');
  const [searchKeyword, setSearchKeyword] = useState('');

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
      error(err instanceof Error ? err.message : 'コース情報の取得に失敗しました');
    }
  }, [courseId, error, router]);

  const fetchStudents = useCallback(async () => {
    if (!course) return;
    try {
      const data = await getStudents(undefined, [course.school_id]);
      setStudents(data.filter((s) => s.status === 'active'));
    } catch (err) {
      error(err instanceof Error ? err.message : '生徒一覧の取得に失敗しました');
    }
  }, [error, course]);

  const fetchApplications = useCallback(async () => {
    if (!courseId) return;
    try {
      const data = await getCourseApplications(courseId);
      setApplications(data);
    } catch {
      // silently handle — non-critical
    }
  }, [courseId]);

  useEffect(() => {
    // 権限が確定するまで、また権限が無い場合は取得しない（画面を出さないだけでは取得は止まらない）
    if (permissionLoading || !hasPermission) return;
    const load = async () => {
      setIsLoading(true);
      await Promise.all([fetchCourse(), fetchApplications()]);
      setIsLoading(false);
    };
    load();
  }, [fetchCourse, fetchApplications, permissionLoading, hasPermission]);

  useEffect(() => {
    if (course) fetchStudents();
  }, [course, fetchStudents]);

  const targetStudents = useMemo(() => {
    if (!course) return [];
    return students.filter((s) => course.target_grades.includes(s.grade));
  }, [students, course]);

  const filteredStudents = useMemo(() => {
    return targetStudents.filter((s) => {
      if (filterGrade !== '' && s.grade !== filterGrade) return false;
      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        const name = `${s.last_name}${s.first_name}`.toLowerCase();
        const kana = `${s.last_name_kana || ''}${s.first_name_kana || ''}`.toLowerCase();
        const code = (s.student_code || '').toLowerCase();
        if (!name.includes(kw) && !kana.includes(kw) && !code.includes(kw)) return false;
      }
      return true;
    });
  }, [targetStudents, filterGrade, searchKeyword]);

  const appliedStudentIds = useMemo(() => {
    return new Set(applications.map((a) => a.student_id));
  }, [applications]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedStudentIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedStudentIds(next);
  };

  const toggleAll = () => {
    if (selectedStudentIds.size === filteredStudents.length) {
      setSelectedStudentIds(new Set());
    } else {
      setSelectedStudentIds(new Set(filteredStudents.map((s) => s.id)));
    }
  };

  const handleApply = async () => {
    if (!courseId || selectedStudentIds.size === 0) return;
    setIsApplying(true);
    try {
      await applyCoursesToStudents(courseId, Array.from(selectedStudentIds), applyMode);
      await fetchApplications();
      setSelectedStudentIds(new Set());
      setIsConfirmOpen(false);
      success(`${selectedStudentIds.size}名に下書き登録しました`);
    } catch (err) {
      error(err instanceof Error ? err.message : '適用に失敗しました');
    } finally {
      setIsApplying(false);
    }
  };

  if (permissionLoading) {
    return (
      <AdminLayout headerTitle="講習管理">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return (
      <AdminLayout headerTitle="講習管理">
        <AccessDenied message="講習管理ページは教室長以上のみアクセス可能です" />
      </AdminLayout>
    );
  }

  if (isLoading) {
    return (
      <AdminLayout headerTitle="講習管理">
        <Loading size="md" />
      </AdminLayout>
    );
  }

  if (!course) {
    return (
      <AdminLayout headerTitle="講習管理">
        <div className="py-12 text-center text-sm text-text-faint">コースが見つかりません</div>
      </AdminLayout>
    );
  }

  const hasSelection = selectedStudentIds.size > 0;
  const allSelected =
    filteredStudents.length > 0 && selectedStudentIds.size === filteredStudents.length;

  return (
    <AdminLayout headerTitle="講習管理">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div>
        {/* ヘッダー */}
        <div className="mb-4">
          <Link
            href={`/courses/${courseId}`}
            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-heading transition-colors mb-2"
          >
            <ArrowLeft className="w-3 h-3" />
            コース詳細に戻る
          </Link>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold text-text-heading">{course.name}</h1>
              <span
                className={`px-2 py-0.5 text-[11px] font-bold rounded ${SEASON_COLORS[course.season] || ''}`}
              >
                {SEASON_LABELS[course.season]}
              </span>
              <span className="text-xs text-text-muted">
                {course.target_grades.map((g) => GRADE_LABELS[g]).join(' ')}
              </span>
              <span className="text-xs font-bold text-accent-ink">{course.total_koma}コマ</span>
            </div>
            <div className="flex items-center gap-1.5 text-text-muted">
              <Users className="w-3.5 h-3.5" />
              <span className="text-xs">下書き登録済</span>
              <span className="text-lg font-bold text-info">{applications.length}</span>
              <span className="text-xs">名</span>
            </div>
          </div>
        </div>

        {/* 下書き登録の説明 */}
        <div className="p-3 bg-surface-raised rounded-xl border border-border-default mb-4">
          <div className="text-xs text-text-muted leading-relaxed">
            この操作は<span className="font-bold text-text-heading">下書きの提案書</span>
            を作成するだけです。
            進行表への反映・講師への公開は行われません。提案書一覧から確認し「公開」したタイミングで反映されます。
          </div>
        </div>

        {/* 生徒選択 */}
        <div className="bg-surface-raised rounded-xl border border-border-default overflow-hidden">
          {/* 操作バー */}
          <div className="px-4 py-2.5 border-b border-border-subtle flex items-center gap-3">
            <button
              onClick={toggleAll}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-heading transition-colors"
            >
              {allSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-info" />
              ) : (
                <Square className="w-3.5 h-3.5" />
              )}
              {hasSelection ? `${selectedStudentIds.size}名選択` : '全選択'}
            </button>
            {hasSelection && (
              <button
                onClick={() => setSelectedStudentIds(new Set())}
                className="text-[11px] text-text-faint hover:text-text-muted"
              >
                解除
              </button>
            )}
            <span className="text-[11px] text-text-faint">
              ({targetStudents.length}名が対象学年)
            </span>
            <div className="flex-1" />
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint" />
              <input
                type="text"
                placeholder="氏名・コードで検索"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-border-default rounded-lg bg-surface-raised text-text-body placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-ink/30 w-44"
              />
            </div>
            <select
              value={filterGrade}
              onChange={(e) => setFilterGrade(e.target.value ? parseInt(e.target.value) : '')}
              className="px-2 py-1.5 text-xs border border-border-default rounded-lg bg-surface-raised text-text-body"
            >
              <option value="">全学年</option>
              {course.target_grades.map((g) => (
                <option key={g} value={g}>
                  {GRADE_LABELS[g]}
                </option>
              ))}
            </select>
            <button
              onClick={() => setIsConfirmOpen(true)}
              disabled={!hasSelection}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] active:scale-[0.97] transition-[filter,transform] duration-150 ease-out disabled:opacity-40 disabled:pointer-events-none"
            >
              選択した{selectedStudentIds.size}名に下書き登録
            </button>
          </div>

          {/* 生徒リスト */}
          <div
            className="divide-y divide-border-subtle"
            style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}
          >
            {filteredStudents.length === 0 ? (
              <div className="py-8 text-center text-xs text-text-faint">対象の生徒がいません</div>
            ) : (
              filteredStudents.map((student) => {
                const isApplied = appliedStudentIds.has(student.id);
                const isChecked = selectedStudentIds.has(student.id);
                return (
                  <div
                    key={student.id}
                    className={`flex items-center gap-3 px-4 py-2.5 transition-colors duration-100 ${
                      isChecked ? 'bg-info/5' : 'hover:bg-surface-hover/50'
                    }`}
                  >
                    <button
                      onClick={() => toggleSelect(student.id)}
                      className="shrink-0 text-text-faint hover:text-text-heading transition-colors"
                    >
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4 text-info" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                    <Link
                      href={`/students/${student.id}/progress`}
                      className="flex-1 min-w-0 text-sm text-text-heading hover:text-accent-ink transition-colors truncate"
                    >
                      {student.last_name} {student.first_name}
                      {student.last_name_kana && (
                        <span className="ml-1.5 text-xs text-text-muted">
                          ({student.last_name_kana} {student.first_name_kana})
                        </span>
                      )}
                    </Link>
                    <span className="text-xs text-text-muted w-10 text-center shrink-0">
                      {GRADE_LABELS[student.grade] || student.grade}
                    </span>
                    <span className="w-24 text-center shrink-0">
                      {isApplied ? (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded bg-info-subtle text-info"
                          title="下書きの提案書が作成されています"
                        >
                          下書き作成済
                        </span>
                      ) : (
                        <span className="text-[10px] text-text-faint">未登録</span>
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 下書き登録履歴 */}
        {applications.length > 0 && (
          <div className="mt-4 bg-surface-raised rounded-xl border border-border-default overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border-subtle flex items-center gap-2">
              <span className="text-xs font-bold text-text-muted">下書き登録履歴</span>
              <span className="text-[10px] text-text-faint">
                （生徒ごとに編集して「公開」すると進行表に反映されます）
              </span>
            </div>
            <div className="divide-y divide-border-subtle max-h-48 overflow-y-auto">
              {applications.map((app) => (
                <div key={app.id} className="flex items-center gap-4 px-4 py-2 text-xs">
                  <span className="text-text-heading flex-1 min-w-0 truncate">
                    {app.student?.last_name} {app.student?.first_name}
                  </span>
                  <span className="text-text-faint shrink-0">
                    {new Date(app.applied_at).toLocaleString('ja-JP')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 確認モーダル */}
      {isConfirmOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-surface-raised rounded-xl border border-border-default p-5 max-w-sm w-full animate-in fade-in zoom-in-[0.97] duration-150">
            <h2 className="text-sm font-bold text-text-heading mb-3">下書き登録の確認</h2>
            <p className="text-xs text-text-body mb-3">
              以下の内容で下書きの提案書を作成します。よろしいですか？
            </p>
            <div className="p-3 bg-surface-hover/50 rounded-lg space-y-1.5 text-xs mb-4">
              <div className="flex justify-between">
                <span className="text-text-muted">コース:</span>
                <span className="font-medium text-text-heading">{course.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">対象生徒:</span>
                <span className="font-medium text-text-heading">{selectedStudentIds.size}名</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">テキスト:</span>
                <span className="font-medium text-text-heading">
                  {course.textbooks?.length || 0}冊
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">合計コマ数:</span>
                <span className="font-bold text-accent-ink">{course.total_koma}コマ</span>
              </div>
            </div>
            <p className="text-[11px] text-text-faint mb-3">
              ※ 進行表への反映と講師への公開は、提案書ごとに「公開」を行ったときに反映されます。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsConfirmOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-text-muted border border-border-default rounded-lg hover:bg-surface-hover active:scale-[0.97] transition-[background-color,transform] duration-150 ease-out"
              >
                キャンセル
              </button>
              <button
                onClick={handleApply}
                disabled={isApplying}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] active:scale-[0.97] transition-[filter,transform] duration-150 ease-out disabled:opacity-50"
              >
                {isApplying ? <InlineLoading size="sm" label="登録中..." /> : '下書き登録する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
