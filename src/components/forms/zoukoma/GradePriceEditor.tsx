'use client';

import { Input, Button } from '@/components/ui';
import type { PriceTable } from '@/types/forms/zoukoma';

interface GradePriceEditorProps {
  selectedGrades: string[];
  priceTable: PriceTable;
  onGradesChange: (grades: string[]) => void;
  onPriceTableChange: (priceTable: PriceTable) => void;
  disabled?: boolean;
}

const ALL_GRADES = ['中1', '中2', '中3', '高1', '高2', '高3'];
const DEFAULT_PRICES: PriceTable = {
  中1: 3980,
  中2: 3980,
  中3: 4120,
  高1: 4480,
  高2: 4770,
  高3: 5060,
};

export function GradePriceEditor({
  selectedGrades,
  priceTable,
  onGradesChange,
  onPriceTableChange,
  disabled = false,
}: GradePriceEditorProps) {
  const handleGradeToggle = (grade: string) => {
    if (disabled) return;
    const newGrades = selectedGrades.includes(grade)
      ? selectedGrades.filter((g) => g !== grade)
      : [...selectedGrades, grade];
    onGradesChange(newGrades);
  };

  const handlePriceChange = (grade: string, value: string) => {
    if (disabled) return;
    const numValue = parseInt(value, 10);
    if (isNaN(numValue) || numValue < 0) {
      return;
    }
    onPriceTableChange({
      ...priceTable,
      [grade]: numValue,
    });
  };

  const handleSetDefaults = () => {
    if (disabled) return;
    const newPriceTable: PriceTable = {};
    selectedGrades.forEach((grade) => {
      newPriceTable[grade] = DEFAULT_PRICES[grade] || 0;
    });
    onPriceTableChange(newPriceTable);
  };

  return (
    <div className="space-y-4">
      {/* 対象学年 */}
      <div>
        <label className="block text-sm font-medium text-[#1f2937] mb-3">
          対象学年
        </label>
        <div className="flex flex-wrap gap-3">
          {ALL_GRADES.map((grade) => (
            <label
              key={grade}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedGrades.includes(grade)}
                onChange={() => handleGradeToggle(grade)}
                disabled={disabled}
                className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
              />
              <span className="text-sm text-[#1f2937]">{grade}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 学年別単価 */}
      {selectedGrades.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="block text-sm font-medium text-[#1f2937]">
              学年別単価（税込）
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleSetDefaults}
              disabled={disabled}
            >
              デフォルト値を設定
            </Button>
          </div>
          <div className="border border-[#e5e7eb] rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                  <th className="px-4 py-2 text-left text-sm font-semibold text-[#1f2937]">
                    学年
                  </th>
                  <th className="px-4 py-2 text-left text-sm font-semibold text-[#1f2937]">
                    単価（税込）
                  </th>
                </tr>
              </thead>
              <tbody>
                {selectedGrades.map((grade) => (
                  <tr
                    key={grade}
                    className="border-b border-[#e5e7eb]/20 last:border-b-0"
                  >
                    <td className="px-4 py-2 text-sm text-[#1f2937] font-medium">
                      {grade}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-[#4b5563]">¥</span>
                        <Input
                          type="number"
                          min="0"
                          value={priceTable[grade] || 0}
                          onChange={(e) =>
                            handlePriceChange(grade, e.target.value)
                          }
                          disabled={disabled}
                          className="w-32"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
