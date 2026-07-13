'use client';

import { useEffect, useRef, useState } from 'react';
import { todayIso } from './newProgress.shared';

/**
 * 日付セル入力: クリックで編集モードに入る。
 * 空欄時は「今日」クイックボタン表示。値があるときはクリックで再編集可能。
 * onSave は YYYY-MM-DD 形式または null で呼ばれる。
 */
export function DateInputWithToday({
  value,
  onSave,
  disabled = false,
}: {
  value: string;
  onSave: (v: string | null) => void;
  disabled?: boolean;
}) {
  const [localVal, setLocalVal] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setLocalVal(value), [value]);

  const isEmpty = !localVal;

  if (disabled) {
    return <span className="px-1.5 py-1 text-xs text-[#d1d5db]">—</span>;
  }

  const commit = (v: string) => {
    const next = v || null;
    if ((next ?? '') !== (value ?? '')) onSave(next);
    setEditing(false);
  };

  // 値があって非編集中: テキスト表示 + クリアボタン
  if (!isEmpty && !editing) {
    return (
      <div className="flex items-center gap-0.5 group">
        {/* 入力済みの日付は色付きチップで強調。スクロールしても「どこまで進んだか」が
            一目で分かる（色が付いている行＝実施済み）。 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
            setTimeout(() => inputRef.current?.showPicker?.(), 50);
          }}
          className="px-2.5 py-1 text-sm font-bold text-[#1e40af] bg-[#dbeafe] border border-[#bfdbfe] hover:bg-[#bfdbfe] active:scale-[0.97] rounded transition-[background-color,transform] duration-150 ease-out cursor-pointer whitespace-nowrap"
          title="クリックで日付を変更"
        >
          {localVal.replace(/^\d{4}-/, '').replace('-', '/')}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setLocalVal('');
            onSave(null);
          }}
          className="px-1 py-0.5 text-[11px] text-[#9ca3af] hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          title="日付をクリア"
        >
          ×
        </button>
      </div>
    );
  }

  // 空欄 or 編集モード: input + ボタン
  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="date"
        value={localVal}
        autoFocus={editing}
        onChange={(e) => {
          setLocalVal(e.target.value);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
        onClick={(e) => e.stopPropagation()}
        className="flex-1 min-w-0 px-1.5 py-1 text-xs border border-[#1e3a5f] bg-white rounded outline-none"
      />
      {isEmpty && !editing && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            const t = todayIso();
            setLocalVal(t);
            onSave(t);
          }}
          className="px-1.5 py-0.5 text-[11px] bg-[#eff6ff] text-[#1e40af] border border-[#dbeafe] rounded hover:bg-[#dbeafe] whitespace-nowrap"
          title="今日の日付を入力"
        >
          今日
        </button>
      )}
      {editing && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setLocalVal('');
            onSave(null);
            setEditing(false);
          }}
          className="px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50 rounded"
          title="日付をクリア"
        >
          取消
        </button>
      )}
    </div>
  );
}
