import { notFound } from 'next/navigation';
import { getForm } from '@/lib/api/forms';
import { PublicFormRenderer, KomaFormRenderer } from '@/components/forms';
import { getDefaultSchoolId, getSchool } from '@/lib/api/schools';

interface FormPreviewPageProps {
  params: Promise<{ formId: string }>;
}

export default async function FormPreviewPage({ params }: FormPreviewPageProps) {
  const { formId } = await params;

  // フォームを取得
  let form;
  try {
    form = await getForm(formId);
  } catch (error) {
    console.error('Error loading form:', error);
    notFound();
  }

  // 学校コードを取得
  let schoolCode = '';
  try {
    const schoolId = getDefaultSchoolId();
    const school = await getSchool(schoolId);
    if (school?.code) {
      schoolCode = school.code;
    }
  } catch (error) {
    console.error('Error loading school:', error);
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <header className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-[#1f2937]">{form.title}</h1>
            <a
              href="/forms/manage"
              className="px-4 py-2 text-sm text-[#4b5563] hover:text-[#1f2937] hover:bg-[#f3f4f6] rounded-lg transition-colors"
            >
              フォーム管理に戻る
            </a>
          </div>
          {form.description && (
            <p className="text-[#4b5563] whitespace-pre-line">{form.description}</p>
          )}
          <div className="mt-4 p-3 bg-[#3b82f6]/20 border border-[#3b82f6] rounded-lg">
            <p className="text-sm text-[#1f2937]">
              <strong>プレビューモード</strong> - このページは管理者確認用です。実際の回答は送信されません。
            </p>
          </div>
        </header>

        {/* フォーム */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
          {form.slug === 'test-koma' ? (
            <KomaFormRenderer
              form={form}
              schoolCode={schoolCode}
              isReadOnly={true}
            />
          ) : (
            <PublicFormRenderer
              form={form}
              schoolCode={schoolCode}
              isReadOnly={true}
            />
          )}
        </div>
      </div>
    </div>
  );
}
