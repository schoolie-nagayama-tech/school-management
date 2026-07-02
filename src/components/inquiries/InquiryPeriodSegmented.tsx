'use client';

/**
 * 問合せ一覧の期間セレクタ（2段階）。
 *
 * 1段目: スパンのスライド式スライダー（月 / 3か月 / 半年 / 1年 / 全期間 / カスタム）。
 * 2段目: 選んだスパンの中で「いつの分」を選ぶプルダウン（今月/先月… 今年/去年… 等）。
 *        カスタムのときは日付入力2本、全期間のときは2段目なし。
 */

import {
  type PeriodSpan,
  SPAN_LABELS,
  spanWindowOptions,
  resolveSpanPeriod,
  monthToOffset,
} from '@/lib/utils/inquiryPeriod';

// スライダーに並べるスパンの順番。
const SPANS: PeriodSpan[] = ['month', 'quarter', 'half', 'year', 'all', 'custom'];

export interface InquiryPeriodSegmentedProps {
  span: PeriodSpan;
  offset: number;
  customFrom: string;
  customTo: string;
  onChange: (span: PeriodSpan, offset: number, customFrom: string, customTo: string) => void;
}

export function InquiryPeriodSegmented({
  span,
  offset,
  customFrom,
  customTo,
  onChange,
}: InquiryPeriodSegmentedProps) {
  const n = SPANS.length;
  const activeIndex = Math.max(0, SPANS.indexOf(span));
  // 2段目の候補（month/quarter/half/year のみ。all/custom は空）
  const windows = spanWindowOptions(span);

  return (
    <div className="inline-flex flex-col items-end gap-2">
      {/* 1段目: スパンのスライダー */}
      <div
        className="relative grid rounded-lg bg-surface-hover p-1 border border-border"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        role="tablist"
        aria-label="期間スパン"
      >
        {/* スライドするハイライト */}
        <span
          aria-hidden
          className="absolute top-1 bottom-1 rounded-md bg-surface-raised shadow-sm ring-1 ring-border transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
          style={{
            left: 4,
            width: `calc((100% - 8px) / ${n})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
        {SPANS.map((s) => {
          const active = s === span;
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={active}
              // スパンを変えたら offset は 0(直近) に戻す
              onClick={() => onChange(s, 0, customFrom, customTo)}
              className={`relative z-10 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors duration-150 active:scale-[0.97] ${
                active ? 'text-text-heading' : 'text-text-muted hover:text-text-body'
              }`}
            >
              {SPAN_LABELS[s]}
            </button>
          );
        })}
      </div>

      {/* 2段目（月）: 年＋月ドロップダウン。年を変えるだけで前年同月・一昨年同月へ飛べる */}
      {span === 'month' && <MonthYearSelect offset={offset} onChange={onChange} />}

      {/* 2段目（3か月/半年/1年）: いつの分のプルダウン */}
      {span !== 'month' && windows.length > 0 && (
        <select
          value={offset}
          onChange={(e) => onChange(span, Number(e.target.value), customFrom, customTo)}
          className="border border-border rounded-lg px-2.5 py-1 text-sm text-text-body bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/30"
          aria-label="表示する期間"
        >
          {windows.map((w) => (
            <option key={w.offset} value={w.offset}>
              {w.label}
            </option>
          ))}
        </select>
      )}

      {/* カスタム期間入力 */}
      {span === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => onChange('custom', 0, e.target.value, customTo)}
            className="border border-border rounded-lg px-2.5 py-1 text-sm text-text-body bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <span className="text-xs text-text-muted">〜</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => onChange('custom', 0, customFrom, e.target.value)}
            className="border border-border rounded-lg px-2.5 py-1 text-sm text-text-body bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      )}
    </div>
  );
}

/**
 * 「月」スパンの2段目。年＋月のプルダウンで任意の年月を直接選べる。
 * 年を1つ戻すだけで前年同月、2つ戻せば一昨年同月になる。
 */
function MonthYearSelect({
  offset,
  onChange,
}: {
  offset: number;
  onChange: InquiryPeriodSegmentedProps['onChange'];
}) {
  const [selY, selM] = resolveSpanPeriod('month', offset).dateFrom.split('-').map(Number);
  const curY = Number(resolveSpanPeriod('month', 0).dateFrom.slice(0, 4));

  // 今年から10年分。選択年がそれより古い/未来なら候補に足す。
  const years: number[] = [];
  for (let y = curY; y >= curY - 9; y--) years.push(y);
  if (!years.includes(selY)) years.unshift(selY);

  const cls =
    'border border-border rounded-lg px-2 py-1 text-sm text-text-body bg-surface-raised focus:outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={selY}
        aria-label="年"
        className={cls}
        onChange={(e) => onChange('month', monthToOffset(Number(e.target.value), selM), '', '')}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}年
          </option>
        ))}
      </select>
      <select
        value={selM}
        aria-label="月"
        className={cls}
        onChange={(e) => onChange('month', monthToOffset(selY, Number(e.target.value)), '', '')}
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
          <option key={m} value={m}>
            {m}月
          </option>
        ))}
      </select>
    </div>
  );
}
