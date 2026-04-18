'use client';

/**
 * 進捗ページ ディスパッチャ
 *
 * デフォルト: 新UI（NewProgressPage）
 * ロールバック: URL に `?v=legacy` を付けると旧UI（LegacyProgressPage）を表示
 *
 * 全員を旧UIに戻したい場合は、以下の `FORCE_LEGACY` を true に切り替えればOK。
 * （新UIに問題が見つかった場合の緊急ロールバック用）
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import NewProgressPage from './NewProgressPage';
import LegacyProgressPage from './LegacyProgressPage';

/** 全員を旧UIに戻す緊急フラグ。true にすると `?v=new` 以外は全て旧UI。 */
const FORCE_LEGACY = false;

function ProgressRouter() {
  const params = useSearchParams();
  const v = params?.get('v') ?? '';

  if (FORCE_LEGACY) {
    return v === 'new' ? <NewProgressPage /> : <LegacyProgressPage />;
  }
  return v === 'legacy' ? <LegacyProgressPage /> : <NewProgressPage />;
}

export default function ProgressPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[#6b7280]">読み込み中...</div>}>
      <ProgressRouter />
    </Suspense>
  );
}
