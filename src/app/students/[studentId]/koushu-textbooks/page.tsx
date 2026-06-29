'use client';

import { Suspense } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import KoushuTextbookList from '@/components/proposals/KoushuTextbookList';

export default function KoushuTextbooksPage() {
  return (
    <AdminLayout headerTitle="講習 使用テキスト">
      <Suspense fallback={<Loading />}>
        <KoushuTextbookList />
      </Suspense>
    </AdminLayout>
  );
}
