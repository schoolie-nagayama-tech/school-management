'use client';

import { Modal } from '@/components/ui';
import type { ZoukomaResponse } from '@/types/forms/zoukoma';
import { GRADE_NUMBER_TO_NAME } from '@/types/forms/zoukoma';

interface ZoukomaResponseDetailModalProps {
  isOpen: boolean;
  response: ZoukomaResponse;
  onClose: () => void;
}

export function ZoukomaResponseDetailModal({
  isOpen,
  response,
  onClose,
}: ZoukomaResponseDetailModalProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const { response_data } = response;
  const subjectEntries = Object.entries(response_data.subjects).filter(([, koma]) => koma > 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="回答詳細" size="lg" minHeight="60vh">
      <div className="space-y-4">
        {/* 基本情報 */}
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
            {response.student_name}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            学年
          </label>
          <p className="text-sm text-[#4b5563]">
            {GRADE_NUMBER_TO_NAME[response.grade] ?? response.grade}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            メールアドレス
          </label>
          <p className="text-sm text-[#4b5563]">{response.email || '-'}</p>
        </div>

        <hr className="border-[#e5e7eb]" />

        {/* 申込内容 */}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-2">
            科目内訳
          </label>
          {subjectEntries.length > 0 ? (
            <div className="space-y-1">
              {subjectEntries.map(([subject, koma]) => (
                <div key={subject} className="flex items-center justify-between p-2 bg-[#f9fafb] rounded text-sm">
                  <span className="text-[#4b5563]">{subject}</span>
                  <span className="font-medium text-[#1f2937]">{koma}コマ</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#4b5563]">-</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              合計コマ数
            </label>
            <p className="text-sm text-[#4b5563]">{response_data.total_koma}コマ</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              単価
            </label>
            <p className="text-sm text-[#4b5563]">¥{response_data.unit_price.toLocaleString()}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              合計金額
            </label>
            <p className="text-sm font-semibold text-[#1f2937]">¥{response_data.total_fee.toLocaleString()}</p>
          </div>
        </div>

        {/* 希望日程 */}
        {response_data.selected_slots && response_data.selected_slots.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-2">
              希望日程
            </label>
            <div className="space-y-1">
              {response_data.selected_slots.map((slot) => (
                <div key={slot.id} className="p-2 bg-[#f9fafb] rounded text-sm text-[#4b5563]">
                  {slot.label}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 備考 */}
        {response_data.note && (
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              備考
            </label>
            <p className="text-sm text-[#4b5563] whitespace-pre-wrap">{response_data.note}</p>
          </div>
        )}

        <div className="flex justify-end pt-4 border-t border-[#e5e7eb]">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[#f3f4f6] text-[#4b5563] rounded-lg hover:bg-[#e5e7eb] transition-colors text-sm"
          >
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
}
