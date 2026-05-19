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

        {/* 出席できない日程（unavailable_slots がある場合） */}
        {response_data.unavailable_slots && response_data.unavailable_slots.length > 0 && (() => {
          const allSlots = [...response_data.selected_slots, ...response_data.unavailable_slots];
          const unavailableSet = new Set(response_data.unavailable_slots.map(s => s.id));
          const dateKeys = Array.from(new Set(allSlots.map(s => s.id.split('_')[0]))).sort();
          const periodKeys = Array.from(new Set(allSlots.map(s => s.id.split('_')[1])))
            .sort((a, b) => parseInt(a) - parseInt(b));

          const dateLabel: Record<string, string> = {};
          const periodInfo: Record<string, { period: string; timeRange?: string }> = {};
          allSlots.forEach(slot => {
            const [dk, pk] = slot.id.split('_');
            const parts = slot.label.split(' ');
            if (!dateLabel[dk]) dateLabel[dk] = parts[0] ?? dk;
            if (!periodInfo[pk]) {
              periodInfo[pk] = { period: parts[1] ?? `${pk}限`, timeRange: parts[2] };
            }
          });

          return (
            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                日程（出席不可: {response_data.unavailable_slots.length}件 / 出席可: {response_data.selected_slots.length}件）
              </label>
              <div className="overflow-x-auto">
                <table className="border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#f3f4f6]">
                      <th className="border border-[#e5e7eb] px-3 py-2 text-left font-medium text-[#4b5563]">日付</th>
                      {periodKeys.map(pk => (
                        <th key={pk} className="border border-[#e5e7eb] px-3 py-2 text-center font-medium text-[#4b5563]">
                          <div>{periodInfo[pk]?.period}</div>
                          {periodInfo[pk]?.timeRange && (
                            <div className="font-normal text-xs text-[#6b7280]">{periodInfo[pk].timeRange}</div>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dateKeys.map((dk, i) => (
                      <tr key={dk} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f9fafb]'}>
                        <td className="border border-[#e5e7eb] px-3 py-2 text-[#4b5563] whitespace-nowrap">{dateLabel[dk]}</td>
                        {periodKeys.map(pk => {
                          const slotId = `${dk}_${pk}`;
                          const isUnavailable = unavailableSet.has(slotId);
                          const exists = allSlots.some(s => s.id === slotId);
                          return (
                            <td key={pk} className={`border border-[#e5e7eb] px-3 py-2 text-center ${isUnavailable ? 'bg-[#fef2f2]' : ''}`}>
                              {!exists ? (
                                <span className="text-[#d1d5db]">—</span>
                              ) : isUnavailable ? (
                                <span className="text-[#ef4444] font-bold">✗</span>
                              ) : (
                                <span className="text-[#059669] font-bold">✓</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* 希望日程（従来形式: unavailable_slots がない場合） */}
        {(!response_data.unavailable_slots || response_data.unavailable_slots.length === 0) &&
          response_data.selected_slots && response_data.selected_slots.length > 0 && (() => {
          const slotSet = new Set(response_data.selected_slots.map(s => s.id));
          const dateKeys = Array.from(new Set(response_data.selected_slots.map(s => s.id.split('_')[0]))).sort();
          const periodKeys = Array.from(new Set(response_data.selected_slots.map(s => s.id.split('_')[1])))
            .sort((a, b) => parseInt(a) - parseInt(b));

          const dateLabel: Record<string, string> = {};
          const periodInfo: Record<string, { period: string; timeRange?: string }> = {};
          response_data.selected_slots.forEach(slot => {
            const [dk, pk] = slot.id.split('_');
            const parts = slot.label.split(' ');
            if (!dateLabel[dk]) dateLabel[dk] = parts[0] ?? dk;
            if (!periodInfo[pk]) {
              periodInfo[pk] = { period: parts[1] ?? `${pk}限`, timeRange: parts[2] };
            }
          });

          return (
            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                希望日程（{response_data.selected_slots.length}件）
              </label>
              <div className="overflow-x-auto">
                <table className="border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#f3f4f6]">
                      <th className="border border-[#e5e7eb] px-3 py-2 text-left font-medium text-[#4b5563]">日付</th>
                      {periodKeys.map(pk => (
                        <th key={pk} className="border border-[#e5e7eb] px-3 py-2 text-center font-medium text-[#4b5563]">
                          <div>{periodInfo[pk]?.period}</div>
                          {periodInfo[pk]?.timeRange && (
                            <div className="font-normal text-xs text-[#6b7280]">{periodInfo[pk].timeRange}</div>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dateKeys.map((dk, i) => (
                      <tr key={dk} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f9fafb]'}>
                        <td className="border border-[#e5e7eb] px-3 py-2 text-[#4b5563] whitespace-nowrap">{dateLabel[dk]}</td>
                        {periodKeys.map(pk => (
                          <td key={pk} className="border border-[#e5e7eb] px-3 py-2 text-center">
                            {slotSet.has(`${dk}_${pk}`) ? (
                              <span className="text-[#059669] font-bold">✓</span>
                            ) : (
                              <span className="text-[#d1d5db]">—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

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
            className="px-4 py-2 bg-[#f3f4f6] text-[#4b5563] rounded-lg hover:bg-[#e5e7eb] transition-colors duration-150 text-sm"
          >
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
}
