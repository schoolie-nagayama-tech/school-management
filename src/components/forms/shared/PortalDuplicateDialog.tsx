'use client';

import { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';

interface PortalDuplicateDialogProps {
  /** 既存申込の受付日時（ISO文字列）。取得できなければ null */
  submittedAt: string | null;
  /** 送信せずに閉じる */
  onCancel: () => void;
  /** それでも送信する */
  onConfirm: () => void;
}

/** 受付日時を「7月31日 19:40」形式にする（保護者向けなので年は出さない） */
function formatSubmittedAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(d);
}

/**
 * 「すでに申し込み済みです」の確認ダイアログ。
 *
 * 送信できたか不安になった保護者の二重申込を送信前に止めるのが目的。
 * ただし内容変更や追加申込は正当なので、ブロックはせず明示的な続行を選べるようにする。
 * スマホ1画面に収まるよう、本文は2文まで・ボタンは縦積みにしている。
 */
export function PortalDuplicateDialog({
  submittedAt,
  onCancel,
  onConfirm,
}: PortalDuplicateDialogProps) {
  // 背面スクロールを止める（モバイルでダイアログ外が動くと誤操作しやすい）
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Escape は「送信しない」に倒す。共有の Modal.tsx と同じ挙動に揃えるため。
  // 誤って送ってしまう方が事故なので、キャンセル側が安全側。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const when = formatSubmittedAt(submittedAt);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="portal-duplicate-title"
    >
      <div className="w-full max-w-sm bg-white rounded-2xl border border-[#e5e7eb] p-6 shadow-xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 shrink-0 rounded-full bg-amber-50 ring-1 ring-amber-200 flex items-center justify-center">
            <AlertCircle className="w-5 h-5 text-amber-600" aria-hidden="true" />
          </div>
          <div>
            <h2
              id="portal-duplicate-title"
              className="text-base font-bold text-[#1a1a1a] leading-snug"
            >
              すでにお申し込みを受け付けています
            </h2>
            <p className="text-sm text-[#4b5563] leading-relaxed mt-2">
              {when
                ? `${when}に、同じお名前・メールアドレスでのお申し込みを受け付けています。`
                : '同じお名前・メールアドレスでのお申し込みを受け付けています。'}
            </p>
            <p className="text-sm text-[#4b5563] leading-relaxed mt-2">
              内容の変更や追加のお申し込みでなければ、このまま閉じてください。
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="w-full px-6 py-3 bg-[color:var(--primary)] text-white font-semibold rounded-lg hover:bg-[color:var(--primary-dark)] active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
          >
            閉じる（送信しない）
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="w-full px-6 py-3 text-sm text-[#4b5563] font-medium rounded-lg border border-[#e5e7eb] hover:bg-[#f8f8f8] active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
          >
            それでも送信する
          </button>
        </div>
      </div>
    </div>
  );
}
