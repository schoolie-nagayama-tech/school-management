import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { captureApiError } from '@/lib/api-error';
import { writeAuditLog } from '@/lib/audit-log';
import { verifyInviterAuthority } from '@/lib/invite/inviterAuthority';
import { normalizeLoginEmail } from '@/lib/utils/loginId';

export const dynamic = 'force-dynamic';

// 招待ページ（src/app/invite/[token]/page.tsx）の入力制限と同じ値にする。
const MIN_PASSWORD_LENGTH = 8;
// Supabase Auth（bcrypt）は72バイトを超えるパスワードを受け付けない。
// 文字数で見ると全角を含む場合に72バイトを超えうるが、その場合は createUser が弾き 400 を返す。
const MAX_PASSWORD_LENGTH = 72;
const MAX_DISPLAY_NAME_LENGTH = 100;

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env not set');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** createUser の「そのメールは登録済み」エラーか。コードが無い古い応答のために文言でも見る。 */
function isEmailExistsError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === 'email_exists' || err.code === 'user_already_exists') return true;
  return /already (been )?registered|already exists/i.test(err.message ?? '');
}

/**
 * スタッフ招待の受諾（アカウント作成）をサーバー側で完結させる。
 *
 * ★以前はブラウザが supabase.auth.signUp でアカウントを作り、その userId をここへ送っていた。
 *   その方式だと Supabase の「新規登録を許可」を本番で ON にしておく必要があり、
 *   公開キーさえあれば招待なしで誰でも authenticated のアカウントを作れてしまっていた。
 *   新規登録を OFF にするため、アカウント作成は service role の admin API で行う。
 *
 * 流れ: 入力検証 → 招待の検証（期限・招待者の権限）→ 招待を確保（accepted_at を条件付きで埋める）
 *       → Auth ユーザー作成 → プロフィール・教室紐付け。途中で失敗したら作ったものを消し、
 *       招待の確保を戻す（招待リンクをもう一度使えるようにする）。
 *
 * ★既に同じメールのアカウントがある場合は 409 で止める。ここでそのアカウントのパスワードを
 *   上書きしたり、既存プロフィールのロールを書き換えたりしない。招待トークンを持っているだけでは
 *   そのアカウントの本人である証明にならず、他人のアカウントを乗っ取れてしまうため。
 *   （旧方式でも既存メールは signUp が「登録済み」で失敗し、同じ結果になっていた）
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      token?: unknown;
      password?: unknown;
      displayName?: unknown;
    } | null;
    const token = body?.token;
    const password = body?.password;
    const rawDisplayName = body?.displayName;

    if (!token || typeof token !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'token と password は必須です' }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください` },
        { status: 400 }
      );
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `パスワードは${MAX_PASSWORD_LENGTH}文字以内で入力してください` },
        { status: 400 }
      );
    }
    const displayName =
      typeof rawDisplayName === 'string' && rawDisplayName.trim()
        ? rawDisplayName.trim().slice(0, MAX_DISPLAY_NAME_LENGTH)
        : null;

    const supabaseAdmin = getSupabaseAdmin();

    // 招待を取得・検証（ここではまだ確保しない。権限の検査で落ちる招待を「使用済み」にしないため）
    const { data: invitation, error: invError } = await supabaseAdmin
      .from('user_invitations')
      .select('id, email, role, school_ids, invited_by, expires_at, accepted_at')
      .eq('token', token)
      .is('accepted_at', null)
      .maybeSingle();

    if (invError || !invitation) {
      return NextResponse.json(
        { error: '招待が見つからないか、既に使用されています' },
        { status: 400 }
      );
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json({ error: '招待の有効期限が切れています' }, { status: 400 });
    }

    const authority = await verifyInviterAuthority(supabaseAdmin, invitation);
    if (!authority.ok) {
      // 理由は利用者に出さない（招待者の状態や権限構成を外部に漏らさない）。サーバーログにだけ残す。
      console.warn('Invite complete: inviter authority rejected', {
        invitationId: invitation.id,
        reason: authority.reason,
      });
      return NextResponse.json(
        { error: 'この招待は無効です。招待した方に再発行を依頼してください' },
        { status: 403 }
      );
    }

    // 招待を確保する。accepted_at IS NULL を条件にした UPDATE で、同じトークンの同時送信
    // （二重クリック・リンクの使い回し）のうち1件だけが先へ進めるようにする。
    // 読み込み→書き込みの間に他のリクエストが割り込んでも、DB の行ロックで片方は0件更新になる。
    const claimedAt = new Date().toISOString();
    const { data: claimedRows, error: claimError } = await supabaseAdmin
      .from('user_invitations')
      .update({ accepted_at: claimedAt })
      .eq('id', invitation.id)
      .is('accepted_at', null)
      .gt('expires_at', claimedAt)
      .select('id');

    if (claimError) {
      console.error('Invite complete: claim error', claimError);
      return NextResponse.json({ error: '招待の完了処理に失敗しました' }, { status: 500 });
    }
    if (!claimedRows || claimedRows.length === 0) {
      return NextResponse.json({ error: 'この招待は既に使用されています' }, { status: 409 });
    }

    // 確保を戻す。accepted_at が自分の書いた値のときだけ戻し、他の処理の結果は上書きしない。
    const releaseClaim = async () => {
      const { error } = await supabaseAdmin
        .from('user_invitations')
        .update({ accepted_at: null })
        .eq('id', invitation.id)
        .eq('accepted_at', claimedAt);
      if (error) console.error('Invite complete: release claim error', error);
    };

    // 途中で失敗したときの後始末。作ったアカウントを消し、招待を再利用できる状態に戻す。
    // user_schools / user_profiles は auth.users 削除の CASCADE に頼らず明示的に消す
    // （FK の張り方が環境で違っても残骸を残さないため）。
    let createdUserId: string | null = null;
    const rollback = async () => {
      if (createdUserId) {
        const uid = createdUserId;
        await supabaseAdmin.from('user_schools').delete().eq('user_id', uid);
        await supabaseAdmin.from('user_profiles').delete().eq('id', uid);
        const { error: delError } = await supabaseAdmin.auth.admin.deleteUser(uid);
        if (delError) console.error('Invite complete: rollback deleteUser error', delError);
      }
      await releaseClaim();
    };

    // 確保した後に例外で抜けると招待が「使用済み」のまま残り、リンクが二度と使えなくなる。
    // 例外時も後始末してから外側の catch に渡す。
    try {
      // ログイン画面と同じ正規化（@ の無いIDは内部ドメインを付ける）。旧方式の signUp と揃える。
      const email = normalizeLoginEmail(invitation.email ?? '');

      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        // 招待メールのリンクを開けた＝そのメールを受け取れる人、として確認済み扱いにする
        // （旧方式でも確認メールは送っていなかった）。
        email_confirm: true,
        user_metadata: displayName ? { display_name: displayName } : undefined,
      });

      if (authError || !authData?.user) {
        await rollback();
        if (isEmailExistsError(authError)) {
          return NextResponse.json(
            {
              error:
                'このメールアドレスは既に登録されています。ログイン画面からログインするか、管理者にお問い合わせください',
              code: 'email_exists',
            },
            { status: 409 }
          );
        }
        const msg = authError?.message ?? '';
        console.error('Invite complete: createUser error', authError);
        if (authError?.code === 'weak_password' || /password/i.test(msg)) {
          return NextResponse.json(
            { error: 'パスワードが要件を満たしていません。別のパスワードを入力してください' },
            { status: 400 }
          );
        }
        return NextResponse.json({ error: 'アカウントの作成に失敗しました' }, { status: 500 });
      }

      const userId = authData.user.id;
      createdUserId = userId;

      const nowIso = new Date().toISOString();
      const { error: profileError } = await supabaseAdmin.from('user_profiles').insert({
        id: userId,
        email: authData.user.email ?? email,
        display_name: displayName,
        role: invitation.role,
        is_active: true,
        invited_by: invitation.invited_by || null,
        invited_at: nowIso,
      });

      if (profileError) {
        console.error('Invite complete: user_profiles insert error', profileError);
        await rollback();
        return NextResponse.json({ error: 'プロファイルの作成に失敗しました' }, { status: 500 });
      }

      // user_schools に招待の教室を紐付け。作ったばかりのユーザーなので既存行は無い（重複だけ除く）。
      const schoolIds = Array.from(
        new Set(Array.isArray(invitation.school_ids) ? (invitation.school_ids as string[]) : [])
      );
      if (schoolIds.length > 0) {
        const { error: schoolError } = await supabaseAdmin
          .from('user_schools')
          .insert(schoolIds.map((schoolId) => ({ user_id: userId, school_id: schoolId })));
        if (schoolError) {
          console.error('Invite complete: user_schools insert error', schoolError);
          await rollback();
          return NextResponse.json({ error: '教室の紐付けに失敗しました' }, { status: 500 });
        }
      }

      await writeAuditLog({
        actorId: userId,
        actorRole: invitation.role,
        action: 'user.invite_accept',
        targetType: 'user_profile',
        targetId: userId,
        detail: {
          invitationId: invitation.id,
          invitedBy: invitation.invited_by,
          role: invitation.role,
          schoolIds,
        },
        request,
      });

      // クライアントはこの email と入力したパスワードで signInWithPassword する。
      return NextResponse.json({ ok: true, email: authData.user.email ?? email });
    } catch (e) {
      await rollback().catch((cleanupError) =>
        console.error('Invite complete: rollback after exception failed', cleanupError)
      );
      throw e;
    }
  } catch (e) {
    captureApiError(e, {
      route: 'POST /api/invite/complete',
    });
    console.error('Invite complete error:', e);
    return NextResponse.json({ error: '招待の完了処理に失敗しました' }, { status: 500 });
  }
}
