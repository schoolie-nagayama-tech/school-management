'use client';

import { Suspense } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Loading } from '@/components/ui';
import TestPrepEditor from '@/components/test-prep/TestPrepEditor';

export default function NewTestPrepPage() {
  return (
    <AdminLayout headerTitle="テスト対策提案書">
      <Suspense fallback={<Loading />}>
        <TestPrepEditor />
      </Suspense>
    </AdminLayout>
  );
}
