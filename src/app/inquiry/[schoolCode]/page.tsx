import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import InquiryForm from './InquiryForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface InquiryPageProps {
  params: Promise<{ schoolCode: string }>;
  searchParams: Promise<{ src?: string }>;
}

/**
 * school を service role で解決する。
 * anon ポリシーは存在するが、公開ページのサーバー側解決は
 * service role を使って確実に取得する（セキュリティ方針統一）。
 */
async function getSchoolByCodePublic(code: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data } = await admin
    .from('schools')
    .select('id, name, code, logo_url')
    .eq('code', code)
    .maybeSingle();

  return data as { id: string; name: string; code: string; logo_url: string | null } | null;
}

/**
 * 公開問合せフォームページ。
 * URL: /inquiry/[schoolCode]?src=チラシ
 * ログイン不要。チラシ・看板・QRコードからの流入を受け付ける。
 */
export default async function InquiryPage({ params, searchParams }: InquiryPageProps) {
  const { schoolCode } = await params;
  const { src } = await searchParams;

  const school = await getSchoolByCodePublic(schoolCode);
  if (!school) {
    notFound();
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#f8f9fa]">
      {/* ヘッダー — portal と同じトーン */}
      <header
        className="bg-white border-b border-[#e5e7eb]"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="max-w-lg mx-auto px-5 py-4 sm:py-5">
          <div className="flex items-center gap-3">
            {school.logo_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={school.logo_url}
                alt={school.name}
                className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-[#1a1a1a] flex items-center justify-center flex-shrink-0">
                <span className="text-white text-sm font-bold">{school.name.charAt(0)}</span>
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-[#1a1a1a] truncate leading-tight">
                {school.name}
              </h1>
              <p className="text-xs text-[#6b7280] mt-0.5">お問い合わせ</p>
            </div>
          </div>
        </div>
      </header>

      {/* フォーム本体（Client Component） */}
      <main className="flex-1 max-w-lg mx-auto w-full px-4 sm:px-5 py-5 sm:py-6 pb-[env(safe-area-inset-bottom)]">
        <p className="text-[13px] text-[#6b7280] leading-relaxed mb-5 px-1">
          お気軽にご入力のうえ送信してください。担当者よりご連絡いたします。
        </p>
        <InquiryForm schoolCode={schoolCode} schoolName={school.name} src={src ?? ''} />
      </main>
    </div>
  );
}
