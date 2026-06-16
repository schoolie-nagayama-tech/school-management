'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { loadNotificationFeed } from '@/lib/api/notifications';
import type { FeedItem, NotificationInitialData } from '@/lib/api/notifications';
// FORM_TYPE_LABELS / GRADE_LABELS / STATUS_LABELS の変換ロジックは notifications.ts に移動済み
import { useAuth } from '@/contexts/AuthContext';
import { ChevronDown, ChevronUp, Check, CheckCheck, AlertTriangle } from 'lucide-react';
import { InlineLoading } from '@/components/ui';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useConfirm } from '@/hooks/useConfirm';
import { toggleCheck as toggleMonthlyTaskCheckApi } from '@/lib/api/monthlyTasks';

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

// ── ユーティリティ（描画専用） ──
// FIELD_LABELS / getMeaningfulChanges / buildChangeSummary / hasMeaningfulChanges は
// notifications.ts に移動済み（共有純関数化）

/** タイムスタンプを「M/D H:MM」形式に整形する（描画のみで使用） */
function formatDateTime(date: string): string {
  const d = new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── 型定義（フィルタ型はコンポーネントローカル） ──

type FilterType = 'all' | 'response' | 'update' | 'shift' | 'deadline' | 'transcript';

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
  /**
   * サーバーコンポーネントで事前取得した初期データ（Phase3: SSRストリーミング）。
   * 渡された場合は初回のクライアント fetch をスキップし、ハイドレーション後の
   * 「fetchが始まるまでの空白」を無くす。教室切替などの再取得は従来通り動作する。
   * 未指定なら従来どおりマウント時にクライアントで取得する（既存呼び出しと完全互換）。
   */
  initialData?: NotificationInitialData;
}

