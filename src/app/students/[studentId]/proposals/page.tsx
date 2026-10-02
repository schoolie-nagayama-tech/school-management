'use client';

import { Suspense } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Loading, ScrollToTopButton } from '@/components/ui';
import ProposalList from '@/components/proposals/ProposalList';

export default function ProposalsPage() {
  return (
    <AdminLayout headerTitle="提案書">
      <Suspense fallback={<Loading />}>
        <ProposalList />
      </Suspense>
      {/* 期ごとの提案書が積み重なって縦に伸びるので、先頭へ戻れるようにする */}
      <ScrollToTopButton />
    </AdminLayout>
  );
}
