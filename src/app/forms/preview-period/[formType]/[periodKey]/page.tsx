import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import type { FormType, FormPeriod } from '@/types/database';
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

  // プレビューは管理画面の機能。ログインセッション付きのサーバークライアントで取得することで、
  // 公開期間外（下書き・終了済み・アーカイブ済み）の期間も RLS の自校スコープで読める。
  // anon クライアントだと「公開期間内」の期間しか見えず 404 になるため使わない。
  const supabase = await createSupabaseServerClient();

  const { data: school } = await supabase
    .from('schools')
    .select('*')
    .eq('id', schoolId)
    .maybeSingle<School>();
  if (!school) {
    notFound();
  }

  const { data: periodRow } = await supabase
    .from('form_periods')
    .select('*')
    .eq('school_id', schoolId)
    .eq('form_type', formType)
    .eq('period_key', periodKey)
    .maybeSingle<FormPeriod>();

  if (!periodRow) {
    notFound();
  }

  // 各フォーム種別の Period 型は form_periods 行に settings を型付けしただけなので、
  // settings を保証して renderPreviewForm 側で種別ごとにキャストする
  const period = { ...periodRow, settings: periodRow.settings ?? {} };

  const formLabel = FORM_TYPE_LABELS[formType as FormType] ?? formType;
  const formNode = await renderPreviewForm(formType, school, period);
  if (!formNode) notFound();

  return (
    <div className="min-h-screen bg-surface-hover">
      <div className="max-w-lg mx-auto px-4 py-8 w-full">
        <header className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-text-heading">
              {formLabel} プレビュー
            </h1>
            <Link
              href="/settings/portal"
              className="px-4 py-2 text-sm text-text-body hover:text-text-heading hover:bg-surface-hover rounded-lg transition-colors duration-150"
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

        <div className="bg-surface-raised rounded-xl border border-border p-6">{formNode}</div>
      </div>
    </div>
  );
}
