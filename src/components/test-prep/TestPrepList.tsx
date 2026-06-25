'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getTestPrepProposalsByStudent } from '@/lib/api/test-prep-proposals';
import type { TestPrepProposal, TestPrepStatus } from '@/types/test-prep';
import { TEST_PREP_STATUS_LABELS } from '@/types/test-prep';
import { Spinner } from '@/components/ui';

const STATUS_STYLES: Record<TestPrepStatus, string> = {
  draft: 'bg-surface-hover text-text-muted',
  sent: 'bg-warning-subtle text-yellow-700',
  published: 'bg-success-subtle text-green-700',
};

export default function TestPrepList() {
  const params = useParams();
  const router = useRouter();
  const studentId = params?.studentId as string;

  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<TestPrepProposal[]>([]);

  const loadData = useCallback(async () => {
    try {
      const data = await getTestPrepProposalsByStudent(studentId);
      setProposals(data);
    } catch {
      // handled by loading state
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/students')}
            className="text-sm text-text-muted hover:text-text-body"
          >
            ← 生徒一覧
          </button>
          <h2 className="text-lg font-bold text-text-heading">テスト対策提案書</h2>
        </div>
        <button
          onClick={() => router.push(`/students/${studentId}/test-prep/new`)}
          className="px-4 py-2 text-sm bg-primary text-primary-contrast font-medium rounded-lg hover:bg-primary-dark transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
        >
          + 新規作成
        </button>
      </div>

      {proposals.length === 0 ? (
        // 空状態に軽いフェードイン
        <div
          className="bg-surface-raised rounded-xl border border-border p-12 text-center stagger-item"
          style={{ '--stagger-index': 0 } as React.CSSProperties}
        >
          <p className="text-text-muted mb-4">テスト対策提案書はまだありません</p>
          <button
            onClick={() => router.push(`/students/${studentId}/test-prep/new`)}
            className="px-4 py-2 text-sm bg-primary text-primary-contrast rounded-lg hover:bg-primary-dark transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
          >
            提案書を作成
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((p, i) => (
            <button
              key={p.id}
              onClick={() => router.push(`/students/${studentId}/test-prep/${p.id}`)}
              // stagger-item: 初回表示のカードに40ms刻みのフェードイン（最大8件でクランプ）
              className="stagger-item w-full text-left bg-surface-raised rounded-xl border border-border p-4 hover:bg-surface-hover active:scale-[0.99] transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
              style={{ '--stagger-index': Math.min(i, 7) } as React.CSSProperties}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-text-heading">{p.title || '無題の提案書'}</h3>
                  <p className="text-xs text-text-muted mt-1">
                    {new Date(p.updated_at).toLocaleDateString('ja-JP')} 更新
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[p.status]}`}
                >
                  {TEST_PREP_STATUS_LABELS[p.status]}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
