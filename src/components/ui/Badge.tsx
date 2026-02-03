'use client';

import { ReactNode } from 'react';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-[#1e3a5f] text-white',
  secondary: 'bg-gray-100 text-gray-700',
  outline: 'border border-[#1e3a5f] text-[#1e3a5f] bg-transparent',
  destructive: 'bg-[#c62828] text-white',
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
