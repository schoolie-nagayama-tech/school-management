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
    <div className="min-h-screen bg-[#eff0f3]">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <header className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-[#0d0d0d]">{form.title}</h1>
            <a
              href="/forms/manage"
              className="px-4 py-2 text-sm text-[#2a2a2a] hover:text-[#0d0d0d] hover:bg-[#eff0f3] rounded-lg transition-colors"
            >
              フォーム管理に戻る
            </a>
          </div>
          {form.description && (
            <p className="text-[#2a2a2a] whitespace-pre-line">{form.description}</p>
          )}
          <div className="mt-4 p-3 bg-[#ff8e3c]/20 border border-[#ff8e3c] rounded-lg">
            <p className="text-sm text-[#0d0d0d]">
              <strong>プレビューモード</strong> - このページは管理者確認用です。実際の回答は送信されません。
            </p>
          </div>
        </header>

        {/* フォーム */}
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
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
