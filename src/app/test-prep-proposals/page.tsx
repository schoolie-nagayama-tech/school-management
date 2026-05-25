'use client';

import { Suspense } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import TestPrepProposalsList from '@/components/test-prep/TestPrepProposalsList';

export default function TestPrepProposalsPage() {
  return (
    <AdminLayout headerTitle="テスト対策提案書">
      <Suspense fallback={<Loading />}>
        <TestPrepProposalsList />
      </Suspense>
    </AdminLayout>
  );
}
