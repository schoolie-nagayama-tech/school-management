'use client';

import { Modal } from '@/components/ui';
import type { SoudanResponse } from '@/types/forms/soudan';
import { SOUDAN_GRADE_NUMBER_TO_NAME } from '@/types/forms/soudan';

interface SoudanResponseDetailModalProps {
  isOpen: boolean;
  response: SoudanResponse;
  onClose: () => void;
}

export function SoudanResponseDetailModal({
  isOpen,
  response,
  onClose,
}: SoudanResponseDetailModalProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="回答詳細" size="md">
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
              : response.response_data.student_name || response.student_name || '-'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            学年
          </label>
          <p className="text-sm text-[#2a2a2a]">
            {response.response_data.grade
              ? SOUDAN_GRADE_NUMBER_TO_NAME[response.response_data.grade] || response.response_data.grade
              : response.grade
              ? SOUDAN_GRADE_NUMBER_TO_NAME[response.grade] || response.grade
              : '-'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            メールアドレス
          </label>
          <p className="text-sm text-[#2a2a2a]">
            {response.response_data.email || response.email || '-'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            電話番号
          </label>
          <p className="text-sm text-[#2a2a2a]">
            {response.response_data.phone || '-'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            相談区分
          </label>
          <p className="text-sm text-[#2a2a2a]">
            {response.response_data.categories?.length
              ? response.response_data.categories.join('、')
              : '未分類'}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            相談内容
          </label>
          <p className="text-sm text-[#2a2a2a] whitespace-pre-wrap">
            {response.response_data.content}
          </p>
        </div>

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
