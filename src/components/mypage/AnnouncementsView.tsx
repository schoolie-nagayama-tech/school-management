'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { PortalAnnouncement } from '@/lib/mypage/announcements';
import { BulletinContent } from '@/components/bulletin/BulletinContent';

/**
 * 保護者お知らせ一覧（クライアント）。
 * サーバーで RLS 越しに取得した投稿を表示し、タップで既読化する。
 * 未読は左に色帯、本文の予約リンク（link_url）を表示する。
 */
export function AnnouncementsView({ initial }: { initial: PortalAnnouncement[] }) {
  const [items, setItems] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = async (a: PortalAnnouncement) => {
    const willOpen = openId !== a.id;
    setOpenId(willOpen ? a.id : null);
    // 開いたら既読化（未読だったものだけ叩く）。
    if (willOpen && !a.is_read) {
      setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_read: true } : x)));
      try {
        await fetch('/api/mypage/announcements/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_id: a.id }),
        });
      } catch {
        /* 既読記録の失敗は致命的でないので無視 */
      }
    }
  };

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-raised p-4 text-sm text-text-muted">
        お知らせはまだありません。
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((a) => {
        const open = openId === a.id;
        return (
          <li
            key={a.id}
            className={`overflow-hidden rounded-xl border bg-surface-raised ${
              a.is_read ? 'border-border' : 'border-l-4 border-l-info border-border'
            }`}
          >
            <button
              type="button"
              onClick={() => toggle(a)}
              className="flex w-full items-center justify-between gap-2 p-4 text-left"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-text-heading">
                  {!a.is_read && <span className="inline-block h-2 w-2 rounded-full bg-info" />}
                  <span className="truncate">{a.title}</span>
                </p>
                <p className="text-xs text-text-muted">
                  {new Date(a.created_at).toLocaleDateString('ja-JP')}
                </p>
              </div>
            </button>
            {open && (
              <div className="border-t border-border px-4 pb-4 pt-3">
                {/*
                  ★ 保存型XSS対策（2026-08-08）: 以前はここで a.content を素の
                  dangerouslySetInnerHTML に流していた。お知らせ本文は生HTMLで保存され
                  書き込み時のサニタイズが無いため、スタッフが仕込んだスクリプトが
                  全保護者の画面で実行され得た。掲示板本体と同じ BulletinContent に
                  委ねる（描画時に DOMPurify を通す・SSRでは平文にフォールバック）。
                */}
                <BulletinContent
                  content={a.content}
                  className="prose prose-sm max-w-none text-sm text-text-body"
                />
                {a.link_url && (
                  <a
                    href={a.link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-sm text-info hover:underline"
                  >
                    <ExternalLink className="h-4 w-4" />
                    予約・詳細を開く
                  </a>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
