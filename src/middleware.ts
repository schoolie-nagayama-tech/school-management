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

function buildInAppBrowserPage(targetUrl: string, isAndroid: boolean): string {
  const safeUrl = targetUrl.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const jsUrl = targetUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const cleanUrl = targetUrl.replace(/^https?:\/\//, '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const scheme = targetUrl.startsWith('https') ? 'https' : 'http';
  const intentUrl = `intent://${cleanUrl}#Intent;scheme=${scheme};action=android.intent.action.VIEW;end`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>ブラウザで開く</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:linear-gradient(to bottom,#ecfdf5,#fff)}
.c{text-align:center;max-width:320px;width:100%}
h1{font-size:18px;color:#1f2937;margin-bottom:12px}
p{font-size:14px;color:#6b7280;line-height:1.6;margin-bottom:20px}
.btn{display:block;width:100%;padding:14px;font-size:16px;font-weight:700;color:#fff;background:#059669;border:none;border-radius:12px;text-decoration:none;text-align:center;margin-bottom:12px;cursor:pointer;-webkit-tap-highlight-color:transparent}
.btn:active{background:#047857}
.ol{display:block;width:100%;padding:12px;font-size:14px;color:#374151;background:#fff;border:2px solid #d1d5db;border-radius:12px;text-align:center;cursor:pointer;margin-bottom:16px;-webkit-tap-highlight-color:transparent}
.ol:active{background:#f3f4f6}
.ok{color:#059669;font-weight:600;border-color:#059669}
.h{font-size:12px;color:#9ca3af;line-height:1.5}
</style>
</head>
<body>
<div class="c">
<h1>ブラウザで開いてください</h1>
<p>アプリ内ブラウザでは正常に表示できません。</p>
<a href="${safeUrl}" target="_blank" rel="noopener" class="btn">ブラウザで開く</a>
<button type="button" class="ol" id="cb" onclick="cc()">URLをコピーして貼り付ける</button>
<p class="h">ボタンが動作しない場合は、右上のメニューから「ブラウザで開く」を選択してください</p>
</div>
<script>
${isAndroid ? `try{location.href='${intentUrl}'}catch(e){}` : ''}
function cc(){var b=document.getElementById('cb');try{if(navigator.clipboard){navigator.clipboard.writeText('${jsUrl}').then(function(){b.textContent='コピーしました';b.className='ol ok';r()})}else{f()}}catch(e){f()}function f(){var t=document.createElement('textarea');t.value='${jsUrl}';t.style.cssText='position:fixed;opacity:0';document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);b.textContent='コピーしました';b.className='ol ok';r()}function r(){setTimeout(function(){b.textContent='URLをコピーして貼り付ける';b.className='ol'},2000)}}
</script>
</body>
</html>`;
}

function isInAppBrowser(ua: string): boolean {
  if (/Line|FBAN|FBAV|Instagram|Twitter|MicroMessenger|KAKAOTALK|Grow/i.test(ua)) return true;
  if (/Android/i.test(ua) && /; wv\)/.test(ua)) return true;
  if (/Android/i.test(ua) && /Version\/[\d.]+.*Chrome/i.test(ua)) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // セッション更新が不要な静的メタファイルはスキップ（Edge の無駄な getSession を削減）
  if (
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname.endsWith('.webmanifest')
  ) {
    return NextResponse.next();
  }

  // ── アプリ内ブラウザ → 純粋HTML（Next.js不使用）で外部ブラウザ誘導 ──
  if (pathname.startsWith('/portal/')) {
    const ua = request.headers.get('user-agent') || '';
    const hasOpenBrowserFlag = request.nextUrl.searchParams.get('openExternalBrowser') === '1';
    const isAndroid = /Android/i.test(ua);

    // openExternalBrowser=1 付き＋Android → UA関係なくブリッジページ
    // または UA検出でアプリ内ブラウザと判定
    if ((hasOpenBrowserFlag && isAndroid) || isInAppBrowser(ua)) {
      // ブリッジページのリンク先からパラメータを除去（ブラウザで開いた後に再度ブリッジにならないようにする）
      const cleanUrl = new URL(request.nextUrl.toString());
      cleanUrl.searchParams.delete('openExternalBrowser');
      const targetUrl = cleanUrl.toString();
      const html = buildInAppBrowserPage(targetUrl, isAndroid);
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
  }

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
