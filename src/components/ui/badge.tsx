'use client';

import { HTMLAttributes, forwardRef } from 'react';

interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
}

const variantStyles = {
  default: 'bg-[#ff8e3c] text-[#0d0d0d]',
  secondary: 'bg-[#eff0f3] text-[#2a2a2a]',
  destructive: 'bg-[#d9376e] text-white',
  outline: 'border border-[#0d0d0d] text-[#0d0d0d]',
};

export const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ variant = 'default', className = '', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${variantStyles[variant]} ${className}`}
        {...props}
      />
    );
  }
);
Badge.displayName = 'Badge';
