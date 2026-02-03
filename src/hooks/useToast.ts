'use client';

import { useState, useCallback } from 'react';
import type { Toast, ToastType } from '@/components/ui/Toast';
import { generateToastId } from '@/components/ui/Toast';

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info', duration?: number) => {
    const id = generateToastId();
    const newToast: Toast = { id, message, type, duration };
    setToasts((prev) => [...prev, newToast]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const success = useCallback((message: string, duration?: number) => {
    return addToast(message, 'success', duration);
  }, [addToast]);

  const error = useCallback((message: string, duration?: number) => {
    return addToast(message, 'error', duration);
  }, [addToast]);

  const info = useCallback((message: string, duration?: number) => {
    return addToast(message, 'info', duration);
  }, [addToast]);

  const warning = useCallback((message: string, duration?: number) => {
    return addToast(message, 'warning', duration);
  }, [addToast]);

  return {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    info,
    warning,
  };
}
