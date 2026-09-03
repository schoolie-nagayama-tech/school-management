'use client';

/**
 * 「連絡掲示板AIアシスト」モックで各タブが共通で使う小さな表示部品。
 * 既存の色トークン（info / success / warning / ink / surface …）だけで作る。
 */

import type { ReactNode } from 'react';

/** 見出し付きの枠。タブの中の1ブロックを表す */
export function Panel({
  title,
  icon,
  right,
  tone = 'plain',
  children,
}: {
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
  /** plain=グレー見出し / accent=情報色の見出し */
  tone?: 'plain' | 'accent';
  children: ReactNode;
}) {
  const isAccent = tone === 'accent';
  return (
    <section className="overflow-hidden rounded-lg border border-border">
      <div
        className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-bold tracking-wide ${
          isAccent ? 'bg-info-subtle text-info' : 'bg-surface text-text-muted'
        }`}
      >
        {icon}
        {title}
        {right && <span className="ml-auto font-medium">{right}</span>}
      </div>
      <div className="bg-white p-4">{children}</div>
    </section>
  );
}

/** 小さな注記（画面の意図をその場で説明する用） */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-text-faint">{children}</p>;
}

/** 補足バッジ（「投稿方法は今までと同じ」など、短い断り書き） */
export function Pill({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'muted' | 'ink';
}) {
  const toneClass = {
    info: 'bg-info-subtle text-info',
    success: 'bg-success-subtle text-success',
    warning: 'bg-warning-subtle text-warning',
    muted: 'bg-surface text-text-muted',
    ink: 'bg-ink-subtle text-ink',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold ${toneClass}`}
    >
      {children}
    </span>
  );
}

/**
 * 進捗バー。分母0でも壊れないように割合を丸めてから使う。
 */
export function ProgressBar({
  done,
  total,
  className = '',
}: {
  done: number;
  total: number;
  className?: string;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className={`h-2.5 w-full overflow-hidden rounded-full bg-surface ${className}`}>
      <div
        className="h-full rounded-full bg-info transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** ON/OFF バッジ（AIアシストの状態表示） */
export function OnOffBadge({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
        on ? 'bg-info-subtle text-info' : 'bg-surface text-text-muted'
      }`}
    >
      {on ? 'ON' : 'OFF'}
    </span>
  );
}
