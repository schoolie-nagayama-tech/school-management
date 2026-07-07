'use client';

/**
 * 配信停止ページ クライアントコンポーネント。ログイン不要。
 *
 * 状態:
 *   loading  → トークンの状態をAPIで確認中
 *   invalid  → トークンが無い/無効（リンク切れ）
 *   ready    → 停止ボタンを表示（本人がクリックして確定）
 *   done     → 配信停止済み（今停止した / もともと停止済み）
 *   error    → 通信・サーバーエラー
 *
 * 設計意図: メールスキャナの先読み(GET)で誤って停止されないよう、
 * 実際の停止は本人がボタンを押した POST でのみ行う。
 */

import { useState, useEffect, useCallback } from 'react';
import { MailX, CheckCircle2, AlertCircle } from 'lucide-react';

type Phase = 'loading' | 'invalid' | 'ready' | 'done' | 'error';

interface UnsubscribeClientProps {
  token: string;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#f8f9fa]">
      <header className="border-b border-[#e5e7eb] bg-white">
        <div className="max-w-lg mx-auto px-5 py-4">
          <p className="text-sm font-bold text-[#1a1a1a]">スクールIE</p>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-5 py-10">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-[#e5e7eb] p-8 text-center">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function UnsubscribeClient({ token }: UnsubscribeClientProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [submitting, setSubmitting] = useState(false);

  // 初期表示でトークンの状態を確認（この時点では停止しない）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setPhase('invalid');
        return;
      }
      try {
        const res = await fetch(`/api/inquiries/unsubscribe?token=${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (cancelled) return;
        if (!data.found) {
          setPhase('invalid');
        } else if (data.alreadyOptedOut) {
          setPhase('done');
        } else {
          setPhase('ready');
        }
      } catch {
        if (!cancelled) setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // 配信停止を確定する
  const handleStop = useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/inquiries/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setPhase('done');
      } else {
        setPhase('error');
      }
    } catch {
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  }, [token]);

  if (phase === 'loading') {
    return (
      <Shell>
        <p className="text-sm text-[#6b7280]">読み込み中...</p>
      </Shell>
    );
  }

  if (phase === 'invalid') {
    return (
      <Shell>
        <div className="w-12 h-12 rounded-full bg-[#fef2f2] flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6 text-[#dc2626]" />
        </div>
        <h2 className="text-base font-bold text-[#1a1a1a] mb-3">リンクが無効です</h2>
        <p className="text-sm text-[#374151] leading-relaxed">
          お手数ですが、配信を希望されない場合はお送りしたメールにそのままご返信ください。
        </p>
      </Shell>
    );
  }

  if (phase === 'error') {
    return (
      <Shell>
        <div className="w-12 h-12 rounded-full bg-[#fef2f2] flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6 text-[#dc2626]" />
        </div>
        <h2 className="text-base font-bold text-[#1a1a1a] mb-3">処理に失敗しました</h2>
        <p className="text-sm text-[#374151] leading-relaxed">
          時間をおいて再度お試しいただくか、お送りしたメールにご返信ください。
        </p>
      </Shell>
    );
  }

  if (phase === 'done') {
    return (
      <Shell>
        <div className="w-12 h-12 rounded-full bg-[#d1fae5] flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-6 h-6 text-[#059669]" />
        </div>
        <h2 className="text-base font-bold text-[#1a1a1a] mb-3">配信を停止しました</h2>
        <p className="text-sm text-[#374151] leading-relaxed">
          今後、このメールアドレスへのご案内メールはお送りしません。
          <br />
          再開をご希望の場合は、教室までお問い合わせください。
        </p>
      </Shell>
    );
  }

  // ready
  return (
    <Shell>
      <div className="w-12 h-12 rounded-full bg-[#f3f4f6] flex items-center justify-center mx-auto mb-4">
        <MailX className="w-6 h-6 text-[#6b7280]" />
      </div>
      <h2 className="text-base font-bold text-[#1a1a1a] mb-3">メールの配信を停止しますか？</h2>
      <p className="text-sm text-[#374151] leading-relaxed mb-6">
        下のボタンを押すと、スクールIEからのご案内メールの配信を停止します。
      </p>
      <button
        type="button"
        onClick={handleStop}
        disabled={submitting}
        className="w-full py-3 rounded-xl text-sm font-bold text-white bg-[#dc2626] hover:bg-[#b91c1c] active:scale-[0.99] transition disabled:opacity-60"
      >
        {submitting ? '処理中...' : '配信を停止する'}
      </button>
      <p className="text-xs text-[#9ca3af] mt-4 leading-relaxed">
        誤ってこのページを開いた場合は、そのまま閉じてください。
        <br />
        ボタンを押さない限り配信は停止されません。
      </p>
    </Shell>
  );
}
