'use client';

import { Modal, Button } from '@/components/ui';
import type { MogiResponse } from '@/types/forms/mogi';
import { GRADE_NUMBER_TO_NAME } from '@/types/forms/mogi';

interface MogiResponseDetailModalProps {
  isOpen: boolean;
  response: MogiResponse | null;
  onClose: () => void;
}

export function MogiResponseDetailModal({
  isOpen,
  response,
  onClose,
}: MogiResponseDetailModalProps) {
  if (!response) return null;

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="回答詳細"
      size="lg"
    >
      <div className="space-y-6">
        {/* 基本情報 */}
        <div className="bg-[#eff0f3] rounded-lg border border-[#0d0d0d] p-4">
          <h3 className="font-semibold text-[#0d0d0d] mb-3">基本情報</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-[#2a2a2a]/60">回答日時:</span>
              <span className="ml-2 text-[#0d0d0d] font-medium">
                {formatDateTime(response.created_at)}
              </span>
            </div>
            <div>
              <span className="text-[#2a2a2a]/60">生徒名:</span>
              <span className="ml-2 text-[#0d0d0d] font-medium">
                {response.linked_student
                  ? `${response.linked_student.last_name} ${response.linked_student.first_name}`
                  : response.student_name}
              </span>
            </div>
            <div>
              <span className="text-[#2a2a2a]/60">学年:</span>
              <span className="ml-2 text-[#0d0d0d] font-medium">
                {GRADE_NUMBER_TO_NAME[response.grade] || response.grade}
              </span>
            </div>
            <div>
              <span className="text-[#2a2a2a]/60">メールアドレス:</span>
              <span className="ml-2 text-[#0d0d0d] font-medium">
                {response.email}
              </span>
            </div>
            <div>
              <span className="text-[#2a2a2a]/60">計上状態:</span>
              <span className="ml-2 text-[#0d0d0d] font-medium">
                {response.status_checks?.charged ? '計上済み' : '未計上'}
              </span>
            </div>
            <div>
              <span className="text-[#2a2a2a]/60">紐付け状態:</span>
              <span className="ml-2 text-[#0d0d0d] font-medium">
                {response.linked_student_id ? '紐付け済み' : '未紐付け'}
              </span>
            </div>
          </div>
        </div>

        {/* 選択した日程・会場 */}
        <div>
          <h3 className="font-semibold text-[#0d0d0d] mb-3">選択した日程・会場</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-[#0d0d0d] text-sm">
              <thead>
                <tr className="bg-[#eff0f3]">
                  <th className="border border-[#0d0d0d] px-4 py-2 text-left">日程</th>
                  <th className="border border-[#0d0d0d] px-4 py-2 text-left">会場</th>
                </tr>
              </thead>
              <tbody>
                {response.response_data.selections.map((selection, index) => (
                  <tr key={index} className="hover:bg-[#eff0f3]">
                    <td className="border border-[#0d0d0d] px-4 py-2">
                      {selection.date_label}
                    </td>
                    <td className="border border-[#0d0d0d] px-4 py-2">
                      {selection.venue_label}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 備考 */}
        {response.response_data.note && (
          <div>
            <h3 className="font-semibold text-[#0d0d0d] mb-2">備考</h3>
            <div className="bg-[#eff0f3] rounded-lg border border-[#0d0d0d] p-4">
              <p className="text-sm text-[#2a2a2a] whitespace-pre-line">
                {response.response_data.note}
              </p>
            </div>
          </div>
        )}

        {/* ボタン */}
        <div className="flex justify-end pt-4 border-t border-[#0d0d0d]">
          <Button onClick={onClose} variant="secondary">
            閉じる
          </Button>
        </div>
      </div>
    </Modal>
  );
}
