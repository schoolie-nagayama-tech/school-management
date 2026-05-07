'use client';

import { Suspense } from 'react';
import ProposalEditor from '@/components/proposals/ProposalEditor';

export default function ProposalPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">読み込み中...</div>}>
      <ProposalEditor />
    </Suspense>
  );
}
