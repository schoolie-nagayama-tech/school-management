import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getForm } from '@/lib/api/forms';
import { getSchool } from '@/lib/api/schools';
import { PublicFormRenderer } from '@/components/forms';

export const dynamic = 'force-dynamic';

interface FormPreviewPageProps {
  params: Promise<{ formId: string }>;
}

export default async function FormPreviewPage({ params }: FormPreviewPageProps) {
  const { formId } = await params;

  let form;
  try {
    form = await getForm(formId);
  } catch {
    notFound();
  }

  if (!form) {
    notFound();
  }

  const school = await getSchool(form.school_id);
  if (!school) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-surface-hover">
      <div className="max-w-lg mx-auto px-4 py-8 w-full">
        <header className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-text-heading">{form.title} プレビュー</h1>
            <Link
              href="/settings/forms"
              className="px-4 py-2 text-sm text-text-body hover:text-text-heading hover:bg-surface-hover rounded-lg transition-colors duration-150"
            >
              設定に戻る
            </Link>
          </div>
          <div className="p-3 bg-amber-100 border border-amber-400 rounded-lg">
            <p className="text-sm text-amber-800 font-medium">
              <strong>プレビューモード</strong> -
              このページは管理者確認用です。実際の回答は送信されません。
            </p>
          </div>
        </header>

        <div className="bg-surface-raised rounded-xl border border-border p-6">
          <PublicFormRenderer form={form} schoolCode={school.code ?? ''} isReadOnly />
        </div>
      </div>
    </div>
  );
}
