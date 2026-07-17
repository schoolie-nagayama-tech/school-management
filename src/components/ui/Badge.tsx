'use client';

import { ReactNode } from 'react';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-ink text-text-on-primary',
  secondary: 'bg-surface-hover text-text-body',
  outline: 'border border-ink text-ink bg-transparent',
  destructive: 'bg-danger text-text-on-primary',
};

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span
      // バッジは短いラベル専用。狭い列に置くと折り返して2〜3行に崩れるため、常に1行に保つ
      className={`inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-medium ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
