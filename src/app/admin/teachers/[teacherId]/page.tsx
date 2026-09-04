'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { fetchWithAuth } from '@/lib/api/auth';
import { getActiveTimeSlots, mergeTimeSlotsByTimeRange } from '@/lib/api/schedule';
import { getTeacherShiftHistory, type TeacherShiftHistoryEntry } from '@/lib/api/teacher-shifts';
import {
  getAvailabilityPeriods,
  getEffectiveAvailability,
  isAvailableForInterval,
  syncAllRegularShifts,
  type TeacherAvailabilityPeriod,
} from '@/lib/api/teacher-availability';
import { getTeacherBadges, getTeacherBadgeAssignments } from '@/lib/api/teacher-badges';
import { getTeacherTrainings } from '@/lib/api/teacher-trainings';
import { onTeacherBadgesChanged } from '@/lib/teacher-badge-events';
import type {
  School,
  UserProfile,
  Subject,
  TeacherBadge,
  TeacherBadgeAssignment,
  BadgeRank,
  TeacherTraining,
} from '@/types/database';
import { BADGE_RANK_CONFIG, USER_ROLE_LABELS } from '@/types/database';
import { INDIVIDUAL_FORMATION, type ScheduleTimeSlot } from '@/types/schedule';
import { Loading } from '@/components/ui';
import { BadgeIcon } from '@/components/teacher-badges/BadgeIcon';
import { AvailabilityPeriodsPanel } from '@/components/teachers/AvailabilityPeriodsPanel';
import { displayLoginId } from '@/lib/utils/loginId';

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
const GRADE_CATEGORY_LABELS: Record<string, string> = {
  elementary: '小学',
  middle: '中学',
  high: '高校',
};

function normalizeToStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') {
    const trimmed = v.replace(/^\{|\}$/g, '').trim();
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  }
  return [];
}

function normalizeToNumArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
  if (typeof v === 'string') {
    const trimmed = v.replace(/^\{|\}$/g, '').trim();
    if (!trimmed) return [];
    return trimmed
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
  }
  return [];
}

function normalizeToSlotNumbersByDay(v: unknown): Record<string, number[]> {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const out: Record<string, number[]> = {};
    for (const key of Object.keys(v as object)) {
      const arr = normalizeToNumArray((v as Record<string, unknown>)[key]).filter(
        (n) => n >= 1 && n <= 7
      );
      if (arr.length > 0) out[key] = arr;
    }
    return out;
  }
  return {};
}

interface TeacherWithDetails extends UserProfile {
  user_schools?: Array<{
    id: string;
    school_id: string;
    school?: { id: string; name: string; code: string | null };
  }>;
}

