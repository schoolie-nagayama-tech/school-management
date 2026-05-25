'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Settings, Link as LinkIcon } from 'lucide-react';
import { getQuickLinks, type QuickLink } from '@/lib/api/quick-links';
import { useAuth } from '@/contexts/AuthContext';

interface QuickLinksBarProps {
  className?: string;
}

/**
 * 生徒管理ページ上部に表示する外部ツール用ショートカット。
 * 設定が空の場合は教室長以上にだけ「設定」リンクを薄く表示する。
 * 講師にとっては「リンクが何もなければ何も出ない」状態にする。
 */
export function QuickLinksBar({ className = '' }: QuickLinksBarProps) {
  const { profile, isLoading: authLoading } = useAuth();
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [loaded, setLoaded] = useState(false);

  // 教室長以上だけ「設定へ」ボタンを表示する
  const canManage =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  // 認証ロードが終わってからフェッチする（セッション未取得の状態で叩くと
  // Authorization ヘッダーが付かず、API 側で 401 → 空配列が確定してしまうため）。
  // profile?.id を依存に入れることで、ログイン直後にも自動で再取得される。
  useEffect(() => {
    if (authLoading || !profile?.id) return;
    let cancelled = false;
    void (async () => {
      const data = await getQuickLinks();
      if (!cancelled) {
        setLinks(data);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, profile?.id]);

  // 初回ロード前は描画しない（CLS抑制）
  if (!loaded) return null;

  // リンクが0件の場合、講師には何も見せず、教室長以上には「設定する」案内のみ表示
  if (links.length === 0) {
    if (!canManage) return null;
    return (
      <div
        className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border border-dashed border-border bg-surface ${className}`}
      >
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <LinkIcon className="w-4 h-4" />
          <span>クイックリンク（Grow・らくプリ等の外部ツール）は未設定です</span>
        </div>
        <Link
          href="/settings/quick-links"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-text-body hover:text-ink"
        >
          <Settings className="w-3.5 h-3.5" />
          設定
        </Link>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-surface-raised ${className}`}
    >
      <div className="flex flex-wrap items-center gap-1.5 flex-1">
        {links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[#fff5f5] text-[#b91c1c] border border-[#fecaca] hover:bg-[#fee2e2] hover:border-[#fca5a5] transition-colors duration-150"
            title={link.url}
          >
            <span className="truncate max-w-[200px]">{link.label}</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-60" />
          </a>
        ))}
      </div>
      {canManage && (
        <Link
          href="/settings/quick-links"
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-ink px-1.5"
          title="クイックリンクを編集"
        >
          <Settings className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">編集</span>
        </Link>
      )}
    </div>
  );
}
