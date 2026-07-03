'use client';

import { useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { upsertStudentTextbookSettings } from '@/lib/api/progress';

// ─────────────────────────────────────────────
// 進め方・宿題（インライン — 外枠は親が描画）
// ─────────────────────────────────────────────

// 進め方・宿題の1項目分。テキストエリア＋保存ボタン＋保存済み表示を持つ。
// 以前は onBlur 自動保存だけで「保存された」ことが視覚的に分かりづらかったため、
// 明示的な保存ボタンと「保存しました」表示を追加した（自動保存も維持）。
function SettingField({
  label,
  placeholder,
  initialValue,
  onSave,
}: {
  label: string;
  placeholder: string;
  initialValue: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  // 最後に保存済みの値。変更有無（dirty）の判定に使う。
  const savedRef = useRef(initialValue);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const dirty = value !== savedRef.current;

  const handleSave = async () => {
    if (!dirty || status === 'saving') return;
    setStatus('saving');
    try {
      await onSave(value);
      savedRef.current = value;
      setStatus('saved');
    } catch {
      // エラートーストは onSave 側で表示済み。状態だけ戻す。
      setStatus('idle');
    }
  };

  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">
        {label}
      </label>
      <textarea
        className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded text-sm resize-none"
        rows={2}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (status === 'saved') setStatus('idle');
        }}
        onBlur={handleSave}
      />
      <div className="flex items-center justify-end gap-2 mt-1 h-5">
        {status === 'saved' && !dirty && (
          <span className="text-[11px] text-green-600 flex items-center gap-0.5">
            <Check className="w-3 h-3" /> 保存しました
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || status === 'saving'}
          className={`px-2.5 py-1 text-[11px] font-medium rounded transition-[background-color] duration-150 ease-out active:scale-[0.97] ${
            !dirty || status === 'saving'
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-[#1e3a5f] text-white hover:bg-[#2a4d7a]'
          }`}
        >
          {status === 'saving' ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}

export function TextbookSettingsInline({
  textbookId,
  approach: initialApproach,
  homeworkStyle: initialHomeworkStyle,
  toastError,
}: {
  textbookId: string;
  approach?: string | null;
  homeworkStyle?: string | null;
  toastError: (m: string) => void;
}) {
  // 1項目分の保存処理を生成する。失敗時はトースト表示のうえ再throwし、
  // SettingField 側で保存状態を戻せるようにする。
  const makeSave =
    (build: (value: string) => { approach?: string } | { homework_style?: string }) =>
    async (value: string) => {
      try {
        await upsertStudentTextbookSettings(textbookId, build(value));
      } catch (e) {
        console.error(e);
        toastError('保存に失敗しました');
        throw e;
      }
    };

  return (
    <>
      <SettingField
        label="進め方"
        placeholder="例: ワーク→応用の順。間違えた問題は翌週再演習。"
        initialValue={initialApproach ?? ''}
        onSave={makeSave((value) => ({ approach: value }))}
      />
      <SettingField
        label="宿題の出し方"
        placeholder="例: 次回範囲の予習 + 前回ワークの復習"
        initialValue={initialHomeworkStyle ?? ''}
        onSave={makeSave((value) => ({ homework_style: value }))}
      />
    </>
  );
}
