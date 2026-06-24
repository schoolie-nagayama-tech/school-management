'use client';

import type { ViewMode } from './newProgress.shared';

// ─────────────────────────────────────────────
// スイッチャー
// ─────────────────────────────────────────────
export function ModeSwitcher({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[#e5e7eb] bg-white overflow-hidden text-sm">
      {(['admin', 'meeting'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-2.5 py-1.5 transition-[background-color,color] duration-150 ease-out ${
            mode === m ? 'bg-[#1e3a5f] text-white' : 'text-[#4b5563] hover:bg-[#f3f4f6]'
          }`}
        >
          {m === 'admin' ? '管理' : '面談用'}
        </button>
      ))}
    </div>
  );
}
