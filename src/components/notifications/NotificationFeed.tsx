'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { getRecentUnprocessedResponses } from '@/lib/api/form-responses';
import type { FormResponseWithStudent } from '@/lib/api/form-responses';
import { FORM_TYPE_LABELS, GRADE_LABELS, STATUS_LABELS } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronDown, ChevronUp, Check, CheckCheck } from 'lucide-react';
import { getSchool } from '@/lib/api/schools';
import { useConfirm } from '@/hooks/useConfirm';
import { supabase } from '@/lib/supabase';

// ── 定数 ──

const FORM_TYPE_TO_PATH: Record<string, string> = {
  mogi: 'mogi',
  moshi: 'moshi',
  zoukoma: 'zoukoma',
  youbi: 'youbi',
  shukaisu: 'shukaisu',
  soudan: 'soudan',
  kyozai: 'kyozai',
};

const FORM_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  moshi:    { bg: 'bg-blue-100',   text: 'text-blue-800'   },
  mogi:     { bg: 'bg-green-100',  text: 'text-green-800'  },
  zoukoma:  { bg: 'bg-orange-100', text: 'text-orange-800' },
  youbi:    { bg: 'bg-purple-100', text: 'text-purple-800' },
  shukaisu: { bg: 'bg-rose-100',   text: 'text-rose-800'   },
  soudan:   { bg: 'bg-teal-100',   text: 'text-teal-800'   },
  kyozai:   { bg: 'bg-gray-100',   text: 'text-gray-700'   },
};

