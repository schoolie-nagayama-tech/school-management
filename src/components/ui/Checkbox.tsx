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
          text-[#3b82f6]
          border-[#e5e7eb] rounded
          focus:ring-2 focus:ring-[#3b82f6] focus:ring-offset-2
          disabled:opacity-50 disabled:cursor-not-allowed
          ${className}
        `}
        {...props}
      />
    );
  }
);

Checkbox.displayName = 'Checkbox';
