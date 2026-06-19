'use client';

/**
 * 問合せ一覧の期間セレクタ（セグメント／スライド式）。
 *
 * よく使う期間プリセットを横並びのピル型で表示し、選択中はハイライトが
 * スライドして移動する。絞り込みパネルに埋もれていた期間選択を、画面上部で
 * ワンタップで切り替えられるようにするためのもの。
 *
 * 「カスタム」選択時のみ、日付入力2本を直下に表示する。
 */

import {
  type PeriodPreset,
} from '@/lib/utils/inquiryPeriod';

// 上部に出す代表的なプリセット（多すぎると幅を取るので厳選）。
const SEGMENTS: { value: PeriodPreset; label: string }[] = [
  { value: 'this_month',   label: '今月' },
  { value: 'last_month',   label: '先月' },
  { value: 'last_30_days', label: '直近30日' },
  { value: 'this_year',    label: '今年' },
  { value: 'all_time',     label: '全期間' },
  { value: 'custom',       label: 'カスタム' },
];

export interface InquiryPeriodSegmentedProps {
  preset: PeriodPreset;
  customFrom: string;
  customTo: string;
  onChange: (preset: PeriodPreset, customFrom: string, customTo: string) => void;
}

export function InquiryPeriodSegmented({
  preset,
  customFrom,
  customTo,
  onChange,
}: InquiryPeriodSegmentedProps) {
  const n = SEGMENTS.length;
  // ハイライト位置。SEGMENTS にないプリセット（this_quarter/last_year 等）は先頭扱い。
  let activeIndex = SEGMENTS.findIndex((s) => s.value === preset);
  if (activeIndex < 0) activeIndex = 0;

  return (
    <div className="inline-flex flex-col items-end gap-2">
      {/* セグメント本体。等幅カラム + 絶対配置のハイライトを translateX でスライドさせる */}
      <div
        className="relative grid rounded-lg bg-surface-hover p-1 border border-border"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        role="tablist"
        aria-label="期間"
      >
        {/* スライドするハイライト（p-1=4px 分を差し引いた等幅で移動） */}
        <span
          aria-hidden
          className="absolute top-1 bottom-1 rounded-md bg-surface-raised shadow-sm ring-1 ring-border transition-transform duration-200 ease-out"
          style={{
            left: 4,
            width: `calc((100% - 8px) / ${n})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
        {SEGMENTS.map((s) => {
          const active = s.value === preset;
          return (
            <button
              key={s.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(s.value, customFrom, customTo)}
              className={`relative z-10 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors duration-150 ${
                active ? 'text-text-heading' : 'text-text-muted hover:text-text-body'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* カスタム期間入力（preset=custom のときのみ） */}
      {preset === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => onChange('custom', e.target.value, customTo)}
            className="border border-border rounded-lg px-2.5 py-1 text-sm text-text-body bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <span className="text-xs text-text-muted">〜</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => onChange('custom', customFrom, e.target.value)}
            className="border border-border rounded-lg px-2.5 py-1 text-sm text-text-body bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      )}
    </div>
  );
}
