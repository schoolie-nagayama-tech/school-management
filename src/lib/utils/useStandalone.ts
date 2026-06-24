'use client';

import { useEffect, useState } from 'react';

/**
 * インストール済みPWA（standalone 表示モード）で動作しているかを返すフック。
 *
 * - Android / デスクトップ: `matchMedia('(display-mode: standalone)')`
 * - iOS Safari: `navigator.standalone`
 *
 * SSR では判定できないため初期値は false。マウント後にクライアントで確定し、
 * 表示モードの変化（インストール直後など）にも追従する。
 */
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const compute = () =>
      mq.matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setStandalone(compute());
    const onChange = () => setStandalone(compute());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return standalone;
}
