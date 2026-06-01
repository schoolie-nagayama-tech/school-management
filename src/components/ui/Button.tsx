'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Spinner } from './Spinner';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-ink text-text-on-primary hover:brightness-[0.85] focus:ring-ink/40 disabled:opacity-50 disabled:hover:brightness-100',
  secondary:
    'bg-transparent text-ink border border-ink hover:bg-ink/10 focus:ring-ink/30 disabled:border-border disabled:text-text-faint',
  danger:
    'bg-transparent text-danger border border-danger hover:bg-danger/10 focus:ring-danger/30 disabled:border-border disabled:text-text-faint',
  ghost:
    'bg-transparent text-text-muted hover:bg-surface-hover hover:text-text-heading focus:ring-border disabled:text-text-faint',
  outline:
    'bg-transparent text-text-body border border-border hover:bg-surface-hover focus:ring-border disabled:border-border-subtle disabled:text-text-faint',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      disabled,
      children,
      className = '',
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`
          inline-flex items-center justify-center
          whitespace-nowrap
          font-medium rounded-lg
          transition-[transform,background-color,border-color,color,opacity,filter] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]
          active:scale-[0.97]
          focus:outline-none focus:ring-2 focus:ring-offset-2
          disabled:cursor-not-allowed disabled:active:scale-100
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${className}
        `}
        {...props}
      >
        {isLoading && <Spinner size="sm" tone="current" className="-ml-1 mr-2" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
