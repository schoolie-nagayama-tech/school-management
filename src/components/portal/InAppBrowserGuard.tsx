'use client';

import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui';

function detectInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Line|FBAN|FBAV|Instagram|Twitter|MicroMessenger|KAKAOTALK|Grow/i.test(ua)) return true;
  if (/Android/i.test(ua) && /; wv\)/.test(ua)) return true;
  // Android WebView: "Version/X.X ... Chrome" (regular Chrome doesn't have Version/)
  if (/Android/i.test(ua) && /Version\/[\d.]+.*Chrome/i.test(ua)) return true;
  return false;
}

export function InAppBrowserGuard({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'normal' | 'redirecting' | 'fallback'>(
    'checking'
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!detectInAppBrowser()) {
      setStatus('normal');
      return;
    }

    const url = window.location.href;
    const ua = navigator.userAgent || '';

    if (/Android/i.test(ua)) {
      setStatus('redirecting');
      const cleanUrl = url.replace(/^https?:\/\//, '');
      const scheme = url.startsWith('https') ? 'https' : 'http';
      window.location.href = `intent://${cleanUrl}#Intent;scheme=${scheme};action=android.intent.action.VIEW;end`;
      setTimeout(() => setStatus('fallback'), 2000);
    } else {
      setStatus('fallback');
    }
  }, []);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = window.location.href;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (status === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Spinner size="md" />
      </div>
    );
  }

  if (status === 'redirecting') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-white">
        <div className="text-center space-y-4">
          <Spinner size="md" className="mx-auto" />
          <p className="text-sm text-gray-600">ブラウザを起動中...</p>
        </div>
      </div>
    );
  }

  if (status === 'fallback') {
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-emerald-50 to-white">
        <div className="text-center space-y-5 max-w-sm">
          <h1 className="text-lg font-bold text-gray-800">ブラウザで開いてください</h1>
          <p className="text-sm text-gray-600 leading-relaxed">
            アプリ内ブラウザでは正常に表示できません。
            <br />
            下のボタンからブラウザで開いてください。
          </p>
          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full px-6 py-3.5 bg-emerald-600 text-white font-bold rounded-xl text-center shadow-sm active:bg-emerald-700 transition-colors"
          >
            ブラウザで開く
          </a>
          <button
            type="button"
            onClick={handleCopyUrl}
            className="block w-full px-6 py-3 border-2 border-gray-300 text-gray-700 font-medium rounded-xl text-center active:bg-gray-100 transition-colors"
          >
            {copied ? 'コピーしました' : 'URLをコピーして貼り付ける'}
          </button>
          <p className="text-xs text-gray-400 leading-relaxed">
            ボタンが動作しない場合は、右上のメニューから
            <br />
            「ブラウザで開く」を選択してください
          </p>
          <button
            type="button"
            onClick={() => setStatus('normal')}
            className="text-xs text-gray-400 underline underline-offset-2"
          >
            このまま表示する
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
