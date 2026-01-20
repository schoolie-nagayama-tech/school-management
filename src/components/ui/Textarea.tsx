'use client';

import { TextareaHTMLAttributes, forwardRef } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helpText?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helpText, className = '', id, ...props }, ref) => {
    const textareaId = id || label?.replace(/\s+/g, '-').toLowerCase();

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-sm font-medium text-[#0d0d0d] mb-1"
          >
            {label}
            {props.required && <span className="text-[#d9376e] ml-1">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={`
            w-full px-3 py-2
            border rounded-lg
            bg-[#fffffe] text-[#2a2a2a] placeholder-[#2a2a2a]/40
            transition-colors duration-150
            focus:ring-2 focus:ring-[#ff8e3c] focus:border-[#ff8e3c]
            disabled:bg-[#eff0f3] disabled:text-[#2a2a2a]/50 disabled:cursor-not-allowed
            resize-y
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

Textarea.displayName = 'Textarea';
