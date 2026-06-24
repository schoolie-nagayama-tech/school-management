'use client';

import type { View } from './newProgress.shared';

export function ViewSwitcher({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[#e5e7eb] bg-white overflow-hidden text-sm">
      {(['cards', 'table'] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 transition-[background-color,color] duration-150 ease-out ${
            view === v ? 'bg-[#1e3a5f] text-white' : 'text-[#4b5563] hover:bg-[#f3f4f6]'
          }`}
        >
          {v === 'cards' ? 'カード' : 'テーブル'}
        </button>
      ))}
    </div>
  );
}
