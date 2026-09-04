'use client';

import { ReactNode, useEffect, useId, useState, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

const DialogTitleIdContext = createContext<string | undefined>(undefined);

/** ダイアログ全体の横幅。既定は 'md'（従来どおり max-w-lg = 512px）で挙動を変えない。 */
const DIALOG_SIZE_CLASS = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** スクリーンリーダー用のラベル。DialogTitle を使わない場合に指定 */
  ariaLabel?: string;
  /** ダイアログの横幅。未指定は従来どおり 'md'（max-w-lg） */
  size?: keyof typeof DIALOG_SIZE_CLASS;
}

export function Dialog({ open, onOpenChange, children, ariaLabel, size = 'md' }: DialogProps) {
  const titleId = useId();
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
  // ポータルで body 直下に出すことで、入れ子でもビューポート基準で正しく中央表示される。
  return createPortal(
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
        className={`relative z-50 w-full ${DIALOG_SIZE_CLASS[size]} bg-surface-raised rounded-xl shadow-2xl border border-border ring-1 ring-black/5 max-h-[95vh] overflow-hidden flex flex-col modal-panel`}
      >
        <DialogTitleIdContext.Provider value={titleId}>{children}</DialogTitleIdContext.Provider>
      </div>
    </div>,
    document.body
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
  return <div className={`px-6 py-4 border-b border-border ${className}`}>{children}</div>;
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
    <div
      className={`flex items-center justify-end gap-2 px-6 py-4 border-t border-border ${className}`}
    >
      {children}
    </div>
  );
}
