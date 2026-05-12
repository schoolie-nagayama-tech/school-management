'use client';

import { Suspense } from 'react';
import { AdminLayout } from '@/components/layouts';
import ProposalEditor from '@/components/proposals/ProposalEditor';

export default function ProposalPage() {
  return (
    <AdminLayout headerTitle="提案書">
      <Suspense fallback={<div className="p-8 text-sm text-text-faint">読み込み中...</div>}>
        <ProposalEditor />
      </Suspense>
    </AdminLayout>
  );
}
