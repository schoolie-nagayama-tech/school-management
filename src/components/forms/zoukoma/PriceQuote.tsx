'use client';

import type { PriceTable } from '@/types/forms/zoukoma';

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
      <div className="bg-[#f3f4f6] rounded-lg border border-[#e5e7eb] p-4">
        <p className="text-sm text-[#4b5563] text-center">学年を選択すると料金が表示されます</p>
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
    <div className="bg-white rounded-lg border-2 border-[#3b82f6] p-4">
      <h3 className="text-lg font-bold text-[#1f2937] mb-4">料金</h3>

      {/* 該当学年の単価のみ表示 */}
      <div className="mb-4">
        <p className="text-sm font-medium text-[#4b5563] mb-2">{selectedGrade} 単価（1コマ）</p>
        <p className="text-lg font-semibold text-[#1f2937]">
          ¥{(priceTable[selectedGrade] ?? 0).toLocaleString()}
        </p>
      </div>

      {/* 見積内訳 */}
      <div className="mb-4">
        <p className="text-sm font-medium text-[#4b5563] mb-2">内訳</p>
        <div className="space-y-1">
          {subjectBreakdown.length > 0 ? (
            subjectBreakdown.map(({ subject, koma, fee }) => (
              <div key={subject} className="flex justify-between text-sm text-[#4b5563]">
                <span>
                  {subject} × {koma}コマ
                </span>
                <span>¥{fee.toLocaleString()}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-[#4b5563]/60 text-center py-2">科目を選択してください</p>
          )}
        </div>
      </div>

      {/* 合計 */}
      <div className="pt-4 border-t-2 border-[#e5e7eb]">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-[#4b5563]">合計コマ数</span>
          <span className="text-lg font-bold text-[#1f2937]">{totalKoma}コマ</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-base font-bold text-[#1f2937]">合計金額</span>
          <span className="text-2xl font-bold text-[#1f2937]">¥{totalFee.toLocaleString()}</span>
        </div>
        <p className="text-xs text-[#4b5563] mt-2">
          料金は次回お月謝と合わせてお引き落としとなります。
        </p>
      </div>
    </div>
  );
}
