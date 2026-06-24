'use client';

import { upsertStudentTextbookSettings } from '@/lib/api/progress';

// ─────────────────────────────────────────────
// 進め方・宿題（インライン — 外枠は親が描画）
// ─────────────────────────────────────────────
export function TextbookSettingsInline({
  textbookId,
  toastError,
}: {
  textbookId: string;
  toastError: (m: string) => void;
}) {
  const save = async (patch: { approach?: string; homework_style?: string }) => {
    try {
      await upsertStudentTextbookSettings(textbookId, patch);
    } catch (e) {
      console.error(e);
      toastError('保存に失敗しました');
    }
  };

  return (
    <>
      <div>
        <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">
          進め方
        </label>
        <textarea
          className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded text-sm resize-none"
          rows={2}
          placeholder="例: ワーク→応用の順。間違えた問題は翌週再演習。"
          onBlur={(e) => save({ approach: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-[#6b7280] uppercase tracking-wider mb-1">
          宿題の出し方
        </label>
        <textarea
          className="w-full px-2 py-1.5 border border-[#e5e7eb] rounded text-sm resize-none"
          rows={2}
          placeholder="例: 次回範囲の予習 + 前回ワークの復習"
          onBlur={(e) => save({ homework_style: e.target.value })}
        />
      </div>
    </>
  );
}
