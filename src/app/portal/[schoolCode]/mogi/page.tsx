'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getActiveMogiPeriod } from '@/lib/api/mogi';
import { getSchoolByCode } from '@/lib/api/schools';
import { getPortalMenus } from '@/lib/api/portal';
import { MogiForm } from '@/components/forms/mogi';
import type { MogiPeriod } from '@/types/forms/mogi';
import type { School } from '@/types/database';
import type { PortalMenu } from '@/types/database';
import { Loading } from '@/components/ui';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

export default function MogiPortalPage() {
  const params = useParams();
  const schoolCode = (params?.schoolCode as string) || '';

  const [school, setSchool] = useState<School | null>(null);
  const [period, setPeriod] = useState<MogiPeriod | null>(null);
  const [mogiMenu, setMogiMenu] = useState<PortalMenu | null>(null);
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

        // 公開中の期間とメニュー（タイトル表示用）を取得
        const [periodData, menus] = await Promise.all([
          getActiveMogiPeriod(schoolCode),
          getPortalMenus(schoolData.id),
        ]);
        setPeriod(periodData ?? null);
        const mogi = menus?.find((m) => m.menu_key === 'mogi') ?? null;
        setMogiMenu(mogi);
      } catch (error) {
        console.error('Error fetching data:', error);
        setErrorMessage(getUserErrorMessage(error, 'データの取得に失敗しました'));
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
        <Loading />
      </div>
    );
  }

  // エラー時（教室なし・通信エラーなど）
  if (errorMessage || !school) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4">
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-[#1f2937] mb-4">{school?.name || '教室'}</h1>
          <p className="text-[#4b5563] mb-6">{errorMessage || '現在受付していません'}</p>
          <Link
            href={`/portal/${schoolCode}`}
            className="inline-block px-6 py-3 bg-[#3b82f6] text-white font-medium rounded-lg hover:bg-[#60a5fa] transition-colors duration-150"
          >
            ポータルに戻る
          </Link>
        </div>
      </div>
    );
  }

  // 公開期間外：メニューで設定したタイトルを表示（ポータルカードと連動）
  if (!period) {
    const menuTitle = mogiMenu?.title ?? 'Vもぎ申込';
    const menuDescription = mogiMenu?.description ?? 'Vもぎのお申込みはこちら';
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4">
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-[#1f2937] mb-4">{menuTitle}</h1>
          <p className="text-[#4b5563] mb-6">現在、{menuTitle}の受付は行っておりません。</p>
          {menuDescription && <p className="text-sm text-[#6b7280] mb-6">{menuDescription}</p>}
          <Link
            href={`/portal/${schoolCode}`}
            className="inline-block px-6 py-3 bg-[#3b82f6] text-white font-medium rounded-lg hover:bg-[#60a5fa] transition-colors duration-150"
          >
            ポータルに戻る
          </Link>
        </div>
      </div>
    );
  }

  // フォーム表示
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <div className="max-w-lg mx-auto px-4 py-8 w-full">
        <MogiForm school={school} period={period} />
      </div>
    </div>
  );
}
