'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { HelpCircle, X, ArrowRight, ExternalLink } from 'lucide-react';

export interface ContextHelpTopic {
  /** 操作のタイトル */
  title: string;
  /** 1行の概要 */
  description: string;
  /** 操作手順（短く2-4ステップ） */
  steps?: string[];
}

interface ContextHelpProps {
  /** このページに関連するヘルプトピック（2-4件推奨） */
  topics: ContextHelpTopic[];
  /** ヘルプページへのリンクに付与する検索クエリ */
  searchQuery?: string;
  /** ボタンの表示位置 */
  position?: 'inline' | 'fixed';
}

/**
 * 各ページに配置するコンテキストヘルプボタン。
 * クリックでポップオーバーを表示し、そのページに関連する操作ガイドを提供する。
 */
export function ContextHelp({ topics, searchQuery, position = 'inline' }: ContextHelpProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const helpLink = searchQuery ? `/help?q=${encodeURIComponent(searchQuery)}` : '/help';

  return (
    <div
      className={`relative ${position === 'fixed' ? 'fixed bottom-6 right-6 z-50' : 'inline-flex'}`}
    >
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`
          inline-flex items-center justify-center rounded-full border transition-all duration-200
          ${
            isOpen
              ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-lg'
              : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-[var(--primary)] hover:text-[var(--primary)]'
          }
          ${position === 'fixed' ? 'w-12 h-12 shadow-lg' : 'w-7 h-7'}
        `}
        title="このページの使い方"
      >
        <HelpCircle className={position === 'fixed' ? 'w-6 h-6' : 'w-4 h-4'} />
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          className={`
            absolute z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
            rounded-xl shadow-xl overflow-hidden
            ${position === 'fixed' ? 'bottom-16 right-0 w-80' : 'top-full mt-2 right-0 w-80'}
          `}
        >
          {/* ヘッダー */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--primary)] text-white">
            <div className="flex items-center gap-2">
              <HelpCircle className="w-4 h-4" />
              <span className="text-sm font-medium">このページの使い方</span>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-white/80 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* トピック一覧 */}
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
            {topics.map((topic, i) => (
              <ContextHelpItem key={i} topic={topic} />
            ))}
          </div>

          {/* フッター */}
          <div className="px-4 py-2.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <Link
              href={helpLink}
              className="flex items-center justify-center gap-1.5 text-xs font-medium text-[var(--primary)] hover:underline"
            >
              ヘルプページで詳しく見る
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function ContextHelpItem({ topic }: { topic: ContextHelpTopic }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-4 py-2.5">
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left group">
        <p className="text-sm font-medium text-[var(--headline)] group-hover:text-[var(--primary)] transition-colors">
          {topic.title}
        </p>
        <p className="text-xs text-[var(--paragraph)] mt-0.5">{topic.description}</p>
      </button>

      {expanded && topic.steps && (
        <ol className="mt-2 space-y-1 ml-1">
          {topic.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-text-body leading-relaxed">
              <span className="inline-flex items-center justify-center w-4 h-4 mt-0.5 text-[9px] font-bold bg-[var(--primary)] text-white rounded-full shrink-0">
                {i + 1}
              </span>
              <span className="flex-1">{step}</span>
            </li>
          ))}
        </ol>
      )}

      {!expanded && topic.steps && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-1 flex items-center gap-1 text-[11px] text-[var(--primary)] hover:underline"
        >
          <ArrowRight className="w-3 h-3" />
          手順を表示
        </button>
      )}
    </div>
  );
}
