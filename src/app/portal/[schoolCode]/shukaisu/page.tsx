'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getActiveShukaisuPeriod } from '@/lib/api/shukaisu';
import { getSchoolByCode } from '@/lib/api/schools';
import { ShukaisuForm } from '@/components/forms/shukaisu';
import type { ShukaisuPeriod } from '@/types/forms/shukaisu';
import type { School } from '@/types/database';

export default function ShukaisuPortalPage() {
  const params = useParams();
  const schoolCode = (params?.schoolCode as string) || '';

  const [school, setSchool] = useState<School | null>(null);
  const [period, setPeriod] = useState<ShukaisuPeriod | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setErrorMessage('');

      try {
        // 学校情報を取得
        const schoolData = await getSchoolByCode(schoolCode);
        if (!schoolData) {
          setErrorMessage('教室が見つかりません');
          setIsLoading(false);
          return;
        }
        setSchool(schoolData);

        // 公開中の期間を取得
        const periodData = await getActiveShukaisuPeriod(schoolCode);
        if (!periodData) {
          setErrorMessage('現在受付していません');
          setIsLoading(false);
          return;
        }
        setPeriod(periodData);
      } catch (error) {
        console.error('Error fetching data:', error);
        setErrorMessage(
          error instanceof Error ? error.message : 'データの取得に失敗しました'
        );
      } finally {
        setIsLoading(false);
      }
    };

    if (schoolCode) {
      fetchData();
    }
  }, [schoolCode]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <p className="text-[#4b5563]">読み込み中...</p>
      </div>
    );
  }

  if (errorMessage || !school || !period) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4">
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-[#1f2937] mb-4">
            {school?.name || '教室'}
          </h1>
          <p className="text-[#4b5563] mb-6">{errorMessage || '現在受付していません'}</p>
          <Link
            href={`/portal/${schoolCode}`}
            className="inline-block px-6 py-3 bg-[#3b82f6] text-white font-medium rounded-lg hover:bg-[#60a5fa] transition-colors"
          >
            ポータルに戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <div className="max-w-lg mx-auto px-4 py-8 w-full">
        {!period ? (
          // 公開期間外
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center">
            <h1 className="text-2xl font-bold text-[#1f2937] mb-4">
              週回数変更
            </h1>
            <p className="text-[#4b5563] mb-6">
              現在、週回数変更の受付は行っておりません。
            </p>
            <a
              href={`/portal/${schoolCode}`}
              className="inline-block px-6 py-3 bg-[#3b82f6] text-white font-medium rounded-lg hover:bg-[#60a5fa] transition-colors"
            >
              ポータルに戻る
            </a>
          </div>
        ) : (
          // フォーム表示
          <ShukaisuForm school={school} period={period} />
        )}
      </div>
    </div>
  );
}
