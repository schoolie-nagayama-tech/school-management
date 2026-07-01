'use client';

/**
 * HP取込設定ページ（ブックマークレット発行）。
 * admin / owner のみアクセス可。
 *
 * 1. 「ブックマークレットを発行」ボタン → POST /api/inquiry-import/token でトークン取得。
 * 2. token を javascript: URL に埋め込んで <a> リンク（ドラッグ登録用）とコピーボタンを表示。
 * 3. 「再発行」ボタン → DELETE → POST で既存トークンを失効させて新規発行。
 *
 * ブックマークレット動作:
 *  ① 本部HP問合せ画面で1クリック
 *  ② download.php を fetch（credentials:include でセッション Cookie 付与）
 *  ③ Shift_JIS デコード → /api/inquiry-import/push?token=... に POST
 *  ④ 結果アラートを表示
 */

import { useState } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { supabase } from '@/lib/supabase';
import { Bookmark, Copy, Check, RefreshCw, ArrowLeft, AlertTriangle } from 'lucide-react';
import { isManagerOrAbove } from '@/lib/utils/roles';

// ============================================================
// ブックマークレット生成
// ============================================================

/**
 * ブックマークレットの javascript: URL を生成する。
 *
 * @param token  inquiry_import_tokens.token の値
 * @param origin アプリのオリジン（例: https://nest.example.com）
 *
 * 注意: ブックマークレットは minify した1行の javascript: URL にする必要がある。
 *       テンプレートでは __TOKEN__ と __ORIGIN__ をプレースホルダとして用いる。
 */
function buildBookmarklet(token: string, origin: string): string {
  // ブラウザの download.php から CSV を取得し、NEST に push するコード
  // 改行・余分なスペースを除去して1行にまとめる（ブックマークレット要件）
  const code = `(async()=>{try{const r=await fetch('https://www.tactgroup.net/contents/boshu/class/applicant/download.php',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'btn_download=1',credentials:'include'});if(!r.ok)throw new Error('HP取得失敗 '+r.status);const b=await r.arrayBuffer();const csv=new TextDecoder('shift-jis').decode(b);const res=await fetch('${origin}/api/inquiry-import/push?token=${token}',{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:csv});const d=await res.json();if(!res.ok)throw new Error(d.error||'取込失敗');alert('NEST取込完了\\n新規 '+d.created+'件 / 重複スキップ '+d.skipped+'件'+((d.errors&&d.errors.length)?'\\nエラー '+d.errors.length+'件':''));}catch(e){alert('取込エラー: '+e.message);}})();`;
  return `javascript:${code}`;
}

// ============================================================
// コンポーネント
// ============================================================

