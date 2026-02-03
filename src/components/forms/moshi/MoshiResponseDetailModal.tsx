'use client';

import { Modal } from '@/components/ui';
import type { MoshiResponse } from '@/types/forms/moshi';
import { MOSHI_GRADE_NUMBER_TO_NAME } from '@/types/forms/moshi';

interface MoshiResponseDetailModalProps {
  isOpen: boolean;
  response: MoshiResponse;
  onClose: () => void;
}

export function MoshiResponseDetailModal({
  isOpen,
  response,
  onClose,
}: MoshiResponseDetailModalProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="回答詳細" size="md">
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
            {MOSHI_GRADE_NUMBER_TO_NAME[response.grade] || response.grade}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            メールアドレス
          </label>
          <p className="text-sm text-[#4b5563]">{response.email}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            受験方法
          </label>
          <p className="text-sm text-[#4b5563]">
            {response.response_data.exam_type === 'regular' ? '通常受験' : '振替受験'}
          </p>
        </div>

        {response.response_data.exam_type === 'regular' && (
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              通常受験
            </label>
            <p className="text-sm text-[#4b5563]">
              {response.response_data.regular_confirmed ? '参加確認済み' : '-'}
            </p>
          </div>
        )}

        {response.response_data.exam_type === 'furikae' && (
          <>
            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-1">
                振替希望日
              </label>
              <p className="text-sm text-[#4b5563]">
                {response.response_data.furikae_date_label || response.response_data.furikae_date || '-'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-1">
                振替希望時間
              </label>
              <p className="text-sm text-[#4b5563]">
                {response.response_data.furikae_time || '-'}
              </p>
            </div>
          </>
        )}

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
