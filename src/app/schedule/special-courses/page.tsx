'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Pencil, Trash2, CalendarClock } from 'lucide-react';
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
import { SpecialCourseFormModal } from '@/components/schedule/SpecialCourseFormModal';
import { YearRoundCourseDetailModal } from '@/components/schedule/YearRoundCourseDetailModal';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getFormations } from '@/lib/api/schedule-formations';
import { getActiveTimeSlots } from '@/lib/api/schedule';
import { getKoushuPeriods, type KoushuPeriodInfo } from '@/lib/api/koushu-period';
import {
  getYearRoundCourses,
  getKoushuCourses,
  createSpecialCourse,
  updateSpecialCourse,
  deleteSpecialCourse,
  type SpecialCourse,
  type SpecialCourseFormValues,
} from '@/lib/api/specialCourses';
import {
  formatCourseScopeLabel,
  formatWeeklySlotLabel,
  totalCourseFee,
  SPECIAL_COURSE_SCOPE_LABELS,
  type SpecialCourseScope,
} from '@/lib/utils/specialCourses';
import {
  INDIVIDUAL_FORMATION,
  type ScheduleFormation,
  type ScheduleTimeSlot,
} from '@/types/schedule';

/**
 * 特別講座（通年講座 / 講習講座）の管理画面。
 *
 * 正典: docs/special-courses-plan.md
 *  - 通年講座 … 小集団や国理社オンラインライブ、HAL など。時間割は座席表の形態ボードで作る。
 *                講習期だけ日時を上書きできる（講座カードの「時間割・上書き」から）。
 *  - 講習講座 … 英単語特訓・暗記講座など、その講習期だけの講座。開催日時をここで確定する。
 */