const SCHOOL_LABEL_COLORS = [
  { bg: 'bg-sky-100',     text: 'text-sky-800' },
  { bg: 'bg-emerald-100', text: 'text-emerald-800' },
  { bg: 'bg-violet-100',  text: 'text-violet-800' },
  { bg: 'bg-rose-100',    text: 'text-rose-800' },
  { bg: 'bg-indigo-100',  text: 'text-indigo-800' },
  { bg: 'bg-teal-100',    text: 'text-teal-800' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-800' },
  { bg: 'bg-orange-100',  text: 'text-orange-800' },
] as const;

const ACTION_LABELS: Record<string, { label: string; className: string }> = {
  created:        { label: '登録',       className: 'bg-green-100 text-green-700' },
  updated:        { label: '編集',       className: 'bg-blue-100 text-blue-700' },
  status_changed: { label: 'ステータス', className: 'bg-orange-100 text-orange-700' },
  soft_deleted:   { label: '削除',       className: 'bg-red-100 text-red-700' },
  restored:       { label: '復元',       className: 'bg-purple-100 text-purple-700' },
};

const FIELD_LABELS: Record<string, string> = {
  last_name: '姓',
  first_name: '名',
  last_name_kana: 'セイ',
  first_name_kana: 'メイ',
  grade: '学年',
  status: '在籍状況',
  school_name: '学校名',
  class_name: 'クラス',
  club: '部活',
  student_code: '生徒コード',
  subject_other: 'その他科目',
};

// ── ユーティリティ ──

function formatDateTime(date: string): string {
  const d = new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(なし)';
  if (key === 'grade' && typeof value === 'number') return GRADE_LABELS[value] ?? String(value);
  if (key === 'status' && typeof value === 'string') return STATUS_LABELS[value as keyof typeof STATUS_LABELS] ?? value;
  return String(value);
}

function getMeaningfulChanges(diff: Record<string, { old: unknown; new: unknown }> | null): Array<{ label: string; old: string; new: string }> {
  if (!diff) return [];
  const changes: Array<{ label: string; old: string; new: string }> = [];
  for (const [key, val] of Object.entries(diff)) {
    if (key === 'updated_at' || key === 'created_at') continue;
    if (!val) continue;
    const oldDisplay = formatValue(key, val.old);
    const newDisplay = formatValue(key, val.new);
    if (oldDisplay === newDisplay) continue;
    const label = FIELD_LABELS[key] ?? key;
    changes.push({ label, old: oldDisplay, new: newDisplay });
  }
  return changes;
}

function buildChangeSummary(action: string, diff: Record<string, { old: unknown; new: unknown }> | null): string {
  if (action === 'created') return '新規登録';
  if (action === 'soft_deleted') return '削除';
  if (action === 'restored') return '復元';
  const changes = getMeaningfulChanges(diff);
  if (changes.length === 0) return '';
  return changes.map((c) => `${c.label}: ${c.old}→${c.new}`).join(', ');
}

function hasMeaningfulChanges(log: StudentLogEntry): boolean {
  if (log.action === 'created' || log.action === 'soft_deleted' || log.action === 'restored') return true;
  const changes = getMeaningfulChanges(log.diff as Record<string, { old: unknown; new: unknown }> | null);
  return changes.length > 0;
}

// ── 型定義 ──

type FeedItemType = 'response' | 'update' | 'shift';

interface FeedItem {
  id: string;
  type: FeedItemType;
  timestamp: string;
  // response 系
  formType?: string;
  formLabel?: string;
  formPeriod?: string;
  schoolId?: string;
  // update 系
  action?: string;
  changeSummary?: string;
  studentId?: string;
  // shift 系
  shiftType?: 'seasonal' | 'regular';
  shiftSettingId?: string;
  shiftSettingName?: string;
  teacherEmail?: string;
  // 共通
  studentName: string;
  gradeLabel?: string;
}

interface StudentLogEntry {
  id: string;
  student_id: string;
  school_id: string;
  action: string;
  diff: Record<string, { old: unknown; new: unknown }> | null;
  created_at: string;
  student: {
    last_name: string;
    first_name: string;
    grade: number;
    status: string;
  } | null;
}

type FilterType = 'all' | 'response' | 'update' | 'shift';

// ── localStorage ──

const FEED_DISMISSED_KEY_PREFIX = 'dismissedFeedIds_';
const OLD_RESPONSE_KEY_PREFIX = 'dismissedResponseIds_';
const OLD_UPDATE_KEY_PREFIX = 'dismissedUpdateLogIds_';

function getDismissedIds(userId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    // 新キーからロード
    const stored = localStorage.getItem(`${FEED_DISMISSED_KEY_PREFIX}${userId}`);
    const ids: Set<string> = stored ? new Set(JSON.parse(stored)) : new Set();

    // 旧キーからマイグレーション（初回のみ）
    const migratedKey = `feedIdsMigrated_${userId}`;
    if (!localStorage.getItem(migratedKey)) {
      const oldResponse = localStorage.getItem(`${OLD_RESPONSE_KEY_PREFIX}${userId}`);
      const oldUpdate = localStorage.getItem(`${OLD_UPDATE_KEY_PREFIX}${userId}`);
      if (oldResponse) {
        const arr: string[] = JSON.parse(oldResponse);
        arr.forEach((id) => ids.add(`response_${id}`));
      }
      if (oldUpdate) {
        const arr: string[] = JSON.parse(oldUpdate);
        arr.forEach((id) => ids.add(`update_${id}`));
      }
      saveDismissedIds(userId, ids);
      localStorage.setItem(migratedKey, '1');
    }

    return ids;
  } catch {
    return new Set();
  }
}

