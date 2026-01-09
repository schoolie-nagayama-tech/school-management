'use client';

import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helpText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helpText, className = '', id, ...props }, ref) => {
    const inputId = id || label?.replace(/\s+/g, '-').toLowerCase();

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-[#0d0d0d] mb-1"
          >
            {label}
            {props.required && <span className="text-[#d9376e] ml-1">*</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            w-full px-3 py-2
            border rounded-lg
            bg-[#fffffe] text-[#2a2a2a] placeholder-[#2a2a2a]/40
            transition-colors duration-150
            focus:ring-2 focus:ring-[#ff8e3c] focus:border-[#ff8e3c]
            disabled:bg-[#eff0f3] disabled:text-[#2a2a2a]/50 disabled:cursor-not-allowed
            ${error ? 'border-[#d9376e] focus:ring-[#d9376e] focus:border-[#d9376e]' : 'border-[#0d0d0d]'}
            ${className}
          `}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-[#d9376e]">{error}</p>}
        {helpText && !error && (
          <p className="mt-1 text-sm text-[#2a2a2a]">{helpText}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