export default function InquiryConnectPage() {
  const { profile } = useAuth();

  // ロールガード: 教室長以上（manager / owner / admin）。判定は roles.ts に一元化。
  const isAdmin = isManagerOrAbove(profile?.role);

  const [bookmarklet, setBookmarklet] = useState<string | null>(null);
  const [isIssuing, setIsIssuing] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // ============================================================
  // トークン発行（既存があれば再利用）
  // ============================================================

  async function issueToken() {
    setIsIssuing(true);
    setError('');
    try {
      // Bearer トークンは monthlyTasks.ts と同じパターンで取得
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('ログインが必要です');

      const res = await fetch('/api/inquiry-import/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ label: '管理画面発行' }),
      });

      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? '発行に失敗しました');
      if (!data.token) throw new Error('トークンが返されませんでした');

      const origin = window.location.origin;
      setBookmarklet(buildBookmarklet(data.token, origin));
    } catch (err) {
      setError(err instanceof Error ? err.message : '発行に失敗しました');
    } finally {
      setIsIssuing(false);
    }
  }

  // ============================================================
  // トークン再発行（DELETE → POST）
  // ============================================================

  async function revokeAndReissue() {
    setIsRevoking(true);
    setError('');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('ログインが必要です');

      const authHeader = { Authorization: `Bearer ${session.access_token}` };

      // 1. 既存トークンを全失効
      const delRes = await fetch('/api/inquiry-import/token', {
        method: 'DELETE',
        headers: authHeader,
      });
      if (!delRes.ok) {
        const d = (await delRes.json()) as { error?: string };
        throw new Error(d.error ?? '失効に失敗しました');
      }

      // 2. 新規発行
      const postRes = await fetch('/api/inquiry-import/token', {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: '管理画面発行（再発行）' }),
      });
      const postData = (await postRes.json()) as { token?: string; error?: string };
      if (!postRes.ok) throw new Error(postData.error ?? '再発行に失敗しました');
      if (!postData.token) throw new Error('トークンが返されませんでした');

      const origin = window.location.origin;
      setBookmarklet(buildBookmarklet(postData.token, origin));
    } catch (err) {
      setError(err instanceof Error ? err.message : '再発行に失敗しました');
    } finally {
      setIsRevoking(false);
    }
  }

  // ============================================================
  // クリップボードコピー
  // ============================================================

  async function copyBookmarklet() {
    if (!bookmarklet) return;
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API が使えない環境では手動コピーへ誘導
      setError(
        '自動コピーに失敗しました。下のリンクを右クリック→「リンクアドレスをコピー」してください。'
      );
    }
  }

  // ============================================================
  // ロールチェック
  // ============================================================

  if (!isAdmin) {
    return (
      <AdminLayout>
        <AccessDenied message="この機能は管理者のみ利用できます" />
      </AdminLayout>
    );
  }

  // ============================================================
  // UI
  // ============================================================

  return (
    <AdminLayout headerTitle="HPから取込（ブックマークレット）">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* 戻るリンク */}
        <div>
          <Link
            href="/admin/inquiries"
            className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-heading transition-colors duration-150"
          >
            <ArrowLeft className="w-4 h-4" />
            問合せ一覧に戻る
          </Link>
        </div>

        {/* 説明 */}
        <div className="bg-surface-raised border border-border rounded-xl p-5">
          <h2 className="text-base font-bold text-text-heading mb-2">概要</h2>
          <p className="text-sm text-text-body leading-relaxed">
            本部HPの問合せ管理画面で「NESTに取込」ブックマークをクリックすると、
            表示中の教室のCSVを自動でNESTに取り込みます。
            教室を切り替えながら1クリックずつ実行してください。
          </p>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="flex items-start gap-2 p-4 bg-danger/10 border border-danger/30 rounded-xl">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        {/* ブックマークレット発行エリア */}
        <div className="bg-surface-raised border border-border rounded-xl p-5 space-y-4">
          <h2 className="text-base font-bold text-text-heading">ブックマークレットを発行</h2>

          {!bookmarklet ? (
            /* 未発行状態 */
            <div className="space-y-3">
              <p className="text-sm text-text-body">
                下のボタンを押すとブックマークレットのリンクを生成します。
                既に発行済みのトークンがある場合は再利用されます。
              </p>
              <Button variant="primary" onClick={issueToken} disabled={isIssuing}>
                <Bookmark className="w-4 h-4 mr-1.5" />
                {isIssuing ? '発行中...' : 'ブックマークレットを発行'}
              </Button>
            </div>
          ) : (
            /* 発行済み状態 */
            <div className="space-y-4">
              {/* ドラッグ用リンク */}
              <div className="p-4 bg-info-subtle border border-info/30 rounded-lg">
                <p className="text-xs font-medium text-info mb-2">
                  下のリンクをブックマークバーにドラッグして登録してください
                </p>
                {/* eslint-disable-next-line react/jsx-no-target-blank */}
                <a
                  href={bookmarklet}
                  // javascript: URL の onClick を防止（ページ内クリックでなくブックマーク登録用）
                  onClick={(e) => e.preventDefault()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-ink text-white text-sm font-medium rounded-lg cursor-grab active:cursor-grabbing select-none hover:bg-ink/90 transition-colors duration-150"
                  draggable
                >
                  <Bookmark className="w-4 h-4" />
                  NESTに取込
                </a>
                <p className="text-xs text-info mt-2">
                  ※
                  このリンクはクリックしても動きません。ブックマークバーにドラッグして登録してください。
                </p>
              </div>

              {/* コピーボタン */}
              <div>
                <p className="text-sm text-text-body mb-2">
                  または、ブックマークレットのコードをコピーして手動で登録できます。
                </p>
                <Button variant="outline" onClick={copyBookmarklet}>
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-1.5 text-success" />
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

              {/* 再発行ボタン */}
              <div className="pt-3 border-t border-border">
                <p className="text-xs text-text-muted mb-2">
                  トークンが漏洩した場合や無効化したい場合は再発行してください。
                  古いトークンは即座に無効になります。
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
            <li>上の「NESTに取込」リンクをブラウザのブックマークバーにドラッグして登録する</li>
            <li>本部HPにログインし、問合せ管理画面を開く</li>
            <li>取り込みたい教室を選択する（教室ごとに1クリック）</li>
            <li>ブックマークバーの「NESTに取込」をクリック → 完了アラートが表示される</li>
            <li>教室を切り替えて繰り返す</li>
          </ol>
          <div className="mt-4 p-3 bg-warning-subtle border border-warning/30 rounded-lg">
            <p className="text-xs text-text-heading font-medium">注意事項</p>
            <ul className="mt-1 space-y-1 text-xs text-text-body list-disc list-inside">
              <li>トークンは秘密情報です。他の人と共有しないでください。</li>
              <li>漏洩した場合は「トークンを再発行」で古いものを無効化してください。</li>
              <li>同一の問合せNOは重複スキップされるので、何度実行しても二重登録になりません。</li>
            </ul>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
