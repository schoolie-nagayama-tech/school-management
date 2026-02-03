'use client';

import { SelectHTMLAttributes, forwardRef } from 'react';

interface SelectOption {
  value: string | number;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    { label, error, options, placeholder, className = '', id, ...props },
    ref
  ) => {
    const selectId = id || label?.replace(/\s+/g, '-').toLowerCase();

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-sm font-medium text-[#1f2937] mb-1"
          >
            {label}
            {props.required && <span className="text-[#ef4444] ml-1">*</span>}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`
            w-full px-3 py-2
            border rounded-lg
            text-[#4b5563]
            bg-white
            transition-colors duration-150
            focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]
            disabled:bg-[#f3f4f6] disabled:text-[#4b5563]/50 disabled:cursor-not-allowed
            ${error ? 'border-[#ef4444] focus:ring-[#ef4444] focus:border-[#ef4444]' : 'border-[#e5e7eb]'}
            ${className}
          `}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && <p className="mt-1 text-sm text-[#ef4444]">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