export default function TeacherDetailPage() {
  const params = useParams();
  const teacherId = params?.teacherId as string | undefined;
  useAuth();
  const { schools: masterSchools, subjects: masterSubjects } = useMasterData();

  const [teacher, setTeacher] = useState<TeacherWithDetails | null>(null);
  const [scheduleTimeSlots, setScheduleTimeSlots] = useState<ScheduleTimeSlot[]>([]);
  const [allBadges, setAllBadges] = useState<TeacherBadge[]>([]);
  const [badgeAssignments, setBadgeAssignments] = useState<TeacherBadgeAssignment[]>([]);
  const [trainings, setTrainings] = useState<TeacherTraining[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // シフト提出履歴（生ログ表示用。表示優先順位は availability period 経由）
  const [shiftHistory, setShiftHistory] = useState<TeacherShiftHistoryEntry[]>([]);
  // 出勤可能期間一覧（teacher_availability_periods）：manual / regular_shift 両方
  const [availabilityPeriods, setAvailabilityPeriods] = useState<TeacherAvailabilityPeriod[]>([]);
  // 「今日有効な」出勤可能（manual > regular_shift 解決済み）
  const [effectiveAvailability, setEffectiveAvailability] =
    useState<TeacherAvailabilityPeriod | null>(null);
  const [isResyncing, setIsResyncing] = useState(false);

  useEffect(() => {
    if (!teacherId) return;
    let cancelled = false;

    (async () => {
      try {
        const [teacherRes, badges, assignments, trainingsList] = await Promise.all([
          fetchWithAuth(`/api/admin/users/${teacherId}`),
          getTeacherBadges().catch(() => [] as TeacherBadge[]),
          getTeacherBadgeAssignments(teacherId).catch(() => [] as TeacherBadgeAssignment[]),
          getTeacherTrainings(teacherId).catch(() => [] as TeacherTraining[]),
        ]);

        if (cancelled) return;

        if (!teacherRes.ok) {
          if (teacherRes.status === 404) setNotFound(true);
          return;
        }

        const data: TeacherWithDetails = await teacherRes.json();
        setTeacher(data);
        setAllBadges(badges);
        setBadgeAssignments(assignments);
        setTrainings(trainingsList);

        const schoolIds = (data.user_schools || []).map((us) => us.school_id);
        if (schoolIds.length > 0) {
          const slotsArrays = await Promise.all(
            schoolIds.map((sid) => getActiveTimeSlots(sid).catch(() => [] as ScheduleTimeSlot[]))
          );
          if (cancelled) return;
          // 重複排除は slot_number ではなく実時刻区間で行う（形態違いの同番コマを潰さないため）。
          setScheduleTimeSlots(mergeTimeSlotsByTimeRange(slotsArrays));

          // 講師のシフト（現在有効分 + 履歴）を取得。
          // 在籍校が複数あれば最初の1校を基準にする。期間考慮はAPI側で実施。
          const primaryId = schoolIds[0];
          const [history, periods, effective] = await Promise.all([
            getTeacherShiftHistory(primaryId, teacherId).catch(() => []),
            getAvailabilityPeriods(teacherId).catch(() => [] as TeacherAvailabilityPeriod[]),
            getEffectiveAvailability(teacherId, undefined, { schoolId: primaryId }).catch(
              () => null
            ),
          ]);
          if (cancelled) return;
          setShiftHistory(history);
          setAvailabilityPeriods(periods);
          setEffectiveAvailability(effective);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [teacherId]);

  useEffect(() => {
    if (!teacherId) return;
    let lastLoadAt = Date.now();
    const THROTTLE_MS = 30_000;

    const reloadBadges = async () => {
      try {
        const assignments = await getTeacherBadgeAssignments(teacherId);
        setBadgeAssignments(assignments);
        lastLoadAt = Date.now();
      } catch {}
    };

    const offEvent = onTeacherBadgesChanged((changedId) => {
      if (changedId === teacherId) reloadBadges();
    });

    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastLoadAt < THROTTLE_MS) return;
      reloadBadges();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      offEvent();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [teacherId]);

  if (isLoading) {
    return (
      <AdminLayout headerTitle="講師詳細">
        <Loading />
      </AdminLayout>
    );
  }

  if (notFound || !teacher) {
    return (
      <AdminLayout headerTitle="講師詳細">
        <div className="text-center py-16">
          <p className="text-gray-500 mb-4">講師が見つかりませんでした</p>
          <Link href="/admin/teachers" className="text-ink hover:underline">
            講師一覧へ戻る
          </Link>
        </div>
      </AdminLayout>
    );
  }

  const subjectIds = normalizeToStrArray(teacher.teachable_subject_ids);
  const teachableSubjects = masterSubjects.filter((s) => subjectIds.includes(s.id));
  const subjectsByCategory: Record<string, Subject[]> = {};
  for (const s of teachableSubjects) {
    const cat = s.grade_category ?? 'middle';
    if (!subjectsByCategory[cat]) subjectsByCategory[cat] = [];
    subjectsByCategory[cat].push(s);
  }

  // 「今日有効な」出勤可能の描画。コマ番号ではなく実時刻の区間包含で判定する
  // （形態ごとに slot_number が独立採番されるため、番号で突き合わせると別形態のコマと誤一致する）。
  //
  // 旧レコード（時間帯が空でコマ番号だけある期間）は個別のコマ時間で実時刻に解決する。
  const individualSlots = scheduleTimeSlots.filter((s) => s.formation === INDIVIDUAL_FORMATION);
  const legacyLabelSource = individualSlots.length > 0 ? individualSlots : scheduleTimeSlots;
  const legacyLabelByNumber = new Map<number, string>();
  for (const s of legacyLabelSource) {
    if (!legacyLabelByNumber.has(s.slot_number)) {
      legacyLabelByNumber.set(
        s.slot_number,
        `${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}`
      );
    }
  }
  const resolveSlotNumber = (n: number) => legacyLabelByNumber.get(n);

  // 期間が無い講師は user_profiles の旧値から擬似期間を組んでフォールバック（過渡期データ）。
  // 旧値も空なら「出勤可能なし」であり、全時間可に化けさせない。
  const profileSlotsByDay = normalizeToSlotNumbersByDay(teacher.available_slot_numbers_by_day);
  const profileDays = Object.entries(profileSlotsByDay)
    .filter(([, v]) => v.length > 0)
    .map(([k]) => Number(k));
  const availabilityForDisplay =
    effectiveAvailability ??
    (profileDays.length > 0
      ? {
          available_days_of_week: profileDays,
          available_time_slots_by_day: {},
          available_slot_numbers_by_day: profileSlotsByDay,
        }
      : null);

  const isAvailableCell = (dayIdx: number, slot: ScheduleTimeSlot): boolean =>
    availabilityForDisplay
      ? isAvailableForInterval(availabilityForDisplay, dayIdx, slot.start_time, slot.end_time, {
          resolveSlotNumber,
        })
      : false;

  const totalAvailableSlots = scheduleTimeSlots.reduce(
    (sum, slot) =>
      sum + DAY_LABELS.reduce((n, _, dayIdx) => n + (isAvailableCell(dayIdx, slot) ? 1 : 0), 0),
    0
  );
  // 「いつ時点の出勤可能か」ラベル
  const effectiveLabel = effectiveAvailability
    ? `${effectiveAvailability.effective_from} 〜 ${effectiveAvailability.effective_until || '無期限'}`
    : null;
  const effectiveSourceLabel = effectiveAvailability
    ? effectiveAvailability.source === 'manual'
      ? '手動設定'
      : 'シフト提出由来'
    : null;

  const earnedBadges = badgeAssignments
    .map((a) => allBadges.find((b) => b.id === a.badge_id))
    .filter((b): b is TeacherBadge => b !== undefined);

  const rankCounts: Record<BadgeRank, number> = {
    neutral: 0,
    bronze: 0,
    silver: 0,
    gold: 0,
    platinum: 0,
  };
  for (const b of earnedBadges) rankCounts[b.rank] = (rankCounts[b.rank] || 0) + 1;

  const schools: School[] = (teacher.user_schools || [])
    .map((us) => masterSchools.find((s) => s.id === us.school_id))
    .filter((s): s is School => s !== undefined);

  const teacherSchools = schools;
  // バッジ数に応じて背景を変化させる（隠し要素）
  const heroBgClass = (() => {
    const n = earnedBadges.length;
    if (n >= 14) return 'bg-gradient-to-br from-amber-400 via-rose-500 to-indigo-600 hero-shine';
    if (n >= 10) return 'bg-gradient-to-br from-yellow-500 via-amber-500 to-orange-600';
    if (n >= 7) return 'bg-gradient-to-br from-fuchsia-700 via-purple-700 to-indigo-800';
    if (n >= 4) return 'bg-gradient-to-br from-emerald-700 via-teal-700 to-cyan-800';
    if (n >= 1) return 'bg-gradient-to-br from-slate-600 via-slate-700 to-slate-800';
    return 'bg-gradient-to-br from-ink to-ink/80';
  })();

  return (
    <AdminLayout
      headerTitle="講師詳細"
      actions={
        <div className="flex gap-2">
          <Link
            href="/admin/teachers"
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg bg-surface-raised transition-[color,background-color] duration-150 ease-out active:scale-[0.97]"
          >
            一覧に戻る
          </Link>
          <Link
            href={`/admin/teachers/${teacher.id}/edit`}
            className="px-4 py-2 text-sm font-medium text-white bg-ink rounded-lg hover:brightness-[0.85] transition-[filter] duration-150 ease-out active:scale-[0.97]"
          >
            編集
          </Link>
        </div>
      }
    >
      {/* ヒーローカード */}
      <div
        className={`${heroBgClass} relative overflow-hidden rounded-2xl p-6 mb-6 shadow-lg text-white transition-[background] duration-500 ease-out`}
      >
        <div className="flex items-center gap-5">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold truncate">{teacher.display_name || '(未設定)'}</h1>
            <p className="text-sm text-white/70 truncate">{displayLoginId(teacher.email)}</p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-xs font-semibold text-white bg-black/30 px-2.5 py-1 rounded-full">
                {USER_ROLE_LABELS[teacher.role] || teacher.role}
              </span>
              {teacherSchools.map((s) => (
                <span
                  key={s.id}
                  className="text-xs text-white bg-black/20 px-2.5 py-1 rounded-full"
                >
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 統計サマリー */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="担当教室" value={teacherSchools.length} unit="校" />
        <StatCard label="指導可能科目" value={teachableSubjects.length} unit="科目" />
        <StatCard label="出勤可能コマ" value={totalAvailableSlots} unit="コマ/週" />
        <StatCard label="獲得バッジ" value={earnedBadges.length} unit={`/ ${allBadges.length}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左カラム */}
        <div className="lg:col-span-2 space-y-6">
          {/* 指導可能科目 */}
          <Panel title="指導可能科目">
            {teachableSubjects.length === 0 ? (
              <EmptyText>未設定</EmptyText>
            ) : (
              <div className="space-y-3">
                {(['elementary', 'middle', 'high'] as const).map((cat) => {
                  const items = subjectsByCategory[cat];
                  if (!items || items.length === 0) return null;
                  return (
                    <div key={cat}>
                      <div className="text-xs font-semibold text-gray-500 mb-1.5">
                        {GRADE_CATEGORY_LABELS[cat]}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {items.map((s) => (
                          <span
                            key={s.id}
                            className="px-2.5 py-1 text-xs font-medium text-sky-800 bg-sky-50 border border-sky-200 rounded-md"
                          >
                            {s.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          {/* 出勤可能コマ マトリクス
              ソース: teacher_availability_periods の effective（manual > regular_shift で解決済み）。
              未登録時は user_profiles の旧値にフォールバック表示（過渡期データ用）。
              「いつ時点で」「どのソース由来か」をヘッダで明示し、編集は下の「出勤可能期間」から行う。 */}
          <Panel title="出勤可能コマ">
            {scheduleTimeSlots.length === 0 || totalAvailableSlots === 0 ? (
              <EmptyText>未設定</EmptyText>
            ) : (
              <div className="space-y-2">
                {effectiveAvailability ? (
                  <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
                    <span>現在有効分:</span>
                    <span className="font-semibold text-gray-700">{effectiveLabel}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-semibold ${
                        effectiveAvailability.source === 'manual'
                          ? 'bg-info-subtle text-info'
                          : 'bg-warning-subtle text-warning'
                      }`}
                    >
                      {effectiveSourceLabel}
                    </span>
                    <span className="ml-auto text-gray-400">編集は下の「出勤可能期間」から</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-gray-400">
                    出勤可能期間が登録されていないため、旧設定値を表示しています
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="p-2 border border-gray-200 bg-gray-50 text-left font-semibold text-gray-600">
                          コマ
                        </th>
                        {DAY_LABELS.map((d, i) => (
                          <th
                            key={i}
                            className="p-2 border border-gray-200 bg-gray-50 text-center font-semibold text-gray-600 min-w-[42px]"
                          >
                            {d}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scheduleTimeSlots.map((slot) => (
                        // 表示キー・ラベルは実時刻区間（形態が違えば同じ slot_number でも
                        // 時刻が異なるため、コマ番号ではなく時間帯を主にする）
                        <tr key={`${slot.start_time}-${slot.end_time}`}>
                          <td className="p-2 border border-gray-200 text-gray-700 whitespace-nowrap">
                            <span className="font-semibold">
                              {slot.start_time.slice(0, 5)}〜{slot.end_time.slice(0, 5)}
                            </span>
                          </td>
                          {DAY_LABELS.map((_, dayIdx) => {
                            const available = isAvailableCell(dayIdx, slot);
                            return (
                              <td
                                key={dayIdx}
                                className={`p-2 border border-gray-200 text-center ${
                                  available ? 'bg-emerald-50' : 'bg-surface-raised'
                                }`}
                              >
                                {available && (
                                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Panel>

          {/* 出勤可能期間一覧：teacher_availability_periods
              - 通常シフト提出から自動反映された期間 (source=regular_shift) と、
                手動編集の期間 (source=manual) の両方を時系列で表示。
              - 同一日に複数 period がある場合、リード側で manual > regular_shift の優先順位。
              - 「再同期」ボタンで提出データから手動再構築できる（緊急時の整合性確保用）。 */}
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
              if (!teacher) return;
              const sids = (teacher.user_schools || []).map((us) => us.school_id);
              if (sids.length === 0) return;
              setIsResyncing(true);
              try {
                for (const sid of sids) {
                  await syncAllRegularShifts(sid);
                }
                const [refreshed, eff] = await Promise.all([
                  getAvailabilityPeriods(teacherId!),
                  getEffectiveAvailability(teacherId!, undefined, { schoolId: sids[0] }).catch(
                    () => null
                  ),
                ]);
                setAvailabilityPeriods(refreshed);
                setEffectiveAvailability(eff);
              } catch (e) {
                console.error('resync failed', e);
              } finally {
                setIsResyncing(false);
              }
            }}
            onChanged={async () => {
              if (!teacherId) return;
              const sids = (teacher.user_schools || []).map((us) => us.school_id);
              const primary = sids[0];
              const [refreshed, eff] = await Promise.all([
                getAvailabilityPeriods(teacherId),
                primary
                  ? getEffectiveAvailability(teacherId, undefined, { schoolId: primary }).catch(
                      () => null
                    )
                  : Promise.resolve(null),
              ]);
              setAvailabilityPeriods(refreshed);
              setEffectiveAvailability(eff);
            }}
          />

          {/* シフト提出履歴：通常 + 講習を時系列で並べる。
              「いつどの設定で何曜日を提出したか」を一覧化、過去の出勤履歴も追える。 */}
          <Panel title="シフト提出履歴">
            {shiftHistory.length === 0 ? (
              <EmptyText>シフト提出履歴がありません</EmptyText>
            ) : (
              <ul className="divide-y divide-gray-100">
                {shiftHistory.map((h) => {
                  // 曜日 → 時間帯 リスト
                  const byDow = new Map<number, string[]>();
                  for (const sl of h.slots) {
                    if (!byDow.has(sl.day_of_week)) byDow.set(sl.day_of_week, []);
                    byDow.get(sl.day_of_week)!.push(sl.time_slot);
                  }
                  const period = (() => {
                    const f = h.effective_from ?? '';
                    const u = h.effective_until ?? '';
                    if (!f && !u) return '期間未設定';
                    return `${f || '〜'} 〜 ${u || '無期限'}`;
                  })();
                  return (
                    <li key={h.submission_id} className="py-2 text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`px-1.5 py-0.5 text-[11px] rounded font-semibold ${
                            h.source === 'regular'
                              ? 'bg-info-subtle text-info'
                              : 'bg-warning-subtle text-warning'
                          }`}
                        >
                          {h.source === 'regular' ? '通常' : '講習'}
                        </span>
                        <span className="font-semibold">{h.setting_name || '名称未設定'}</span>
                        <span className="text-xs text-gray-500">{period}</span>
                        {h.submitted_at && (
                          <span className="text-[11px] text-gray-400">
                            提出: {new Date(h.submitted_at).toLocaleDateString('ja-JP')}
                          </span>
                        )}
                      </div>
                      {byDow.size > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1 pl-2">
                          {Array.from(byDow.entries())
                            .sort(([a], [b]) => a - b)
                            .map(([dow, slots]) => (
                              <span
                                key={dow}
                                className="inline-flex items-center gap-1 text-[11px] text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded"
                              >
                                <strong>{DAY_LABELS[dow]}</strong>
                                <span className="text-gray-500">{slots.length} 枠</span>
                              </span>
                            ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {/* 研修参加履歴 */}
          <Panel title="研修参加履歴">
            {trainings.length === 0 ? (
              <EmptyText>まだ研修の参加履歴がありません</EmptyText>
            ) : (
              <ul className="divide-y divide-gray-100">
                {trainings.map((t) => (
                  <li key={t.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-3">
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
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* 右カラム */}
        <div className="space-y-6">
          {/* バッジ獲得状況 */}
          <Panel title="バッジ">
            <div className="mb-4">
              <div className="flex items-end justify-between mb-1.5">
                <span className="text-xs text-gray-500">獲得数</span>
                <span className="text-sm font-bold text-gray-900">
                  {earnedBadges.length}{' '}
                  <span className="text-xs font-normal text-gray-400">/ {allBadges.length}</span>
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${allBadges.length ? (earnedBadges.length / allBadges.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5 mb-4">
              {(['platinum', 'gold', 'silver', 'bronze'] as BadgeRank[]).map((r) => {
                const cfg = BADGE_RANK_CONFIG[r];
                return (
                  <div
                    key={r}
                    className="text-center py-2 rounded-lg border"
                    style={{ borderColor: `${cfg.color}40`, backgroundColor: `${cfg.color}08` }}
                  >
                    <div className="text-lg font-bold" style={{ color: cfg.color }}>
                      {rankCounts[r]}
                    </div>
                    <div
                      className="text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: cfg.color }}
                    >
                      {cfg.label}
                    </div>
                  </div>
                );
              })}
            </div>
            {earnedBadges.length === 0 ? (
              <EmptyText>まだバッジがありません</EmptyText>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {earnedBadges.slice(0, 12).map((b) => {
                  const cfg = BADGE_RANK_CONFIG[b.rank];
                  return (
                    <div
                      key={b.id}
                      className="flex flex-col items-center text-center"
                      title={b.description ? `${b.name}\n${b.description}` : b.name}
                    >
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-sm"
                        style={{
                          background: `linear-gradient(135deg, ${cfg.color}, ${cfg.color}88)`,
                        }}
                      >
                        <BadgeIcon icon={b.icon} size={18} />
                      </div>
                      <div className="text-[11px] text-gray-600 mt-1 truncate w-full">{b.name}</div>
                      {/* 説明文（設定されている場合のみ。獲得バッジの内容を講師詳細でも確認できるように） */}
                      {b.description && (
                        <div className="text-[10px] text-gray-400 mt-0.5 leading-snug line-clamp-2 w-full">
                          {b.description}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {earnedBadges.length > 12 && (
              <div className="mt-2 text-center text-xs text-gray-400">
                +{earnedBadges.length - 12} 件
              </div>
            )}
          </Panel>

          {/* 基本情報 */}
          <Panel title="基本情報">
            <dl className="text-sm space-y-2">
              <div className="flex justify-between">
                <dt className="text-gray-500">ログインID</dt>
                <dd className="font-medium text-gray-800 truncate ml-2">
                  {displayLoginId(teacher.email)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">役割</dt>
                <dd className="font-medium text-gray-800">
                  {USER_ROLE_LABELS[teacher.role] || teacher.role}
                </dd>
              </div>
              {teacher.created_at && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">登録日</dt>
                  <dd className="font-medium text-gray-800">
                    {new Date(teacher.created_at).toLocaleDateString('ja-JP')}
                  </dd>
                </div>
              )}
            </dl>
          </Panel>
        </div>
      </div>
    </AdminLayout>
  );
}

// ============================================
// Subcomponents
// ============================================

function StatCard({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="bg-surface-raised border border-gray-200 rounded-xl p-4 hover:border-gray-300 transition-[border-color] duration-150 ease-out">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-gray-900 tabular-nums">{value}</span>
        {unit && <span className="text-xs text-gray-400">{unit}</span>}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-raised border border-gray-200 rounded-xl p-5">
      <h2 className="text-sm font-bold text-gray-800 mb-3">{title}</h2>
      {children}
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400 py-2">{children}</p>;
}
