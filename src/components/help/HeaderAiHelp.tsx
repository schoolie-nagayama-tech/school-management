'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { AiHelpAsk } from '@/components/help/AiHelpAsk';
import type { RoleTag } from '@/lib/help/faqData';

/**
 * ヘッダーの「AIに聞いてみる」。
 *
 * ★導線の問題を解くために置いている。ヘルプは歯車メニューの奥にあり、
 *   そもそも在ることに気づかれない。最初は使ってもらわないと始まらないので、
 *   どの画面にも見えるヘッダーに出す。
 *
 * ヘッダーの帯に本物の入力欄を埋めると、答えを出す場所が無く窮屈になるので、
 * 見た目は入力欄・押すと中央に開いて本物の入力欄になる、という形にした。
 * Ctrl/⌘+K でも開く。
 */

interface Props {
  /** 質問の例を出し分けるのに使う（絞り込み自体はサーバー側で行う） */
  role: RoleTag;
}

export function HeaderAiHelp({ role }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Ctrl/⌘+K で開く。Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // 開いたら中の入力欄へフォーカス。閉じたらトリガーへ戻す（キーボードで迷子にしない）
  useEffect(() => {
    if (open) {
      const input = panelRef.current?.querySelector('input');
      input?.focus();
    } else {
      triggerRef.current?.blur();
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="AIに聞いてみる（Ctrl+K）"
        className="ai-pill flex items-center gap-1.5 h-8 px-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white/90 hover:text-white border border-white/25 transition-[background-color,color] duration-150"
      >
        <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        {/* ★ヘッダーが狭いので、文字は広い画面だけ。短く「AIに聞く」 */}
        <span className="hidden lg:inline text-xs whitespace-nowrap">AIに聞く</span>
        <span className="sr-only lg:hidden">AIに聞いてみる</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh] bg-black/40 backdrop-blur-[2px] animate-[fade-in_140ms_ease-out]"
          onClick={close}
          role="presentation"
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="AIに聞いてみる"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-2xl bg-surface border border-border shadow-2xl animate-[popover-enter_160ms_cubic-bezier(0.23,1,0.32,1)] max-h-[76vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-1">
              <span className="text-xs text-text-faint">ヘルプに書いてあることから答えます</span>
              <button
                type="button"
                onClick={close}
                aria-label="閉じる"
                className="p-1 rounded-md text-text-faint hover:text-text-body hover:bg-surface-hover transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 pb-4">
              <AiHelpAsk variant="modal" role={role} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
