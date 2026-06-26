'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Button, Input, Label, Loading } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import {
  getTeacherTrainings,
  createTeacherTraining,
  deleteTeacherTraining,
} from '@/lib/api/teacher-trainings';
import { getTrainingMasters } from '@/lib/api/training-masters';
import type { TeacherTraining, TrainingMaster } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import { addUserToSchool, removeUserFromSchool, fetchWithAuth } from '@/lib/api/auth';
import { displayLoginId } from '@/lib/utils/loginId';
import { ChevronLeft } from 'lucide-react';
import { useMasterData } from '@/contexts/MasterDataContext';
import { getActiveTimeSlots } from '@/lib/api/schedule';
import {
  getTeacherBadges,
  getTeacherBadgeAssignments,
  toggleTeacherBadge,
} from '@/lib/api/teacher-badges';
import {
  getAvailabilityPeriods,
  syncAllRegularShifts,
  type TeacherAvailabilityPeriod,
} from '@/lib/api/teacher-availability';
import { AvailabilityPeriodsPanel } from '@/components/teachers/AvailabilityPeriodsPanel';
import { emitTeacherBadgesChanged } from '@/lib/teacher-badge-events';
import type {
  School,
  UserProfile,
  Subject,
  TeacherBadge,
  TeacherBadgeAssignment,
} from '@/types/database';
import type { ScheduleTimeSlot } from '@/types/schedule';
import { BadgeGrid } from '@/components/teacher-badges/BadgeGrid';
import { BadgeProgress } from '@/components/teacher-badges/BadgeProgress';
import { BadgeTemplateDialog } from '@/components/teacher-badges/BadgeTemplateDialog';
import type { BadgeRank } from '@/types/database';
import { createTeacherBadge } from '@/lib/api/teacher-badges';

const GRADE_CATEGORY_LABELS: Record<string, string> = {
  elementary: '小学',
  middle: '中学',
  high: '高校',
};

function groupSubjectsByGradeCategory(subjects: Subject[]): { label: string; items: Subject[] }[] {
  const order: ('elementary' | 'middle' | 'high')[] = ['elementary', 'middle', 'high'];
  const map = new Map<string, Subject[]>();
  for (const s of subjects) {
    const cat = s.grade_category ?? 'middle';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat)!.push(s);
  }
  return order
    .filter((cat) => map.has(cat))
    .map((cat) => ({ label: GRADE_CATEGORY_LABELS[cat] ?? cat, items: map.get(cat)! }));
}

/** API/DB が配列 or 文字列で返す場合に JS 配列に正規化 */
function normalizeToStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') {
    const trimmed = v.replace(/^\{|\}$/g, '').trim();
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  }
  return [];
}

interface TeacherWithDetails extends UserProfile {
  user_schools?: Array<{
    id: string;
    user_id: string;
    school_id: string;
    school?: { id: string; name: string; code: string | null };
  }>;
}

