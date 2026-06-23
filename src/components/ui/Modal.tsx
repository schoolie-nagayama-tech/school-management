'use client';

import { ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  minHeight?: string;
}

const sizeStyles = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
};

export function Modal({ isOpen, onClose, title, children, size = 'md', minHeight }: ModalProps) {
  // ポータル描画はマウント後のみ（SSR/ハイドレーション不一致を避ける）
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  // document.body 直下へポータル描画する。
  // 親モーダルのパネル(.modal-panel)は transform を持つため、入れ子モーダルを
  // パネル内に描画すると fixed の基準が親パネルになり、はみ出し・見切れ・重なりが起きる。
  // ポータルで body 直下に出すことで、入れ子でもビューポート基準で正しく中央表示される。
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 modal-overlay" onClick={onClose} aria-hidden="true" />

      <div
        className={`
          relative w-full ${sizeStyles[size]}
          bg-surface-raised rounded-xl shadow-2xl border border-border ring-1 ring-black/5
          modal-panel
          max-h-[95vh] overflow-hidden flex flex-col
        `}
        style={minHeight ? { minHeight } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 id="modal-title" className="text-lg font-bold text-text-heading">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-text-faint hover:text-text-body rounded-lg hover:bg-surface-hover transition-colors duration-150"
            aria-label="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-6 flex-1 min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body
  );
}
