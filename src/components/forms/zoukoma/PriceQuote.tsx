'use client';

import type { PriceTable } from '@/types/forms/zoukoma';
import { GRADE_NAME_TO_NUMBER, GRADE_NUMBER_TO_NAME } from '@/types/forms/zoukoma';

interface PriceQuoteProps {
  selectedGrade: string | null;
  priceTable: PriceTable;
  subjectValues: Record<string, number>;
  totalKoma: number;
}

export function PriceQuote({
  selectedGrade,
  priceTable,
  subjectValues,
  totalKoma,
}: PriceQuoteProps) {
  if (!selectedGrade) {
    return (
      <div className="bg-[#eff0f3] rounded-lg border border-[#0d0d0d] p-4">
        <p className="text-sm text-[#2a2a2a] text-center">
          学年を選択すると見積金額が表示されます
        </p>
      </div>
    );
  }

  const unitPrice = priceTable[selectedGrade] || 0;
  const totalFee = totalKoma * unitPrice;

  // 科目ごとの内訳
  const subjectBreakdown = Object.entries(subjectValues)
    .filter(([, koma]) => koma > 0)
    .map(([subject, koma]) => ({
      subject,
      koma,
      fee: koma * unitPrice,
    }));

  return (
    <div className="bg-[#fffffe] rounded-lg border-2 border-[#ff8e3c] p-4">
      <h3 className="text-lg font-bold text-[#0d0d0d] mb-4">料金見積</h3>

      {/* 単価表 */}
      <div className="mb-4">
        <p className="text-sm font-medium text-[#2a2a2a] mb-2">学年別単価</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-[#eff0f3] border-b border-[#0d0d0d]">
                <th className="px-3 py-2 text-left border-r border-[#0d0d0d]">
                  学年
                </th>
                <th className="px-3 py-2 text-right">単価（1コマ）</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(priceTable).map(([grade, price]) => (
                <tr
                  key={grade}
                  className={`border-b border-[#0d0d0d]/20 ${
                    grade === selectedGrade ? 'bg-[#ff8e3c]/20' : ''
                  }`}
                >
                  <td className="px-3 py-2 border-r border-[#0d0d0d]/20">
                    {grade}
                  </td>
                  <td className="px-3 py-2 text-right">
                    ¥{price.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 見積内訳 */}
      <div className="mb-4">
        <p className="text-sm font-medium text-[#2a2a2a] mb-2">内訳</p>
        <div className="space-y-1">
          {subjectBreakdown.length > 0 ? (
            subjectBreakdown.map(({ subject, koma, fee }) => (
              <div
                key={subject}
                className="flex justify-between text-sm text-[#2a2a2a]"
              >
                <span>
                  {subject} × {koma}コマ
                </span>
                <span>¥{fee.toLocaleString()}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-[#2a2a2a]/60 text-center py-2">
              科目を選択してください
            </p>
          )}
        </div>
      </div>

      {/* 合計 */}
      <div className="pt-4 border-t-2 border-[#0d0d0d]">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-[#2a2a2a]">合計コマ数</span>
          <span className="text-lg font-bold text-[#0d0d0d]">{totalKoma}コマ</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-base font-bold text-[#0d0d0d]">概算合計金額</span>
          <span className="text-2xl font-bold text-[#0d0d0d]">
            ¥{totalFee.toLocaleString()}
          </span>
        </div>
        <p className="text-xs text-[#2a2a2a]/60 mt-2">
          ※ 正式な金額は後日ご連絡いたします
        </p>
      </div>
    </div>
  );
}
