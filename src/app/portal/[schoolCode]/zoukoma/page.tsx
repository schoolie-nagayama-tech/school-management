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
    <div className="min-h-screen bg-[#f3f4f6]">
      <div className="max-w-lg mx-auto px-4 py-8 w-full">
        {!period ? (
          // 公開期間外
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center">
            <h1 className="text-2xl font-bold text-[#1f2937] mb-4">
              テスト対策増コマ申し込み
            </h1>
            <p className="text-[#4b5563] mb-6">
              現在、テスト対策増コマ申し込みの受付は行っておりません。
            </p>
            <a
              href={`/portal/${schoolCode}`}
              className="inline-block px-6 py-3 bg-[#3b82f6] text-white font-medium rounded-lg hover:bg-[#60a5fa] transition-colors"
            >
              ポータルに戻る
            </a>
          </div>
        ) : (
          // フォーム表示（他フォームと同じレイアウト：ヘッダー＋白カード）
          <>
            <header className="mb-6 text-center">
              <h1 className="text-2xl font-bold text-[#1f2937] mb-2">
                {period.title}
              </h1>
              {period.settings?.description && (
                <p className="text-[#4b5563] whitespace-pre-line">
                  {period.settings.description}
                </p>
              )}
            </header>
            <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
              <ZoukomaForm school={school} period={period} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
