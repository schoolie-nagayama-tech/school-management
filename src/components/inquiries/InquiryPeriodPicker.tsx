'use client';

/**
 * 問合せ管理共通の期間ピッカーコンポーネント。
 * プリセット select + カスタム期間 date input 2本 + 解決済み期間ラベルを表示する。
 * 分析ページでのみ showCompare=true を渡して「去年と比較」トグルを表示する。
 */

import {
  type PeriodPreset,
  PRESET_LABELS,
  resolvePeriod,
  formatPeriodLabel,
} from '@/lib/utils/inquiryPeriod';

export interface InquiryPeriodPickerProps {
  preset: PeriodPreset;
  customFrom: string;
  customTo: string;
  onChange: (preset: PeriodPreset, customFrom: string, customTo: string) => void;
  /** 比較トグルを表示するか（分析ページでのみ true） */
  showCompare?: boolean;
  compare?: boolean;
  onCompareChange?: (compare: boolean) => void;
}

export function InquiryPeriodPicker({
  preset,
  customFrom,
  customTo,
  onChange,
  showCompare = false,
  compare = false,
  onCompareChange,
}: InquiryPeriodPickerProps) {
  // 解決済み期間（プレビュー表示用）
  const resolved = resolvePeriod(preset, customFrom, customTo);
  const periodLabel = formatPeriodLabel(resolved);

  const handlePresetChange = (newPreset: PeriodPreset) => {
    // custom 以外に切り替えても customFrom/To の入力値は保持する（再選択しやすいように）
    onChange(newPreset, customFrom, customTo);
  };

  const handleCustomFromChange = (value: string) => {
    onChange(preset, value, customTo);
  };

  const handleCustomToChange = (value: string) => {
    onChange(preset, customFrom, value);
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      {/* プリセット選択 */}
      <div>
        <label className="block text-xs text-text-muted mb-1">期間</label>
        <select
          value={preset}
          onChange={(e) => handlePresetChange(e.target.value as PeriodPreset)}
          className="border border-border rounded-lg px-3 py-1.5 text-sm text-text-body bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {(Object.entries(PRESET_LABELS) as [PeriodPreset, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* カスタム期間入力（preset=custom のときのみ表示） */}
      {preset === 'custom' && (
        <>
          <div>
            <label className="block text-xs text-text-muted mb-1">開始日</label>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => handleCustomFromChange(e.target.value)}
              className="border border-border rounded-lg px-3 py-1.5 text-sm text-text-body bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">終了日</label>
            <input
              type="date"
              value={customTo}
              onChange={(e) => handleCustomToChange(e.target.value)}
              className="border border-border rounded-lg px-3 py-1.5 text-sm text-text-body bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </>
      )}

      {/* 解決済み期間ラベル */}
      <div className="flex items-end pb-0.5">
        <span className="text-xs text-text-muted whitespace-nowrap">{periodLabel}</span>
      </div>

      {/* 比較トグル（分析ページのみ） */}
      {showCompare && (
        <div className="flex items-end pb-0.5 ml-auto">
          <button
            type="button"
            onClick={() => onCompareChange?.(!compare)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors duration-150 ${
              compare
                ? 'bg-primary text-white border-primary'
                : 'bg-surface text-text-body border-border hover:bg-surface-hover'
            }`}
          >
            去年と比較
          </button>
        </div>
      )}
    </div>
  );
}
