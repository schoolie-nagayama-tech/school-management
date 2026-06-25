'use client';

import { ReactNode, MouseEventHandler, CSSProperties } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  // stagger 表示などでカード単位に CSS 変数（--stagger-index 等）を渡せるようにする
  style?: CSSProperties;
}

export function Card({ children, className = '', onClick, style }: CardProps) {
  // クリッカブル時: active:scale で押下フィードバック、--ease-out カーブで揃える
  const interactiveClass = onClick
    ? 'cursor-pointer transition-[transform,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]'
    : '';
  return (
    <div
      className={`bg-surface rounded-xl border border-border ${interactiveClass} ${className}`}
      onClick={onClick}
      style={style}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  children: ReactNode;
  className?: string;
}

export function CardHeader({ children, className = '' }: CardHeaderProps) {
  return <div className={`px-6 py-4 border-b border-border ${className}`}>{children}</div>;
}

interface CardTitleProps {
  children: ReactNode;
  className?: string;
}

export function CardTitle({ children, className = '' }: CardTitleProps) {
  return <h3 className={`text-lg font-bold text-text-heading ${className}`}>{children}</h3>;
}

interface CardContentProps {
  children: ReactNode;
  className?: string;
}

export function CardContent({ children, className = '' }: CardContentProps) {
  return <div className={`px-6 py-4 ${className}`}>{children}</div>;
}
