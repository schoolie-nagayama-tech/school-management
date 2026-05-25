'use client';

import { Suspense } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import TestPrepList from '@/components/test-prep/TestPrepList';

export default function TestPrepListPage() {
  return (
    <AdminLayout headerTitle="テスト対策提案書">
      <Suspense fallback={<Loading />}>
        <TestPrepList />
      </Suspense>
    </AdminLayout>
  );
}
