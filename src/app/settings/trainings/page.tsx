'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** 研修マスタはバッジ管理ページに統合されたため、旧URLからリダイレクト */
export default function TrainingMastersRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/teacher-badges');
  }, [router]);
  return null;
}
