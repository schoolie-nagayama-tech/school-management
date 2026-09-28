'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { LazySection } from './LazySection';
import { HUB_HEADER_OFFSET } from './sections';

interface HubSectionProps {
  id?: string;
  title: string;
  /** 見出しの右に添えるもの（「2月から」タグ・注記など） */
  extra?: ReactNode;
  /** 見出し右端の「詳細・編集 →」。既存のサブページがあるときだけ渡す */
  detailHref?: string;
  detailLabel?: string;
  /** true なら本文を見えてから読み込む（LazySection）。見出しは常に出す */
  lazy?: boolean;
  placeholderHeight?: number;
  /** 本文の余白を外す（表や既存部品を端まで広げたいとき） */
  flush?: boolean;
  children: ReactNode;
}

/**
 * 生徒ハブの1セクション（カード＋見出し）。
 * カードはセクションの単位にだけ使い、中は罫線と余白で組む（モックの方針）。
 * scroll-margin-top は固定ヘッダーの高さに合わせる（目次から飛んだとき見出しが隠れないように）。
 */
export function HubSection({
  id,
  title,
  extra,
  detailHref,
  detailLabel = '詳細・編集',
  lazy = false,
  placeholderHeight,
  flush = false,
  children,
}: HubSectionProps) {
  return (
    <section
      id={id}
      style={{ scrollMarginTop: HUB_HEADER_OFFSET }}
      className="min-w-0 rounded-[10px] border border-border-subtle bg-surface"
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-border-subtle px-4 py-3">
        <h2 className="text-base font-bold text-text-heading">{title}</h2>
        {extra}
        {detailHref && (
          <Link
            href={detailHref}
            className="ml-auto inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
          >
            {detailLabel}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        )}
      </div>
      <div className={flush ? '' : 'px-4 py-3.5'}>
        {lazy ? (
          <LazySection placeholderHeight={placeholderHeight}>{children}</LazySection>
        ) : (
          children
        )}
      </div>
    </section>
  );
}