export default function SpecialCoursesPage() {
  const { profile, selectedSchoolId } = useAuth();
  const { schools, subjects } = useMasterData();

  // 'all'（すべての教室）は特別講座の編集対象として扱わない（教室スコープの資産のため）
  const schoolId = selectedSchoolId && selectedSchoolId !== 'all' ? selectedSchoolId : '';
  const schoolName = schools.find((s) => s.id === schoolId)?.name ?? '';

  const [scope, setScope] = useState<SpecialCourseScope>('year_round');
  const [formations, setFormations] = useState<ScheduleFormation[]>([]);
  const [periods, setPeriods] = useState<KoushuPeriodInfo[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<KoushuPeriodInfo | null>(null);
  const [courses, setCourses] = useState<SpecialCourse[]>([]);
  // 通年講座の「曜日 開始-終了」表示用のコマ時間マスタ（全形態ぶん。形態別の絞り込みはフォーム側）
  const [timeSlots, setTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<SpecialCourse | null>(null);
  const [detailCourse, setDetailCourse] = useState<SpecialCourse | null>(null);
  const [deletingCourse, setDeletingCourse] = useState<SpecialCourse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 特別講座は「個別以外の指導形態」で開く（小集団・プログラミング等）。
  // 個別は1対1/1対2のブース運用で講座の概念を持たないため候補から外す。
  useEffect(() => {
    getFormations()
      .then((all) => setFormations(all.filter((f) => f.key !== INDIVIDUAL_FORMATION)))
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

  // コマ時間マスタ（教室切替のたびに取り直す）
  useEffect(() => {
    if (!schoolId) {
      setTimeSlots([]);
      return;
    }
    getActiveTimeSlots(schoolId)
      .then(setTimeSlots)
      .catch(() => setTimeSlots([]));
  }, [schoolId]);

  const loadCourses = useCallback(async () => {
    if (!schoolId) {
      setCourses([]);
      return;
    }
    if (scope === 'koushu' && !selectedPeriod) {
      setCourses([]);
      return;
    }
    setLoading(true);
    try {
      setCourses(
        scope === 'year_round'
          ? await getYearRoundCourses(schoolId)
          : await getKoushuCourses(schoolId, selectedPeriod!.season, selectedPeriod!.year)
      );
    } finally {
      setLoading(false);
    }
  }, [schoolId, scope, selectedPeriod]);

  useEffect(() => {
    loadCourses();
  }, [loadCourses]);

  const formationLabelByKey = useMemo(
    () => new Map(formations.map((f) => [f.key, f.label])),
    [formations]
  );
  const subjectNameById = useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);
  const timeSlotById = useMemo(() => new Map(timeSlots.map((s) => [s.id, s])), [timeSlots]);

  const handleOpenCreate = () => {
    setEditingCourse(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (course: SpecialCourse) => {
    setEditingCourse(course);
    setModalOpen(true);
  };

  const handleSubmit = async (values: SpecialCourseFormValues) => {
    if (!schoolId) return;
    if (editingCourse) {
      await updateSpecialCourse(editingCourse.id, values);
    } else {
      // scope・season・year は画面の文脈で決まる（フォームでは入力させない）
      await createSpecialCourse({
        school_id: schoolId,
        scope,
        season: scope === 'koushu' ? (selectedPeriod?.season ?? null) : null,
        year: scope === 'koushu' ? (selectedPeriod?.year ?? null) : null,
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

  // 講習講座は「講習期間を選ぶ」まで追加できない。通年講座は期間に依存しない。
  const canCreate =
    !!schoolId && formations.length > 0 && (scope === 'year_round' || !!selectedPeriod);

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
              個別以外の指導形態（小集団・プログラミング等）で開く講座を、教室ごとに登録します。
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

            {/* 種別タブ（通年講座 / 講習講座） */}
            <div className="flex items-center gap-1 border-b border-[var(--stroke)]">
              {(['year_round', 'koushu'] as SpecialCourseScope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    scope === s
                      ? 'border-[var(--headline)] text-[var(--headline)]'
                      : 'border-transparent text-[var(--paragraph)] hover:text-[var(--headline)]'
                  }`}
                >
                  {SPECIAL_COURSE_SCOPE_LABELS[s]}
                </button>
              ))}
            </div>

            <p className="text-xs text-[var(--paragraph)]">
              {scope === 'year_round'
                ? '通常期も講習期も開催する講座です。定例の曜日・コマを設定すると、座席表の形態ボードのそのセルから生徒の枠を作れるようになります。'
                : 'その講習期だけ開催する講座です。開催日時をここで確定します（変更・振替はできません）。'}
            </p>

            {formations.length === 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                個別以外の指導形態が登録されていません。先に「設定 →
                コマ時間設定」で指導形態を作成してください。
              </p>
            )}

            <div className="flex items-center justify-between gap-4 flex-wrap">
              {scope === 'koushu' ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-[var(--paragraph)] font-medium">講習期間:</span>
                  {periods.length === 0 ? (
                    <span className="text-xs text-[var(--paragraph)]">
                      講習期間が設定されていません
                    </span>
                  ) : (
                    periods.map((p) => (
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
                    ))
                  )}
                </div>
              ) : (
                <span />
              )}
              <Button
                onClick={handleOpenCreate}
                className="flex items-center gap-1"
                disabled={!canCreate}
              >
                <Plus className="w-4 h-4" />
                講座を追加
              </Button>
            </div>

            {loading ? (
              <Loading size="md" />
            ) : courses.length === 0 ? (
              <div className="text-center py-12 text-[var(--paragraph)]">
                <p className="mb-4">まだ講座が登録されていません。</p>
                {canCreate && (
                  <Button onClick={handleOpenCreate}>
                    <Plus className="w-4 h-4 mr-1" />
                    最初の講座を追加
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {courses.map((c) => {
                  const total = totalCourseFee(c.unit_price, c.session_dates.length);
                  // 通年講座の定例枠。未設定の講座は座席表の枠の候補に出ないので、はっきり見せる。
                  const weeklySlotLabel = formatWeeklySlotLabel(
                    c.day_of_week,
                    c.time_slot_id,
                    c.time_slot_id ? timeSlotById.get(c.time_slot_id) : null
                  );
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
                          <p className="mt-1 font-bold text-[var(--headline)] truncate">{c.name}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {c.scope === 'year_round' && (
                            <button
                              onClick={() => setDetailCourse(c)}
                              className="p-1.5 text-gray-400 hover:text-[var(--headline)] hover:bg-gray-100 rounded-md transition-colors active:scale-[0.97]"
                              aria-label="時間割・講習期の上書き"
                              title="時間割・講習期の上書き"
                            >
                              <CalendarClock className="w-4 h-4" />
                            </button>
                          )}
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
                          <dt>対象</dt>
                          <dd>
                            {formatCourseScopeLabel(
                              c.target_grades,
                              c.subject_id ? (subjectNameById.get(c.subject_id) ?? null) : null
                            )}
                          </dd>
                        </div>
                        {c.scope === 'year_round' && (
                          <div className="flex justify-between">
                            <dt>曜日・コマ</dt>
                            <dd
                              className={
                                weeklySlotLabel
                                  ? 'font-medium text-[var(--headline)]'
                                  : 'text-gray-400'
                              }
                            >
                              {weeklySlotLabel ?? '未設定'}
                            </dd>
                          </div>
                        )}
                        {c.scope === 'koushu' && (
                          <div className="flex justify-between">
                            <dt>回数</dt>
                            <dd>{c.session_dates.length}回</dd>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <dt>単価</dt>
                          <dd>
                            {c.unit_price != null ? `${c.unit_price.toLocaleString()}円` : '—'}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt>定員</dt>
                          <dd>{c.capacity != null ? `${c.capacity}名` : '制限なし'}</dd>
                        </div>
                        {c.scope === 'koushu' && (
                          <div className="flex justify-between font-bold text-[var(--headline)] pt-1 border-t border-[var(--stroke)]">
                            <dt>合計金額</dt>
                            <dd>{total != null ? `${total.toLocaleString()}円` : '—'}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <SpecialCourseFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        schoolId={schoolId}
        scope={scope}
        formations={formations}
        subjects={subjects}
        editing={editingCourse}
        onSubmit={handleSubmit}
      />

      {detailCourse && (
        <YearRoundCourseDetailModal
          open={!!detailCourse}
          onOpenChange={(open) => !open && setDetailCourse(null)}
          course={detailCourse}
          periods={periods}
        />
      )}

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
