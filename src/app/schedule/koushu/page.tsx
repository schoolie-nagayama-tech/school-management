'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Button } from '@/components/ui';
import { KoushuPeriodCard } from '@/components/schedule/KoushuPeriodCard';
import { KoushuPeriodFormModal } from '@/components/schedule/KoushuPeriodFormModal';
import { KoushuEnrollmentFormModal } from '@/components/schedule/KoushuEnrollmentFormModal';
import {
  getSchoolKoushu,
  createKoushu,
  updateKoushu,
  deleteKoushu,
  getKoushuEnrollments,
  upsertKoushuEnrollment,
  deleteKoushuEnrollment,
  type KoushuCourse,
  type KoushuEnrollment,
} from '@/lib/api/seasonalCourses';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useAuth } from '@/contexts/AuthContext';
import type { Subject } from '@/types/database';

export default function KoushuPage() {
  const { selectedSchoolId } = useAuth();
  const { subjects: masterSubjects } = useMasterData();
  const schoolId = selectedSchoolId ?? '';

  const [courses, setCourses] = useState<KoushuCourse[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(false);

  // 各コースの申し込みデータ（展開時にロード）
  const [enrollmentsMap, setEnrollmentsMap] = useState<Map<string, KoushuEnrollment[]>>(new Map());
  const [enrollmentsLoadingSet, setEnrollmentsLoadingSet] = useState<Set<string>>(new Set());

  // 講習フォームモーダル
  const [periodFormOpen, setPeriodFormOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<KoushuCourse | null>(null);

  // 申し込みフォームモーダル
  const [enrollmentFormOpen, setEnrollmentFormOpen] = useState(false);
  const [targetCourseId, setTargetCourseId] = useState<string | null>(null);
  const [editingEnrollment, setEditingEnrollment] = useState<KoushuEnrollment | null>(null);

  // 削除確認
  const [deletingCourse, setDeletingCourse] = useState<KoushuCourse | null>(null);
  const [deletingEnrollment, setDeletingEnrollment] = useState<KoushuEnrollment | null>(null);

  const loadCourses = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      const c = await getSchoolKoushu(schoolId);
      setCourses(c);
      setSubjects(masterSubjects);
    } finally {
      setLoading(false);
    }
  }, [schoolId, masterSubjects]);

  useEffect(() => { loadCourses(); }, [loadCourses]);

  const loadEnrollments = useCallback(async (courseId: string) => {
    setEnrollmentsLoadingSet((prev) => new Set(prev).add(courseId));
    try {
      const list = await getKoushuEnrollments(courseId);
      setEnrollmentsMap((prev) => new Map(prev).set(courseId, list));
    } finally {
      setEnrollmentsLoadingSet((prev) => {
        const next = new Set(prev);
        next.delete(courseId);
        return next;
      });
    }
  }, []);

  // ---- 講習 CRUD ----
  const handleSaveCourse = async (data: {
    name: string; season: string;
    start_date: string | null; end_date: string | null;
  }) => {
    if (editingCourse) {
      await updateKoushu(editingCourse.id, data);
    } else {
      await createKoushu(schoolId, data);
    }
    await loadCourses();
  };

  const handleDeleteCourse = async () => {
    if (!deletingCourse) return;
    await deleteKoushu(deletingCourse.id);
    setDeletingCourse(null);
    await loadCourses();
  };

  // ---- 申し込み CRUD ----
  const handleSaveEnrollment = async (studentId: string, komaCount: number, subjectIds: string[]) => {
    if (!targetCourseId) return;
    await upsertKoushuEnrollment(targetCourseId, studentId, komaCount, subjectIds);
    await loadEnrollments(targetCourseId);
    // enrollment_count を更新するためにコース一覧も再取得
    await loadCourses();
  };

  const handleDeleteEnrollment = async () => {
    if (!deletingEnrollment || !targetCourseId) return;
    await deleteKoushuEnrollment(deletingEnrollment.id);
    setDeletingEnrollment(null);
    await loadEnrollments(targetCourseId);
    await loadCourses();
  };

  const openAddEnrollment = (courseId: string) => {
    setTargetCourseId(courseId);
    setEditingEnrollment(null);
    setEnrollmentFormOpen(true);
  };

  const openEditEnrollment = (courseId: string, en: KoushuEnrollment) => {
    setTargetCourseId(courseId);
    setEditingEnrollment(en);
    setEnrollmentFormOpen(true);
  };

  const existingStudentIds = targetCourseId
    ? (enrollmentsMap.get(targetCourseId) ?? []).map((e) => e.student_id)
    : [];

  return (
    <AdminLayout headerTitle="講習スケジュール">
      <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
        {/* ヘッダー */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/schedule">
              <button className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </button>
            </Link>
            <h1 className="text-xl font-bold text-[var(--headline)]">講習管理</h1>
          </div>
          <Button
            onClick={() => { setEditingCourse(null); setPeriodFormOpen(true); }}
            className="flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            講習を追加
          </Button>
        </div>

        {/* 教室未選択 */}
        {!schoolId && (
          <div className="text-center py-12 text-[var(--paragraph)]">
            教室を選択してください。
          </div>
        )}

        {/* 読み込み中 */}
        {schoolId && loading && (
          <div className="text-center py-12 text-[var(--paragraph)]">読み込み中...</div>
        )}

        {/* 講習なし */}
        {schoolId && !loading && courses.length === 0 && (
          <div className="text-center py-12 text-[var(--paragraph)]">
            <p className="mb-4">まだ講習が登録されていません。</p>
            <Button onClick={() => { setEditingCourse(null); setPeriodFormOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" />
              最初の講習を追加
            </Button>
          </div>
        )}

        {/* 講習一覧 */}
        {schoolId && !loading && courses.length > 0 && (
          <div className="space-y-3">
            {courses.map((course) => (
              <KoushuPeriodCard
                key={course.id}
                course={course}
                enrollments={enrollmentsMap.get(course.id) ?? []}
                subjects={subjects}
                enrollmentsLoading={enrollmentsLoadingSet.has(course.id)}
                onEdit={(c) => { setEditingCourse(c); setPeriodFormOpen(true); }}
                onDelete={setDeletingCourse}
                onAddEnrollment={() => openAddEnrollment(course.id)}
                onEditEnrollment={(en) => openEditEnrollment(course.id, en)}
                onDeleteEnrollment={(en) => {
                  setTargetCourseId(course.id);
                  setDeletingEnrollment(en);
                }}
                onExpand={() => loadEnrollments(course.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 講習フォームモーダル */}
      <KoushuPeriodFormModal
        open={periodFormOpen}
        onClose={() => setPeriodFormOpen(false)}
        initialData={editingCourse}
        onSave={handleSaveCourse}
      />

      {/* 申し込みフォームモーダル */}
      <KoushuEnrollmentFormModal
        open={enrollmentFormOpen}
        onClose={() => setEnrollmentFormOpen(false)}
        schoolId={schoolId}
        subjects={subjects}
        existingStudentIds={editingEnrollment ? [] : existingStudentIds}
        initialData={editingEnrollment}
        onSave={handleSaveEnrollment}
      />

      {/* 講習削除確認 */}
      {deletingCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="font-bold text-[var(--headline)] mb-2">講習を削除しますか？</h3>
            <p className="text-sm text-[var(--paragraph)] mb-4">
              「{deletingCourse.name}」を削除します。この操作は取り消せません。
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setDeletingCourse(null)}>
                キャンセル
              </Button>
              <Button
                variant="danger"
                onClick={handleDeleteCourse}
              >
                削除する
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 申し込み削除確認 */}
      {deletingEnrollment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="font-bold text-[var(--headline)] mb-2">申し込みを削除しますか？</h3>
            <p className="text-sm text-[var(--paragraph)] mb-4">
              {deletingEnrollment.student
                ? `${deletingEnrollment.student.last_name} ${deletingEnrollment.student.first_name}`
                : ''}
              の申し込みを削除します。
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setDeletingEnrollment(null)}>
                キャンセル
              </Button>
              <Button
                variant="danger"
                onClick={handleDeleteEnrollment}
              >
                削除する
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
