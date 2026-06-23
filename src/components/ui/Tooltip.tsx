'use client';

import { ReactNode } from 'react';

interface TooltipProps {
  text: string;
  children: ReactNode;
  /** ツールチップの表示位置 */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** 改行対応（長いテキストの場合） */
  multiline?: boolean;
}

/**
 * ホバーでツールチップを表示する汎用コンポーネント
 */
export function Tooltip({ text, children, position = 'top', multiline = false }: TooltipProps) {
  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  };

  return (
    <div className="relative group/tip inline-flex">
      {children}
      <div
        className={`absolute ${positionClasses[position]} z-50 pointer-events-none
          opacity-0 scale-95
          group-hover/tip:opacity-100 group-hover/tip:scale-100
          transition-[opacity,transform] duration-[125ms] ease-out`}
      >
        <div
          className={`bg-text-heading text-text-on-primary text-[10px] px-2 py-1 rounded shadow-lg ${
            multiline ? 'whitespace-pre-line max-w-[240px] leading-relaxed' : 'whitespace-nowrap'
          }`}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

interface HelpTooltipProps {
  text: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  multiline?: boolean;
  /** アイコンサイズ (デフォルト: 12px) */
  size?: number;
}

/**
 * ? アイコン付きのヘルプツールチップ
 * ラベル横などに配置して補足説明を表示する
 */
export function HelpTooltip({
  text,
  position = 'top',
  multiline = true,
  size = 12,
}: HelpTooltipProps) {
  return (
    <Tooltip text={text} position={position} multiline={multiline}>
      <span
        className="inline-flex items-center justify-center rounded-full border border-border text-text-faint hover:text-text-muted hover:border-border-strong cursor-help transition-colors duration-150 shrink-0"
        style={{ width: size + 4, height: size + 4, fontSize: size - 2 }}
      >
        ?
      </span>
    </Tooltip>
  );
}
