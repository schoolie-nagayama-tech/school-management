import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getDefaultSchoolId, getSchool } from '@/lib/api/schools';
import { getZoukomaPeriodByKey } from '@/lib/api/zoukoma';
import { getMoshiPeriodByKey } from '@/lib/api/moshi';
import { getMogiPeriodByKey } from '@/lib/api/mogi';
import { getShukaisuPeriodByKey } from '@/lib/api/shukaisu';
import { getSoudanPeriodByKey } from '@/lib/api/soudan';
import { getYoubiPeriodByKey } from '@/lib/api/youbi';
import { ZoukomaForm } from '@/components/forms/zoukoma/ZoukomaForm';
import { MoshiForm } from '@/components/forms/moshi';
import { MogiForm } from '@/components/forms/mogi';
import { ShukaisuForm } from '@/components/forms/shukaisu';
import { SoudanForm } from '@/components/forms/soudan';
import { YoubiForm } from '@/components/forms/youbi';
import type { FormType } from '@/types/database';

export const dynamic = 'force-dynamic';

const FORM_TYPE_LABELS: Record<string, string> = {
  zoukoma: '増コマ申込',
  moshi: '模試申込',
  mogi: 'Vもぎ申込',
  shukaisu: '週回数変更',
  soudan: 'お客様相談',
  youbi: '曜日変更',
};

interface FormPreviewPageProps {
  params: Promise<{ formType: string; periodKey: string }>;
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function FormPeriodPreviewPage({
  params,
  searchParams,
}: FormPreviewPageProps) {
  const { formType, periodKey } = await params;
  const { schoolId: querySchoolId } = await searchParams;

  const validFormTypes = ['zoukoma', 'moshi', 'mogi', 'shukaisu', 'soudan', 'youbi'];
  if (!validFormTypes.includes(formType)) {
    notFound();
  }

  const schoolId = querySchoolId || getDefaultSchoolId();
  const school = await getSchool(schoolId);
  if (!school) {
    notFound();
  }

  let period;
  switch (formType as FormType) {
    case 'zoukoma':
      period = await getZoukomaPeriodByKey(schoolId, periodKey);
      break;
    case 'moshi':
      period = await getMoshiPeriodByKey(schoolId, periodKey);
      break;
    case 'mogi':
      period = await getMogiPeriodByKey(schoolId, periodKey);
      break;
    case 'shukaisu':
      period = await getShukaisuPeriodByKey(schoolId, periodKey);
      break;
    case 'soudan':
      period = await getSoudanPeriodByKey(schoolId, periodKey);
      break;
    case 'youbi':
      period = await getYoubiPeriodByKey(schoolId, periodKey);
      break;
    default:
      notFound();
  }

  if (!period) {
    notFound();
  }

  const formLabel = FORM_TYPE_LABELS[formType] ?? formType;

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      <div className="max-w-lg mx-auto px-4 py-8 w-full">
        <header className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-[#1f2937]">
              {formLabel} プレビュー
            </h1>
            <Link
              href="/settings/forms"
              className="px-4 py-2 text-sm text-[#4b5563] hover:text-[#1f2937] hover:bg-[#f3f4f6] rounded-lg transition-colors"
            >
              設定に戻る
            </Link>
          </div>
          <div className="p-3 bg-amber-100 border border-amber-400 rounded-lg">
            <p className="text-sm text-amber-800 font-medium">
              <strong>プレビューモード</strong> - このページは管理者確認用です。実際の回答は送信されません。
            </p>
          </div>
        </header>

        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
          {formType === 'zoukoma' && (
            <ZoukomaForm school={school} period={period} isPreview />
          )}
          {formType === 'moshi' && (
            <MoshiForm school={school} period={period} isPreview />
          )}
          {formType === 'mogi' && (
            <MogiForm school={school} period={period} isPreview />
          )}
          {formType === 'shukaisu' && (
            <ShukaisuForm school={school} period={period} isPreview />
          )}
          {formType === 'soudan' && (
            <SoudanForm school={school} period={period} isPreview />
          )}
          {formType === 'youbi' && (
            <YoubiForm school={school} period={period} isPreview />
          )}
        </div>
      </div>
    </div>
  );
}
