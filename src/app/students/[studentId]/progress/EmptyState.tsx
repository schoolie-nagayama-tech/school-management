'use client';

// ─────────────────────────────────────────────
// 空状態
// ─────────────────────────────────────────────
export function EmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="bg-white border border-dashed border-[#e5e7eb] rounded-xl p-12 text-center">
      <p className="text-sm text-[#6b7280] mb-4 animate-[stagger-fade-in_240ms_var(--ease-out)_forwards]">
        登録されているテキストがありません。
      </p>
      {onAdd && (
        <button
          onClick={onAdd}
          className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm hover:bg-[#2a4d7a] transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
        >
          + テキストを追加
        </button>
      )}
    </div>
  );
}
