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
            className="block text-sm font-medium text-[#1f2937] mb-1"
          >
            {label}
            {props.required && <span className="text-[#ef4444] ml-1">*</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            w-full px-3 py-2
            border rounded-lg
            bg-white text-[#4b5563] placeholder-[#4b5563]/40
            transition-colors duration-150
            focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]
            disabled:bg-[#f3f4f6] disabled:text-[#4b5563]/50 disabled:cursor-not-allowed
            ${error ? 'border-[#ef4444] focus:ring-[#ef4444] focus:border-[#ef4444]' : 'border-[#e5e7eb]'}
            ${className}
          `}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-[#ef4444]">{error}</p>}
        {helpText && !error && (
          <p className="mt-1 text-sm text-[#4b5563]">{helpText}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
