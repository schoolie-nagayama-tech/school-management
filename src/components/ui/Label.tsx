'use client';

import { LabelHTMLAttributes, forwardRef } from 'react';

type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className = '', children, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={`block text-sm font-medium text-text-heading ${className}`}
        {...props}
      >
        {children}
      </label>
    );
  }
);

Label.displayName = 'Label';
