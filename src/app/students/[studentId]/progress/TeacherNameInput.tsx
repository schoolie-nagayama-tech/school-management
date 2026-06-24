'use client';

import { useEffect, useState } from 'react';

/**
 * 講師名入力: 空欄時に「自分を入れる」チップで即補完。
 */
export function TeacherNameInput({
  value,
  selfName,
  onSave,
}: {
  value: string;
  selfName: string;
  onSave: (v: string | null) => void;
}) {
  const [localVal, setLocalVal] = useState(value);
  useEffect(() => setLocalVal(value), [value]);
  const isEmpty = !localVal;
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={(e) => {
          const v = e.target.value || null;
          if ((v ?? '') !== (value ?? '')) onSave(v);
        }}
        placeholder="講師"
        onClick={(e) => e.stopPropagation()}
        className="flex-1 min-w-0 px-1.5 py-1 text-xs bg-transparent border border-transparent hover:border-[#e5e7eb] focus:border-[#1e3a5f] focus:bg-white rounded outline-none"
      />
      {isEmpty && selfName && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setLocalVal(selfName);
            onSave(selfName);
          }}
          className="px-1.5 py-0.5 text-[11px] bg-[#eff6ff] text-[#1e40af] border border-[#dbeafe] rounded hover:bg-[#dbeafe] whitespace-nowrap"
          title={`${selfName}（自分）を入力`}
        >
          自分
        </button>
      )}
    </div>
  );
}
