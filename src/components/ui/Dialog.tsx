'use client';

import { ReactNode, useEffect, useId, createContext, useContext } from 'react';

const DialogTitleIdContext = createContext<string | undefined>(undefined);

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** スクリーンリーダー用のラベル。DialogTitle を使わない場合に指定 */
  ariaLabel?: string;
}

export function Dialog({ open, onOpenChange, children, ariaLabel }: DialogProps) {
  const titleId = useId();
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [open]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onOpenChange(false);
      }
    };
    if (open) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 modal-overlay"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabel ? undefined : titleId}
        aria-label={ariaLabel}
        className="relative z-50 w-full max-w-lg bg-surface-raised rounded-xl shadow-2xl border border-border ring-1 ring-black/5 max-h-[95vh] overflow-hidden flex flex-col modal-panel"
      >
        <DialogTitleIdContext.Provider value={titleId}>{children}</DialogTitleIdContext.Provider>
      </div>
    </div>
  );
}

interface DialogContentProps {
  children: ReactNode;
  className?: string;
}

export function DialogContent({ children, className = '' }: DialogContentProps) {
  return <div className={`px-6 py-6 flex-1 min-h-0 overflow-y-auto ${className}`}>{children}</div>;
}

interface DialogHeaderProps {
  children: ReactNode;
  className?: string;
}

export function DialogHeader({ children, className = '' }: DialogHeaderProps) {
  return (
    <div className={`px-6 py-4 border-b border-border ${className}`}>
      {children}
    </div>
  );
}

interface DialogTitleProps {
  children: ReactNode;
  className?: string;
}

export function DialogTitle({ children, className = '' }: DialogTitleProps) {
  const titleId = useContext(DialogTitleIdContext);
  return (
    <h2 id={titleId} className={`text-lg font-semibold text-text-heading ${className}`}>
      {children}
    </h2>
  );
}

interface DialogFooterProps {
  children: ReactNode;
  className?: string;
}

export function DialogFooter({ children, className = '' }: DialogFooterProps) {
  return (
    <div className={`flex items-center justify-end gap-2 px-6 py-4 border-t border-border ${className}`}>
      {children}
    </div>
  );
}
