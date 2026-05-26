import { notFound } from 'next/navigation';
import { getSchoolByCode } from '@/lib/api/schools';
import { getActiveZoukomaPeriod } from '@/lib/api/zoukoma';
import { ZoukomaForm } from '@/components/forms/zoukoma/ZoukomaForm';

// クエリパラメータから初期値を構築（提案書からの遷移時に自動入力）
// name=生徒名, grade=学年, s_英語=2, s_数学=3 ...
function buildInitialValues(query: Record<string, string | string[] | undefined>) {
  const name = typeof query.name === 'string' ? query.name : undefined;
  const grade = typeof query.grade === 'string' ? query.grade : undefined;
  const subjects: Record<string, number> = {};
  for (const [key, val] of Object.entries(query)) {
    if (key.startsWith('s_') && typeof val === 'string') {
      const n = Number(val);
      if (n > 0) subjects[key.slice(2)] = n;
    }
  }
  if (!name && !grade && Object.keys(subjects).length === 0) return undefined;
  return { studentName: name, grade, subjects };
}

interface ZoukomaPortalPageProps {
  params: Promise<{ schoolCode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ZoukomaPortalPage({
  params,
  searchParams,
}: ZoukomaPortalPageProps) {
  const { schoolCode } = await params;
  const query = await searchParams;

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
              className="inline-block px-6 py-3 bg-[#3b82f6] text-white font-medium rounded-lg hover:bg-[#60a5fa] transition-colors duration-150"
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
              <ZoukomaForm
                school={school}
                period={period}
                initialValues={buildInitialValues(query)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
