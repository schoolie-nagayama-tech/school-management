'use client';

import { ReactNode, useEffect } from 'react';

interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** オーバーレイの className（例: z-[100] で他モーダルより前面に） */
  overlayClassName?: string;
}

export function AlertDialog({ open, onOpenChange, children, overlayClassName }: AlertDialogProps) {
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
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${overlayClassName ?? ''}`}>
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div className="relative z-50 w-full max-w-lg bg-white rounded-xl shadow-2xl border border-[#e5e7eb] max-h-[95vh] overflow-hidden flex flex-col">
        {children}
      </div>
    </div>
  );
}

interface AlertDialogContentProps {
  children: ReactNode;
  className?: string;
}

export function AlertDialogContent({ children, className = '' }: AlertDialogContentProps) {
  return <div className={`px-6 py-6 flex-1 min-h-0 overflow-y-auto ${className}`}>{children}</div>;
}

interface AlertDialogHeaderProps {
  children: ReactNode;
  className?: string;
}

export function AlertDialogHeader({ children, className = '' }: AlertDialogHeaderProps) {
  return (
    <div className={`px-6 py-4 border-b border-[#e5e7eb] ${className}`}>
      {children}
    </div>
  );
}

interface AlertDialogTitleProps {
  children: ReactNode;
  className?: string;
}

export function AlertDialogTitle({ children, className = '' }: AlertDialogTitleProps) {
  return (
    <h2 className={`text-lg font-semibold text-[#1f2937] ${className}`}>
      {children}
    </h2>
  );
}

interface AlertDialogDescriptionProps {
  children: ReactNode;
  className?: string;
}

export function AlertDialogDescription({ children, className = '' }: AlertDialogDescriptionProps) {
  return (
    <p className={`text-sm text-[#4b5563] mt-2 ${className}`}>
      {children}
    </p>
  );
}

interface AlertDialogFooterProps {
  children: ReactNode;
  className?: string;
}

export function AlertDialogFooter({ children, className = '' }: AlertDialogFooterProps) {
  return (
    <div className={`flex items-center justify-end gap-2 px-6 py-4 border-t border-[#e5e7eb] ${className}`}>
      {children}
    </div>
  );
}

interface AlertDialogActionProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function AlertDialogAction({ children, onClick, className = '' }: AlertDialogActionProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 bg-[#3b82f6] text-white rounded-lg hover:bg-[#60a5fa] transition-colors font-medium ${className}`}
    >
      {children}
    </button>
  );
}

interface AlertDialogCancelProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}

export function AlertDialogCancel({ children, onClick, className = '' }: AlertDialogCancelProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 bg-white text-[#4b5563] border border-[#e5e7eb] rounded-lg hover:bg-[#f3f4f6] transition-colors font-medium ${className}`}
    >
      {children}
    </button>
  );
}
