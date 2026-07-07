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
  // 公開問合せフォーム（チラシ・看板のQR経由）— 1IPあたり 5リクエスト/分。
  // 保護者の正常送信は数回で十分。service role で insert する無認証 POST のため、
  // ハニーポットに加えてレート制限でスパム・DoS による inquiries 汚染を防ぐ。
  { path: '/api/inquiry-form', limit: 5, windowSeconds: 60 },
  // シフト提出系 — 1IPあたり 20リクエスト/分
  { path: '/api/regular-shift/public', limit: 20, windowSeconds: 60 },
  { path: '/api/seasonal-shift/public', limit: 20, windowSeconds: 60 },
  // 埋め込みウィジェット — 1IPあたり 60リクエスト/分
  { path: '/api/embed/', limit: 60, windowSeconds: 60 },
  // 招待完了 — 1IPあたり 10リクエスト/分
  { path: '/api/invite/complete', limit: 10, windowSeconds: 60 },
  // 招待情報取得（トークン照合）— 1IPあたり 30リクエスト/分（トークン総当たりの多層防御）
  // 注: /api/invite/complete を先に評価するため complete は上の専用ルールが適用される
  { path: '/api/invite/', limit: 30, windowSeconds: 60 },
  // 配信停止（メール内リンク）— 1IPあたり 30リクエスト/分（トークン総当たり対策）
  { path: '/api/inquiries/unsubscribe', limit: 30, windowSeconds: 60 },
];

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    request.ip ||
    '0.0.0.0'
  );
}

function buildInAppBrowserPage(targetUrl: string): string {
  const safeUrl = targetUrl
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
  const jsUrl = targetUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

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
<p>アプリ内ブラウザでは正常に表示できません。<br>下のボタンからURLをコピーして、ブラウザに貼り付けてください。</p>
<button type="button" class="btn" id="cb" onclick="cc()">URLをコピーする</button>
<a href="${safeUrl}" target="_blank" rel="noopener" class="ol">ブラウザで開く</a>
<p class="h">ボタンが動作しない場合は、右上のメニューから「ブラウザで開く」を選択してください</p>
</div>
<script>
function cc(){var b=document.getElementById('cb');try{if(navigator.clipboard){navigator.clipboard.writeText('${jsUrl}').then(function(){b.textContent='コピーしました！ブラウザに貼り付けてください';b.style.background='#047857';r()})}else{f()}}catch(e){f()}function f(){var t=document.createElement('textarea');t.value='${jsUrl}';t.style.cssText='position:fixed;opacity:0';document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);b.textContent='コピーしました！ブラウザに貼り付けてください';b.style.background='#047857';r()}function r(){setTimeout(function(){b.textContent='URLをコピーする';b.style.background='#059669'},3000)}}
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

// メンテナンス画面（純粋HTML / Next.js非依存）。DBリージョン移行などのカットオーバー中に表示する。
// スタイルはインライン完結（静的アセット取得不要）。lucide の wrench アイコンを埋め込み。
function buildMaintenancePage(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>メンテナンス中</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:linear-gradient(to bottom,#ecfdf5,#fff);color:#1f2937}
.c{text-align:center;max-width:400px;width:100%}
.ic{width:52px;height:52px;margin:0 auto 20px;color:#059669}
h1{font-size:20px;margin-bottom:12px}
p{font-size:14px;color:#6b7280;line-height:1.8}
.t{margin-top:18px;font-size:12px;color:#9ca3af}
</style>
</head>
<body>
<div class="c">
<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
<h1>メンテナンス中</h1>
<p>ただいまシステムのメンテナンスを行っています。<br>ご不便をおかけしますが、終了までしばらくお待ちください。</p>
<p class="t">しばらくしてから、もう一度アクセスしてください。</p>
</div>
</body>
</html>`;
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

  // ── メンテナンスモード（環境変数で切替。DB移行などのカットオーバー中に利用を停止） ──
  // MAINTENANCE_MODE=true の間は全リクエストにメンテ画面(503)を返す。静的アセットは config.matcher で除外済み。
  // 管理者は ?maint_bypass=<MAINTENANCE_BYPASS_TOKEN> でアクセスすると cookie が発行され、以降すり抜けて動作確認できる。
  if (process.env.MAINTENANCE_MODE === 'true') {
    const bypassToken = process.env.MAINTENANCE_BYPASS_TOKEN;
    const qpBypass = request.nextUrl.searchParams.get('maint_bypass');
    const cookieBypass = request.cookies.get('maint_bypass')?.value;

    // ?maint_bypass=<token> でアクセス → cookie を発行して通す（管理者の事前確認用）
    if (bypassToken && qpBypass === bypassToken) {
      const res = NextResponse.next();
      res.cookies.set('maint_bypass', bypassToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 6, // 6時間
      });
      return res;
    }

    // バイパス cookie を持たない通常アクセスはメンテ画面
    if (!(bypassToken && cookieBypass === bypassToken)) {
      return new NextResponse(buildMaintenancePage(), {
        status: 503,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Retry-After': '900',
          'Cache-Control': 'no-store',
        },
      });
    }
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
      const html = buildInAppBrowserPage(targetUrl);
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

  // ── 公開ルートはセッション更新をスキップ（DB往復を省いてレイテンシ削減） ──
  const isPublicRoute =
    pathname.startsWith('/portal/') ||
    pathname.startsWith('/seasonal-shift/') ||
    pathname.startsWith('/regular-shift/') ||
    // 公開問合せフォーム・面談セルフ予約（保護者がログインなしでアクセス）
    pathname.startsWith('/inquiry/') ||
    pathname.startsWith('/booking/') ||
    // 追客メールの配信停止（メール内リンクからログインなしでアクセス）
    pathname.startsWith('/inquiries/unsubscribe') ||
    pathname.startsWith('/api/inquiries/unsubscribe') ||
    pathname.startsWith('/api/inquiry-form') ||
    pathname.startsWith('/api/booking/') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/invite/') ||
    pathname.startsWith('/offline') ||
    pathname.startsWith('/api/portal/') ||
    pathname.startsWith('/api/embed/') ||
    pathname.startsWith('/api/seasonal-shift/public') ||
    pathname.startsWith('/api/regular-shift/public') ||
    pathname.startsWith('/api/invite/') ||
    pathname.startsWith('/api/webhooks/');

  if (isPublicRoute) {
    return NextResponse.next();
  }

  // ── Supabase セッション管理（認証が必要なルートのみ） ──
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
