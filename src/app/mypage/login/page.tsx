import { isLineLoginConfigured } from '@/lib/mypage/line';
import { LineLoginButton } from '@/components/mypage/LineLoginButton';
import { LoginForm } from '@/components/mypage/LoginForm';

export const dynamic = 'force-dynamic';

/** LINEログインの失敗理由 → 画面に出す日本語。コードは callback ルートが付ける。 */
const LINE_ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: 'ログインの有効期限が切れました。もう一度お試しください。',
  exchange_failed: 'LINEとの通信に失敗しました。時間をおいて再度お試しください。',
  no_invite: '教室から届いた招待URLからログインしてください。',
  invite_invalid: '招待が無効か期限切れです。教室に再発行をご依頼ください。',
  already_linked:
    'このLINEアカウントは既に別のアカウントと連携されています。教室にお問い合わせください。',
  server_error: 'ログインに失敗しました。時間をおいて再度お試しください。',
};

/**
 * 保護者ポータル ログイン画面。
 *
 * 認証手段は2本（docs/account-line-design.md §4）:
 *   - LINEログイン（保護者の主たる手段）
 *   - 教室発行のID/PW（LINEを持たない生徒向けのフォールバック）
 * どちらも同じポータルセッション（自前署名JWT）に着地する。
 *
 * サーバーコンポーネントなのは、LINEが設定済みかを環境変数で判定して
 * ボタンの出し分けをするため（未設定の環境で押せないボタンを見せない）。
 */
export default function MyPageLoginPage({
  searchParams,
}: {
  searchParams: { line_error?: string };
}) {
  const lineEnabled = isLineLoginConfigured();
  const lineError = searchParams.line_error
    ? (LINE_ERROR_MESSAGES[searchParams.line_error] ?? LINE_ERROR_MESSAGES.server_error)
    : null;

  return (
    <div className="pt-8">
      <h1 className="mb-1 text-xl font-bold text-text-heading">ログイン</h1>
      <p className="mb-6 text-sm text-text-muted">
        {lineEnabled
          ? 'LINE、または教室から配布されたIDとパスワードでログインしてください。'
          : '教室から配布されたIDとパスワードでログインしてください。'}
      </p>

      {lineError && (
        <div className="mb-4 rounded-lg border border-danger bg-danger/10 p-3 text-sm text-danger">
          {lineError}
        </div>
      )}

      {lineEnabled && (
        <>
          <LineLoginButton />
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-text-muted">または</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <LoginForm />
    </div>
  );
}
