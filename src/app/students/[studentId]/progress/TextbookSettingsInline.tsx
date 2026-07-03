'use client';

import { useRef, useState } from 'react';
import { upsertStudentTextbookSettings } from '@/lib/api/progress';

// ─────────────────────────────────────────────
// 進め方・宿題（インライン — 外枠は親が描画）
// ─────────────────────────────────────────────
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
  // 保存済みの値を初期表示する。以前は初期値を読み込んでおらず、開くたびに空欄になり
  // 「保存できない」ように見えていた（実際はDBに保存されていた）。
  // 親が key={textbookId} で再マウントするため、テキスト切り替え時にも入り直す。
  const [approach, setApproach] = useState(initialApproach ?? '');
  const [homeworkStyle, setHomeworkStyle] = useState(initialHomeworkStyle ?? '');
  // 最後に保存済みの値。無変更のフォーカスアウトで無駄な更新（updated_at 更新）を避ける。
  const savedApproach = useRef(initialApproach ?? '');
  const savedHomework = useRef(initialHomeworkStyle ?? '');

  const save = async (
    patch: { approach?: string } | { homework_style?: string },
    onSaved: () => void
  ) => {
    try {
      await upsertStudentTextbookSettings(textbookId, patch);
      onSaved();
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
          value={approach}
          onChange={(e) => setApproach(e.target.value)}
          onBlur={() => {
            // 値が変わっていない場合は保存しない
            if (approach === savedApproach.current) return;
            void save({ approach }, () => {
              savedApproach.current = approach;
            });
          }}
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
          value={homeworkStyle}
          onChange={(e) => setHomeworkStyle(e.target.value)}
          onBlur={() => {
            if (homeworkStyle === savedHomework.current) return;
            void save({ homework_style: homeworkStyle }, () => {
              savedHomework.current = homeworkStyle;
            });
          }}
        />
      </div>
    </>
  );
}
