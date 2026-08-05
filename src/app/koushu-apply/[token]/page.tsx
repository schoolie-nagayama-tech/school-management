import { notFound } from 'next/navigation';
import { loadKoushuApplyForm } from '@/lib/api/koushuApply';
import { KoushuApplyForm } from '@/components/koushu-apply/KoushuApplyForm';

/**
 * 講習申込フォーム（保護者向け・トークン経由）。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md §10-1・§12。
 * 講習提案書から個別配布したトークン付きURL（乱数列）で開く経路。
 * `AdminLayout` は使わない（保護者向け・未ログイン公開ページのため）。
 *
 * 非公開の担保: `loadKoushuApplyForm` は
 *  - トークンが存在しない／失効済み → not_found / revoked
 *  - `course_prep_periods.apply_publish_start/end` が現在時刻を含まない
 *    （NULLの場合を含む。2027年2月まではこれに該当する）→ not_published
 * のいずれでも `ok:false` を返す。ここではその区別をせず一律 `notFound()`（実HTTPの404）にする。
 * これをバイパスするクエリパラメータやプレビュー経路は一切作らないこと。
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface KoushuApplyTokenPageProps {
  params: Promise<{ token: string }>;
}

export default async function KoushuApplyTokenPage({ params }: KoushuApplyTokenPageProps) {
  const { token } = await params;

  const result = await loadKoushuApplyForm({ kind: 'token', token });
  if (!result.ok) {
    notFound();
  }

  return <KoushuApplyForm data={result.data} identity={{ token }} />;
}
