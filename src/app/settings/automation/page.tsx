'use client';

/**
 * 自動入力ローダー発行ページ。
 * 教室長以上のみ。HP取込(connect)ページと同じトークン発行フローを、汎用ローダー版で行う。
 *
 * 1.「ローダーを発行」→ POST /api/automation/token でトークン取得
 * 2. buildLoaderBookmarklet でトークン入り javascript: URL を生成し、ドラッグ登録リンクを表示
 * 3. 以後、NEST各所の「流し込む」でジョブをキュー → 対象サイトでこのブックマークをクリックすると充填
 */

import { useState } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { supabase } from '@/lib/supabase';
import { buildLoaderBookmarklet } from '@/lib/automation/actions';
import { Bookmark, Copy, Check, RefreshCw, ArrowLeft } from 'lucide-react';

export default function AutomationLoaderPage() {
  const { profile } = useAuth();
  const isManager =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  const [bookmarklet, setBookmarklet] = useState<string | null>(null);
  const [isIssuing, setIsIssuing] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function issueToken() {
    setIsIssuing(true);
    setError('');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('ログインが必要です');
      const res = await fetch('/api/automation/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ label: '自動入力ローダー' }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? '発行に失敗しました');
      if (!data.token) throw new Error('トークンが返されませんでした');
      setBookmarklet(buildLoaderBookmarklet(window.location.origin, data.token));
    } catch (err) {
      setError(err instanceof Error ? err.message : '発行に失敗しました');
    } finally {
      setIsIssuing(false);
    }
  }

  async function revokeAndReissue() {
    setIsRevoking(true);
    setError('');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('ログインが必要です');
      const authHeader = { Authorization: `Bearer ${session.access_token}` };
      const delRes = await fetch('/api/automation/token', {
        method: 'DELETE',
        headers: authHeader,
      });
      if (!delRes.ok) {
        const d = (await delRes.json()) as { error?: string };
        throw new Error(d.error ?? '失効に失敗しました');
      }
      const postRes = await fetch('/api/automation/token', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: '自動入力ローダー（再発行）' }),
      });
      const postData = (await postRes.json()) as { token?: string; error?: string };
      if (!postRes.ok) throw new Error(postData.error ?? '再発行に失敗しました');
      if (!postData.token) throw new Error('トークンが返されませんでした');
      setBookmarklet(buildLoaderBookmarklet(window.location.origin, postData.token));
    } catch (err) {
      setError(err instanceof Error ? err.message : '再発行に失敗しました');
    } finally {
      setIsRevoking(false);
    }
  }

  async function copyBookmarklet() {
    if (!bookmarklet) return;
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        '自動コピーに失敗しました。下のリンクを右クリック→「リンクアドレスをコピー」してください。'
      );
    }
  }

  if (!isManager) {
    return (
      <AdminLayout>
        <AccessDenied message="この機能は教室長以上のみ利用できます" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="自動入力ローダー">
      <div className="max-w-3xl space-y-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-sm text-info hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          設定に戻る
        </Link>

        {/* 説明 */}
        <div className="bg-surface-raised border border-border rounded-xl p-5 space-y-2">
          <h2 className="text-base font-bold text-text-heading">これは何？</h2>
          <p className="text-sm text-text-body">
            外部サイト（日本教材出版の発注フォーム、スクールIEの講習会契約設定など）への自動入力を、
            ブックマークレット1つで行うための共通ローダーです。NEST各所の「流し込む」を押すとデータが用意され、
            対象サイトでこのブックマークをクリックすると自動で入力されます（登録・送信は手動）。
          </p>
          <p className="text-xs text-text-muted">
            ※ クリップボードのコピー&amp;貼り付けは不要です。これ1本で各機能に対応します。
          </p>
        </div>

        {/* 発行エリア */}
        <div className="bg-surface-raised border border-border rounded-xl p-5">
          <h2 className="text-base font-bold text-text-heading mb-3">ローダーを発行</h2>
          {error && (
            <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {!bookmarklet ? (
            <div className="space-y-3">
              <p className="text-sm text-text-body">
                下のボタンを押すとローダーのリンクを生成します。
              </p>
              <Button onClick={issueToken} disabled={isIssuing}>
                {isIssuing ? '発行中...' : 'ローダーを発行'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs font-medium text-blue-700 mb-2">
                  下のリンクをブックマークバーにドラッグして登録してください（初回のみ）
                </p>
                {/* javascript: URL のため通常クリックは無効化し、ドラッグ登録専用にする。 */}
                {/* eslint-disable-next-line react/jsx-no-target-blank */}
                <a
                  href={bookmarklet}
                  onClick={(e) => e.preventDefault()}
                  draggable
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg cursor-grab active:cursor-grabbing select-none hover:bg-blue-700 transition-colors duration-150"
                >
                  <Bookmark className="w-4 h-4" />
                  NESTから流し込む
                </a>
                <p className="text-xs text-blue-600 mt-2">
                  ※
                  このリンクはクリックしても動きません。ブックマークバーにドラッグして登録してください。
                </p>
              </div>

              <div>
                <p className="text-sm text-text-body mb-2">
                  または、コードをコピーして手動で登録できます。
                </p>
                <Button variant="outline" onClick={copyBookmarklet}>
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-1.5 text-green-600" />
                      コピーしました
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-1.5" />
                      コードをコピー
                    </>
                  )}
                </Button>
              </div>

              <div className="pt-3 border-t border-border">
                <p className="text-xs text-text-muted mb-2">
                  トークンが漏洩した場合や無効化したい場合は再発行してください。古いトークンは即座に無効になります。
                </p>
                <Button variant="secondary" onClick={revokeAndReissue} disabled={isRevoking}>
                  <RefreshCw className="w-4 h-4 mr-1.5" />
                  {isRevoking ? '再発行中...' : 'トークンを再発行（古いものは無効化）'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 使い方 */}
        <div className="bg-surface-raised border border-border rounded-xl p-5">
          <h2 className="text-base font-bold text-text-heading mb-3">使い方</h2>
          <ol className="space-y-2 text-sm text-text-body list-decimal list-inside">
            <li>上の「NESTから流し込む」をブックマークバーにドラッグして登録（初回のみ）</li>
            <li>NESTで「流し込む」ボタン（例: 季節講習の座席表自動入力、教材の取次発注）を押す</li>
            <li>対象サイトを開き、登録したブックマークをクリック → 自動で入力される</li>
            <li>内容を確認して「登録」「送信」を押す（reCAPTCHA・確認は手動）</li>
          </ol>
        </div>
      </div>
    </AdminLayout>
  );
}
