'use client';

import { ReactNode, useEffect, useId, useState, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

const AlertDialogIdsContext = createContext<{ titleId: string; descId: string } | undefined>(
  undefined
);

interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** オーバーレイの className（例: z-[100] で他モーダルより前面に） */
  overlayClassName?: string;
}

export function AlertDialog({ open, onOpenChange, children, overlayClassName }: AlertDialogProps) {
  const titleId = useId();
  const descId = useId();
  // ポータル描画はマウント後のみ（SSR/ハイドレーション不一致を避ける）
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  if (!open || !mounted) return null;

  // document.body 直下へポータル描画する。
  // 親モーダルのパネル(.modal-panel)は transform を持つため、入れ子で描画すると
  // fixed の基準が親パネルになり、はみ出した部分が親の overflow-hidden で見切れる。
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${overlayClassName ?? ''}`}
    >
      <div
        className="absolute inset-0 modal-overlay"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative z-50 w-full max-w-lg bg-surface-raised rounded-xl shadow-2xl border border-border ring-1 ring-black/5 modal-panel max-h-[95vh] overflow-hidden flex flex-col"
      >
        <AlertDialogIdsContext.Provider value={{ titleId, descId }}>
          {children}
        </AlertDialogIdsContext.Provider>
      </div>
    </div>,
    document.body
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
  return <div className={`px-6 py-4 border-b border-border ${className}`}>{children}</div>;
}

interface AlertDialogTitleProps {
  children: ReactNode;
  className?: string;
}

export function AlertDialogTitle({ children, className = '' }: AlertDialogTitleProps) {
  const ids = useContext(AlertDialogIdsContext);
  return (
    <h2 id={ids?.titleId} className={`text-lg font-semibold text-text-heading ${className}`}>
      {children}
    </h2>
  );
}

interface AlertDialogDescriptionProps {
  children: ReactNode;
  className?: string;
}

export function AlertDialogDescription({ children, className = '' }: AlertDialogDescriptionProps) {
  const ids = useContext(AlertDialogIdsContext);
  return (
    <p id={ids?.descId} className={`text-sm text-text-body mt-2 ${className}`}>
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
    <div
      className={`flex items-center justify-end gap-2 px-6 py-4 border-t border-border ${className}`}
    >
      {children}
    </div>
  );
}

interface AlertDialogActionProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}

export function AlertDialogAction({
  children,
  onClick,
  className = '',
  disabled = false,
}: AlertDialogActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 bg-info text-white rounded-lg hover:bg-info/80 transition-colors duration-150 font-medium disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97] ${className}`}
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
      className={`px-4 py-2 bg-surface-raised text-text-body border border-border rounded-lg hover:bg-surface-hover transition-colors duration-150 font-medium active:scale-[0.97] ${className}`}
    >
      {children}
    </button>
  );
}
