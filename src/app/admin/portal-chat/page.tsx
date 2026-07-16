'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ChevronLeft, Send, MessageSquare } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Button, Loading, Textarea, ToastContainer } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { useToast } from '@/hooks/useToast';
import { fetchWithAuth } from '@/lib/api/auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';
import type { ChatMessage } from '@/types/chat';

/**
 * 室長の受信箱（保護者チャット）。requireManager 相当（manager 以上）。
 *
 * ナビ（navConfig）には載せない = URL直行でのみ到達（docs/portal-v2-requirements.md §7-2）。
 * 生徒ごとスレッド一覧＋会話ビュー＋返信。未読印つき。閲覧/送信はすべて
 * service role 経由の管理APIで行う（chat_* はポータル以外に SELECT ポリシー無し）。
 */

interface ThreadRow {
  thread_id: string;
  school_id: string;
  student_id: string;
  student_name: string;
  grade: number | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
}

export default function PortalChatInboxPage() {
  const { profile, isLoading: authLoading } = useAuth();
  const { localSchoolId, availableSchools, setLocalSchoolId } = useLocalSchoolId();
  const { toasts, removeToast, success, error: toastError } = useToast();

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ThreadRow | null>(null);

  const isManager = isManagerOrAbove(profile?.role);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const qs = localSchoolId && localSchoolId !== 'all' ? `?school_id=${localSchoolId}` : '';
      // 素の fetch では 401 になる（この API は requireManager/requireAdmin を通るため）。
      // cookie だけに頼らず Authorization ヘッダーを付ける fetchWithAuth を使う
      // ＝このプロジェクトの管理API呼び出しの作法。
      const res = await fetchWithAuth(`/api/admin/portal-chat/threads${qs}`);
      const json = await res.json();
      setThreads(res.ok ? (json.threads ?? []) : []);
    } catch {
      toastError('スレッドの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [localSchoolId, toastError]);

  useEffect(() => {
    if (isManager) loadThreads();
  }, [isManager, loadThreads]);

  if (authLoading) {
    return (
      <AdminLayout>
        <Loading />
      </AdminLayout>
    );
  }
  if (!isManager) {
    return (
      <AdminLayout>
        <AccessDenied message="このページは教室長以上のみアクセス可能です" />
      </AdminLayout>
    );
  }

  return (
    <div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle="保護者チャット（受信箱）">
        <div className="mb-4">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-heading"
          >
            <ChevronLeft className="h-4 w-4" />
            設定に戻る
          </Link>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-text-heading">教室</label>
          <select
            value={localSchoolId}
            onChange={(e) => {
              setLocalSchoolId(e.target.value);
              setSelected(null);
            }}
            className="w-full max-w-xs rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-body"
          >
            <option value="all">すべての教室</option>
            {availableSchools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
          {/* スレッド一覧 */}
          <div className="rounded-xl border border-border bg-surface-raised">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold text-text-heading">
              スレッド
            </div>
            {loading ? (
              <div className="p-4">
                <Loading size="md" />
              </div>
            ) : threads.length === 0 ? (
              <p className="p-4 text-sm text-text-muted">スレッドはありません。</p>
            ) : (
              <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
                {threads.map((t) => (
                  <li key={t.thread_id}>
                    <button
                      type="button"
                      onClick={() => setSelected(t)}
                      className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-hover ${
                        selected?.thread_id === t.thread_id ? 'bg-surface-hover' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text-heading">
                          {t.student_name}
                          {t.grade != null && (
                            <span className="ml-1 text-xs text-text-muted">
                              {formatGradeLabel(t.grade)}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-text-muted">
                          {t.last_message_preview ?? 'メッセージなし'}
                        </p>
                      </div>
                      {t.unread_count > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-medium text-white">
                          {t.unread_count}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 会話ビュー */}
          <div className="rounded-xl border border-border bg-surface-raised">
            {selected ? (
              <StaffConversation
                key={selected.thread_id}
                thread={selected}
                onReplied={() => {
                  success('返信しました');
                  loadThreads();
                }}
                onError={toastError}
              />
            ) : (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 p-6 text-text-muted">
                <MessageSquare className="h-8 w-8" />
                <p className="text-sm">左のスレッドを選択してください。</p>
              </div>
            )}
          </div>
        </div>
      </AdminLayout>
    </div>
  );
}

/** スタッフの会話ビュー＋返信。 */
function StaffConversation({
  thread,
  onReplied,
  onError,
}: {
  thread: ThreadRow;
  onReplied: () => void;
  onError: (m: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(
        `/api/admin/portal-chat/messages?thread_id=${encodeURIComponent(thread.thread_id)}`
      );
      const json = await res.json();
      setMessages(res.ok ? (json.messages ?? []) : []);
    } finally {
      setLoading(false);
    }
  }, [thread.thread_id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messages]);

  const reply = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const res = await fetchWithAuth('/api/admin/portal-chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: thread.thread_id, body: text.trim() }),
      });
      if (res.ok) {
        setText('');
        await load();
        onReplied();
      } else {
        const j = await res.json();
        onError(j.error ?? '返信に失敗しました');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ minHeight: '60vh' }}>
      <div className="border-b border-border px-4 py-3 text-sm font-semibold text-text-heading">
        {thread.student_name} さん
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? (
          <Loading size="md" />
        ) : (
          messages.map((m) => <StaffBubble key={m.id} message={m} />)
        )}
        <div ref={bottomRef} />
      </div>
      <div className="flex items-end gap-2 border-t border-border p-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="返信を入力"
          rows={2}
          className="flex-1"
        />
        <Button onClick={reply} isLoading={sending} disabled={!text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** スタッフ側の吹き出し（staff=右 / portal=左 / system=中央）。 */
function StaffBubble({ message }: { message: ChatMessage }) {
  const time = new Date(message.created_at).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (message.sender_kind === 'system') {
    return (
      <div className="flex justify-center">
        <div className="max-w-[90%] whitespace-pre-wrap rounded-lg border border-info/40 bg-info/5 px-3 py-2 text-center text-xs text-text-body">
          {message.body}
        </div>
      </div>
    );
  }
  const isStaff = message.sender_kind === 'staff';
  return (
    <div className={`flex ${isStaff ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[85%]">
        <div
          className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
            isStaff
              ? 'rounded-br-sm bg-ink text-white'
              : 'rounded-bl-sm border border-border bg-surface text-text-body'
          }`}
        >
          {message.body}
        </div>
        <p className={`mt-0.5 text-[10px] text-text-muted ${isStaff ? 'text-right' : 'text-left'}`}>
          {isStaff ? '教室' : '保護者'}・{time}
        </p>
      </div>
    </div>
  );
}
