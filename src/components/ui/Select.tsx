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
            className="block text-sm font-medium text-[#0d0d0d] mb-1"
          >
            {label}
            {props.required && <span className="text-[#d9376e] ml-1">*</span>}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`
            w-full px-3 py-2
            border rounded-lg
            text-[#2a2a2a]
            bg-[#fffffe]
            transition-colors duration-150
            focus:ring-2 focus:ring-[#ff8e3c] focus:border-[#ff8e3c]
            disabled:bg-[#eff0f3] disabled:text-[#2a2a2a]/50 disabled:cursor-not-allowed
            ${error ? 'border-[#d9376e] focus:ring-[#d9376e] focus:border-[#d9376e]' : 'border-[#0d0d0d]'}
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
        {error && <p className="mt-1 text-sm text-[#d9376e]">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
