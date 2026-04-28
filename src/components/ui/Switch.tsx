'use client';

import { InputHTMLAttributes, forwardRef } from 'react';

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ checked, onCheckedChange, className = '', ...props }, ref) => {
    return (
      <label className={`relative inline-flex items-center cursor-pointer ${className}`}>
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          className="sr-only peer"
          {...props}
        />
        <div className="w-11 h-6 bg-[#e5e7eb] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#3b82f6] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-[transform] after:duration-150 after:ease-out transition-colors duration-150 peer-checked:bg-[#3b82f6]"></div>
      </label>
    );
  }
);

Switch.displayName = 'Switch';
