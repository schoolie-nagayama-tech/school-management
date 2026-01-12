import { notFound, redirect } from 'next/navigation';
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
      <div className="min-h-screen bg-[#eff0f3] flex items-center justify-center">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <h1 className="text-2xl font-bold text-[#0d0d0d] mb-4">
            このフォームは現在受付していません
          </h1>
          <a
            href={`/portal/${schoolCode}`}
            className="text-[#ff8e3c] hover:underline"
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
      <div className="min-h-screen bg-[#eff0f3]">
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8 text-center">
            <div className="mb-6">
              <svg
                className="w-16 h-16 mx-auto text-[#ff8e3c]"
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
            <h2 className="text-2xl font-bold text-[#0d0d0d] mb-4">送信完了</h2>
            {form.completion_message && (
              <p className="text-[#2a2a2a] mb-6 whitespace-pre-line">
                {form.completion_message}
              </p>
            )}
            <a
              href={`/portal/${schoolCode}`}
              className="inline-block px-6 py-3 bg-[#ff8e3c] text-[#0d0d0d] font-semibold rounded-lg hover:bg-[#ff9e5c] transition-colors"
            >
              戻る
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#eff0f3]">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-[#0d0d0d] mb-2">{form.title}</h1>
          {form.description && (
            <p className="text-[#2a2a2a] whitespace-pre-line">{form.description}</p>
          )}
        </header>

        {/* フォーム */}
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
          {form.slug === 'test-koma' ? (
            <KomaFormRenderer
              form={form}
              schoolCode={schoolCode}
            />
          ) : (
            <PublicFormRenderer
              form={form}
              schoolCode={schoolCode}
            />
          )}
        </div>
      </div>
    </div>
  );
}
