'use client';

import { useEffect, useRef, useState } from 'react';
import { Megaphone, Check, ExternalLink, LogOut, Pin } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useBulletinUnread } from '@/contexts/BulletinUnreadContext';
import { Button } from '@/components/ui';
import { isHtmlContent, sanitizeBulletinHtml } from '@/lib/utils/bulletinHtml';

/**
 * 未読の連絡がある講師に対して、全画面で掲示板を表示し既読を強制するゲート。
 *
 * 背景: 講師が連絡事項を読まずに業務を進めてしまうため、未読があるうちは
 * 掲示板をブロッキング表示し、すべて「見ました」を押すまで他の操作をさせない。
 *
 * 仕様:
 *   - 対象は講師のみ（未読状態は BulletinUnreadContext が講師限定で管理）。
 *   - 未読が 0 件になると自動的に閉じる。
 *   - ESC・背景クリックでは閉じない。一括既読ボタンも置かない
 *     （読まずに閉じる抜け道を作らないため）。
 *   - 閉じ込め防止として「ログアウト」だけは許可する。
 */
export function UnreadBulletinGate() {
  const { profile, schoolIds, signOut } = useAuth();
  const { schools } = useMasterData();
  const { unreadPosts, markPostRead } = useBulletinUnread();
  const [busyId, setBusyId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const open = profile?.role === 'teacher' && unreadPosts.length > 0;

  // ゲート表示中は背面ページのスクロールを止め、ダイアログへフォーカスを移す
  // （キーボード操作の起点をゲート内にする）。入場アニメーション自体は
  // 下の .modal-overlay / .modal-panel（@starting-style、globals.css）に任せる。
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  // 複数教室を担当している講師のみ、どの教室の連絡かを表示する
  const showSchoolName = schoolIds.length > 1;
  const schoolName = (id: string): string | null => {
    const s = schools.find((school) => school.id === id);
    if (!s) return null;
    return s.code === 'DEFAULT' ? 'デフォルト' : s.name;
  };

  const handleRead = async (postId: string) => {
    if (busyId) return;
    setBusyId(postId);
    try {
      await markPostRead(postId);
    } catch {
      toast.error('既読の記録に失敗しました。通信状況を確認して再度お試しください。');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="未読の連絡"
      className="modal-overlay fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-6"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="modal-panel my-6 w-full max-w-2xl rounded-xl bg-white shadow-2xl outline-none"
      >
        {/* ヘッダー: 威圧感を避けるため白地＋濃色テキスト。アイコンのみブランドカラーで軽く強調 */}
        <div className="flex items-start gap-3 rounded-t-xl border-b border-gray-100 bg-white px-6 py-5">
          <Megaphone className="mt-1 h-8 w-8 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-2xl font-bold leading-tight text-text-heading">
              未読の連絡が{unreadPosts.length}件あります
            </h2>
            <p className="mt-2 text-base text-text-muted">
              内容を確認し、各連絡の「見ました」を押してください。すべて確認すると通常画面に戻ります。
            </p>
          </div>
        </div>

        {/* 未読投稿一覧 */}
        <div className="max-h-[65vh] space-y-3 overflow-y-auto px-5 py-4">
          {unreadPosts.map((post, index) => {
            const createdDate = new Date(post.created_at).toLocaleDateString('ja-JP', {
              month: 'numeric',
              day: 'numeric',
            });
            const creatorName = post.creator?.display_name || post.creator?.email || '不明';
            return (
              <div
                key={post.id}
                // 複数件が同時に現れる場面なので stagger-item で40ms刻みにフェードイン
                // （8件超は頭打ちになるようクランプ。globals.css の確立済みパターン）
                className="stagger-item rounded-lg border border-gray-300 bg-white p-4 shadow-sm"
                style={{ '--stagger-index': Math.min(index, 7) } as React.CSSProperties}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {post.is_pinned && <Pin className="h-4 w-4 shrink-0 text-[#d32f2f]" />}
                    {post.label && (
                      <span
                        className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: post.label.color }}
                      >
                        {post.label.name}
                      </span>
                    )}
                    <span className="truncate font-semibold text-[#1a1a1a]">{post.title}</span>
                  </div>
                  {showSchoolName && schoolName(post.school_id) && (
                    <span className="ml-2 shrink-0 text-xs text-gray-400">
                      {schoolName(post.school_id)}
                    </span>
                  )}
                </div>

                {post.content && (
                  <div
                    className="bulletin-post-content mb-3 break-words text-sm text-[var(--text)]"
                    {...(isHtmlContent(post.content)
                      ? { dangerouslySetInnerHTML: { __html: sanitizeBulletinHtml(post.content) } }
                      : { style: { whiteSpace: 'pre-wrap' }, children: post.content })}
                  />
                )}

                {post.link_url && (
                  <a
                    href={post.link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 transition-colors duration-150 hover:bg-blue-100"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate group-hover:underline">{post.link_url}</span>
                  </a>
                )}

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">
                    {createdDate} {creatorName}
                  </span>
                  <Button
                    onClick={() => handleRead(post.id)}
                    variant="primary"
                    size="sm"
                    disabled={busyId === post.id}
                    className="shrink-0"
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    {busyId === post.id ? '記録中...' : '見ました'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* フッター: 閉じ込め防止のログアウトのみ（既読の抜け道は置かない） */}
        <div className="flex items-center justify-end rounded-b-xl border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={signOut}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
          >
            <LogOut className="h-3.5 w-3.5" />
            ログアウト
          </button>
        </div>
      </div>
    </div>
  );
}
