'use client';

import { ReactNode } from 'react';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-[#ff8e3c] text-[#0d0d0d]',
  secondary: 'bg-[#eff0f3] text-[#2a2a2a]',
  outline: 'border border-[#0d0d0d] text-[#2a2a2a] bg-transparent',
  destructive: 'bg-[#d9376e] text-white',
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
