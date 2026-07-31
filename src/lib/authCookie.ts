/**
 * スタッフ用ログインセッションの cookie / storage 名。
 *
 * ★ なぜ定数にするか（2回同じ事故が起きている）:
 *   ブラウザクライアント(src/lib/supabase.ts)が auth.storageKey にこの名前を指定するため、
 *   セッション cookie は `sb-auth-token.0` / `.1` という名前で保存される。
 *   一方 @supabase/ssr の createServerClient は cookie 名を storageKey ではなく
 *   **cookieOptions.name** から決める。片方だけ直書きで足すと、サーバー側が
 *   既定名（sb-<projectref>-auth-token）の cookie を探して見つけられず、
 *   ログイン済みなのに「認証なし」と判定される。
 *
 *   実際に踏んだ事故:
 *   - Phase3 のサーバー事前取得が常に null（supabase-server.ts で指定漏れ）
 *   - ロゴ画像のアップロードが必ず401（api-auth.ts の getApiAuth で指定漏れ）
 *
 *   サーバー側で createServerClient を作るときは必ず
 *   `cookieOptions: { name: AUTH_COOKIE_NAME }` を渡すこと。
 *
 * ★ 保護者ポータルのセッションは別 cookie（portal_session / lib/mypage/session.ts）。
 *   主体が違うので統合しない。
 */
export const AUTH_COOKIE_NAME = 'sb-auth-token';
