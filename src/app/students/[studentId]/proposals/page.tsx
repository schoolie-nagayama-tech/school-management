'use client';

import { Suspense } from 'react';
import ProposalList from '@/components/proposals/ProposalList';

export default function ProposalsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">読み込み中...</div>}>
      <ProposalList />
    </Suspense>
  );
}
