'use client';

import { Suspense } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import ProposalList from '@/components/proposals/ProposalList';

export default function ProposalsPage() {
  return (
    <AdminLayout headerTitle="提案書">
      <Suspense fallback={<Loading />}>
        <ProposalList />
      </Suspense>
    </AdminLayout>
  );
}
