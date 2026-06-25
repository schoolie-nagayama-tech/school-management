'use client';

import { useTheme, type ThemePreference } from '@/contexts/ThemeContext';
import { Sun, Moon, Monitor } from 'lucide-react';

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  Icon: typeof Sun;
}> = [
  { value: 'light', label: 'ライト', Icon: Sun },
  { value: 'dark', label: 'ダーク', Icon: Moon },
  { value: 'system', label: 'システム', Icon: Monitor },
];

/**
 * ライト / ダーク / システムを明示選択する 3 つボタンのトグル。
 * セグメント型で現在選択が一目でわかる。
 */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="カラーテーマ"
      className="inline-flex items-center rounded-lg border border-[color:var(--border-default)] bg-[color:var(--surface)] p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setPreference(value)}
            className={`
              flex items-center justify-center w-7 h-7 rounded-md transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97]
              ${
                active
                  ? 'bg-[color:var(--surface-raised)] text-[color:var(--text-heading)] shadow-sm'
                  : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-heading)]'
              }
            `}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
