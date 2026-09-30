/**
 * 国単位のアクセス制限（日本からのアクセスだけを通す）。
 *
 * ★なぜ入れるか（2026-09-30 セキュリティ総点検）:
 *   NEST を使うのは日本国内の教室・講師・保護者だけなので、海外からのアクセスは
 *   ほぼすべて攻撃（ログイン総当たり・脆弱性探し）になる。入口で落とせば攻撃の量が大きく減る。
 *
 * ★これだけでは守れないもの（誤解しないこと）:
 *   - VPN や国内のサーバーを経由されれば素通りする。あくまで「量を減らす」ための一枚。
 *   - Supabase（*.supabase.co）へ直接来るリクエストには効かない。ブラウザに入っている公開キーで
 *     PostgREST を直接叩く攻撃は、DB の RLS とトリガーで止める（本丸はそちら）。
 *
 * ★国の判定は Vercel が付ける x-vercel-ip-country ヘッダーを使う（クライアントが偽装できない。
 *   Vercel のプロキシが上書きする）。ヘッダーが無い＝Vercel 以外（ローカル開発・テスト）では制限しない。
 */

/** 国の制限をかけないパス（海外のサーバーから届く、機械どうしの通信）。 */
export const GEO_EXEMPT_PATH_PREFIXES: readonly string[] = [
  // Webhook: LINE・Slack・Resend・Notta などのサーバーは海外にある。
  // どれも署名かトークンで送信元を検証しているので、国で絞らなくても偽装はできない。
  '/api/webhooks/',
  '/api/mypage/line/webhook',
  // Vercel Cron: Vercel の基盤から呼ばれ、国は保証されない。CRON_SECRET で認証している。
  '/api/cron/',
];

/** 既定で許可する国（ISO 3166-1 alpha-2）。 */
export const DEFAULT_ALLOWED_COUNTRIES: readonly string[] = ['JP'];

/**
 * 環境変数 GEO_ALLOWED_COUNTRIES（例: "JP,US"）を読んで、許可する国の一覧を返す。
 * 未設定・空なら日本のみ。海外研修などで一時的に広げたいときに、コードを変えずに済むようにする。
 */
export function parseAllowedCountries(raw: string | undefined): string[] {
  const list = (raw ?? '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return list.length > 0 ? list : [...DEFAULT_ALLOWED_COUNTRIES];
}

export function isGeoBlocked(params: {
  /** x-vercel-ip-country の値（無ければ null） */
  country: string | null;
  pathname: string;
  allowedCountries: readonly string[];
  /** GEO_BLOCK_DISABLED=true のとき true（障害時に即座に外せる非常口） */
  disabled?: boolean;
}): boolean {
  const { country, pathname, allowedCountries, disabled } = params;
  if (disabled) return false;
  // ヘッダーが無い＝Vercel 以外（ローカル開発・テスト）。止めると開発ができなくなる。
  if (!country) return false;
  if (GEO_EXEMPT_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return false;
  return !allowedCountries.includes(country.toUpperCase());
}

/** 海外からのアクセスに返すページ（Next.js を通さない純粋なHTML）。 */
export function buildGeoBlockedPage(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>アクセスできません</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f9fafb;color:#1f2937}
.c{text-align:center;max-width:400px;width:100%}
h1{font-size:18px;margin-bottom:12px}
p{font-size:14px;color:#6b7280;line-height:1.8}
.en{margin-top:16px;font-size:12px;color:#9ca3af}
</style>
</head>
<body>
<div class="c">
<h1>このサービスは日本国内からのみご利用いただけます</h1>
<p>海外からのアクセス、または海外を経由する接続（VPNなど）ではご利用になれません。<br>日本国内の通常の回線から、もう一度アクセスしてください。</p>
<p class="en">This service is available only from Japan.</p>
</div>
</body>
</html>`;
}
