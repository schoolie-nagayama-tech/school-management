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
    // 呼び出し側が w-20 等の幅クラスを渡したらそれを尊重する。
    // 既定の w-full を付けたままだと、Tailwind の出力順で w-full が後に来て幅指定に勝ってしまい、
    // 「w-40 を渡したのに横いっぱいに伸びる」（＝flex 内で折り返す）という崩れ方をするため。
    // min-w-*/max-w-* だけの指定は幅を決めないので、従来どおり w-full を残す。
    const hasWidthOverride = /(^|\s)w-\S/.test(className);
    const widthClass = hasWidthOverride ? '' : 'w-full';

    return (
      <div className={widthClass}>
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-text-heading mb-1">
            {label}
            {props.required && <span className="text-danger ml-1">*</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            ${widthClass} px-3 py-2
            border rounded-lg
            bg-surface-raised text-text-body placeholder-text-faint
            transition-colors duration-150
            focus:ring-2 focus:ring-primary focus:border-primary
            disabled:bg-surface disabled:text-text-faint disabled:cursor-not-allowed
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

Input.displayName = 'Input';
