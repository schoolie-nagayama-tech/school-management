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
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
