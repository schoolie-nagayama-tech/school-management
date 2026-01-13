'use client';

import { Modal } from '@/components/ui';
import type { YoubiResponse } from '@/types/forms/youbi';
import { YOUBI_GRADE_NUMBER_TO_NAME } from '@/types/forms/youbi';

interface YoubiResponseDetailModalProps {
  isOpen: boolean;
  response: YoubiResponse;
  onClose: () => void;
}

export function YoubiResponseDetailModal({
  isOpen,
  response,
  onClose,
}: YoubiResponseDetailModalProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const renderSlot = (slot: typeof response.response_data.current, label: string) => (
    <div className="p-3 bg-gray-50 rounded border border-gray-200">
      <p className="text-sm font-medium text-[#0d0d0d] mb-2">{label}</p>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <span className="text-[#2a2a2a]/60">曜日:</span>
          <span className="ml-2 text-[#0d0d0d] font-medium">{slot.day}</span>
        </div>
        <div>
          <span className="text-[#2a2a2a]/60">時限:</span>
          <span className="ml-2 text-[#0d0d0d] font-medium">{slot.period_label}</span>
        </div>
        <div>
          <span className="text-[#2a2a2a]/60">科目:</span>
          <span className="ml-2 text-[#0d0d0d] font-medium">{slot.subject}</span>
        </div>
      </div>
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="回答詳細" size="lg" minHeight="80vh">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            回答日時
          </label>
          <p className="text-sm text-[#2a2a2a]">{formatDate(response.created_at)}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            生徒名
          </label>
          <p className="text-sm text-[#2a2a2a]">
            {response.linked_student
              ? `${response.linked_student.last_name} ${response.linked_student.first_name}`
              : response.student_name}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            学年
          </label>
          <p className="text-sm text-[#2a2a2a]">
            {YOUBI_GRADE_NUMBER_TO_NAME[response.grade] || response.grade}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            メールアドレス
          </label>
          <p className="text-sm text-[#2a2a2a]">{response.email}</p>
        </div>

        {/* 現状 */}
        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
            現在の通塾情報
          </label>
          {renderSlot(response.response_data.current, '現在通っている曜日・時間・科目')}
        </div>

        {/* 変更希望 */}
        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
            変更希望
          </label>
          <div className="space-y-3">
            {renderSlot(response.response_data.request1, '第1希望')}
            {renderSlot(response.response_data.request2, '第2希望')}
          </div>
        </div>

        {/* 変更希望日 */}
        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            変更希望日
          </label>
          <p className="text-sm text-[#2a2a2a]">
            {response.response_data.change_from_label || response.response_data.change_from}
          </p>
        </div>

        {/* 備考 */}
        {response.response_data.note && (
          <div>
            <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
              備考
            </label>
            <p className="text-sm text-[#2a2a2a] whitespace-pre-wrap">
              {response.response_data.note}
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            対応状況
          </label>
          <p className="text-sm text-[#2a2a2a]">
            {response.status_checks?.handled ? '対応済み' : '未対応'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            紐付け状態
          </label>
          <p className="text-sm text-[#2a2a2a]">
            {response.linked_student_id ? '紐付け済み' : '未紐付け'}
          </p>
        </div>
      </div>
    </Modal>
  );
}
