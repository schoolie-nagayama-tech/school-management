'use client';

import { useState } from 'react';
import { FlaskConical } from 'lucide-react';

/**
 * デモセッション中であることを常時明示するバナー。
 *
 * スタッフが「今見ているのはダミーデータ」だと取り違えないための表示であり、
 * ここが唯一の出口（スタッフ画面への復帰導線）でもある。
 * /mypage は保護者向けシェルでスタッフ用ヘッダーを持たないため、
 * これが無いとデモに入ったスタッフは戻る手段が無くなる。
 */
export function DemoBanner() {
  const [exiting, setExiting] = useState(false);

  const handleExit = async () => {
    setExiting(true);
    try {
      await fetch('/api/portal-demo/exit', { method: 'POST' });
    } catch {
      // 失敗しても遷移は行う。cookie が残っていてもスタッフ画面側は影響を受けない
      // （主体が別 cookie なので）。ここで戻れなくなる方が害が大きい。
    }
    // router.push ではなく実遷移にする。ポータル用ツリーからスタッフ用ツリーへ
    // 主体ごと切り替わるため、クライアント側の状態を持ち越さない方が安全。
    window.location.href = '/students';
  };

  return (
    // 背景は surface-raised。レイアウトの地色（bg-surface）と同色だと境界が消えるため。
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2">
      <FlaskConical className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
      <span className="flex-1 text-xs text-text-body">デモ表示中 — ダミーデータです</span>
      <button
        type="button"
        onClick={handleExit}
        disabled={exiting}
        className="shrink-0 rounded border border-border px-2 py-1 text-xs font-medium text-text-heading transition-colors duration-150 hover:bg-black/5 disabled:opacity-50"
      >
        スタッフ画面に戻る
      </button>
    </div>
  );
}
