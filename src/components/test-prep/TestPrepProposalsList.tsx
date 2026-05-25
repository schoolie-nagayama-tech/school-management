'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getTestPrepProposalsWithStudent } from '@/lib/api/test-prep-proposals';
import type { TestPrepProposal, TestPrepStatus } from '@/types/test-prep';
import { TEST_PREP_STATUS_LABELS } from '@/types/test-prep';

type ProposalRow = TestPrepProposal & {
  student: { last_name: string; first_name: string; grade: number } | null;
  exam_type: { name: string } | null;
};

const STATUS_STYLES: Record<TestPrepStatus, string> = {
  draft: 'bg-surface-hover text-text-muted',
  sent: 'bg-warning-subtle text-yellow-700',
  published: 'bg-success-subtle text-green-700',
};

function gradeName(grade: number): string {
  if (grade >= 10) return `高${grade - 9}`;
  if (grade >= 7) return `中${grade - 6}`;
  return `小${grade}`;
}

export default function TestPrepProposalsList() {
  const router = useRouter();
  const { schoolIds } = useAuth();
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [filter, setFilter] = useState<TestPrepStatus | 'all'>('all');

  const loadData = useCallback(async () => {
    if (!schoolIds || schoolIds.length === 0) return;
    try {
      const data = await getTestPrepProposalsWithStudent(
        schoolIds.length === 1 ? schoolIds[0] : schoolIds
      );
      setProposals(data);
    } catch {
      // handled by empty state
    } finally {
      setLoading(false);
    }
  }, [schoolIds]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = filter === 'all'
    ? proposals
    : proposals.filter((p) => p.status === filter);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-text-heading">テスト対策提案書</h2>
      </div>

      {/* ステータスフィルタ */}
      <div className="flex items-center gap-1.5 mb-4">
        {(['all', 'draft', 'sent', 'published'] as const).map((s) => {
          const count = s === 'all'
            ? proposals.length
            : proposals.filter((p) => p.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors ${
                filter === s
                  ? 'bg-primary text-primary-contrast'
                  : 'bg-surface-hover text-text-muted hover:text-text-body'
              }`}
            >
              {s === 'all' ? 'すべて' : TEST_PREP_STATUS_LABELS[s]}
              <span className="ml-1 tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {/* 一覧 */}
      {filtered.length === 0 ? (
        <div className="bg-surface-raised rounded-xl border border-border p-12 text-center">
          <p className="text-text-muted">
            {proposals.length === 0
              ? 'テスト対策提案書はまだありません'
              : '該当する提案書はありません'}
          </p>
        </div>
      ) : (
        <div className="bg-surface-raised rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-hover text-text-muted text-xs">
                <th className="text-left px-4 py-2.5 font-medium">生徒</th>
                <th className="text-left px-4 py-2.5 font-medium">タイトル</th>
                <th className="text-left px-4 py-2.5 font-medium">試験</th>
                <th className="text-center px-4 py-2.5 font-medium">ステータス</th>
                <th className="text-right px-4 py-2.5 font-medium">更新日</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/students/${p.student_id}/test-prep/${p.id}`)}
                  className="border-t border-border hover:bg-surface-hover cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    {p.student ? (
                      <div>
                        <span className="font-medium text-text-heading">
                          {p.student.last_name} {p.student.first_name}
                        </span>
                        <span className="text-xs text-text-muted ml-2">
                          {gradeName(p.student.grade)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-text-muted">---</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-body">
                    {p.title || '無題の提案書'}
                  </td>
                  <td className="px-4 py-3 text-text-muted text-xs">
                    {p.exam_type?.name || '---'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[p.status]}`}>
                      {TEST_PREP_STATUS_LABELS[p.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-text-muted">
                    {new Date(p.updated_at).toLocaleDateString('ja-JP')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
