import type { Metadata } from 'next';
import { LEGAL_DOCUMENTS, loadLegalMarkdown } from '@/lib/mypage/legal';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView';

/**
 * ★ force-static にする理由は /privacy と同じ（ビルド時にmdを読み切る／未ログインで見える）。
 */
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: '利用規約 | NEST',
  description: '保護者マイページのご利用条件',
};

export default function TermsOfServicePage() {
  const markdown = loadLegalMarkdown('terms_of_service');

  return (
    <LegalDocumentView
      markdown={markdown}
      otherDocument={{
        href: LEGAL_DOCUMENTS.privacy_policy.href,
        title: LEGAL_DOCUMENTS.privacy_policy.title,
      }}
    />
  );
}
