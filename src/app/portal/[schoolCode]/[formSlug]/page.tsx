import { getFormBySlug } from '@/lib/api/forms';
import { PublicFormRenderer, KomaFormRenderer } from '@/components/forms';

interface FormPageProps {
  params: Promise<{ schoolCode: string; formSlug: string }>;
  searchParams: Promise<{ submitted?: string }>;
}

export default async function FormPage({ params, searchParams }: FormPageProps) {
  const { schoolCode, formSlug } = await params;
  const { submitted } = await searchParams;

  // フォームを取得
  const form = await getFormBySlug(schoolCode, formSlug);

  if (!form) {
    return (
      <div className="min-h-screen bg-[#f3f4f6] flex items-center justify-center">
        <div className="max-w-lg mx-auto px-4 text-center w-full">
          <h1 className="text-2xl font-bold text-[#1f2937] mb-4">
            このフォームは現在受付していません
          </h1>
          <a
            href={`/portal/${schoolCode}`}
            className="text-[#3b82f6] hover:underline"
          >
            お申込みページに戻る
          </a>
        </div>
      </div>
    );
  }

  // 送信完了画面
  if (submitted === 'true') {
    return (
      <div className="min-h-screen bg-[#f3f4f6]">
        <div className="max-w-lg mx-auto px-4 py-8 w-full">
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center">
            <div className="mb-6">
              <svg
                className="w-16 h-16 mx-auto text-[#3b82f6]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-[#1f2937] mb-4">送信完了</h2>
            {form.completion_message && (
              <p className="text-[#4b5563] mb-6 whitespace-pre-line">
                {form.completion_message}
              </p>
            )}
            <a
              href={`/portal/${schoolCode}`}
              className="inline-block px-6 py-3 bg-[#3b82f6] text-white font-semibold rounded-lg hover:bg-[#60a5fa] transition-colors"
            >
              戻る
            </a>
          </div>
        </div>
      </div>
    );
  }

  // test-koma は他フォームと同じレイアウトで表示（ヘッダー＋白カード）
  if (form.slug === 'test-koma') {
    return (
      <div className="min-h-screen bg-[#f3f4f6]">
        <div className="max-w-lg mx-auto px-4 py-8 w-full">
          <header className="mb-6">
            <h1 className="text-2xl font-bold text-[#1f2937] mb-2">{form.title}</h1>
            {form.description && (
              <p className="text-[#4b5563] whitespace-pre-line">{form.description}</p>
            )}
          </header>
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
            <KomaFormRenderer form={form} schoolCode={schoolCode} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      <div className="max-w-lg mx-auto px-4 py-8 w-full">
        {/* ヘッダー */}
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-[#1f2937] mb-2">{form.title}</h1>
          {form.description && (
            <p className="text-[#4b5563] whitespace-pre-line">{form.description}</p>
          )}
        </header>

        {/* フォーム */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
          <PublicFormRenderer form={form} schoolCode={schoolCode} />
        </div>
      </div>
    </div>
  );
}
