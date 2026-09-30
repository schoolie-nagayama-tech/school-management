'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { InlineLoading } from '@/components/ui';
import { getStudentParentMessages } from '@/lib/api/portalChat';
import type { StudentChatDigest } from '@/lib/mypage/chatDigest';

interface ParentMessagesCardProps {
  studentId: string;
  /** 出す件数（新しい順）。既定5 */
  limit?: number;
}

/** 受信箱（スタッフ側の連絡画面）。student_id を渡すとその生徒のスレッドを開いた状態で始まる */
function inboxHref(studentId: string): string {
  return `/admin/portal-chat?student_id=${encodeURIComponent(studentId)}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 保護者との連絡（生徒1人分の直近のメッセージ）。見出しと「2月から」タグは置く側が持つ。
 *
 * スレッドは生徒ごとに1本なので、行は「その1本の直近のメッセージ」（新しい順）。
 * 返信待ち（保護者のメッセージのあとにスタッフの返信が無い）は対応が要るので黄で出す。
 * ★自動返信（system）は返信に数えない（定義は src/lib/mypage/chatDigest.ts）。
 * ★ここで見ても既読にはしない（受信箱の未読印を残すため）。返信は各行から受信箱で行う。
 * ★読み込み失敗を空扱いにしない。「連絡はまだありません」と言い切ると返信漏れを隠す。
 */
export function ParentMessagesCard({ studentId, limit = 5 }: ParentMessagesCardProps) {
  const [digest, setDigest] = useState<StudentChatDigest | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDigest(null);
    setFailed(false);
    getStudentParentMessages(studentId, limit)
      .then((d) => {
        if (!cancelled) setDigest(d);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Error fetching parent messages for hub:', err);
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, limit, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  if (failed) {
    return (
      <p className="m-0 text-[13px] text-danger">
        連絡を読み込めませんでした
        <button type="button" onClick={retry} className="ml-2 text-primary hover:underline">
          再読み込み
        </button>
      </p>
    );
  }
  if (!digest) return <InlineLoading label="読み込み中…" />;
  if (digest.items.length === 0) {
    return <p className="m-0 text-[13px] text-text-muted">連絡はまだありません</p>;
  }

  const href = inboxHref(studentId);
  return (
    <ul className="m-0 list-none p-0">
      {digest.items.map((m) => (
        <li key={m.id} className="border-b border-border-subtle last:border-0">
          <Link
            href={href}
            className={`-mx-1.5 flex items-baseline gap-2 rounded px-1.5 py-1.5 text-[13px] transition-colors hover:bg-surface-hover ${
              m.awaiting_reply ? 'bg-warning-subtle' : ''
            }`}
          >
            <span className="shrink-0 font-mono text-[11px] text-text-faint">
              {formatDate(m.created_at)}
            </span>
            <span className="min-w-[5.5em] shrink-0 whitespace-nowrap text-[11px] text-text-muted">
              {m.direction === 'from_parent' ? '保護者→塾' : '塾→保護者'}
              {m.is_auto && '（自動）'}
            </span>
            <span className="min-w-0 flex-1 truncate text-text-body">
              {m.preview || '（本文なし）'}
            </span>
            {m.awaiting_reply && (
              <span className="shrink-0 whitespace-nowrap rounded-full border border-warning px-1.5 text-[11px] leading-[1.6] text-warning">
                返信待ち
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
