import type { Metadata } from 'next';
import { LEGAL_DOCUMENTS, loadLegalMarkdown } from '@/lib/mypage/legal';
import { LegalDocumentView } from '@/components/legal/LegalDocumentView';

/**
 * ★ force-static にする理由（2つ）:
 *   1) docs/legal/*.md の読み込みをビルド時に済ませ、Vercel 実行時のファイル
 *      システムに依存させない（サーバーレス環境では同梱されないことがある）。
 *   2) このページは未ログインでも読めなければならない（登録前に読む必要がある）。
 *      force-static は cookies()/headers() を空にするため、ルートレイアウトの
 *      認証解決も含めて「誰が見ても同じ静的ページ」になる。
 */
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'プライバシーポリシー | NEST',
  description: 'NEST・保護者マイページにおける個人情報の取扱いについて',
};

export default function PrivacyPolicyPage() {
  const markdown = loadLegalMarkdown('privacy_policy');

  return (
    <LegalDocumentView
      markdown={markdown}
      otherDocument={{
        href: LEGAL_DOCUMENTS.terms_of_service.href,
        title: LEGAL_DOCUMENTS.terms_of_service.title,
      }}
    />
  );
}
