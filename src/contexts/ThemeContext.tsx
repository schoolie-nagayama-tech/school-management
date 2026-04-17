'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'nest-theme';

interface ThemeContextValue {
  /** ユーザー選択値（保存対象） */
  preference: ThemePreference;
  /** 実際に適用されているテーマ（system → 現在のOS設定に解決済み） */
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (resolved === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('light');
  const [resolved, setResolved] = useState<ResolvedTheme>('light');

  // 初期化（クライアント）
  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? 'light';
    setPreferenceState(saved);
    const r = resolveTheme(saved);
    setResolved(r);
    applyTheme(r);
  }, []);

  // system 選択時、OS 設定変更を追跡
  useEffect(() => {
    if (preference !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const r: ResolvedTheme = mql.matches ? 'dark' : 'light';
      setResolved(r);
      applyTheme(r);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((p: ThemePreference) => {
    localStorage.setItem(STORAGE_KEY, p);
    setPreferenceState(p);
    const r = resolveTheme(p);
    setResolved(r);
    applyTheme(r);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

/**
 * FOUC 防止用の同期スクリプト。
 * layout.tsx の <head> に dangerouslySetInnerHTML で注入する。
 * React ハイドレート前に実行され、localStorage を読んで class を先に付ける。
 */
export const themeInitScript = `(function(){try{var p=localStorage.getItem('${STORAGE_KEY}')||'light';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
