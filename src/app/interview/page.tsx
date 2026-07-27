'use client';

/**
 * 面談ワークスペース エントリーポイント
 *
 * InterviewWorkspace は useSearchParams()（?studentId= の初期選択）を使うため、
 * Next.js の要求どおり Suspense でラップする（怠るとビルドで CSR bailout エラーになる）。
 */

import { Suspense } from 'react';
import { Loading } from '@/components/ui';
import { InterviewWorkspace } from './InterviewWorkspace';

export default function InterviewPage() {
  return (
    <Suspense fallback={<Loading />}>
      <InterviewWorkspace />
    </Suspense>
  );
}
