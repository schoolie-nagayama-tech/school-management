'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, Loading, ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { useRequirePermission } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import {
  ChevronLeft,
  Plus,
  Trash2,
  GripVertical,
  ExternalLink,
  Save,
  ArrowUp,
  ArrowDown,
  Link as LinkIcon,
} from 'lucide-react';
import { getQuickLinks, saveQuickLinks, type QuickLink } from '@/lib/api/quick-links';

/** クライアント側で行を一意に識別するための簡易ID生成 */
function makeLocalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Math.random().toString(36).slice(2, 10)}`;
}

export default function QuickLinksSettingsPage() {
  // 教室長以上のみアクセス可
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessSettings
  );
  const { profile } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const canManage =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  const [links, setLinks] = useState<QuickLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // 認証ロード完了後に初期取得する（セッション未確定だとトークン無しになり 401 → 空が返る）
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    void (async () => {
      const data = await getQuickLinks();
      if (!cancelled) {
        setLinks(data);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  // 行を追加
  const handleAdd = useCallback(() => {
    setLinks((prev) => [...prev, { id: makeLocalId(), label: '', url: '' }]);
    setDirty(true);
  }, []);

  // 行を更新
  const handleChange = useCallback((id: string, patch: Partial<QuickLink>) => {
    setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    setDirty(true);
  }, []);

  // 行を削除（確認ダイアログ付き）
  const handleRemove = useCallback(
    async (link: QuickLink) => {
      const ok = await confirm({
        title: 'リンクの削除',
        description: `「${link.label || '(無題)'}」を削除しますか？`,
        confirmLabel: '削除',
        variant: 'danger',
      });
      if (!ok) return;
      setLinks((prev) => prev.filter((l) => l.id !== link.id));
      setDirty(true);
    },
    [confirm]
  );

  // 並び替え（上下移動）
  const handleMove = useCallback((index: number, dir: -1 | 1) => {
    setLinks((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  }, []);

  // 保存（バリデーションはサーバ側でも行うが、UX のためにクライアントでも軽く実施）
  const handleSave = useCallback(async () => {
    // 空行をはじく
    const trimmed = links
      .map((l) => ({ ...l, label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.label || l.url);

    for (const l of trimmed) {
      if (!l.label) {
        toastError('ラベル未入力の行があります');
        return;
      }
      if (!l.url) {
        toastError('URL 未入力の行があります');
        return;
      }
      if (!/^https?:\/\//i.test(l.url)) {
        toastError(`URL は http(s):// で始めてください: ${l.label}`);
        return;
      }
    }

    setIsSaving(true);
    try {
      const saved = await saveQuickLinks(trimmed);
      setLinks(saved);
      setDirty(false);
      success('クイックリンクを保存しました');
    } catch (e) {
      toastError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  }, [links, success, toastError]);

  if (permissionLoading) {
    return (
      <AdminLayout headerTitle="クイックリンク設定">
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!hasPermission || !canManage) {
    return (
      <AdminLayout headerTitle="クイックリンク設定">
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="クイックリンク設定">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div>
        {/* パンくず */}
        <div className="mb-4">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-ink"
          >
            <ChevronLeft className="w-4 h-4" />
            設定一覧へ戻る
          </Link>
        </div>

        {/* 説明 */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-text-heading mb-2 flex items-center gap-2">
            <LinkIcon className="w-5 h-5" />
            クイックリンク
          </h1>
          <p className="text-sm text-text-muted">
            生徒管理ページの上部に表示する、外部ツール（Grow・らくプリ・進行表など）へのリンクを管理します。
            ここで設定した内容は<strong>全教室共通</strong>で、講師を含む全スタッフが利用できます。
          </p>
        </div>

        {/* リスト */}
        {isLoading ? (
          <Loading />
        ) : (
          <div className="space-y-2">
            {links.length === 0 && (
              <div className="text-center py-10 px-4 border border-dashed border-border rounded-xl bg-surface text-sm text-text-muted">
                まだリンクがありません。「リンクを追加」から登録してください。
              </div>
            )}

            {links.map((link, index) => (
              <div
                key={link.id}
                className="flex items-start gap-2 p-3 bg-surface-raised border border-border rounded-lg"
              >
                {/* 並び替えハンドル（視覚目印） */}
                <div className="flex flex-col items-center pt-2 text-text-faint">
                  <GripVertical className="w-4 h-4" />
                </div>

                <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-2">
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">
                      ラベル
                    </label>
                    <input
                      type="text"
                      value={link.label}
                      onChange={(e) => handleChange(link.id, { label: e.target.value })}
                      placeholder="例: Grow"
                      maxLength={40}
                      className="w-full px-3 py-2 border border-border-strong rounded-lg text-sm bg-surface-raised text-text-heading focus:ring-2 focus:ring-ink/30 focus:border-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">URL</label>
                    <div className="flex gap-1">
                      <input
                        type="url"
                        value={link.url}
                        onChange={(e) => handleChange(link.id, { url: e.target.value })}
                        placeholder="https://..."
                        className="flex-1 px-3 py-2 border border-border-strong rounded-lg text-sm bg-surface-raised text-text-heading focus:ring-2 focus:ring-ink/30 focus:border-ink"
                      />
                      {/^https?:\/\//i.test(link.url) && (
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-9 h-9 text-text-muted hover:text-ink border border-border rounded-lg hover:bg-surface-hover"
                          title="新しいタブで開く"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* 並び替え・削除 */}
                <div className="flex flex-col gap-1 pt-5">
                  <button
                    onClick={() => handleMove(index, -1)}
                    disabled={index === 0}
                    className="w-7 h-7 inline-flex items-center justify-center rounded text-text-muted hover:text-ink hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
                    title="上へ"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleMove(index, 1)}
                    disabled={index === links.length - 1}
                    className="w-7 h-7 inline-flex items-center justify-center rounded text-text-muted hover:text-ink hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed"
                    title="下へ"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button
                  onClick={() => handleRemove(link)}
                  className="mt-5 w-8 h-8 inline-flex items-center justify-center rounded text-danger hover:bg-danger/10"
                  title="削除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* アクション */}
        <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <Button variant="outline" onClick={handleAdd} disabled={isSaving}>
            <Plus className="w-4 h-4 mr-1.5" />
            リンクを追加
          </Button>
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="text-xs text-text-muted">未保存の変更があります</span>
            )}
            <Button onClick={handleSave} isLoading={isSaving} disabled={!dirty || isSaving}>
              <Save className="w-4 h-4 mr-1.5" />
              保存
            </Button>
          </div>
        </div>

        {/* プレビュー */}
        {links.some((l) => l.label.trim() && /^https?:\/\//i.test(l.url.trim())) && (
          <div className="mt-8">
            <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
              プレビュー
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5 rounded-xl border border-border bg-surface-raised">
              {links
                .filter((l) => l.label.trim() && /^https?:\/\//i.test(l.url.trim()))
                .map((link) => (
                  <span
                    key={link.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[#fff5f5] text-[#b91c1c] border border-[#fecaca]"
                  >
                    {link.label}
                    <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                  </span>
                ))}
            </div>
          </div>
        )}
      </div>

      {ConfirmDialog}
    </AdminLayout>
  );
}