function saveDismissedIds(userId: string, ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${FEED_DISMISSED_KEY_PREFIX}${userId}`, JSON.stringify(Array.from(ids)));
}

// ── コンポーネント ──

interface StudentClickInfo {
  studentId?: string;
  studentName: string;
  schoolId?: string;
}

interface NotificationFeedProps {
  className?: string;
  onStudentClick?: (info: StudentClickInfo) => void;
}

export function NotificationFeed({ className = '', onStudentClick }: NotificationFeedProps) {
  const { getSelectedSchoolIds, selectedSchoolId, user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();

  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [schoolNames, setSchoolNames] = useState<Record<string, string>>({});
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // ユーザーIDが変わったら確認済みIDをロード
  useEffect(() => {
    if (user?.id) {
      setDismissedIds(getDismissedIds(user.id));
    }
  }, [user?.id]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setFeedItems([]);
        return;
      }

      const since = new Date();
      since.setDate(since.getDate() - 7);

      // 並行取得
      const [responsesResult, logsResult, seasonalShiftResult, regularShiftResult] = await Promise.allSettled([
        getRecentUnprocessedResponses(schoolIds, 7, 20),
        supabase
          .from('student_logs')
          .select('id, student_id, school_id, action, diff, created_at, student:students!student_logs_student_id_fkey(last_name, first_name, grade, status)')
          .in('school_id', schoolIds)
          .in('action', ['updated', 'status_changed'])
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('seasonal_shift_submissions')
          .select('id, setting_id, school_id, teacher_name, teacher_email, submitted_at, created_at, setting:seasonal_shift_settings!seasonal_shift_submissions_setting_id_fkey(name)')
          .in('school_id', schoolIds)
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('regular_shift_submissions')
          .select('id, setting_id, school_id, teacher_name, teacher_email, submitted_at, created_at, setting:regular_shift_settings!regular_shift_submissions_setting_id_fkey(name)')
          .in('school_id', schoolIds)
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      const items: FeedItem[] = [];
      const allSchoolIdsToFetch: string[] = [];

      // 回答データ → FeedItem
      if (responsesResult.status === 'fulfilled') {
        const responses: FormResponseWithStudent[] = responsesResult.value;
        responses.forEach((r) => {
          items.push({
            id: `response_${r.id}`,
            type: 'response',
            timestamp: r.created_at,
            formType: r.form_type,
            formLabel: FORM_TYPE_LABELS[r.form_type] ?? r.form_type,
            formPeriod: r.form_period,
            schoolId: r.school_id,
            studentId: r.linked_student_id ?? undefined,
            studentName: r.student_name,
            gradeLabel: GRADE_LABELS[r.grade] ?? `学年${r.grade}`,
          });
        });

        // 教室名を取得（後でシフト分も追加）
        const responseSchoolIds = responses.map((r) => r.school_id);
        allSchoolIdsToFetch.push(...responseSchoolIds);
      }

      // 更新ログ → FeedItem
      if (logsResult.status === 'fulfilled' && !logsResult.value.error) {
        const logs = (logsResult.value.data || []) as unknown as StudentLogEntry[];
        logs
          .filter((l) => hasMeaningfulChanges(l))
          .forEach((l) => {
            const student = l.student;
            const summary = buildChangeSummary(l.action, l.diff as Record<string, { old: unknown; new: unknown }> | null);
            items.push({
              id: `update_${l.id}`,
              type: 'update',
              timestamp: l.created_at,
              action: l.action,
              changeSummary: summary,
              studentId: l.student_id,
              schoolId: l.school_id,
              studentName: student ? `${student.last_name} ${student.first_name}` : '(不明)',
            });
          });
      }

      // シフト申請 → FeedItem
      const processShiftResult = (
        result: PromiseSettledResult<{ data: unknown[] | null; error: unknown }>,
        shiftType: 'seasonal' | 'regular',
      ) => {
        if (result.status !== 'fulfilled' || result.value.error) return;
        const submissions = (result.value.data || []) as Array<{
          id: string;
          setting_id: string;
          school_id: string;
          teacher_name: string;
          teacher_email: string;
          submitted_at: string;
          created_at: string;
          setting: { name: string } | null;
        }>;
        submissions.forEach((s) => {
          items.push({
            id: `shift_${shiftType}_${s.id}`,
            type: 'shift',
            timestamp: s.created_at,
            shiftType,
            shiftSettingId: s.setting_id,
            shiftSettingName: s.setting?.name ?? '',
            teacherEmail: s.teacher_email,
            schoolId: s.school_id,
            studentName: s.teacher_name, // 講師名を共通フィールドで表示
          });
        });
      };
      processShiftResult(seasonalShiftResult, 'seasonal');
      processShiftResult(regularShiftResult, 'regular');

      // シフト申請の教室IDも収集
      items.filter((i) => i.type === 'shift' && i.schoolId).forEach((i) => allSchoolIdsToFetch.push(i.schoolId!));

      // 教室名を一括取得
      const uniqueSchoolIds = Array.from(new Set(allSchoolIdsToFetch));
      if (uniqueSchoolIds.length > 0) {
        const nameMap: Record<string, string> = {};
        await Promise.all(
          uniqueSchoolIds.map(async (sid) => {
            try {
              const school = await getSchool(sid);
              if (school) nameMap[sid] = school.name;
            } catch { /* ignore */ }
          })
        );
        setSchoolNames(nameMap);
      }

      // 時系列ソート（新しい順）
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setFeedItems(items);
    } catch (error) {
      console.error('Error fetching notification feed:', error);
      setFeedItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds]);

  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchData();
    }
  }, [fetchData, selectedSchoolId]);

  // フィルタ＋確認済み除外
  const visibleItems = useMemo(() => {
    return feedItems
      .filter((item) => !dismissedIds.has(item.id))
      .filter((item) => filter === 'all' || item.type === filter);
  }, [feedItems, dismissedIds, filter]);

  // カウント（確認済み除外、フィルタ前）
  const counts = useMemo(() => {
    const undismissed = feedItems.filter((item) => !dismissedIds.has(item.id));
    return {
      all: undismissed.length,
      response: undismissed.filter((i) => i.type === 'response').length,
      update: undismissed.filter((i) => i.type === 'update').length,
      shift: undismissed.filter((i) => i.type === 'shift').length,
    };
  }, [feedItems, dismissedIds]);

  // 教室カラーマップ
  const schoolColorBySchoolId = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    visibleItems.forEach((item) => {
      if (item.schoolId && !seen.has(item.schoolId)) {
        seen.add(item.schoolId);
        order.push(item.schoolId);
      }
    });
    const map: Record<string, { bg: string; text: string }> = {};
    order.forEach((id, i) => {
      map[id] = SCHOOL_LABEL_COLORS[i % SCHOOL_LABEL_COLORS.length];
    });
    return map;
  }, [visibleItems]);

  const handleDismiss = useCallback(
    (id: string) => {
      if (!user?.id) return;
      const next = new Set(dismissedIds);
      next.add(id);
      setDismissedIds(next);
      saveDismissedIds(user.id, next);
    },
    [dismissedIds, user?.id]
  );

  const handleDismissAll = useCallback(async () => {
    if (!user?.id) return;
    const targetItems = feedItems
      .filter((item) => !dismissedIds.has(item.id))
      .filter((item) => filter === 'all' || item.type === filter);
    if (targetItems.length === 0) return;

    const filterLabel = filter === 'all' ? '通知' : filter === 'response' ? '新着申込' : filter === 'update' ? '更新履歴' : 'シフト申請';
    const confirmed = await confirm({
      title: '一括確認',
      description: `${filterLabel} ${targetItems.length}件 をすべて確認済みにしますか？`,
      confirmLabel: '確認済みにする',
      variant: 'default',
    });
    if (!confirmed) return;

    const next = new Set(dismissedIds);
    targetItems.forEach((item) => next.add(item.id));
    setDismissedIds(next);
    saveDismissedIds(user.id, next);
  }, [feedItems, dismissedIds, user?.id, confirm, filter]);

  // ── ローディング ──
  if (isLoading) {
    return (
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
        <div className="flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#1e3a5f] border-t-transparent rounded-full animate-spin"></div>
          <span className="ml-2 text-sm text-gray-500">通知を読み込み中...</span>
        </div>
      </div>
    );
  }

  // ── 空 ──
  if (counts.all === 0) {
    return (
      <>
        <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
          <div className="text-center text-sm text-gray-500">直近7日間の通知はありません</div>
        </div>
        {ConfirmDialog}
      </>
    );
  }

  // ── フィルターチップ ──
  const filterChips: Array<{ key: FilterType; label: string; count: number }> = [
    { key: 'all', label: 'すべて', count: counts.all },
    { key: 'response', label: '申込', count: counts.response },
    { key: 'update', label: '更新履歴', count: counts.update },
    { key: 'shift', label: 'シフト', count: counts.shift },
  ];

  return (
    <>
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 overflow-hidden ${className}`}>
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-3 bg-white border-b border-gray-200">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-[#1a1a1a]">通知フィード</span>
            <span className="text-xs text-gray-400">直近7日</span>
          </div>
          <div className="flex items-center gap-1.5">
            {/* フィルターチップ */}
            {filterChips.map((chip) => (
              <button
                key={chip.key}
                onClick={() => setFilter(chip.key)}
                className={`text-[11px] px-2.5 py-1 rounded-full transition-colors ${
                  filter === chip.key
                    ? 'bg-[#1e3a5f] text-white'
                    : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                }`}
              >
                {chip.label}
                {chip.count > 0 && (
                  <span className={`ml-1 ${filter === chip.key ? 'text-white/80' : 'text-gray-400'}`}>
                    {chip.count}
                  </span>
                )}
              </button>
            ))}

            <span className="w-px h-4 bg-gray-200 mx-1" />

            {/* すべて見る */}
            <Link
              href="/responses"
              className="text-xs text-[#3b82f6] hover:text-[#1d4ed8] font-medium whitespace-nowrap"
            >
              すべて見る →
            </Link>

            {/* 一括確認 */}
            <button
              onClick={handleDismissAll}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 font-medium px-2 py-1 rounded hover:bg-gray-100 transition-colors whitespace-nowrap"
              title="すべて確認済みにする"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              一括確認
            </button>

            {/* 折りたたみ */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* フィードリスト */}
        {isExpanded && (
          <div className="max-h-[350px] overflow-y-auto divide-y divide-gray-100">
            {visibleItems.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400 italic">
                {filter === 'all' ? '表示する通知はありません' : `${filter === 'response' ? '申込' : filter === 'update' ? '更新履歴' : 'シフト申請'}はありません`}
              </div>
            ) : (
              visibleItems.map((item) => (
                <FeedItemRow
                  key={item.id}
                  item={item}
                  schoolNames={schoolNames}
                  schoolColorBySchoolId={schoolColorBySchoolId}
                  onDismiss={handleDismiss}
                  onStudentClick={onStudentClick}
                />
              ))
            )}
          </div>
        )}
      </div>
      {ConfirmDialog}
    </>
  );
}

