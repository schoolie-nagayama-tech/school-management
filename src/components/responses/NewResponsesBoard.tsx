'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { getRecentUnprocessedResponses } from '@/lib/api/form-responses';
import type { FormResponseWithStudent } from '@/lib/api/form-responses';
import { FORM_TYPE_LABELS, GRADE_LABELS } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronDown, ChevronUp, Check, CheckCheck } from 'lucide-react';
import { getSchool } from '@/lib/api/schools';
import { useConfirm } from '@/hooks/useConfirm';

const FORM_TYPE_TO_PATH: Record<string, string> = {
  mogi: 'mogi',
  moshi: 'moshi',
  zoukoma: 'zoukoma',
  youbi: 'youbi',
  shukaisu: 'shukaisu',
  soudan: 'soudan',
  kyozai: 'kyozai',
};

// フォームタイプ別の色設定
const FORM_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  moshi:    { bg: 'bg-blue-100',   text: 'text-blue-800'   },
  mogi:     { bg: 'bg-green-100',  text: 'text-green-800'  },
  zoukoma:  { bg: 'bg-orange-100', text: 'text-orange-800' },
  youbi:    { bg: 'bg-purple-100', text: 'text-purple-800' },
  shukaisu: { bg: 'bg-rose-100',   text: 'text-rose-800'   },
  soudan:   { bg: 'bg-teal-100',   text: 'text-teal-800'   },
  kyozai:   { bg: 'bg-gray-100',   text: 'text-gray-700'   },
};

// 教室名表示用の色（出現順で割り当て、同じ画面内で被らないようにする）
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

function formatDateTime(date: string): string {
  const d = new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const DISMISSED_KEY_PREFIX = 'dismissedResponseIds_';

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

interface NewResponsesBoardProps {
  className?: string;
}

export function NewResponsesBoard({ className = '' }: NewResponsesBoardProps) {
  const { getSelectedSchoolIds, selectedSchoolId, user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [responses, setResponses] = useState<FormResponseWithStudent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [schoolNames, setSchoolNames] = useState<Record<string, string>>({});
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // ユーザーIDが変わったら確認済みIDをロード
  useEffect(() => {
    if (user?.id) {
      setDismissedIds(getDismissedIds(user.id));
    }
  }, [user?.id]);

  const fetchResponses = useCallback(async () => {
    setIsLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setResponses([]);
        return;
      }
      const data = await getRecentUnprocessedResponses(schoolIds, 7, 20);
      setResponses(data);

      // 教室名を取得
      const uniqueSchoolIds = Array.from(new Set(data.map((r) => r.school_id)));
      const nameMap: Record<string, string> = {};
      await Promise.all(
        uniqueSchoolIds.map(async (sid) => {
          try {
            const school = await getSchool(sid);
            if (school) nameMap[sid] = school.name;
          } catch {
            // 取得失敗は無視
          }
        })
      );
      setSchoolNames(nameMap);
    } catch (error) {
      console.error('Error fetching new responses:', error);
      setResponses([]);
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds]);

  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchResponses();
    }
  }, [fetchResponses, selectedSchoolId]);

  // 未確認のもののみ表示
  const visibleResponses = useMemo(
    () => responses.filter((r) => !dismissedIds.has(r.id)),
    [responses, dismissedIds]
  );

  // 表示中の教室を「先頭からの出現順」で並べ、その順で色を割り当て（同じ画面で色が被らないようにする）
  const schoolColorBySchoolId = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    visibleResponses.forEach((r) => {
      if (r.school_id && !seen.has(r.school_id)) {
        seen.add(r.school_id);
        order.push(r.school_id);
      }
    });
    const map: Record<string, { bg: string; text: string }> = {};
    order.forEach((id, i) => {
      map[id] = SCHOOL_LABEL_COLORS[i % SCHOOL_LABEL_COLORS.length];
    });
    return map;
  }, [visibleResponses]);

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
      description: `新着申込 ${visibleResponses.length}件 をすべて確認済みにしますか？この操作は取り消せません。`,
      confirmLabel: '確認済みにする',
      variant: 'default',
    });
    if (!confirmed) return;
    const next = new Set(dismissedIds);
    responses.forEach((r) => next.add(r.id));
    setDismissedIds(next);
    saveDismissedIds(user.id, next);
  }, [responses, dismissedIds, user?.id, confirm, visibleResponses.length]);

  if (isLoading) {
    return (
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
        <div className="flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#1e3a5f] border-t-transparent rounded-full animate-spin"></div>
          <span className="ml-2 text-sm text-gray-500">新着申込を確認中...</span>
        </div>
      </div>
    );
  }

  if (visibleResponses.length === 0) {
    return (
      <>
        <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
          <div className="text-center text-sm text-gray-500">直近7日間の新着申込はありません</div>
        </div>
        {ConfirmDialog}
      </>
    );
  }

  return (
    <>
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 overflow-hidden ${className}`}>
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 bg-[#fff8e1] border-b border-[#ffe082]">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#1a1a1a]">新着の申し込み（{visibleResponses.length}件）</span>
            <span className="text-xs text-gray-500 ml-1">直近7日</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/responses"
              className="text-xs text-[#3b82f6] hover:text-[#1d4ed8] font-medium"
              onClick={(e) => e.stopPropagation()}
            >
              すべて見る →
            </Link>
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

        {/* 申込一覧 */}
        {isExpanded && (
          <div className="divide-y divide-gray-100">
            {visibleResponses.map((response) => {
              const path = FORM_TYPE_TO_PATH[response.form_type] ?? response.form_type;
              const href = `/forms/responses/${path}/${response.form_period}`;
              const formLabel = FORM_TYPE_LABELS[response.form_type] ?? response.form_type;
              const gradeLabel = GRADE_LABELS[response.grade] ?? `学年${response.grade}`;
              const color = FORM_TYPE_COLORS[response.form_type] ?? { bg: 'bg-gray-100', text: 'text-gray-700' };
              const schoolName = schoolNames[response.school_id];
              const schoolColor = response.school_id ? schoolColorBySchoolId[response.school_id] : null;
              return (
                <div
                  key={response.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50 transition-colors group"
                >
                  <span className="text-xs text-gray-400 whitespace-nowrap w-[72px] shrink-0">
                    {formatDateTime(response.created_at)}
                  </span>
                  <span
                    className={`px-2 py-0.5 ${color.bg} ${color.text} text-xs font-medium rounded whitespace-nowrap shrink-0`}
                  >
                    {formLabel}
                  </span>
                  <Link href={href} className="flex items-center gap-2 flex-1 min-w-0 hover:underline">
                    <span className="text-sm text-[#1a1a1a] truncate">{response.student_name}</span>
                    <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">{gradeLabel}</span>
                    {schoolName && schoolColor && (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap shrink-0 ${schoolColor.bg} ${schoolColor.text}`}>
                        {schoolName}
                      </span>
                    )}
                  </Link>
                  <button
                    onClick={() => handleDismiss(response.id)}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-600 px-2 py-1 rounded hover:bg-green-50 transition-colors opacity-0 group-hover:opacity-100 whitespace-nowrap shrink-0"
                    title="確認済みにする"
                  >
                    <Check className="w-3.5 h-3.5" />
                    確認
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
