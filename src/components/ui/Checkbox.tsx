'use client';

import { InputHTMLAttributes, forwardRef } from 'react';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ checked, onCheckedChange, className = '', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        className={`
          w-4 h-4
          text-info
          border-border rounded
          focus:ring-2 focus:ring-primary focus:ring-offset-2
          disabled:opacity-50 disabled:cursor-not-allowed
          ${className}
        `}
        {...props}
      />
    );
  }
);

Checkbox.displayName = 'Checkbox';
