'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { EXTRA_KIND_BADGE } from './scheduleBadges';

/**
 * 座席表の凡例。バッジ・色の意味をまとめて表示する（折りたたみ式・印刷時は非表示）。
 * 種別バッジ色は scheduleBadges.ts の単一ソースを参照（StudentCard と一致）。
 */
export function ScheduleLegend() {
  const [open, setOpen] = useState(false);

  return (
    <div className="print:hidden text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[var(--paragraph)] hover:text-[var(--headline)]"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        凡例
      </button>
      {open && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 rounded-lg border border-[var(--stroke)] bg-white">
          {/* 出欠（座席カードの背景色） */}
          <span className="text-[var(--paragraph)] font-medium">出欠:</span>
          <LegendSwatch className="bg-green-50 border-green-200 text-green-800" label="出席" />
          <LegendSwatch className="bg-red-50 border-red-200 text-red-800" label="欠席" />
          <LegendSwatch className="bg-yellow-50 border-yellow-200 text-yellow-800" label="遅刻" />

          <span className="w-px h-4 bg-[var(--stroke)]" />

          {/* 種別バッジ */}
          <span className="text-[var(--paragraph)] font-medium">種別:</span>
          <LegendBadge
            className={EXTRA_KIND_BADGE.test_prep}
            label="テスト対策"
            desc="増コマ申込の落とし込み"
          />
          <LegendBadge className={EXTRA_KIND_BADGE.additional} label="追加授業" desc="単発追加" />
          <LegendBadge className={EXTRA_KIND_BADGE.trial} label="体験" desc="体験授業" />
          <LegendBadge
            className="bg-info text-white"
            label="仮"
            desc="自動マッチング下書き（未公開）"
          />

          <span className="w-px h-4 bg-[var(--stroke)]" />

          {/* その他の表示 */}
          <span className="inline-flex items-center gap-1">
            <span className="text-blue-500 font-medium">振替</span>
            <span className="text-[var(--paragraph)]">振替で入ったコマ</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="line-through text-gray-400">取消線</span>
            <span className="text-[var(--paragraph)]">振替元（移動済み）</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="text-red-600 font-medium">赤斜線</span>
            <span className="text-[var(--paragraph)]">講師の欠勤コマ</span>
          </span>
        </div>
      )}
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`w-4 h-4 rounded border ${className}`} />
      <span className="text-[var(--paragraph)]">{label}</span>
    </span>
  );
}

function LegendBadge({
  className,
  label,
  desc,
}: {
  className: string;
  label: string;
  desc: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`px-1 py-0.5 rounded text-[9px] font-bold leading-none ${className}`}>
        {label}
      </span>
      <span className="text-[var(--paragraph)]">{desc}</span>
    </span>
  );
}
