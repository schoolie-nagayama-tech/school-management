import { notFound } from 'next/navigation';
import { getSchoolByCode } from '@/lib/api/schools';
import { getActiveZoukomaPeriod } from '@/lib/api/zoukoma';
import { ZoukomaForm } from '@/components/forms/zoukoma/ZoukomaForm';

interface ZoukomaPortalPageProps {
  params: Promise<{ schoolCode: string }>;
}

export default async function ZoukomaPortalPage({
  params,
}: ZoukomaPortalPageProps) {
  const { schoolCode } = await params;

  // 教室情報を取得
  const school = await getSchoolByCode(schoolCode);
  if (!school) {
    notFound();
  }

  // 公開中の増コマ申込期間を取得
  const period = await getActiveZoukomaPeriod(schoolCode);

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {!period ? (
          // 公開期間外
          <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8 text-center">
            <h1 className="text-2xl font-bold text-[#0d0d0d] mb-4">
              増コマ申込
            </h1>
            <p className="text-[#2a2a2a] mb-6">
              現在、増コマ申込の受付は行っておりません。
            </p>
            <a
              href={`/portal/${schoolCode}`}
              className="inline-block px-6 py-3 bg-[#ff8e3c] text-[#0d0d0d] font-medium rounded-lg hover:bg-[#ff9e5c] transition-colors"
            >
              ポータルに戻る
            </a>
          </div>
        ) : (
          // フォーム表示
          <ZoukomaForm school={school} period={period} />
        )}
      </div>
    </div>
  );
}
