'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { fetchWithAuth } from '@/lib/api/auth';
import { getActiveTimeSlots } from '@/lib/api/schedule';
import { getTeacherBadges, getTeacherBadgeAssignments } from '@/lib/api/teacher-badges';
import { getTeacherTrainings } from '@/lib/api/teacher-trainings';
import { onTeacherBadgesChanged } from '@/lib/teacher-badge-events';
import type { School, UserProfile, Subject, TeacherBadge, TeacherBadgeAssignment, BadgeRank, TeacherTraining } from '@/types/database';
import { BADGE_RANK_CONFIG, USER_ROLE_LABELS } from '@/types/database';
import type { ScheduleTimeSlot } from '@/types/schedule';
import { Loading } from '@/components/ui';
import { BadgeIcon } from '@/components/teacher-badges/BadgeIcon';
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
    return trimmed.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
  }
  return [];
}

function normalizeToSlotNumbersByDay(v: unknown): Record<string, number[]> {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const out: Record<string, number[]> = {};
    for (const key of Object.keys(v as object)) {
      const arr = normalizeToNumArray((v as Record<string, unknown>)[key]).filter((n) => n >= 1 && n <= 7);
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

  useEffect(() => {
    if (!teacherId) return;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/users/${teacherId}`);
        if (!res.ok) {
          if (res.status === 404) setNotFound(true);
          return;
        }
        setTeacher(await res.json());
      } finally {
        setIsLoading(false);
      }
    })();
  }, [teacherId]);

  // バッジ情報
  useEffect(() => {
    if (!teacherId) return;
    let cancelled = false;
    const loadBadges = async () => {
      try {
        const [badges, assignments] = await Promise.all([
          getTeacherBadges(),
          getTeacherBadgeAssignments(teacherId),
        ]);
        if (cancelled) return;
        setAllBadges(badges);
        setBadgeAssignments(assignments);
      } catch {}
    };
    loadBadges();
    // 他画面でバッジが変更されたら再取得
    const offEvent = onTeacherBadgesChanged((changedId) => {
      if (changedId === teacherId) loadBadges();
    });
    const onFocus = () => loadBadges();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      offEvent();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [teacherId]);

  // 研修参加履歴
  useEffect(() => {
    if (!teacherId) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await getTeacherTrainings(teacherId);
        if (!cancelled) setTrainings(list);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [teacherId]);

  // スロット情報（出勤可能コマ表示用）
  const teacherSchoolIds = teacher?.user_schools?.map((us) => us.school_id) || [];
  useEffect(() => {
    if (teacherSchoolIds.length === 0) return;
    (async () => {
      try {
        const all: ScheduleTimeSlot[] = [];
        const seen = new Set<number>();
        for (const sid of teacherSchoolIds) {
          const slots = await getActiveTimeSlots(sid);
          for (const s of slots) {
            if (!seen.has(s.slot_number)) {
              seen.add(s.slot_number);
              all.push(s);
            }
          }
        }
        all.sort((a, b) => a.slot_number - b.slot_number);
        setScheduleTimeSlots(all);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacher?.id]);

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

  const slotsByDay = normalizeToSlotNumbersByDay(teacher.available_slot_numbers_by_day);
  const totalAvailableSlots = Object.values(slotsByDay).reduce((sum, arr) => sum + arr.length, 0);

  const earnedBadges = badgeAssignments
    .map((a) => allBadges.find((b) => b.id === a.badge_id))
    .filter((b): b is TeacherBadge => b !== undefined);

  const rankCounts: Record<BadgeRank, number> = {
    neutral: 0, bronze: 0, silver: 0, gold: 0, platinum: 0,
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
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg bg-surface-raised transition-colors duration-150"
          >
            一覧に戻る
          </Link>
          <Link
            href={`/admin/teachers/${teacher.id}/edit`}
            className="px-4 py-2 text-sm font-medium text-white bg-ink rounded-lg hover:brightness-[0.85] transition-colors duration-150"
          >
            編集
          </Link>
        </div>
      }
    >
      {/* ヒーローカード */}
      <div className={`${heroBgClass} relative overflow-hidden rounded-2xl p-6 mb-6 shadow-lg text-white transition-colors duration-500`}>
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
                      <div className="text-xs font-semibold text-gray-500 mb-1.5">{GRADE_CATEGORY_LABELS[cat]}</div>
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

          {/* 出勤可能コマ マトリクス */}
          <Panel title="出勤可能コマ">
            {scheduleTimeSlots.length === 0 || totalAvailableSlots === 0 ? (
              <EmptyText>未設定</EmptyText>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="p-2 border border-gray-200 bg-gray-50 text-left font-semibold text-gray-600">コマ</th>
                      {DAY_LABELS.map((d, i) => (
                        <th key={i} className="p-2 border border-gray-200 bg-gray-50 text-center font-semibold text-gray-600 min-w-[42px]">
                          {d}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleTimeSlots.map((slot) => (
                      <tr key={slot.slot_number}>
                        <td className="p-2 border border-gray-200 text-gray-700 whitespace-nowrap">
                          <span className="font-semibold">{slot.slot_number}</span>
                          <span className="ml-1 text-gray-400">{slot.start_time}〜{slot.end_time}</span>
                        </td>
                        {DAY_LABELS.map((_, dayIdx) => {
                          const available = (slotsByDay[String(dayIdx)] || []).includes(slot.slot_number);
                          return (
                            <td
                              key={dayIdx}
                              className={`p-2 border border-gray-200 text-center ${
                                available ? 'bg-emerald-50' : 'bg-surface-raised'
                              }`}
                            >
                              {available && <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                            <span>
                              {new Date(t.attended_on).toLocaleDateString('ja-JP')}
                            </span>
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
                  {earnedBadges.length} <span className="text-xs font-normal text-gray-400">/ {allBadges.length}</span>
                </span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 rounded-full transition-[width] duration-500 ease-out"
                  style={{ width: `${allBadges.length ? (earnedBadges.length / allBadges.length) * 100 : 0}%` }}
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
                    <div className="text-lg font-bold" style={{ color: cfg.color }}>{rankCounts[r]}</div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: cfg.color }}>
                      {cfg.label}
                    </div>
                  </div>
                );
              })}
            </div>
            {earnedBadges.length === 0 ? (
              <EmptyText>まだバッジがありません</EmptyText>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {earnedBadges.slice(0, 12).map((b) => {
                  const cfg = BADGE_RANK_CONFIG[b.rank];
                  return (
                    <div key={b.id} className="flex flex-col items-center text-center" title={b.name}>
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-sm"
                        style={{ background: `linear-gradient(135deg, ${cfg.color}, ${cfg.color}88)` }}
                      >
                        <BadgeIcon icon={b.icon} size={18} />
                      </div>
                      <div className="text-[10px] text-gray-600 mt-1 truncate w-full">{b.name}</div>
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
                <dd className="font-medium text-gray-800 truncate ml-2">{displayLoginId(teacher.email)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">役割</dt>
                <dd className="font-medium text-gray-800">{USER_ROLE_LABELS[teacher.role] || teacher.role}</dd>
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
    <div className="bg-surface-raised border border-gray-200 rounded-xl p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-gray-900">{value}</span>
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
