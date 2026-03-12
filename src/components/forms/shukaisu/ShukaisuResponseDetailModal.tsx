'use client';

import { Modal } from '@/components/ui';
import type { ShukaisuResponse } from '@/types/forms/shukaisu';
import { SHUKAISU_GRADE_NUMBER_TO_NAME } from '@/types/forms/shukaisu';

interface ShukaisuResponseDetailModalProps {
  isOpen: boolean;
  response: ShukaisuResponse;
  onClose: () => void;
}

export function ShukaisuResponseDetailModal({
  isOpen,
  response,
  onClose,
}: ShukaisuResponseDetailModalProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const renderSlots = (slots: typeof response.response_data.current.slots) => {
    if (slots.length === 0) return <p className="text-sm text-[#4b5563]">-</p>;
    return (
      <div className="space-y-2">
        {slots.map((slot, index) => (
          <div key={index} className="p-2 bg-gray-50 rounded text-sm">
            <div className="flex items-center gap-2 text-[#4b5563]">
              <span>{index + 1}コマ目: {slot.day} {slot.period_label} {slot.subject}</span>
              {slot.duration_minutes === 45 && (
                <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded font-medium shrink-0">
                  45分
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="回答詳細" size="lg" minHeight="80vh">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            回答日時
          </label>
          <p className="text-sm text-[#4b5563]">{formatDate(response.created_at)}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            生徒名
          </label>
          <p className="text-sm text-[#4b5563]">
            {response.linked_student
              ? `${response.linked_student.last_name} ${response.linked_student.first_name}`
              : response.student_name}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            学年
          </label>
          <p className="text-sm text-[#4b5563]">
            {SHUKAISU_GRADE_NUMBER_TO_NAME[response.grade] || response.grade}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            メールアドレス
          </label>
          <p className="text-sm text-[#4b5563]">{response.email}</p>
        </div>

        {/* 現状 */}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-2">
            現在の通塾状況
          </label>
          <div className="mb-2">
            <span className="text-sm text-[#4b5563]">
              週回数: {response.response_data.current.weekly_count}回
            </span>
          </div>
          {renderSlots(response.response_data.current.slots)}
        </div>

        {/* 変更希望 */}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-2">
            変更希望
          </label>
          <div className="mb-2">
            <span className="text-sm text-[#4b5563]">
              週回数: {response.response_data.requested.weekly_count}回
            </span>
          </div>
          {renderSlots(response.response_data.requested.slots)}
        </div>

        {/* 変更希望日 */}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            変更希望日
          </label>
          <p className="text-sm text-[#4b5563]">
            {response.response_data.change_from_label || response.response_data.change_from}
          </p>
        </div>

        {/* 備考 */}
        {response.response_data.note && (
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              備考
            </label>
            <p className="text-sm text-[#4b5563] whitespace-pre-wrap">
              {response.response_data.note}
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            対応状況
          </label>
          <p className="text-sm text-[#4b5563]">
            {(response.status_checks as Record<string, boolean> | null)?.handled ? '対応済み' : '未対応'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            紐付け状態
          </label>
          <p className="text-sm text-[#4b5563]">
            {response.linked_student_id ? '紐付け済み' : '未紐付け'}
          </p>
        </div>
      </div>
    </Modal>
  );
}
