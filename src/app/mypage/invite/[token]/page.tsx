import { AlertCircle } from 'lucide-react';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { getPortalContext } from '@/lib/mypage/supabase';
import { isLineLoginConfigured } from '@/lib/mypage/line';
import { InviteAccept } from '@/components/mypage/InviteAccept';

export const dynamic = 'force-dynamic';

/** 招待状態の簡易メッセージ表示。 */
function StatusMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="pt-8">
      <div className="mb-3 flex items-center gap-2 text-text-heading">
        <AlertCircle className="h-5 w-5 text-text-muted" />
        <h1 className="text-lg font-bold">{title}</h1>
      </div>
      <p className="text-sm text-text-muted">{body}</p>
    </div>
  );
}

/** 招待に埋め込む生徒情報の型（service role 取得）。 */
interface InvitationRow {
  invite_type: string;
  expires_at: string;
  accepted_at: string | null;
  students: { last_name: string; first_name: string } | null;
}

/**
 * 招待受諾ページ（サーバー）。
 * service role で招待を取得し、状態（無効/期限切れ/受諾済み/有効）で分岐する。
 * 有効なときだけクライアントの受諾フォームを描画する。
 */
export default async function InvitePage({ params }: { params: { token: string } }) {
  const token = params.token;
  const supabase = getPortalServiceClient();

  const { data, error } = await supabase
    .from('portal_invitations')
    .select('invite_type, expires_at, accepted_at, students(last_name, first_name)')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    return (
      <StatusMessage
        title="エラーが発生しました"
        body="招待の確認に失敗しました。時間をおいて再度お試しください。"
      />
    );
  }

  const invitation = data as unknown as InvitationRow | null;

  if (!invitation) {
    return (
      <StatusMessage
        title="招待が見つかりません"
        body="URLが正しいか、教室に発行済みの招待かをご確認ください。"
      />
    );
  }
  if (invitation.accepted_at) {
    return (
      <StatusMessage
        title="使用済みの招待です"
        body="この招待は既に使われています。ログイン画面からお進みください。"
      />
    );
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return (
      <StatusMessage
        title="招待の有効期限が切れています"
        body="教室に招待の再発行をご依頼ください。"
      />
    );
  }

  // 既にログイン済みかどうか（紐づけ確認モードの分岐に使う）。
  const ctx = await getPortalContext();
  const studentName = invitation.students
    ? `${invitation.students.last_name} ${invitation.students.first_name}`
    : '生徒';

  return (
    <InviteAccept
      token={token}
      inviteType={invitation.invite_type}
      studentName={studentName}
      hasSession={ctx != null}
      lineEnabled={isLineLoginConfigured()}
    />
  );
}