export function NotificationFeed({ className = '', onStudentClick, initialData }: NotificationFeedProps) {
  const { getSelectedSchoolIds, selectedSchoolId, user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  // 教室名はアプリ起動時にロード済みの MasterData から引く（旧: フィード取得後に
  // getSchool を教室数分だけ追加で叩く2段目のラウンドトリップが発生していた）
  const { schools } = useMasterData();
  const schoolNames = useMemo(
    () => Object.fromEntries(schools.map((s) => [s.id, s.name])) as Record<string, string>,
    [schools]
  );

  // 初期データがあれば seed として使い、ローディングは非表示にする
  const [feedItems, setFeedItems] = useState<FeedItem[]>(initialData?.feedItems ?? []);
  const [isLoading, setIsLoading] = useState(!initialData);
  const [isExpanded, setIsExpanded] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // 初期データ（SSR事前取得）を消費したかどうか。マウント直後の1回だけ fetch をスキップするためのフラグ。
  const skipInitialFetchRef = useRef<boolean>(!!initialData);

  // ユーザーIDが変わったら確認済みIDをロード
  useEffect(() => {
    if (user?.id) {
      setDismissedIds(getDismissedIds(user.id));
    }
  }, [user?.id]);

  const fetchData = useCallback(async () => {
    // 初回のみ: SSR 事前取得データがあればクライアント fetch をスキップ
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      return;
    }
    setIsLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setFeedItems([]);
        return;
      }
      // 取得・変換は共有関数に委譲（notifications.ts）
      const items = await loadNotificationFeed(schoolIds);
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
  // type ごとに5回 filter していたのを単一パスの集計に統合
  const counts = useMemo(() => {
    const result = { all: 0, response: 0, update: 0, shift: 0, deadline: 0, transcript: 0 };
    for (const item of feedItems) {
      if (dismissedIds.has(item.id)) continue;
      result.all++;
      if (item.type in result) result[item.type as keyof typeof result]++;
    }
    return result;
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

  // 業務タスクを実施済みにする（未完了の全教室分）
  const handleCompleteMonthlyTask = useCallback(
    async (feedId: string, taskId: string, incompleteSchoolIds: string[]) => {
      try {
        await Promise.all(
          incompleteSchoolIds.map((sid) => toggleMonthlyTaskCheckApi(taskId, sid, true))
        );
        // フィードからも除去
        setFeedItems((prev) => prev.filter((item) => item.id !== feedId));
      } catch {
        console.error('Failed to complete monthly task');
      }
    },
    []
  );

  const handleDismissAll = useCallback(async () => {
    if (!user?.id) return;
    const targetItems = feedItems
      .filter((item) => !dismissedIds.has(item.id))
      .filter((item) => filter === 'all' || item.type === filter);
    if (targetItems.length === 0) return;

    const filterLabel = filter === 'all' ? '通知' : filter === 'response' ? '新着申込' : filter === 'update' ? '更新履歴' : filter === 'shift' ? 'シフト申請' : filter === 'transcript' ? '面談紐付け' : '期日';
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
        <InlineLoading label="通知を読み込み中..." />
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
    { key: 'update', label: '更新', count: counts.update },
    { key: 'shift', label: 'シフト', count: counts.shift },
    { key: 'deadline', label: '期日', count: counts.deadline },
    { key: 'transcript', label: '面談紐付け', count: counts.transcript },
  ];

  return (
    <>
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 overflow-hidden ${className}`}>
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-200">
          <div className="flex items-center gap-3">
            <span className="font-bold text-[13px] text-[#1a1a1a] whitespace-nowrap">通知</span>
            {/* フィルターチップ */}
            <div className="flex items-center gap-1">
              {filterChips.map((chip) => (
                <button
                  key={chip.key}
                  onClick={() => setFilter(chip.key)}
                  className={`flex items-center gap-1 text-[11px] h-6 px-2 rounded transition-colors whitespace-nowrap ${
                    filter === chip.key
                      ? 'bg-[#1e3a5f] text-white font-medium'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {chip.label}
                  {chip.count > 0 && (
                    <span className={`min-w-[16px] h-4 flex items-center justify-center rounded-full text-[10px] font-bold leading-none px-1 ${
                      filter === chip.key
                        ? 'bg-white/25 text-white'
                        : 'bg-gray-200 text-gray-600'
                    }`}>
                      {chip.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* すべて見る */}
            <Link
              href="/responses"
              className="text-[11px] text-[#3b82f6] hover:text-[#1d4ed8] font-medium whitespace-nowrap px-1.5 py-1"
            >
              すべて見る
            </Link>
            <span className="w-px h-3.5 bg-gray-200" />
            {/* 一括確認 */}
            <button
              onClick={handleDismissAll}
              className="flex items-center gap-0.5 text-[11px] text-gray-400 hover:text-gray-600 px-1.5 py-1 rounded hover:bg-gray-50 transition-colors whitespace-nowrap"
              title="すべて確認済みにする"
            >
              <CheckCheck className="w-3 h-3" />
              一括確認
            </button>
            <span className="w-px h-3.5 bg-gray-200" />
            {/* 折りたたみ */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-400 hover:text-gray-600 transition-colors p-0.5"
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* フィードリスト */}
        {isExpanded && (
          <div className="max-h-[640px] overflow-y-auto divide-y divide-gray-100">
            {visibleItems.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400 italic">
                {filter === 'all' ? '表示する通知はありません' : `${filter === 'response' ? '申込' : filter === 'update' ? '更新履歴' : filter === 'shift' ? 'シフト申請' : filter === 'transcript' ? '面談紐付け' : '期日通知'}はありません`}
              </div>
            ) : (
              visibleItems.map((item) => (
                <FeedItemRow
                  key={item.id}
                  item={item}
                  schoolNames={schoolNames}
                  schoolColorBySchoolId={schoolColorBySchoolId}
                  onDismiss={handleDismiss}
                  onCompleteMonthlyTask={handleCompleteMonthlyTask}
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
  onCompleteMonthlyTask: (feedId: string, taskId: string, incompleteSchoolIds: string[]) => void;
  onStudentClick?: (info: StudentClickInfo) => void;
}

function FeedItemRow({ item, schoolNames, schoolColorBySchoolId, onDismiss, onCompleteMonthlyTask, onStudentClick }: FeedItemRowProps) {
  if (item.type === 'response') {
    return <ResponseRow item={item} schoolNames={schoolNames} schoolColorBySchoolId={schoolColorBySchoolId} onDismiss={onDismiss} onStudentClick={onStudentClick} />;
  }
  if (item.type === 'shift') {
    return <ShiftRow item={item} schoolNames={schoolNames} schoolColorBySchoolId={schoolColorBySchoolId} onDismiss={onDismiss} />;
  }
  if (item.type === 'deadline') {
    return <DeadlineRow item={item} schoolNames={schoolNames} schoolColorBySchoolId={schoolColorBySchoolId} onDismiss={onDismiss} onCompleteMonthlyTask={onCompleteMonthlyTask} />;
  }
  if (item.type === 'transcript') {
    return <TranscriptRow item={item} schoolNames={schoolNames} schoolColorBySchoolId={schoolColorBySchoolId} onDismiss={onDismiss} onStudentClick={onStudentClick} />;
  }
  return <UpdateRow item={item} onDismiss={onDismiss} onStudentClick={onStudentClick} />;
}

function TranscriptRow({
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
  const schoolName = item.schoolId ? schoolNames[item.schoolId] : undefined;
  const schoolColor = item.schoolId ? schoolColorBySchoolId[item.schoolId] : undefined;

  return (
    <div className="flex items-center gap-2 px-4 py-2 hover:bg-indigo-50 transition-colors group">
      <span className="text-xs text-gray-400 whitespace-nowrap w-[72px] shrink-0">
        {formatDateTime(item.timestamp)}
      </span>
      <Link href="/transcriptions" className="px-1.5 py-0.5 bg-indigo-100 text-indigo-800 text-[11px] font-medium rounded whitespace-nowrap shrink-0 hover:opacity-80">
        面談紐付け
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
          <span className="text-sm text-[#1a1a1a] font-medium shrink-0">{item.studentName}</span>
        )}
        {item.gradeLabel && (
          <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">{item.gradeLabel}</span>
        )}
        {item.transcriptTitle && (
          <span className="text-xs text-gray-500 truncate" title={item.transcriptTitle}>
            {item.transcriptTitle}
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
  const href = item.schoolId
    ? `/forms/responses/${path}/${item.formPeriod}?schoolId=${item.schoolId}`
    : `/forms/responses/${path}/${item.formPeriod}`;
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

function DeadlineRow({
  item,
  schoolNames,
  schoolColorBySchoolId,
  onDismiss,
  onCompleteMonthlyTask,
}: {
  item: FeedItem;
  schoolNames: Record<string, string>;
  schoolColorBySchoolId: Record<string, { bg: string; text: string }>;
  onDismiss: (id: string) => void;
  onCompleteMonthlyTask: (feedId: string, taskId: string, incompleteSchoolIds: string[]) => void;
}) {
  const isOverdue = item.deadlineType === 'overdue';
  const isMonthly = item.deadlineSource === 'monthly';
  const sourceLabel = isMonthly ? '業務' : '講習準備';
  const statusLabel = isOverdue ? '超過' : '期日近';
  const badgeClass = isOverdue
    ? 'bg-red-600 text-white shadow-sm ring-1 ring-red-700'
    : 'bg-amber-100 text-amber-700';
  const rowClass = isOverdue
    ? 'bg-red-50/60 hover:bg-red-100 border-l-4 border-red-500'
    : 'hover:bg-amber-50';
  const dateClass = isOverdue ? 'text-red-700 font-bold' : 'text-gray-400';
  const inlineDateClass = isOverdue
    ? 'bg-red-100 text-red-700 font-semibold'
    : 'bg-amber-50 text-amber-700';
  const schoolName = item.schoolId ? schoolNames[item.schoolId] : undefined;
  const schoolColor = item.schoolId ? schoolColorBySchoolId[item.schoolId] : undefined;

  // feedId から実際のtask IDを抽出
  const actualTaskId = item.id.replace('deadline_monthly_', '').replace('deadline_schedule_', '');

  const dateDisplay = item.deadlineDate
    ? (() => {
        const d = new Date(item.deadlineDate + 'T00:00:00');
        return `${d.getMonth() + 1}/${d.getDate()}`;
      })()
    : '';

  return (
    <div className={`flex items-center gap-2 px-4 py-2 ${rowClass} transition-colors group`}>
      <span className={`text-xs whitespace-nowrap w-[72px] shrink-0 ${dateClass}`}>
        {dateDisplay}
      </span>
      <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold whitespace-nowrap shrink-0 ${badgeClass}`}>
        {isOverdue && <AlertTriangle className="w-3 h-3" />}
        {statusLabel}
      </span>
      <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[11px] font-medium whitespace-nowrap shrink-0">
        {sourceLabel}
      </span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {item.deadlineHref ? (
          <Link
            href={item.deadlineHref}
            className="text-sm text-[#1a1a1a] hover:text-[#3b82f6] hover:underline font-medium truncate"
            title={item.studentName}
          >
            {item.studentName}
          </Link>
        ) : (
          <span className="text-sm text-[#1a1a1a] font-medium truncate">{item.studentName}</span>
        )}
        {dateDisplay && (
          <span className={`px-1.5 py-0.5 rounded text-[11px] whitespace-nowrap shrink-0 ${inlineDateClass}`}>
            期日 {dateDisplay}
          </span>
        )}
        {schoolName && schoolColor && (
          <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap shrink-0 ${schoolColor.bg} ${schoolColor.text}`}>
            {schoolName}
          </span>
        )}
      </div>
      {isMonthly ? (
        /* 業務タスク → 実施済みにする */
        <button
          onClick={() => onCompleteMonthlyTask(item.id, actualTaskId, item.incompleteSchoolIds ?? [])}
          className="flex items-center text-gray-400 hover:text-green-600 p-1 rounded hover:bg-green-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
          title="実施済みにする"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      ) : (
        /* 準備スケジュール → 確認済み（非表示） */
        <button
          onClick={() => onDismiss(item.id)}
          className="flex items-center text-gray-400 hover:text-green-600 p-1 rounded hover:bg-green-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
          title="確認済みにする"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
