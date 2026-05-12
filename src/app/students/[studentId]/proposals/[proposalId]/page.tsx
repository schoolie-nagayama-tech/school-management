'use client';

import { Suspense } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import ProposalEditor from '@/components/proposals/ProposalEditor';

export default function ProposalPage() {
  return (
    <AdminLayout headerTitle="提案書">
      <Suspense fallback={<Loading />}>
        <ProposalEditor />
      </Suspense>
    </AdminLayout>
  );
}
