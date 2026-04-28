'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // アニメーションのために少し遅延
    const showTimer = setTimeout(() => setIsVisible(true), 10);

    const duration = toast.duration || 3000;
    const hideTimer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => onRemove(toast.id), 200); // exit は 200ms で素早く
    }, duration);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [toast.id, toast.duration, onRemove]);

  const typeStyles = {
    success: 'bg-[#2e7d32] text-white border-[#1b5e20]',
    error: 'bg-[#c62828] text-white border-[#b71c1c]',
    info: 'bg-[#1976d2] text-white border-[#1565c0]',
    warning: 'bg-[#f9a825] text-[#1a1a1a] border-[#f57f17]',
  };

  const IconComponent = {
    success: CheckCircle,
    error: XCircle,
    info: Info,
    warning: AlertTriangle,
  }[toast.type];

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg
        transition-[transform,opacity] duration-300 ease-out
        ${typeStyles[toast.type]}
        ${isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full'}
      `}
    >
      <div className="flex-shrink-0">
        <IconComponent className="w-5 h-5" />
      </div>
      <div className="flex-1 text-sm font-medium">{toast.message}</div>
      <button
        onClick={() => {
          setIsVisible(false);
          setTimeout(() => onRemove(toast.id), 200);
        }}
        className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity duration-150"
        aria-label="閉じる"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// Toast管理用のフック（グローバルコンテキストとして使用する場合）
let toastIdCounter = 0;
export function generateToastId(): string {
  return `toast-${Date.now()}-${++toastIdCounter}`;
}
