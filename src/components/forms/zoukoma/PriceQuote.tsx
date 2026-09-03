'use client';

import type { PriceTable } from '@/types/forms/zoukoma';

interface PriceQuoteProps {
  selectedGrade: string | null;
  priceTable: PriceTable;
  subjectValues: Record<string, number>;
  totalKoma: number;
}

/**
 * 料金の見積表示。
 *
 * 以前は青2pxの枠で囲んだカードだったが、白カード（PortalFormSection）の中に
 * さらに枠が入って圧迫感の原因になっていたため、薄いグレー地の面で区切るだけにしている。
 */
export function PriceQuote({
  selectedGrade,
  priceTable,
  subjectValues,
  totalKoma,
}: PriceQuoteProps) {
  if (!selectedGrade) {
    return (
      <div className="bg-[#f9fafb] rounded-lg p-3">
        <p className="text-xs text-[#6b7280] text-center">学年を選択すると料金が表示されます</p>
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
    <div className="bg-[#f9fafb] rounded-lg p-3.5">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-[13px] font-bold text-[#1f2937]">料金</h3>
        <p className="text-[11px] text-[#6b7280]">
          {selectedGrade} 1コマ {unitPrice.toLocaleString()}円
        </p>
      </div>

      {/* 見積内訳 */}
      <div className="space-y-1">
        {subjectBreakdown.length > 0 ? (
          subjectBreakdown.map(({ subject, koma, fee }) => (
            <div key={subject} className="flex justify-between text-xs text-[#4b5563]">
              <span>
                {subject} × {koma}コマ
              </span>
              <span className="tabular-nums">¥{fee.toLocaleString()}</span>
            </div>
          ))
        ) : (
          <p className="text-xs text-[#9ca3af] text-center py-1">コマ数を入力すると内訳が出ます</p>
        )}
      </div>

      {/* 合計 */}
      <div className="mt-2.5 pt-2.5 border-t border-[#e5e7eb] flex items-baseline justify-between">
        <span className="text-xs text-[#4b5563]">
          合計 <span className="font-semibold text-[#1f2937]">{totalKoma}コマ</span>
        </span>
        <span className="text-xl font-bold text-[#1f2937] tabular-nums">
          ¥{totalFee.toLocaleString()}
        </span>
      </div>
      <p className="text-[11px] text-[#6b7280] mt-1.5">
        料金は次回お月謝と合わせてお引き落としとなります。
      </p>
    </div>
  );
}
