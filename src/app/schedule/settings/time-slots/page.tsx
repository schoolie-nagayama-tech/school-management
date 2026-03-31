'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** 旧ルート → /settings/time-slots へリダイレクト */
export default function TimeSlotsPageRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings/time-slots');
  }, [router]);
  return <div className="py-8 text-center text-gray-500">リダイレクト中...</div>;
}
