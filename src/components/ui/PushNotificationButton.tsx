'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

interface Props {
  schoolId: string;
  /** コンパクト表示（アイコンのみ） */
  compact?: boolean;
}

type SubState = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed' | 'loading';

export function PushNotificationButton({ schoolId, compact = false }: Props) {
  const [state, setState] = useState<SubState>('loading');

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    // 既存のサブスクリプション確認
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setState(sub ? 'subscribed' : 'unsubscribed');
      });
    });
  }, []);

  const subscribe = async () => {
    if (!VAPID_PUBLIC_KEY) {
      console.error('NEXT_PUBLIC_VAPID_PUBLIC_KEY が設定されていません');
      return;
    }
    setState('loading');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState('denied');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), schoolId }),
      });
      if (!res.ok) throw new Error('登録APIエラー');
      setState('subscribed');
    } catch (e) {
      console.error('[push] 購読失敗:', e);
      setState('unsubscribed');
    }
  };

  const unsubscribe = async () => {
    setState('loading');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState('unsubscribed');
    } catch (e) {
      console.error('[push] 解除失敗:', e);
      setState('subscribed');
    }
  };

  if (state === 'unsupported') return null;

  const isLoading = state === 'loading';
  const isSubscribed = state === 'subscribed';
  const isDenied = state === 'denied';

  const label = isDenied
    ? '通知がブロックされています'
    : isSubscribed
    ? '通知ON（タップで解除）'
    : '通知をONにする';

  const Icon = isDenied ? BellOff : isSubscribed ? BellRing : Bell;
  const colorClass = isDenied
    ? 'text-text-faint cursor-not-allowed'
    : isSubscribed
    ? 'text-primary'
    : 'text-white/70 hover:text-white';

  const handleClick = () => {
    if (isDenied || isLoading) return;
    if (isSubscribed) unsubscribe();
    else subscribe();
  };

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading || isDenied}
        title={label}
        aria-label={label}
        className={`inline-flex items-center justify-center w-9 h-9 rounded-lg transition-colors duration-150 ${colorClass} disabled:opacity-50`}
      >
        {isLoading ? (
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <Icon className="w-4 h-4" />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isLoading || isDenied}
      className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors duration-150 ${
        isDenied
          ? 'text-text-faint cursor-not-allowed'
          : isSubscribed
          ? 'text-primary hover:bg-primary/10'
          : 'text-text-body hover:bg-surface-hover'
      }`}
    >
      {isLoading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        <Icon className="w-4 h-4" />
      )}
      {label}
    </button>
  );
}
