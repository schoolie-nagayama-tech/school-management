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
          <label htmlFor={textareaId} className="block text-sm font-medium text-text-heading mb-1">
            {label}
            {props.required && <span className="text-danger ml-1">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={`
            w-full px-3 py-2
            border rounded-lg
            bg-surface-raised text-text-body placeholder-text-faint
            transition-colors duration-150
            focus:ring-2 focus:ring-primary focus:border-primary
            disabled:bg-surface disabled:text-text-faint disabled:cursor-not-allowed
            resize-y
            ${error ? 'border-danger focus:ring-danger focus:border-danger' : 'border-border'}
            ${className}
          `}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-danger">{error}</p>}
        {helpText && !error && <p className="mt-1 text-sm text-text-muted">{helpText}</p>}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
