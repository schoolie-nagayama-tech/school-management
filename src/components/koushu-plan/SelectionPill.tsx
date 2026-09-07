'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Link2, Tag } from 'lucide-react';
import {
  INTENT_TAG_COLOR,
  INTENT_TAGS,
  type IntentTag,
} from '@/components/proposals/proposalEditor.shared';

/**
 * 選択脇のフローティング「まとめる」ピル。提案書エディタと講習テンプレートで共有する。
 *
 * 位置（pos）の算出は親（usePillPosition）に任せ、ここは描画と
 * 指導意図メニューの開閉だけを持つ。メニューの state を内側に閉じ込めているのは、
 * 開閉が親の再描画に影響しない純粋な見た目の都合だから。
 */
export function SelectionPill({
  pos,
  count,
  contiguous,
  dragging,
  appliedMode,
  showIntent = true,
  onGroup,
  onGroupApplied,
  onApplyIntent,
}: {
  /** ピルを出す画面座標。null なら非表示 */
  pos: { top: number; left: number } | null;
  count: number;
  /** 選択中の単元が隣接しているか（隣接時のみまとめられる） */
  contiguous: boolean;
  dragging: boolean;
  appliedMode: boolean;
  /** 指導意図の一括設定を出すか。テンプレートは意図を持たないので false で使う */
  showIntent?: boolean;
  onGroup: () => void;
  onGroupApplied: () => void;
  onApplyIntent: (tag: IntentTag | null) => void;
}) {
  // 指導意図の一括設定メニュー（選択中の単元へまとめて適用。行ごとの個別クリックを無くす）
  const [intentMenuOpen, setIntentMenuOpen] = useState(false);
  const intentMenuRef = useRef<HTMLDivElement>(null);

  // メニュー外クリックで閉じる
  useEffect(() => {
    if (!intentMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (intentMenuRef.current && !intentMenuRef.current.contains(e.target as Node)) {
        setIntentMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [intentMenuOpen]);

  if (!pos || count < 2) return null;

  const handleApplyIntent = (tag: IntentTag | null) => {
    onApplyIntent(tag);
    setIntentMenuOpen(false);
  };

  return (
    // ドラッグ中はピルがポインタ操作を奪わないよう pointer-events を切る。
    <div
      className={`fixed z-40 -translate-y-1/2 print:hidden flex items-center gap-1.5 ${dragging ? 'pointer-events-none' : ''}`}
      style={{ top: pos.top, left: pos.left }}
    >
      {contiguous ? (
        <button
          type="button"
          onClick={onGroup}
          className="flex items-center gap-1.5 rounded-full bg-primary text-white text-xs font-bold pl-3 pr-2.5 py-1.5 shadow-lg ring-1 ring-black/5 hover:bg-primary/90 active:scale-95 transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]"
        >
          <Link2 className="w-3.5 h-3.5" />
          {count}単元をまとめる
          <kbd className="ml-0.5 rounded bg-white/20 px-1 text-[10px] font-semibold leading-tight">
            G
          </kbd>
        </button>
      ) : (
        <div className="flex items-center gap-1.5 rounded-full bg-surface-raised text-text-muted text-[11px] font-medium px-3 py-1.5 shadow-lg ring-1 ring-border-default origin-left animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
          隣接する単元のみまとめられます
        </div>
      )}

      {/* 申込編集フェーズ（提案済み/公開済み）では「申込結合」も提示。提案結合とは別系統で申込コマを1コマにまとめる。 */}
      {appliedMode && contiguous && (
        <button
          type="button"
          onClick={onGroupApplied}
          className="flex items-center gap-1.5 rounded-full bg-success text-white text-xs font-bold pl-3 pr-3 py-1.5 shadow-lg ring-1 ring-black/5 hover:bg-success/90 active:scale-95 transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]"
          title="選択中の単元を申込1コマにまとめる（提案結合とは別）"
        >
          <Link2 className="w-3.5 h-3.5" />
          申込結合
        </button>
      )}

      {/* グループ化ピルの隣に「指導意図」一括設定。選択した場所のすぐ横でまとめて設定できる。 */}
      {showIntent && (
        <div className="relative" ref={intentMenuRef}>
          <button
            type="button"
            onClick={() => setIntentMenuOpen((o) => !o)}
            className="flex items-center gap-1 rounded-full bg-surface-raised text-text-body text-xs font-medium pl-2.5 pr-2 py-1.5 shadow-lg ring-1 ring-border-default hover:bg-surface-hover active:scale-95 transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]"
            title="選択中の単元へ指導意図を一括設定"
          >
            <Tag className="w-3.5 h-3.5" />
            指導意図
            {intentMenuOpen ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
          {intentMenuOpen && (
            <div className="absolute top-full left-0 mt-2 w-56 p-2 bg-surface-raised border border-border-default rounded-xl shadow-lg origin-top-left animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
              <div className="px-1 pb-1.5 text-[10px] font-bold text-text-faint">
                選択中の{count}単元に設定
              </div>
              <div className="flex flex-wrap gap-1">
                {INTENT_TAGS.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => handleApplyIntent(tag)}
                    className={`px-1.5 py-0.5 text-[10px] font-medium border rounded-full bg-white border-current hover:brightness-95 active:scale-95 transition-[transform,filter] duration-100 ease-out ${INTENT_TAG_COLOR[tag]}`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <button
                onClick={() => handleApplyIntent(null)}
                className="mt-1.5 w-full text-left px-1.5 py-1 text-[10px] text-text-faint hover:text-text-muted rounded transition-[color] duration-100"
              >
                指導意図をクリア
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
