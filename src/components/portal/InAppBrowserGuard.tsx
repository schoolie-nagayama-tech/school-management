'use client';

import { useEffect, useState } from 'react';

function detectInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Line|FBAN|FBAV|Instagram|Twitter|MicroMessenger|KAKAOTALK/i.test(ua)) return true;
  if (/Android/i.test(ua) && /; wv\)/.test(ua)) return true;
  return false;
}

export function InAppBrowserGuard({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'normal' | 'redirecting' | 'fallback'>('checking');

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

  if (status === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'redirecting') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-white">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 mx-auto border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
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
          <h1 className="text-lg font-bold text-gray-800">
            ブラウザで開いてください
          </h1>
          <p className="text-sm text-gray-600 leading-relaxed">
            アプリ内ブラウザでは正常に表示できません。<br />
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