export default function TeacherEditPage() {
  const params = useParams();
  const router = useRouter();
  const teacherId = params?.teacherId as string | undefined;
  const { getSelectedSchoolIds, profile } = useAuth();
  const { schools: masterSchools, subjects: masterSubjects } = useMasterData();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const isManager = profile?.role === 'manager';

  const [teacher, setTeacher] = useState<TeacherWithDetails | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [scheduleTimeSlots, setScheduleTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [editLastName, setEditLastName] = useState('');
  const [editFirstName, setEditFirstName] = useState('');
  const [editSchoolIds, setEditSchoolIds] = useState<string[]>([]);
  const [editTeachableSubjectIds, setEditTeachableSubjectIds] = useState<string[]>([]);
  // 出勤可能（曜日×コマ）は teacher_availability_periods（シフト申請由来＋手動）で版管理する。
  // 旧 user_profiles.available_slot_numbers_by_day 直編集は廃止し、期間パネルへ一本化。
  const [availabilityPeriods, setAvailabilityPeriods] = useState<TeacherAvailabilityPeriod[]>([]);
  const [isResyncing, setIsResyncing] = useState(false);
  const [allBadges, setAllBadges] = useState<TeacherBadge[]>([]);
  const [badgeAssignments, setBadgeAssignments] = useState<TeacherBadgeAssignment[]>([]);
  const [badgeCreateDialogOpen, setBadgeCreateDialogOpen] = useState(false);

  const [trainings, setTrainings] = useState<TeacherTraining[]>([]);
  const [trainingMasters, setTrainingMasters] = useState<TrainingMaster[]>([]);
  const [newTrainingMasterId, setNewTrainingMasterId] = useState('');
  const [newTrainingTitle, setNewTrainingTitle] = useState('');
  const [newTrainingPeriodLabel, setNewTrainingPeriodLabel] = useState('');
  const [newTrainingAttendedOn, setNewTrainingAttendedOn] = useState('');
  const [newTrainingNote, setNewTrainingNote] = useState('');
  const [isTrainingSaving, setIsTrainingSaving] = useState(false);

  const handleAddTraining = async () => {
    if (!teacherId) return;
    const title = newTrainingTitle.trim();
    if (!title) {
      toastError('研修名を入力してください');
      return;
    }
    setIsTrainingSaving(true);
    try {
      const created = await createTeacherTraining({
        teacher_id: teacherId,
        title,
        period_label: newTrainingPeriodLabel.trim() || null,
        attended_on: newTrainingAttendedOn || null,
        note: newTrainingNote.trim() || null,
        training_master_id: newTrainingMasterId || null,
      });
      setTrainings((prev) =>
        [created, ...prev].sort((a, b) => {
          const aDate = a.attended_on ?? '';
          const bDate = b.attended_on ?? '';
          if (aDate && !bDate) return -1;
          if (!aDate && bDate) return 1;
          if (aDate !== bDate) return aDate < bDate ? 1 : -1;
          return a.created_at < b.created_at ? 1 : -1;
        })
      );
      setNewTrainingMasterId('');
      setNewTrainingTitle('');
      setNewTrainingPeriodLabel('');
      setNewTrainingAttendedOn('');
      setNewTrainingNote('');
      success('研修参加履歴を追加しました');
    } catch (e) {
      toastError(e instanceof Error ? e.message : '追加に失敗しました');
    } finally {
      setIsTrainingSaving(false);
    }
  };

  const handleDeleteTraining = async (t: TeacherTraining) => {
    if (
      !(await confirm({
        title: '削除確認',
        description: `「${t.title}」を削除しますか？`,
        confirmLabel: '削除',
        variant: 'danger',
      }))
    ) {
      return;
    }
    try {
      await deleteTeacherTraining(t.id);
      setTrainings((prev) => prev.filter((x) => x.id !== t.id));
      success('削除しました');
    } catch (e) {
      toastError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  useEffect(() => {
    if (!teacherId) return;
    let cancelled = false;
    setIsLoading(true);
    setNotFound(false);

    (async () => {
      try {
        const [teacherRes, masters, trainingsList, badges, assignments, periods] =
          await Promise.all([
            fetchWithAuth(`/api/admin/users/${teacherId}`),
            getTrainingMasters(true).catch(() => [] as TrainingMaster[]),
            getTeacherTrainings(teacherId).catch(() => [] as TeacherTraining[]),
            getTeacherBadges().catch(() => [] as TeacherBadge[]),
            getTeacherBadgeAssignments(teacherId).catch(() => [] as TeacherBadgeAssignment[]),
            getAvailabilityPeriods(teacherId).catch(() => [] as TeacherAvailabilityPeriod[]),
          ]);

        if (cancelled) return;

        if (!teacherRes.ok) {
          if (teacherRes.status === 404) {
            setNotFound(true);
            setTeacher(null);
            return;
          }
          throw new Error('講師の取得に失敗しました');
        }

        const found: TeacherWithDetails = await teacherRes.json();
        setTeacher(found);
        setSchools(masterSchools);
        setSubjects(masterSubjects);
        setTrainingMasters(masters);
        setTrainings(trainingsList);
        setAllBadges(badges);
        setBadgeAssignments(assignments);
        setAvailabilityPeriods(periods);

        setEditLastName(found.last_name || found.display_name || '');
        setEditFirstName(found.first_name || '');
        const teacherSchoolIds = found.user_schools?.map((us) => us.school_id) || [];
        if (isManager) {
          const userSchoolIds = getSelectedSchoolIds();
          setEditSchoolIds(teacherSchoolIds.filter((id) => userSchoolIds.includes(id)));
        } else {
          setEditSchoolIds(teacherSchoolIds);
        }
        const subjectIds = normalizeToStrArray(found.teachable_subject_ids);
        setEditTeachableSubjectIds(subjectIds);
      } catch (e) {
        if (!cancelled) toastError((e as Error).message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [teacherId, isManager, getSelectedSchoolIds, toastError, masterSchools, masterSubjects]);

  const handleBadgeToggle = async (badge: TeacherBadge) => {
    if (!teacherId) return;
    const isEarned = badgeAssignments.some((a) => a.badge_id === badge.id);

    // 楽観的更新
    if (isEarned) {
      setBadgeAssignments((prev) => prev.filter((a) => a.badge_id !== badge.id));
    } else {
      const optimistic: TeacherBadgeAssignment = {
        id: `temp-${Date.now()}`,
        teacher_id: teacherId,
        badge_id: badge.id,
        completed_at: new Date().toISOString().split('T')[0],
        note: null,
        assigned_by: null,
        created_at: new Date().toISOString(),
        badge,
      };
      setBadgeAssignments((prev) => [...prev, optimistic]);
    }

    try {
      const result = await toggleTeacherBadge(teacherId, { badgeId: badge.id });
      if (result.action === 'assigned' && result.assignment) {
        setBadgeAssignments((prev) =>
          prev.map((a) =>
            a.badge_id === badge.id && a.id.startsWith('temp-') ? result.assignment! : a
          )
        );
      }
      // 他画面（一覧・詳細）へ同期通知
      emitTeacherBadgesChanged(teacherId);
    } catch {
      // ロールバック
      if (isEarned) {
        const [assignments] = await Promise.all([getTeacherBadgeAssignments(teacherId)]);
        setBadgeAssignments(assignments);
      } else {
        setBadgeAssignments((prev) => prev.filter((a) => !a.id.startsWith('temp-')));
      }
      toastError('バッジの更新に失敗しました');
    }
  };

  useEffect(() => {
    if (editSchoolIds.length === 0) {
      setScheduleTimeSlots([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const slotsArrays = await Promise.all(
          editSchoolIds.map((sid) => getActiveTimeSlots(sid).catch(() => [] as ScheduleTimeSlot[]))
        );
        if (cancelled) return;
        const seen = new Set<number>();
        const allSlots: ScheduleTimeSlot[] = [];
        for (const slots of slotsArrays) {
          for (const s of slots) {
            if (!seen.has(s.slot_number)) {
              seen.add(s.slot_number);
              allSlots.push(s);
            }
          }
        }
        allSlots.sort((a, b) => a.slot_number - b.slot_number);
        setScheduleTimeSlots(allSlots);
      } catch {
        if (!cancelled) setScheduleTimeSlots([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editSchoolIds]);

  const handleSave = async () => {
    if (!teacher) return;
    setIsSaving(true);
    try {
      // プロファイル（表示名・指導可能科目）は API 経由で RPC 更新。
      // 出勤可能（曜日×コマ）は下の「出勤可能期間」パネルで teacher_availability_periods
      // として版管理するため、ここでは送らない（送らなければ API 側でも上書きしない）。
      const profileRes = await fetchWithAuth(`/api/admin/users/${teacher.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          last_name: editLastName,
          first_name: editFirstName,
          teachable_subject_ids: editTeachableSubjectIds,
        }),
      });
      const errBody = (await profileRes.json().catch(() => ({}))) as {
        error?: string;
        details?: string;
      };
      if (!profileRes.ok) {
        const msg = errBody.details
          ? `${errBody.error ?? 'プロファイルの更新に失敗しました'}（${errBody.details}）`
          : errBody.error || 'プロファイルの更新に失敗しました';
        throw new Error(msg);
      }

      const currentSchoolIds = teacher.user_schools?.map((us) => us.school_id) || [];
      const toAdd = editSchoolIds.filter((id) => !currentSchoolIds.includes(id));
      const toRemove = currentSchoolIds.filter((id) => !editSchoolIds.includes(id));

      for (const schoolId of toAdd) {
        await addUserToSchool(teacher.id, schoolId);
      }
      for (const schoolId of toRemove) {
        await removeUserFromSchool(teacher.id, schoolId);
      }

      success('講師を更新しました');
      router.push(`/admin/teachers/${teacher.id}`);
    } catch (err) {
      console.error('Error updating teacher:', err);
      toastError('講師の更新に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const availableSchools = isManager
    ? schools.filter((s) => getSelectedSchoolIds().includes(s.id))
    : schools;

  if (!teacherId) {
    return (
      <AdminLayout headerTitle="講師詳細">
        <div className="p-6">
          <p className="text-[#2a2a2a]">講師IDが指定されていません。</p>
          <Link href="/admin/teachers">
            <Button variant="secondary" className="mt-4">
              講師一覧に戻る
            </Button>
          </Link>
        </div>
      </AdminLayout>
    );
  }

  if (isLoading) {
    return (
      <AdminLayout headerTitle="講師詳細">
        <Loading size="md" />
      </AdminLayout>
    );
  }

  if (notFound || !teacher) {
    return (
      <AdminLayout headerTitle="講師詳細">
        <div className="p-6">
          <p className="text-[#2a2a2a]">講師が見つかりません。</p>
          <Link href="/admin/teachers">
            <Button variant="secondary" className="mt-4">
              講師一覧に戻る
            </Button>
          </Link>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="講師詳細">
      <div>
        {/* ヘッダー */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/teachers"
              className="flex items-center gap-2 text-text-body hover:text-[#ff8e3c] transition-[color] duration-150 ease-out active:scale-[0.97]"
            >
              <ChevronLeft className="w-4 h-4" />
              講師一覧に戻る
            </Link>
            <h1 className="text-2xl font-bold text-text-heading">講師詳細</h1>
          </div>
          <div className="flex gap-3">
            <Link href="/admin/teachers">
              <Button variant="secondary">キャンセル</Button>
            </Link>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>

        {/* 2カラムレイアウト */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左カラム: 基本情報 */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-surface-raised rounded-xl border border-border p-6 shadow-sm">
              <h2 className="text-base font-semibold text-text-heading mb-4 pb-2 border-b border-border">
                基本情報
              </h2>
              <div className="space-y-4">
                <div>
                  <Label className="block text-sm font-medium text-text-muted mb-1.5">
                    ログインID
                  </Label>
                  <Input
                    value={displayLoginId(teacher.email)}
                    disabled
                    className="w-full bg-surface text-text-body"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="block text-sm font-medium text-text-muted mb-1.5">姓</Label>
                    <Input
                      value={editLastName}
                      onChange={(e) => setEditLastName(e.target.value)}
                      placeholder="山田"
                      className="w-full"
                    />
                  </div>
                  <div>
                    <Label className="block text-sm font-medium text-text-muted mb-1.5">名</Label>
                    <Input
                      value={editFirstName}
                      onChange={(e) => setEditFirstName(e.target.value)}
                      placeholder="太郎"
                      className="w-full"
                    />
                  </div>
                </div>
                <div>
                  <Label className="block text-sm font-medium text-text-muted mb-1.5">
                    担当教室
                  </Label>
                  <div className="space-y-2 max-h-40 overflow-y-auto border border-border rounded-lg p-3 bg-surface">
                    {availableSchools.map((school) => (
                      <label
                        key={school.id}
                        className="flex items-center gap-2 cursor-pointer hover:bg-surface-hover rounded px-2 py-1 -mx-2 -my-1"
                      >
                        <input
                          type="checkbox"
                          checked={editSchoolIds.includes(school.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEditSchoolIds([...editSchoolIds, school.id]);
                            } else {
                              setEditSchoolIds(editSchoolIds.filter((id) => id !== school.id));
                            }
                          }}
                          className="rounded border-text-faint text-[#ff8e3c] focus:ring-[#ff8e3c]"
                        />
                        <span className="text-sm text-text-heading">{school.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 右カラム: 指導・勤務設定 */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-surface-raised rounded-xl border border-border p-6 shadow-sm">
              <h2 className="text-base font-semibold text-text-heading mb-2 pb-2 border-b border-border">
                指導可能科目
              </h2>
              <p className="text-xs text-text-muted mb-3">
                選択した科目のみ指導可能です。未選択の科目は指導できません。
              </p>
              {subjects.length > 0 && (
                <div className="flex gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setEditTeachableSubjectIds(subjects.map((s) => s.id))}
                    className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-surface hover:border-[#ff8e3c]/50 text-text-muted transition-[background-color,border-color] duration-150 ease-out active:scale-[0.97]"
                  >
                    全科目選択
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditTeachableSubjectIds([])}
                    className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-surface hover:border-[#ff8e3c]/50 text-text-muted transition-[background-color,border-color] duration-150 ease-out active:scale-[0.97]"
                  >
                    全科目解除
                  </button>
                </div>
              )}
              <div className="space-y-4 max-h-56 overflow-y-auto">
                {subjects.length === 0 ? (
                  <p className="text-sm text-text-faint">科目が登録されていません</p>
                ) : (
                  groupSubjectsByGradeCategory(subjects).map(({ label, items }) => (
                    <div key={label}>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                          {label}
                        </p>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const ids = items.map((s) => s.id);
                              setEditTeachableSubjectIds((prev) => [
                                ...prev.filter((id) => !ids.includes(id)),
                                ...ids,
                              ]);
                            }}
                            className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-surface text-text-muted transition-[background-color] duration-150 ease-out active:scale-[0.97]"
                          >
                            全選択
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEditTeachableSubjectIds((prev) =>
                                prev.filter((id) => !items.some((s) => s.id === id))
                              )
                            }
                            className="text-[11px] px-2 py-0.5 rounded border border-border hover:bg-surface text-text-muted transition-[background-color] duration-150 ease-out active:scale-[0.97]"
                          >
                            全解除
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {items.map((subject) => (
                          <label
                            key={subject.id}
                            className="flex items-center gap-2 cursor-pointer hover:text-[#ff8e3c]"
                          >
                            <input
                              type="checkbox"
                              checked={editTeachableSubjectIds.includes(subject.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEditTeachableSubjectIds([
                                    ...editTeachableSubjectIds,
                                    subject.id,
                                  ]);
                                } else {
                                  setEditTeachableSubjectIds(
                                    editTeachableSubjectIds.filter((id) => id !== subject.id)
                                  );
                                }
                              }}
                              className="rounded border-text-faint text-[#ff8e3c] focus:ring-[#ff8e3c]"
                            />
                            <span className="text-sm">{subject.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 出勤可能（曜日×コマ）: teacher_availability_periods で版管理。
                シフト申請由来 (regular_shift) の期間が自動で表に入り、手動 (manual) の期間で
                上書きできる。期間（いつからいつまで）も表示。閲覧ページと同じ共有パネル。
                ※このパネルの保存は即時 DB 反映で、上部の「保存」ボタンとは独立。 */}
            <AvailabilityPeriodsPanel
              periods={availabilityPeriods}
              teacherId={teacher.id}
              schoolIds={(teacher.user_schools || []).map((us) => us.school_id)}
              schoolNames={Object.fromEntries(
                (teacher.user_schools || []).map((us) => [us.school_id, us.school?.name ?? '校舎'])
              )}
              timeSlots={scheduleTimeSlots}
              isResyncing={isResyncing}
              onResync={async () => {
                const sids = (teacher.user_schools || []).map((us) => us.school_id);
                if (sids.length === 0) return;
                setIsResyncing(true);
                try {
                  for (const sid of sids) {
                    await syncAllRegularShifts(sid);
                  }
                  setAvailabilityPeriods(await getAvailabilityPeriods(teacher.id));
                } catch (e) {
                  console.error('resync failed', e);
                  toastError('シフトからの再同期に失敗しました');
                } finally {
                  setIsResyncing(false);
                }
              }}
              onChanged={async () => {
                setAvailabilityPeriods(await getAvailabilityPeriods(teacher.id));
              }}
            />

            {/* バッジ / トロフィー */}
            <div className="bg-surface-raised rounded-xl border border-border p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
                <h2 className="text-base font-semibold text-text-heading">バッジ / トロフィー</h2>
                <button
                  type="button"
                  onClick={() => setBadgeCreateDialogOpen(true)}
                  className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-surface hover:border-ink/30 text-text-muted transition-[background-color,border-color] duration-150 ease-out active:scale-[0.97]"
                >
                  + バッジを新規作成
                </button>
              </div>
              {allBadges.length > 0 && (
                <>
                  <div className="mb-4">
                    <BadgeProgress
                      earned={badgeAssignments.length}
                      total={allBadges.length}
                      rankCounts={badgeAssignments.reduce(
                        (acc, a) => {
                          const rank =
                            a.badge?.rank || allBadges.find((b) => b.id === a.badge_id)?.rank;
                          if (rank) acc[rank] = (acc[rank] || 0) + 1;
                          return acc;
                        },
                        {} as Partial<Record<BadgeRank, number>>
                      )}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    クリックでバッジの付与 / 剥奪を切り替えます
                  </p>
                </>
              )}
              {allBadges.length > 0 ? (
                <BadgeGrid
                  badges={allBadges}
                  assignments={badgeAssignments}
                  onBadgeClick={(badge) => handleBadgeToggle(badge)}
                  interactive
                  groupByCategory
                />
              ) : (
                <p className="text-sm text-gray-400 py-2">
                  バッジがまだ登録されていません。上の「+ バッジを新規作成」から作成できます。
                </p>
              )}
            </div>

            {/* 研修参加履歴 */}
            <div className="bg-surface-raised rounded-xl border border-border p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
                <h2 className="text-base font-semibold text-text-heading">研修参加履歴</h2>
              </div>

              {/* 追加フォーム */}
              <div className="mb-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="md:col-span-2">
                    <Label htmlFor="training-master" className="text-xs">
                      研修名 <span className="text-red-500">*</span>
                    </Label>
                    {trainingMasters.length === 0 ? (
                      <div className="mt-1 text-xs text-gray-500">
                        研修マスタが未登録です。
                        <Link
                          href="/admin/teacher-badges"
                          className="text-ink hover:underline ml-1"
                        >
                          バッジ管理 &gt; 研修マスタ
                        </Link>
                        で登録してください。
                      </div>
                    ) : (
                      <select
                        id="training-master"
                        value={newTrainingMasterId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setNewTrainingMasterId(id);
                          const m = trainingMasters.find((x) => x.id === id);
                          if (m) {
                            setNewTrainingTitle(m.name);
                            if (m.period_label) setNewTrainingPeriodLabel(m.period_label);
                          } else {
                            setNewTrainingTitle('');
                          }
                        }}
                        className="mt-1 block w-full rounded-md border border-gray-300 bg-surface-raised px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                      >
                        <option value="">-- 研修を選択 --</option>
                        {trainingMasters.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                            {m.period_label ? ` (${m.period_label})` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="training-period" className="text-xs">
                      期・ラベル
                    </Label>
                    <Input
                      id="training-period"
                      value={newTrainingPeriodLabel}
                      onChange={(e) => setNewTrainingPeriodLabel(e.target.value)}
                      placeholder="例: 2026Q1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="training-date" className="text-xs">
                      参加日
                    </Label>
                    <Input
                      id="training-date"
                      type="date"
                      value={newTrainingAttendedOn}
                      onChange={(e) => setNewTrainingAttendedOn(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="training-note" className="text-xs">
                      メモ
                    </Label>
                    <Input
                      id="training-note"
                      value={newTrainingNote}
                      onChange={(e) => setNewTrainingNote(e.target.value)}
                      placeholder="任意"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={handleAddTraining}
                    disabled={isTrainingSaving || !newTrainingTitle.trim()}
                  >
                    {isTrainingSaving ? '追加中…' : '追加'}
                  </Button>
                </div>
              </div>

              {/* 一覧 */}
              {trainings.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">まだ研修の参加履歴がありません</p>
              ) : (
                <ul className="divide-y divide-gray-100 border-t border-gray-100">
                  {trainings.map((t) => (
                    <li key={t.id} className="py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate">{t.title}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-gray-500">
                          {t.period_label && <span>{t.period_label}</span>}
                          {t.attended_on && (
                            <span>{new Date(t.attended_on).toLocaleDateString('ja-JP')}</span>
                          )}
                        </div>
                        {t.note && (
                          <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{t.note}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteTraining(t)}
                        className="text-xs text-red-600 hover:text-red-700 hover:underline flex-shrink-0 transition-[color] duration-150 ease-out active:scale-[0.97]"
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* バッジ新規作成ダイアログ（講師編集からバッジを直接作成） */}
      {/* バッジ新規作成ダイアログ（作成後にこの講師へ自動付与） */}
      <BadgeTemplateDialog
        open={badgeCreateDialogOpen}
        onClose={async () => {
          setBadgeCreateDialogOpen(false);
          if (teacherId) {
            const [badges, assignments] = await Promise.all([
              getTeacherBadges().catch(() => [] as TeacherBadge[]),
              getTeacherBadgeAssignments(teacherId).catch(() => [] as TeacherBadgeAssignment[]),
            ]);
            setAllBadges(badges);
            setBadgeAssignments(assignments);
          }
        }}
        onSave={async (data) => {
          const created = await createTeacherBadge(data);
          // 作成後にこの講師へ自動付与
          if (teacherId) {
            try {
              const result = await toggleTeacherBadge(teacherId, { badgeId: created.id });
              if (result.action === 'assigned' && result.assignment) {
                setBadgeAssignments((prev) => [...prev, result.assignment!]);
              }
              emitTeacherBadgesChanged(teacherId);
            } catch {
              /* 付与失敗は無視、リフレッシュで拾う */
            }
          }
          setAllBadges((prev) => [...prev, created]);
          success('バッジを作成し、この講師に付与しました');
          return created;
        }}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {ConfirmDialog}
    </AdminLayout>
  );
}
