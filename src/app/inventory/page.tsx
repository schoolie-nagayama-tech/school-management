'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loading } from '@/components/ui';

export default function InventoryPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/ordering');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loading label="リダイレクト中..." />
    </div>
  );
}
