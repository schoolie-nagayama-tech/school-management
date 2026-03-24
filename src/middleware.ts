import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/utils/rateLimit';

/**
 * 公開APIエンドポイントのレート制限設定
 * path: マッチするパスプレフィックス
 * limit: ウィンドウ内の最大リクエスト数
 * windowSeconds: ウィンドウの長さ (秒)
 */
const PUBLIC_RATE_LIMITS: Array<{
  path: string;
  limit: number;
  windowSeconds: number;
}> = [
  // フォーム送信系（保護者ポータル）— 1IPあたり 30リクエスト/分
  { path: '/api/portal/form-responses', limit: 30, windowSeconds: 60 },
  // シフト提出系 — 1IPあたり 20リクエスト/分
  { path: '/api/regular-shift/public', limit: 20, windowSeconds: 60 },
  { path: '/api/seasonal-shift/public', limit: 20, windowSeconds: 60 },
  // 埋め込みウィジェット — 1IPあたり 60リクエスト/分
  { path: '/api/embed/', limit: 60, windowSeconds: 60 },
  // 招待完了 — 1IPあたり 10リクエスト/分
  { path: '/api/invite/complete', limit: 10, windowSeconds: 60 },
];

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    request.ip ||
    '0.0.0.0'
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── 公開APIレート制限 ──
  for (const rule of PUBLIC_RATE_LIMITS) {
    if (pathname.startsWith(rule.path)) {
      const ip = getClientIp(request);
      const result = checkRateLimit(ip, rule.path, {
        limit: rule.limit,
        windowSeconds: rule.windowSeconds,
      });

      if (!result.allowed) {
        return NextResponse.json(
          { error: 'リクエストが多すぎます。しばらく待ってから再度お試しください。' },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)),
              'X-RateLimit-Limit': String(rule.limit),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
            },
          }
        );
      }
      break; // 最初にマッチしたルールのみ適用
    }
  }

  // ── Supabase セッション管理 ──
  const supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  await supabase.auth.getSession();

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * 以下のパスを除くすべてのリクエストパスにマッチ:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
