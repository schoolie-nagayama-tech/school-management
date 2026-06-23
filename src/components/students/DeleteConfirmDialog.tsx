'use client';

import { Button, Modal } from '@/components/ui';
import { AlertTriangle } from 'lucide-react';
import type { Student } from '@/types/database';

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  student: Student | null;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function DeleteConfirmDialog({
  isOpen,
  student,
  onConfirm,
  onCancel,
  isLoading = false,
}: DeleteConfirmDialogProps) {
  if (!student) return null;

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="生徒の削除" size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#ef4444]/20 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-[#ef4444]" />
          </div>
          <div>
            <p className="text-[#1f2937]">以下の生徒を削除してもよろしいですか？</p>
            <p className="mt-2 text-sm text-[#4b5563]">
              <span className="font-medium">
                {student.last_name} {student.first_name}
              </span>
            </p>
            <p className="mt-3 text-sm text-[#4b5563]">
              削除後もデータは保持されますが、一覧には表示されなくなります。
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e7eb]">
          <Button type="button" variant="secondary" onClick={onCancel}>
            キャンセル
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm} isLoading={isLoading}>
            削除する
          </Button>
        </div>
      </div>
    </Modal>
  );
}
