'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getUnhandledSoudanCount, getSoudanPeriods } from '@/lib/api/soudan';
import { getDefaultSchoolId } from '@/lib/api/schools';

export function SoudanAlert() {
  const [unhandledCount, setUnhandledCount] = useState<number | null>(null);
  const [latestPeriodKey, setLatestPeriodKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const schoolId = getDefaultSchoolId();
        const count = await getUnhandledSoudanCount(schoolId);
        setUnhandledCount(count);
        
        // 最新の期間を取得（リンク用）
        const periods = await getSoudanPeriods(schoolId, false);
        if (periods.length > 0) {
          // 最新の期間（作成日時が新しい順）
          const sorted = periods.sort((a, b) => 
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          setLatestPeriodKey(sorted[0].period_key);
        }
      } catch (error) {
        console.error('Error fetching unhandled soudan data:', error);
        setUnhandledCount(0);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
    
    // 30秒ごとに更新
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  // 未対応がない場合は表示しない
  if (isLoading || unhandledCount === null || unhandledCount === 0) {
    return null;
  }

  // リンク先を決定（最新の期間がある場合はその期間の回答一覧、なければ相談の未処理一覧）
  const linkHref = latestPeriodKey
    ? `/forms/responses/soudan/${latestPeriodKey}`
    : '/responses?type=soudan&linked=unlinked';

  return (
    <div className="mb-6 bg-[#ef4444] border-2 border-[#e5e7eb] rounded-lg p-4 shadow-lg animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-2xl">⚠️</div>
          <div>
            <h3 className="text-lg font-bold text-white mb-1">
              未対応のお客様相談があります
            </h3>
            <p className="text-white/90 text-sm">
              {unhandledCount}件の未対応のお客様相談がございます。早急にご確認ください。
            </p>
          </div>
        </div>
        <Link
          href={linkHref}
          className="px-4 py-2 bg-white text-[#ef4444] font-bold rounded-lg hover:bg-gray-100 transition-colors whitespace-nowrap"
        >
          確認する →
        </Link>
      </div>
    </div>
  );
}
