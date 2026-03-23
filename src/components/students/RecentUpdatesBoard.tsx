'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronUp, Check, CheckCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { GRADE_LABELS, STATUS_LABELS } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { useConfirm } from '@/hooks/useConfirm';

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

function formatDateTime(date: string): string {
  const d = new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** フィールド名を日本語に変換 */
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

/** 値を表示用に変換 */
function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(なし)';
  if (key === 'grade' && typeof value === 'number') return GRADE_LABELS[value] ?? String(value);
  if (key === 'status' && typeof value === 'string') return STATUS_LABELS[value as keyof typeof STATUS_LABELS] ?? value;
  return String(value);
}

/** diffから意味のある変更フィールドだけ抽出 */
function getMeaningfulChanges(diff: Record<string, { old: unknown; new: unknown }> | null): Array<{ label: string; old: string; new: string }> {
  if (!diff) return [];
  const changes: Array<{ label: string; old: string; new: string }> = [];
  for (const [key, val] of Object.entries(diff)) {
    if (key === 'updated_at' || key === 'created_at') continue;
    if (!val) continue;
    const oldDisplay = formatValue(key, val.old);
    const newDisplay = formatValue(key, val.new);
    // 表示上同じなら変更なしとみなす（null と "" の違いを無視）
    if (oldDisplay === newDisplay) continue;
    const label = FIELD_LABELS[key] ?? key;
    changes.push({ label, old: oldDisplay, new: newDisplay });
  }
  return changes;
}

/** diffからサマリーテキストを生成 */
function buildChangeSummary(action: string, diff: Record<string, { old: unknown; new: unknown }> | null): string {
  if (action === 'created') return '新規登録';
  if (action === 'soft_deleted') return '削除';
  if (action === 'restored') return '復元';

  const changes = getMeaningfulChanges(diff);
  if (changes.length === 0) return '';
  return changes.map((c) => `${c.label}: ${c.old}→${c.new}`).join(', ');
}

/** ログに意味のある変更があるか */
function hasMeaningfulChanges(log: StudentLogEntry): boolean {
  if (log.action === 'created' || log.action === 'soft_deleted' || log.action === 'restored') return true;
  const changes = getMeaningfulChanges(log.diff as Record<string, { old: unknown; new: unknown }> | null);
  return changes.length > 0;
}

const ACTION_LABELS: Record<string, { label: string; className: string }> = {
  created: { label: '登録', className: 'bg-green-100 text-green-700' },
  updated: { label: '編集', className: 'bg-blue-100 text-blue-700' },
  status_changed: { label: 'ステータス', className: 'bg-orange-100 text-orange-700' },
  soft_deleted: { label: '削除', className: 'bg-red-100 text-red-700' },
  restored: { label: '復元', className: 'bg-purple-100 text-purple-700' },
};

const DISMISSED_KEY_PREFIX = 'dismissedUpdateLogIds_';

function getDismissedIds(userId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = localStorage.getItem(`${DISMISSED_KEY_PREFIX}${userId}`);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedIds(userId: string, ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${DISMISSED_KEY_PREFIX}${userId}`, JSON.stringify(Array.from(ids)));
}

interface RecentUpdatesBoardProps {
  className?: string;
  onStudentClick?: (studentId: string) => void;
}

export function RecentUpdatesBoard({ className = '', onStudentClick }: RecentUpdatesBoardProps) {
  const { getSelectedSchoolIds, selectedSchoolId, user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [logs, setLogs] = useState<StudentLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user?.id) {
      setDismissedIds(getDismissedIds(user.id));
    }
  }, [user?.id]);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setLogs([]);
        return;
      }

      const since = new Date();
      since.setDate(since.getDate() - 7);

      const { data, error } = await supabase
        .from('student_logs')
        .select('id, student_id, school_id, action, diff, created_at, student:students!student_logs_student_id_fkey(last_name, first_name, grade, status)')
        .in('school_id', schoolIds)
        .in('action', ['updated', 'status_changed'])
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Error fetching student logs:', error);
        setLogs([]);
        return;
      }

      setLogs((data || []) as unknown as StudentLogEntry[]);
    } catch (error) {
      console.error('Error fetching student logs:', error);
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds]);

  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchLogs();
    }
  }, [fetchLogs, selectedSchoolId]);

  const visibleLogs = useMemo(
    () => logs.filter((l) => !dismissedIds.has(l.id) && hasMeaningfulChanges(l)),
    [logs, dismissedIds]
  );

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
    const confirmed = await confirm({
      title: '一括確認',
      description: `更新履歴 ${visibleLogs.length}件 をすべて確認済みにしますか？`,
      confirmLabel: '確認済みにする',
      variant: 'default',
    });
    if (!confirmed) return;
    const next = new Set(dismissedIds);
    logs.forEach((l) => next.add(l.id));
    setDismissedIds(next);
    saveDismissedIds(user.id, next);
  }, [logs, dismissedIds, user?.id, confirm, visibleLogs.length]);

  if (isLoading) {
    return (
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
        <div className="flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-[#1e3a5f] border-t-transparent rounded-full animate-spin"></div>
          <span className="ml-2 text-sm text-gray-500">更新履歴を確認中...</span>
        </div>
      </div>
    );
  }

  if (visibleLogs.length === 0) {
    return (
      <>
        <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
          <div className="text-center text-sm text-gray-500">直近7日間の更新はありません</div>
        </div>
        {ConfirmDialog}
      </>
    );
  }

  return (
    <>
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 overflow-hidden ${className}`}>
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 bg-[#e3f2fd] border-b border-[#bbdefb]">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#1a1a1a]">生徒情報の更新履歴（{visibleLogs.length}件）</span>
            <span className="text-xs text-gray-500 ml-1">直近7日</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDismissAll}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 font-medium px-2 py-1 rounded hover:bg-gray-100 transition-colors"
              title="すべて確認済みにする"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              一括確認
            </button>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* 一覧 */}
        {isExpanded && (
          <div className="divide-y divide-gray-100">
            {visibleLogs.map((log) => {
              const student = log.student;
              const studentName = student
                ? `${student.last_name} ${student.first_name}`
                : '(不明)';
              const actionInfo = ACTION_LABELS[log.action] ?? { label: log.action, className: 'bg-gray-100 text-gray-600' };
              const summary = buildChangeSummary(log.action, log.diff as Record<string, { old: unknown; new: unknown }> | null);

              return (
                <div
                  key={log.id}
                  className="flex items-start gap-2 px-4 py-2 hover:bg-blue-50 transition-colors group"
                >
                  <span className="text-xs text-gray-400 whitespace-nowrap w-[72px] shrink-0 mt-0.5">
                    {formatDateTime(log.created_at)}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap shrink-0 ${actionInfo.className}`}>
                    {actionInfo.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => onStudentClick?.(log.student_id)}
                      className="text-sm text-[#1a1a1a] hover:text-[#3b82f6] hover:underline cursor-pointer font-medium"
                    >
                      {studentName}
                    </button>
                    <p className="text-xs text-gray-500 truncate mt-0.5" title={summary}>
                      {summary}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDismiss(log.id)}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-600 px-2 py-1 rounded hover:bg-green-50 transition-colors opacity-0 group-hover:opacity-100 whitespace-nowrap shrink-0"
                    title="確認済みにする"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {ConfirmDialog}
    </>
  );
}
