import { notFound } from 'next/navigation';
import { getSchoolByCode } from '@/lib/api/schools';
import { loadKoushuApplyForm } from '@/lib/api/koushuApply';
import { KoushuApplyForm } from '@/components/koushu-apply/KoushuApplyForm';
import { EntryScreen } from '@/components/koushu-apply/EntryScreen';

/**
 * 講習申込フォーム（保護者向け・ポータル/生徒コード経由）。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md §10-1・§12。
 * `AdminLayout` は使わない（保護者向け・未ログイン公開ページのため。既存の
 * `/portal/[schoolCode]/zoukoma` 等と同じ構え）。
 *
 * 流れ:
 *  1. 生徒コード未入力 → 入口画面（`EntryScreen`）を表示するだけ。DBには触れない
 *  2. 生徒コード入力後（`?code=`）→ `loadKoushuApplyForm({kind:'studentCode', ...})` を呼ぶ
 *
 * 非公開の担保: 手順2の解決が失敗する理由（生徒コード不一致／非公開期間／トークン相当の
 * 失効等）は `loadKoushuApplyForm` 側で一本化されており、ここではその理由を一切出し分けず
 * 「お申込みページが見つかりません」の一律文言だけを返す（§12: 存在の出し分けをしない）。
 * トークン経由（/koushu-apply/[token]）は生徒コード入力という手前の手順が無いぶん、
 * URLだけで即座に notFound()（実HTTPの404）にできるが、こちらはクライアント入力を経る
 * ため同じ担保をサーバー側の文言表示で行う。どちらもバイパス経路を作らないこと。
 *
 * 教室コード自体（schoolCode）は既存の `/portal/[schoolCode]` と同じく公開情報として扱い、
 * 見つからなければ通常の notFound() にする（講習申込の可否とは別軸の話）。
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface KoushuPortalPageProps {
  params: Promise<{ schoolCode: string }>;
  searchParams: Promise<{ code?: string }>;
}

export default async function KoushuPortalPage({ params, searchParams }: KoushuPortalPageProps) {
  const { schoolCode } = await params;
  const { code } = await searchParams;

  const school = await getSchoolByCode(schoolCode);
  if (!school) {
    notFound();
  }

  const studentCode = typeof code === 'string' ? code.trim() : '';
  if (!studentCode) {
    return (
      <div className="min-h-[100dvh] bg-[#f8f9fa]">
        <div className="max-w-lg mx-auto min-h-[100dvh] bg-white">
          <EntryScreen schoolCode={schoolCode} />
        </div>
      </div>
    );
  }

  const result = await loadKoushuApplyForm({ kind: 'studentCode', schoolCode, studentCode });
  if (!result.ok) {
    return (
      <div className="min-h-[100dvh] bg-[#f8f9fa] flex items-center justify-center px-4">
        <div className="max-w-sm w-full bg-white rounded-xl border border-[var(--stroke)] p-6 text-center space-y-2">
          <p className="text-sm font-semibold text-[var(--headline)]">
            お申込みページが見つかりません
          </p>
          <p className="text-xs text-[var(--paragraph)]">
            生徒コードをご確認いただくか、教室までお問い合わせください。
          </p>
        </div>
      </div>
    );
  }

  return <KoushuApplyForm data={result.data} identity={{ schoolCode, studentCode }} />;
}
