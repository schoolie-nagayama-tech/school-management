import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getPortalContext } from '@/lib/mypage/supabase';
import { getPortalReport } from '@/lib/mypage/reports';
import { ReportDetail } from '@/components/mypage/ReportDetail';

export const dynamic = 'force-dynamic';

/**
 * 授業報告書の詳細ページ（§7-4・UIモック セクション2）。
 *
 * ★ 取得は portal クライアント（RLS/限定公開ビュー越し）:
 *   承認前・他人の生徒・退塾超過・他教室はビューが弾き null → 404。
 *   「見えない」と「存在しない」を区別しない（未公開の報告書の存在を漏らさない）。
 */
export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;

  const ctx = await getPortalContext();
  if (!ctx) redirect('/mypage/login');

  const report = await getPortalReport(ctx.client, reportId);
  if (!report) notFound();

  const subtitle = [
    report.subjectNames.join('・'),
    report.teacherName ? `${report.teacherName}先生` : null,
  ]
    .filter(Boolean)
    .join(' ・ ');

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/mypage/reports"
          aria-label="報告書一覧に戻る"
          className="flex-none text-text-muted transition-colors hover:text-text-heading"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold text-text-heading">
            {formatLessonDate(report.lessonDate)} の報告書
          </h1>
          {subtitle && <p className="truncate text-xs text-text-muted">{subtitle}</p>}
        </div>
      </div>

      <ReportDetail report={report} />
    </div>
  );
}

/** 'YYYY-MM-DD' → '7月14日(月)'。 */
function formatLessonDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = ['日', '月', '火', '水', '木', '金', '土'][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
  return `${m}月${d}日(${dow})`;
}
