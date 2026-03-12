'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getRecentUnprocessedResponses } from '@/lib/api/form-responses';
import type { FormResponseWithStudent } from '@/lib/api/form-responses';
import { FORM_TYPE_LABELS, GRADE_LABELS } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronDown, ChevronUp } from 'lucide-react';

const FORM_TYPE_TO_PATH: Record<string, string> = {
  mogi: 'mogi',
  moshi: 'moshi',
  zoukoma: 'zoukoma',
  youbi: 'youbi',
  shukaisu: 'shukaisu',
  soudan: 'soudan',
  kyozai: 'kyozai',
};

function formatDateTime(date: string): string {
  const d = new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface NewResponsesBoardProps {
  className?: string;
}

export function NewResponsesBoard({ className = '' }: NewResponsesBoardProps) {
  const { getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const [responses, setResponses] = useState<FormResponseWithStudent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);

  const fetchResponses = useCallback(async () => {
    setIsLoading(true);
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setResponses([]);
        return;
      }
      const data = await getRecentUnprocessedResponses(schoolIds, 7, 10);
      setResponses(data);
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

  if (responses.length === 0) {
    return (
      <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 p-4 ${className}`}>
        <div className="text-center text-sm text-gray-500">
          直近7日間の新着申込はありません
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-[#f8f8f8] rounded-xl border border-gray-200 overflow-hidden ${className}`}>
      {/* ヘッダー */}
      <div className="flex items-center justify-between p-4 bg-[#fff8e1] border-b border-[#ffe082]">
        <div className="flex items-center gap-2">
          <span className="text-lg">📋</span>
          <span className="font-bold text-[#1a1a1a]">
            新着の申し込み（{responses.length}件）
          </span>
          <span className="text-xs text-gray-500 ml-1">直近7日・未処理</span>
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
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            {isExpanded ? (
              <ChevronUp className="w-5 h-5" />
            ) : (
              <ChevronDown className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {/* 申込一覧 */}
      {isExpanded && (
        <div className="divide-y divide-gray-100">
          {responses.map((response) => {
            const path = FORM_TYPE_TO_PATH[response.form_type] ?? response.form_type;
            const href = `/forms/responses/${path}/${response.form_period}`;
            const formLabel = FORM_TYPE_LABELS[response.form_type] ?? response.form_type;
            const gradeLabel = GRADE_LABELS[response.grade] ?? `学年${response.grade}`;
            return (
              <Link key={response.id} href={href}>
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50 transition-colors cursor-pointer">
                  <span className="text-xs text-gray-400 whitespace-nowrap w-[72px] shrink-0">
                    {formatDateTime(response.created_at)}
                  </span>
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-medium rounded whitespace-nowrap shrink-0">
                    {formLabel}
                  </span>
                  <span className="text-sm text-[#1a1a1a] truncate">
                    {response.student_name}
                  </span>
                  <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">
                    {gradeLabel}
                  </span>
                  <span className="ml-auto text-xs text-[#3b82f6] whitespace-nowrap shrink-0">
                    詳細 →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
