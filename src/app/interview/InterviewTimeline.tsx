'use client';

/**
 * 面談ワークスペース 左カラム: 過去の面談記録
 * ------------------------------------------------------------------
 * 「前回の申し送り」ピン留めカード・「未完了の約束・タスク」・「面談タイムライン」の3つ。
 * タスクの完了/未完了は楽観更新し、失敗時はロールバックする。
 * タイムラインの編集は既存の InterviewModal をそのまま再利用する。
 */

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, InlineLoading } from '@/components/ui';
import { InterviewModal } from '@/components/students/InterviewModal';
import { completeTask, uncompleteTask } from '@/lib/api/interviews';
import { useToast } from '@/hooks/useToast';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import {
  INTERVIEW_TYPE_COLORS,
  INTERVIEW_TYPE_LABELS,
  type StudentInterview,
} from '@/types/database';
import { fmtDateJa } from './interview.shared';
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  History,
  Pin,
} from 'lucide-react';

export interface HandoverInfo {
  date: string;
  text: string;
  isFallback: boolean;
}

interface InterviewTimelineProps {
  studentId: string;
  schoolId: string;
  interviews: StudentInterview[];
  loading: boolean;
  handover: HandoverInfo | null;
  /** タスク完了操作・面談編集の保存後に呼ぶ。親側で面談記録を再取得する。 */
  onChanged: () => void;
}

export function InterviewTimeline({
  studentId,
  schoolId,
  interviews,
  loading,
  handover,
  onChanged,
}: InterviewTimelineProps) {
  const { error: toastError } = useToast();

  // タイムラインの全文展開トグル
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // タスク完了の楽観更新オーバーレイ（API確定後は親の再取得で自然に一覧から消える）
  const [taskOverrides, setTaskOverrides] = useState<Record<string, boolean>>({});

  // 編集モーダル
  const [editingInterview, setEditingInterview] = useState<StudentInterview | null>(null);

  const tasks = interviews.filter((i) => i.interview_type === 'task' && !i.is_completed);
  const timeline = interviews.filter((i) => i.interview_type !== 'task');

  const handleToggleTask = async (task: StudentInterview) => {
    const next = !(taskOverrides[task.id] ?? false);
    setTaskOverrides((prev) => ({ ...prev, [task.id]: next }));
    try {
      if (next) {
        await completeTask(task.id);
      } else {
        await uncompleteTask(task.id);
      }
      onChanged();
    } catch (e) {
      // 失敗時はロールバック
      setTaskOverrides((prev) => ({ ...prev, [task.id]: !next }));
      toastError(getUserErrorMessage(e, 'タスクの更新に失敗しました'));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 前回の申し送り（ピン留め） */}
      <Card className="border-l-4 border-l-warning">
        <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
          <Pin className="h-4 w-4 text-warning" />
          <CardTitle className="text-sm">前回の申し送り</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {loading ? (
            <InlineLoading />
          ) : handover ? (
            <>
              <p className="mb-1 text-xs text-text-faint">{fmtDateJa(handover.date)}</p>
              <p className="whitespace-pre-wrap text-sm text-text-body">{handover.text}</p>
            </>
          ) : (
            <p className="text-sm text-text-muted">面談記録はまだありません</p>
          )}
        </CardContent>
      </Card>

      {/* 未完了の約束・タスク */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
          <CheckCircle2 className="h-4 w-4 text-text-muted" />
          <CardTitle className="text-sm">未完了の約束・タスク</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {loading ? (
            <InlineLoading />
          ) : tasks.length === 0 ? (
            <p className="text-sm text-text-muted">未完了のタスクはありません</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {tasks.map((t) => {
                const done = taskOverrides[t.id] ?? false;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => handleToggleTask(t)}
                      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-surface-hover"
                    >
                      {done ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <Circle className="h-4 w-4 shrink-0 text-text-faint" />
                      )}
                      <span
                        className={`text-sm ${done ? 'text-text-faint line-through' : 'text-text-body'}`}
                      >
                        {t.content}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 面談タイムライン（新しい順・APIが既にソート済み） */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 border-b-0 pb-0">
          <History className="h-4 w-4 text-text-muted" />
          <CardTitle className="text-sm">面談タイムライン</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[600px] overflow-y-auto pt-2">
          {loading ? (
            <InlineLoading />
          ) : timeline.length === 0 ? (
            <p className="text-sm text-text-muted">面談記録はまだありません</p>
          ) : (
            <div className="flex flex-col gap-3">
              {timeline.map((iv) => {
                const expanded = expandedIds.has(iv.id);
                return (
                  <div
                    key={iv.id}
                    className="rounded-lg border border-border-subtle p-3 transition-colors hover:bg-surface-hover"
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-xs text-text-faint">
                        {fmtDateJa(iv.interview_date)}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${INTERVIEW_TYPE_COLORS[iv.interview_type]}`}
                      >
                        {INTERVIEW_TYPE_LABELS[iv.interview_type]}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingInterview(iv)}
                        className="ml-auto shrink-0 text-xs text-text-muted hover:text-primary"
                      >
                        編集
                      </button>
                    </div>
                    {iv.title && (
                      <p className="mb-1 text-sm font-semibold text-text-heading">{iv.title}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleExpanded(iv.id)}
                      className="w-full text-left"
                    >
                      <p
                        className={`text-xs leading-relaxed text-text-body ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-3'}`}
                      >
                        {iv.content}
                      </p>
                      <span className="mt-1 inline-flex items-center gap-0.5 text-xs text-text-muted">
                        {expanded ? (
                          <>
                            閉じる <ChevronUp className="h-3 w-3" />
                          </>
                        ) : (
                          <>
                            全文を見る <ChevronDown className="h-3 w-3" />
                          </>
                        )}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 面談記録の一覧全体（フィルタ・削除等）は既存ページに残す */}
      <Link
        href={`/students/${studentId}/interviews`}
        target="_blank"
        className="inline-flex items-center justify-center gap-1.5 text-xs text-text-muted hover:text-primary"
      >
        <ExternalLink className="h-3 w-3" />
        面談記録の全件一覧を開く
      </Link>

      {editingInterview && (
        <InterviewModal
          studentId={studentId}
          schoolId={schoolId}
          interview={editingInterview}
          onClose={() => setEditingInterview(null)}
          onSaved={() => {
            setEditingInterview(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
