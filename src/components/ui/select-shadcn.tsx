'use client';

import { ReactNode, useState, useRef, useEffect, createContext, useContext } from 'react';

interface SelectContextType {
  value?: string;
  onValueChange?: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  selectedLabel?: string;
  setSelectedLabel: (label: string) => void;
}

const SelectContext = createContext<SelectContextType | null>(null);

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}

export function Select({ value, onValueChange, children }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string>();

  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen, selectedLabel, setSelectedLabel }}>
      <div className="relative">
        {children}
      </div>
    </SelectContext.Provider>
  );
}

interface SelectTriggerProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function SelectTrigger({ children, className = '', onClick }: SelectTriggerProps) {
  const context = useContext(SelectContext);
  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      context?.setOpen(!context.open);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`
        w-full px-3 py-2
        border rounded-lg
        text-[#2a2a2a]
        bg-[#fffffe]
        transition-colors duration-150
        focus:ring-2 focus:ring-[#ff8e3c] focus:border-[#ff8e3c]
        disabled:bg-[#eff0f3] disabled:text-[#2a2a2a]/50 disabled:cursor-not-allowed
        border-[#0d0d0d]
        flex items-center justify-between
        ${className}
      `}
    >
      {children}
    </button>
  );
}

interface SelectValueProps {
  placeholder?: string;
  children?: ReactNode;
}

export function SelectValue({ placeholder, children }: SelectValueProps) {
  const context = useContext(SelectContext);
  return (
    <span className="select-value">
      {context?.selectedLabel || children || placeholder || '選択してください'}
    </span>
  );
}

interface SelectContentProps {
  children: ReactNode;
  className?: string;
}

export function SelectContent({ children, className = '' }: SelectContentProps) {
  const context = useContext(SelectContext);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contentRef.current && !contentRef.current.contains(event.target as Node)) {
        context?.setOpen(false);
      }
    };

    if (context?.open) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [context?.open]);

  if (!context?.open) return null;

  return (
    <div
      ref={contentRef}
      className={`
        absolute z-50 w-full mt-1
        bg-[#fffffe] border border-[#0d0d0d] rounded-lg shadow-lg
        max-h-60 overflow-auto
        ${className}
      `}
    >
      {children}
    </div>
  );
}

interface SelectItemProps {
  value: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function SelectItem({ value, children, onClick, className = '' }: SelectItemProps) {
  const context = useContext(SelectContext);
  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      context?.onValueChange?.(value);
      context?.setSelectedLabel(String(children));
      context?.setOpen(false);
    }
  };

  return (
    <div
      className={`
        px-3 py-2 cursor-pointer hover:bg-[#eff0f3] transition-colors
        ${context?.value === value ? 'bg-[#ff8e3c]/10' : ''}
        ${className}
      `}
      data-value={value}
      onClick={handleClick}
    >
      {children}
    </div>
  );
}
