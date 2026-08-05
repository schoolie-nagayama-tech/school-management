'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Pencil, Trash2 } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import AccessDenied from '@/components/AccessDenied';
import {
  Badge,
  Button,
  Loading,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui';
import {
  SpecialCourseFormModal,
  type SpecialCourseFormValues,
} from '@/components/schedule/SpecialCourseFormModal';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getFormations } from '@/lib/api/schedule-formations';
import { getKoushuPeriods, type KoushuPeriodInfo } from '@/lib/api/koushu-period';
import {
  getSpecialCourses,
  createSpecialCourse,
  updateSpecialCourse,
  deleteSpecialCourse,
  type KoushuSpecialCourse,
} from '@/lib/api/koushuSpecialCourses';
import { GRADE_LABELS } from '@/types/database';
import type { ScheduleFormation } from '@/types/schedule';

/**
 * 特別講座（小集団・HAL 等）の管理画面。
 * 仕様書 §18（決定55〜58）: seasonal_courses（個別メニュー）とは別テーブル・別UI。
 * 開催予定は固定・振替不可のため、登録時点でよく確認してもらう前提のUIにする。
 */
export default function SpecialCoursesPage() {
  const { profile, selectedSchoolId } = useAuth();
  const { schools } = useMasterData();

  // 'all'（すべての教室）は特別講座の編集対象として扱わない（教室スコープの資産のため）
  const schoolId = selectedSchoolId && selectedSchoolId !== 'all' ? selectedSchoolId : '';
  const schoolName = schools.find((s) => s.id === schoolId)?.name ?? '';

  const [formations, setFormations] = useState<ScheduleFormation[]>([]);
  const [periods, setPeriods] = useState<KoushuPeriodInfo[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<KoushuPeriodInfo | null>(null);
  const [courses, setCourses] = useState<KoushuSpecialCourse[]>([]);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<KoushuSpecialCourse | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<KoushuSpecialCourse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 形態一覧（小集団・HAL 等のユーザー定義形態のみ。個別/集団のシステム形態は特別講座の対象外）
  useEffect(() => {
    getFormations()
      .then((all) => setFormations(all.filter((f) => !f.is_system)))
      .catch(() => setFormations([]));
  }, []);

  // 講習期間一覧（教室切替のたびに取り直す）
  useEffect(() => {
    if (!schoolId) {
      setPeriods([]);
      setSelectedPeriod(null);
      return;
    }
    getKoushuPeriods(schoolId)
      .then((p) => {
        setPeriods(p);
        setSelectedPeriod((cur) => (cur && p.some((x) => x.id === cur.id) ? cur : (p[0] ?? null)));
      })
      .catch(() => setPeriods([]));
  }, [schoolId]);

  const loadCourses = useCallback(async () => {
    if (!schoolId || !selectedPeriod) {
      setCourses([]);
      return;
    }
    setLoading(true);
    try {
      setCourses(await getSpecialCourses(schoolId, selectedPeriod.season, selectedPeriod.year));
    } finally {
      setLoading(false);
    }
  }, [schoolId, selectedPeriod]);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  const formationLabelByKey = useMemo(
    () => new Map(formations.map((f) => [f.key, f.label])),
    [formations]
  );

  const gradesLabel = (grades: number[]): string =>
    grades.length === 0 ? '全学年' : grades.map((g) => GRADE_LABELS[g] ?? g).join('・');

  const handleOpenCreate = () => {
    setEditingCourse(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (course: KoushuSpecialCourse) => {
    setEditingCourse(course);
    setModalOpen(true);
  };

  const handleSubmit = async (values: SpecialCourseFormValues) => {
    if (!schoolId || !selectedPeriod) return;
    if (editingCourse) {
      await updateSpecialCourse(editingCourse.id, values);
    } else {
      await createSpecialCourse({
        school_id: schoolId,
        season: selectedPeriod.season,
        year: selectedPeriod.year,
        ...values,
      });
    }
    await loadCourses();
  };

  const handleDelete = async () => {
    if (!deletingCourse) return;
    setDeleteError(null);
    try {
      await deleteSpecialCourse(deletingCourse.id);
      setDeletingCourse(null);
      await loadCourses();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  // 権限チェックはフック呼び出しがすべて終わった後に行う（Hooksのルール順守のため早期returnを最後に置く）
  if (!isManagerOrAbove(profile?.role)) return <AccessDenied />;

  return (
    <AdminLayout headerTitle="特別講座管理">
      <div className="space-y-6">
        {/* ヘッダー */}
        <div className="flex items-center gap-3">
          <Link href="/schedule">
            <button className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors active:scale-[0.97]">
              <ArrowLeft className="w-5 h-5" />
            </button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[var(--headline)]">特別講座管理</h1>
            <p className="text-sm text-[var(--paragraph)]">
              小集団・HAL 等、開催日時が固定の特別講座を教室ごとに登録します。
            </p>
          </div>
        </div>

        {!schoolId && (
          <div className="text-center py-12 text-[var(--paragraph)]">
            教室を選択してください（ヘッダーの教室切替から1教室を選んでください）。
          </div>
        )}

        {schoolId && (
          <>
            <div className="flex items-center gap-2 text-xs text-[var(--paragraph)]">
              <span className="font-medium">教室:</span>
              <span>{schoolName}</span>
            </div>

            {periods.length === 0 ? (
              <div className="text-center py-12 text-[var(--paragraph)]">
                講習期間が設定されていません。先に講習期間を設定してください。
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-[var(--paragraph)] font-medium">講習期間:</span>
                    {periods.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedPeriod(p)}
                        className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                          selectedPeriod?.id === p.id
                            ? 'bg-[var(--headline)] text-white border-[var(--headline)]'
                            : 'bg-white text-[var(--paragraph)] border-[var(--stroke)] hover:bg-gray-50'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  {selectedPeriod && (
                    <Button
                      onClick={handleOpenCreate}
                      className="flex items-center gap-1"
                      disabled={formations.length === 0}
                    >
                      <Plus className="w-4 h-4" />
                      講座を追加
                    </Button>
                  )}
                </div>

                {formations.length === 0 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    小集団・HAL 等の指導形態が未登録です。先に「設定 →
                    コマ時間設定」で形態を作成してください。
                  </p>
                )}

                {selectedPeriod &&
                  (loading ? (
                    <Loading size="md" />
                  ) : courses.length === 0 ? (
                    <div className="text-center py-12 text-[var(--paragraph)]">
                      <p className="mb-4">まだ講座が登録されていません。</p>
                      {formations.length > 0 && (
                        <Button onClick={handleOpenCreate}>
                          <Plus className="w-4 h-4 mr-1" />
                          最初の講座を追加
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {courses.map((c) => {
                        const total =
                          c.unit_price != null ? c.unit_price * c.session_dates.length : null;
                        return (
                          <div
                            key={c.id}
                            className="border border-[var(--stroke)] rounded-xl p-4 bg-white space-y-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant={c.is_active ? 'default' : 'secondary'}>
                                    {formationLabelByKey.get(c.formation) ?? c.formation}
                                  </Badge>
                                  {!c.is_active && <Badge variant="outline">無効</Badge>}
                                </div>
                                <p className="mt-1 font-bold text-[var(--headline)] truncate">
                                  {c.name}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => handleOpenEdit(c)}
                                  className="p-1.5 text-gray-400 hover:text-[var(--headline)] hover:bg-gray-100 rounded-md transition-colors active:scale-[0.97]"
                                  aria-label="編集"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => {
                                    setDeleteError(null);
                                    setDeletingCourse(c);
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-danger hover:bg-danger/10 rounded-md transition-colors active:scale-[0.97]"
                                  aria-label="削除"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            <dl className="text-xs text-[var(--paragraph)] space-y-1">
                              <div className="flex justify-between">
                                <dt>対象学年</dt>
                                <dd>{gradesLabel(c.target_grades)}</dd>
                              </div>
                              <div className="flex justify-between">
                                <dt>回数</dt>
                                <dd>{c.session_dates.length}回</dd>
                              </div>
                              <div className="flex justify-between">
                                <dt>単価</dt>
                                <dd>
                                  {c.unit_price != null
                                    ? `${c.unit_price.toLocaleString()}円`
                                    : '—'}
                                </dd>
                              </div>
                              <div className="flex justify-between">
                                <dt>定員</dt>
                                <dd>{c.capacity != null ? `${c.capacity}名` : '制限なし'}</dd>
                              </div>
                              <div className="flex justify-between font-bold text-[var(--headline)] pt-1 border-t border-[var(--stroke)]">
                                <dt>合計金額</dt>
                                <dd>{total != null ? `${total.toLocaleString()}円` : '—'}</dd>
                              </div>
                            </dl>
                          </div>
                        );
                      })}
                    </div>
                  ))}
              </>
            )}
          </>
        )}
      </div>

      <SpecialCourseFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        formations={formations}
        editing={editingCourse}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={!!deletingCourse}
        onOpenChange={(open) => !open && setDeletingCourse(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>講座を削除しますか</AlertDialogTitle>
            <AlertDialogDescription>
              「{deletingCourse?.name}」を削除します。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <div className="px-6 pb-4 -mt-2">
              <p className="text-sm text-danger">{deleteError}</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingCourse(null)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-danger hover:bg-danger/80">
              削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
