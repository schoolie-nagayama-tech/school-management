'use client';

import { useEffect, useState } from 'react';
import { InlineLoading } from '@/components/ui';
import { getStudentInterviews } from '@/lib/api/interviews';
import type { StudentInterview } from '@/types/database';
import { HubSection } from './HubSection';

interface AttentionSectionProps {
  studentId: string;
}

/**
 * 気にすること（左カラム）。第1段は「未完了の約束」だけ。
 *
 * 約束は面談記録に interview_type='task' として保存されている（期日の列は無い。日付は登録日）。
 * ★完了の操作はここに置かず、下の面談欄（InterviewList）に任せる。完了操作を2か所に持つと、
 *   片方で完了しても片方が古いまま残る。
 * 第2段で足すもの: 注意すること（アラートを生徒1人で引く集計が要る）。
 * 保護者との連絡は、生徒単位で連絡スレッドを引く関数がまだ無いので出していない。
 */
export function AttentionSection({ studentId }: AttentionSectionProps) {
  const [tasks, setTasks] = useState<StudentInterview[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStudentInterviews(studentId)
      .then((rows) => {
        if (cancelled) return;
        setTasks(rows.filter((r) => r.interview_type === 'task' && !r.is_completed));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  return (
    <HubSection id="sec-attention" title="気にすること">
      <h3 className="mb-2 text-sm font-bold text-text-heading">未完了の約束</h3>
      {failed ? (
        <p className="text-[13px] text-danger">約束の取得に失敗しました</p>
      ) : tasks === null ? (
        <InlineLoading label="読み込み中…" />
      ) : tasks.length === 0 ? (
        <p className="text-[13px] text-text-muted">未完了の約束はありません</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {tasks.map((t) => (
            <li
              key={t.id}
              className="flex items-baseline gap-2 border-b border-border-subtle py-1.5 text-[13px] last:border-0"
            >
              <span className="min-w-0 flex-1 text-text-body [overflow-wrap:anywhere]">
                {t.title || t.content}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-text-faint">
                {t.interview_date}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mb-0 mt-2 text-xs text-text-muted">
        約束の追加・完了は下の
        <a href="#sec-interview" className="mx-0.5 text-primary hover:underline">
          面談
        </a>
        欄から行います。
      </p>
    </HubSection>
  );
}
