import { MessageCircle } from 'lucide-react';

interface LineLoginButtonProps {
  /** 招待URL起点のとき、その招待トークン。ログイン後に招待ページへ戻る。 */
  invite?: string;
  /** ボタン文言（既定は「LINEでログイン」）。 */
  label?: string;
}

/**
 * 「LINEでログイン」ボタン。
 *
 * 実体はただのリンク（/api/mypage/line/start への GET）。フォーム送信ではないので
 * クライアント状態を持たない。押すとLINEの認可画面へ飛び、コールバックで
 * ポータルセッションが張られて戻ってくる。
 *
 * 色は LINE のブランドカラー（#06C755）。ブランド要件で色は固定なので
 * デザイントークンではなく直値で持つ。
 */
export function LineLoginButton({ invite, label = 'LINEでログイン' }: LineLoginButtonProps) {
  const href = invite
    ? `/api/mypage/line/start?invite=${encodeURIComponent(invite)}`
    : '/api/mypage/line/start';

  return (
    <a
      href={href}
      className="flex w-full items-center justify-center rounded-lg bg-[#06C755] px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
    >
      <MessageCircle className="mr-2 h-4 w-4" />
      {label}
    </a>
  );
}
