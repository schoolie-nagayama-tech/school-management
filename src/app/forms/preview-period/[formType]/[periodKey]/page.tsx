import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getDefaultSchoolId, getSchool } from '@/lib/api/schools';
import { getZoukomaPeriodByKey } from '@/lib/api/zoukoma';
import { getMoshiPeriodByKey } from '@/lib/api/moshi';
import { getMogiPeriodByKey } from '@/lib/api/mogi';
import { getShukaisuPeriodByKey } from '@/lib/api/shukaisu';
import { getSoudanPeriodByKey } from '@/lib/api/soudan';
import { getYoubiPeriodByKey } from '@/lib/api/youbi';
import type { FormType } from '@/types/database';
import { FORM_TYPE_LABELS } from '@/types/database';
import type { School } from '@/types/database';
import type { ZoukomaPeriod } from '@/types/forms/zoukoma';
import type { MoshiPeriod } from '@/types/forms/moshi';
import type { MogiPeriod } from '@/types/forms/mogi';
import type { ShukaisuPeriod } from '@/types/forms/shukaisu';
import type { SoudanPeriod } from '@/types/forms/soudan';
import type { YoubiPeriod } from '@/types/forms/youbi';

export const dynamic = 'force-dynamic';

/** 1リサイスト1フォーム種別のみ動的 import（バンドル分割） */
async function renderPreviewForm(
  formType: string,
  school: School,
  period: unknown
): Promise<ReactNode> {
  switch (formType) {
    case 'zoukoma': {
      const { ZoukomaForm } = await import('@/components/forms/zoukoma/ZoukomaForm');
      return <ZoukomaForm school={school} period={period as ZoukomaPeriod} isPreview />;
    }
    case 'moshi': {
      const { MoshiForm } = await import('@/components/forms/moshi');
      return <MoshiForm school={school} period={period as MoshiPeriod} isPreview />;
    }
    case 'mogi': {
      const { MogiForm } = await import('@/components/forms/mogi');
      return <MogiForm school={school} period={period as MogiPeriod} isPreview />;
    }
    case 'shukaisu': {
      const { ShukaisuForm } = await import('@/components/forms/shukaisu');
      return <ShukaisuForm school={school} period={period as ShukaisuPeriod} isPreview />;
    }
    case 'soudan': {
      const { SoudanForm } = await import('@/components/forms/soudan');
      return <SoudanForm school={school} period={period as SoudanPeriod} isPreview />;
    }
    case 'youbi': {
      const { YoubiForm } = await import('@/components/forms/youbi');
      return <YoubiForm school={school} period={period as YoubiPeriod} isPreview />;
    }
    default:
      return null;
  }
}

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

  const formLabel = FORM_TYPE_LABELS[formType as FormType] ?? formType;
  const formNode = await renderPreviewForm(formType, school, period);
  if (!formNode) notFound();

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      <div className="max-w-lg mx-auto px-4 py-8 w-full">
        <header className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-[#1f2937]">
              {formLabel} プレビュー
            </h1>
            <Link
              href="/settings/portal"
              className="px-4 py-2 text-sm text-[#4b5563] hover:text-[#1f2937] hover:bg-[#f3f4f6] rounded-lg transition-colors duration-150"
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

        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">{formNode}</div>
      </div>
    </div>
  );
}