// ── FeedItemRow ──

interface FeedItemRowProps {
  item: FeedItem;
  schoolNames: Record<string, string>;
  schoolColorBySchoolId: Record<string, { bg: string; text: string }>;
  onDismiss: (id: string) => void;
  onStudentClick?: (info: StudentClickInfo) => void;
}

function FeedItemRow({ item, schoolNames, schoolColorBySchoolId, onDismiss, onStudentClick }: FeedItemRowProps) {
  if (item.type === 'response') {
    return <ResponseRow item={item} schoolNames={schoolNames} schoolColorBySchoolId={schoolColorBySchoolId} onDismiss={onDismiss} onStudentClick={onStudentClick} />;
  }
  if (item.type === 'shift') {
    return <ShiftRow item={item} schoolNames={schoolNames} schoolColorBySchoolId={schoolColorBySchoolId} onDismiss={onDismiss} />;
  }
  return <UpdateRow item={item} onDismiss={onDismiss} onStudentClick={onStudentClick} />;
}

function ResponseRow({
  item,
  schoolNames,
  schoolColorBySchoolId,
  onDismiss,
  onStudentClick,
}: {
  item: FeedItem;
  schoolNames: Record<string, string>;
  schoolColorBySchoolId: Record<string, { bg: string; text: string }>;
  onDismiss: (id: string) => void;
  onStudentClick?: (info: StudentClickInfo) => void;
}) {
  const path = FORM_TYPE_TO_PATH[item.formType ?? ''] ?? item.formType;
  const href = `/forms/responses/${path}/${item.formPeriod}`;
  const color = FORM_TYPE_COLORS[item.formType ?? ''] ?? { bg: 'bg-gray-100', text: 'text-gray-700' };
  const schoolName = item.schoolId ? schoolNames[item.schoolId] : undefined;
  const schoolColor = item.schoolId ? schoolColorBySchoolId[item.schoolId] : undefined;

  return (
    <div className="flex items-center gap-2 px-4 py-2 hover:bg-amber-50 transition-colors group">
      <span className="text-xs text-gray-400 whitespace-nowrap w-[72px] shrink-0">
        {formatDateTime(item.timestamp)}
      </span>
      <Link href={href} className={`px-1.5 py-0.5 ${color.bg} ${color.text} text-[11px] font-medium rounded whitespace-nowrap shrink-0 hover:opacity-80`}>
        {item.formLabel}
      </Link>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {onStudentClick ? (
          <button
            type="button"
            onClick={() => onStudentClick({ studentId: item.studentId, studentName: item.studentName, schoolId: item.schoolId })}
            className="text-sm text-[#1a1a1a] hover:text-[#3b82f6] hover:underline cursor-pointer font-medium shrink-0"
          >
            {item.studentName}
          </button>
        ) : (
          <span className="text-sm text-[#1a1a1a] truncate">{item.studentName}</span>
        )}
        {item.gradeLabel && (
          <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">{item.gradeLabel}</span>
        )}
        {schoolName && schoolColor && (
          <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap shrink-0 ${schoolColor.bg} ${schoolColor.text}`}>
            {schoolName}
          </span>
        )}
      </div>
      <button
        onClick={() => onDismiss(item.id)}
        className="flex items-center text-gray-400 hover:text-green-600 p-1 rounded hover:bg-green-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
        title="確認済みにする"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function ShiftRow({
  item,
  schoolNames,
  schoolColorBySchoolId,
  onDismiss,
}: {
  item: FeedItem;
  schoolNames: Record<string, string>;
  schoolColorBySchoolId: Record<string, { bg: string; text: string }>;
  onDismiss: (id: string) => void;
}) {
  const shiftLabel = item.shiftType === 'seasonal' ? '講習シフト' : '通常シフト';
  const href = item.shiftType === 'seasonal'
    ? `/settings/seasonal-shifts/${item.shiftSettingId}/submissions`
    : `/settings/regular-shifts/${item.shiftSettingId}/submissions`;
  const schoolName = item.schoolId ? schoolNames[item.schoolId] : undefined;
  const schoolColor = item.schoolId ? schoolColorBySchoolId[item.schoolId] : undefined;

  return (
    <div className="flex items-center gap-2 px-4 py-2 hover:bg-cyan-50 transition-colors group">
      <span className="text-xs text-gray-400 whitespace-nowrap w-[72px] shrink-0">
        {formatDateTime(item.timestamp)}
      </span>
      <Link href={href} className="px-1.5 py-0.5 bg-cyan-100 text-cyan-800 text-[11px] font-medium rounded whitespace-nowrap shrink-0 hover:opacity-80">
        {shiftLabel}
      </Link>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-sm text-[#1a1a1a] font-medium shrink-0">{item.studentName}</span>
        {item.shiftSettingName && (
          <span className="text-xs text-gray-500 truncate" title={item.shiftSettingName}>
            {item.shiftSettingName}
          </span>
        )}
        {schoolName && schoolColor && (
          <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap shrink-0 ${schoolColor.bg} ${schoolColor.text}`}>
            {schoolName}
          </span>
        )}
      </div>
      <button
        onClick={() => onDismiss(item.id)}
        className="flex items-center text-gray-400 hover:text-green-600 p-1 rounded hover:bg-green-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
        title="確認済みにする"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function UpdateRow({
  item,
  onDismiss,
  onStudentClick,
}: {
  item: FeedItem;
  onDismiss: (id: string) => void;
  onStudentClick?: (info: StudentClickInfo) => void;
}) {
  const actionInfo = ACTION_LABELS[item.action ?? ''] ?? { label: item.action ?? '', className: 'bg-gray-100 text-gray-600' };

  return (
    <div className="flex items-center gap-2 px-4 py-2 hover:bg-blue-50 transition-colors group">
      <span className="text-xs text-gray-400 whitespace-nowrap w-[72px] shrink-0">
        {formatDateTime(item.timestamp)}
      </span>
      <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap shrink-0 ${actionInfo.className}`}>
        {actionInfo.label}
      </span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {onStudentClick ? (
          <button
            type="button"
            onClick={() => onStudentClick({ studentId: item.studentId, studentName: item.studentName, schoolId: item.schoolId })}
            className="text-sm text-[#1a1a1a] hover:text-[#3b82f6] hover:underline cursor-pointer font-medium shrink-0"
          >
            {item.studentName}
          </button>
        ) : (
          <span className="text-sm text-[#1a1a1a] font-medium shrink-0">{item.studentName}</span>
        )}
        {item.changeSummary && (
          <span className="text-xs text-gray-500 truncate" title={item.changeSummary}>
            {item.changeSummary}
          </span>
        )}
      </div>
      <button
        onClick={() => onDismiss(item.id)}
        className="flex items-center text-gray-400 hover:text-green-600 p-1 rounded hover:bg-green-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
        title="確認済みにする"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
