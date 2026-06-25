'use client';

import { useState } from 'react';
import { INTENT_TAG_COLOR, INTENT_TAGS, type IntentTag } from './newProgress.shared';

/**
 * 指導意図ピッカー (管理モード用)
 * グループ先頭行に表示。クリックで 6 種のプリセットから選択。
 */
export function IntentTagPicker({
  currentTag,
  onChange,
}: {
  currentTag: IntentTag | null;
  onChange: (tag: IntentTag | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      {currentTag ? (
        <button
          onClick={() => setOpen(!open)}
          className={`inline-block px-1.5 py-0 border rounded-full text-[11px] bg-white hover:shadow-sm transition-shadow ${INTENT_TAG_COLOR[currentTag]}`}
        >
          {currentTag}
        </button>
      ) : (
        <button
          onClick={() => setOpen(!open)}
          className="inline-block px-1.5 py-0 border border-dashed border-[#d1d5db] rounded-full text-[11px] text-[#9ca3af] hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
        >
          ＋指導意図
        </button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 w-44 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-20 overflow-hidden origin-top-left animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
            <div className="px-3 py-1.5 text-[11px] text-[#6b7280] uppercase tracking-wider border-b border-[#f3f4f6]">
              指導意図を選ぶ
            </div>
            {INTENT_TAGS.map((t) => (
              <button
                key={t}
                onClick={() => {
                  onChange(t);
                  setOpen(false);
                }}
                className={`w-full px-3 py-1.5 text-left text-xs hover:bg-[#f9fafb] transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] ${currentTag === t ? 'bg-[#eff6ff] font-semibold' : ''}`}
              >
                {t}
              </button>
            ))}
            {currentTag && (
              <button
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left text-[11px] text-[#6b7280] hover:bg-red-50 border-t border-[#f3f4f6] transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
              >
                指導意図を外す
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
