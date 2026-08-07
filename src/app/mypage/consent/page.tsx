import { redirect } from 'next/navigation';
import { getPortalContext } from '@/lib/mypage/supabase';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_KEYS, hasCurrentConsent } from '@/lib/mypage/legal';
import { ConsentForm } from '@/components/mypage/ConsentForm';

export const dynamic = 'force-dynamic';

/**
 * 再同意画面（P3-L4）。
 *
 * プライバシーポリシー・利用規約の版が上がると、旧版にしか同意していない
 * アカウントはダッシュボードからここへ誘導される。
 *
 * 既に現在版へ同意済みのアカウントが直接この URL を開いたときは /mypage に戻す
 * （同じ版に何度も同意させない）。
 */
export default async function ConsentPage() {
  const ctx = await getPortalContext();
  if (!ctx) {
    redirect('/mypage/login');
  }

  if (await hasCurrentConsent(ctx.claims.sub)) {
    redirect('/mypage');
  }

  const documents = LEGAL_DOCUMENT_KEYS.map((key) => ({
    title: LEGAL_DOCUMENTS[key].title,
    href: LEGAL_DOCUMENTS[key].href,
    version: LEGAL_DOCUMENTS[key].version,
  }));

  return (
    <div className="pt-4">
      <h1 className="mb-1 text-xl font-bold text-text-heading">同意のお願い</h1>
      <p className="mb-5 text-sm leading-relaxed text-text-muted">
        マイページのご利用にあたり、次の内容へのご同意が必要です。内容をご確認のうえ、同意してお進みください。
      </p>

      <ConsentForm documents={documents} />
    </div>
  );
}
