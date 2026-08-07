import { NextRequest, NextResponse } from 'next/server';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { getPortalContext } from '@/lib/mypage/supabase';
import { validatePassword, hashPassword } from '@/lib/mypage/password';
import { signPortalJwt } from '@/lib/mypage/jwt';
import { setPortalSession } from '@/lib/mypage/session';

export const dynamic = 'force-dynamic';

/**
 * 保護者招待で選べる relation。生徒招待は 'self' 固定。
 * 父・母の区別は運用で使わないため 2026-08-05 に「保護者 / その他」へ整理した
 * （マイグレーション 20260805000000）。その他は relation_note に自由入力を持つ。
 */
const GUARDIAN_RELATIONS = ['guardian', 'other'] as const;
type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];

/** その他を選んだときの続柄メモの最大長（画面の1行入力に見合う長さ）。 */
const RELATION_NOTE_MAX = 20;

/**
 * 招待受諾。2モード（docs/portal-v2-requirements.md Stage1）。
 *
 * body: { token, display_name?, login_id?, password?, relation?, relation_note? }
 *
 * (a) 既ログイン（有効な portal_session あり）: 現アカウントに生徒紐づけを追加。
 * (b) 未ログイン: { display_name, login_id, password, relation } でアカウント作成
 *     → 紐づけ → accepted マーク → 自動ログイン（cookieセット）。
 *
 * relation は invite_type='student' なら強制 'self'、'guardian' なら guardian/other。
 * other のときは relation_note（自由入力）を必須にする。
 * login_id 重複は 409。
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const token = body.token;
  if (typeof token !== 'string' || !token) {
    return NextResponse.json({ error: '招待トークンがありません' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();

  // ── 招待の検証（存在・未使用・期限内） ──
  const { data: invitation, error: invErr } = await supabase
    .from('portal_invitations')
    .select('id, token, student_id, invite_type, expires_at, accepted_at')
    .eq('token', token)
    .maybeSingle();

  if (invErr) {
    console.error('[mypage/invite/accept] 招待検索に失敗:', invErr.message);
    return NextResponse.json({ error: '受諾に失敗しました' }, { status: 500 });
  }
  if (!invitation) {
    return NextResponse.json({ error: '招待が見つかりません' }, { status: 404 });
  }
  if (invitation.accepted_at) {
    return NextResponse.json({ error: 'この招待は既に使用されています' }, { status: 409 });
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json({ error: '招待の有効期限が切れています' }, { status: 410 });
  }

  // ── relation の確定 ──
  // 生徒招待は 'self' 固定（自己昇格の防止）。保護者招待は body の relation を検証。
  let relation: 'self' | GuardianRelation;
  let relationNote: string | null = null;
  if (invitation.invite_type === 'student') {
    relation = 'self';
  } else {
    const r = body.relation;
    if (typeof r !== 'string' || !GUARDIAN_RELATIONS.includes(r as GuardianRelation)) {
      return NextResponse.json(
        { error: '続柄（保護者・その他）を選択してください' },
        { status: 400 }
      );
    }
    relation = r as GuardianRelation;

    // 「その他」は自由入力を必須にする（誰なのか分からない紐づけを作らない）。
    if (relation === 'other') {
      const note = body.relation_note;
      if (typeof note !== 'string' || !note.trim()) {
        return NextResponse.json({ error: '続柄を入力してください（例: 祖母）' }, { status: 400 });
      }
      if (note.trim().length > RELATION_NOTE_MAX) {
        return NextResponse.json(
          { error: `続柄は${RELATION_NOTE_MAX}文字以内で入力してください` },
          { status: 400 }
        );
      }
      relationNote = note.trim();
    }
  }

  // ── モード判定: 有効なセッションがあれば (a)、無ければ (b) ──
  const ctx = await getPortalContext();

  if (ctx) {
    // ── (a) 既ログイン: 現アカウントに紐づけを追加 ──
    const accountId = ctx.claims.sub;
    const linkResult = await linkStudent(
      supabase,
      accountId,
      invitation.student_id,
      relation,
      relationNote
    );
    if (linkResult.error) return linkResult.error;

    const marked = await markAccepted(supabase, invitation.id, accountId);
    if (marked) return marked;

    return NextResponse.json({ ok: true, mode: 'linked' });
  }

  // ── (b) 未ログイン: アカウント作成 → 紐づけ → 受諾 → 自動ログイン ──
  const display_name = body.display_name;
  const login_id = body.login_id;
  const password = body.password;

  if (typeof display_name !== 'string' || !display_name.trim()) {
    return NextResponse.json({ error: '表示名を入力してください' }, { status: 400 });
  }
  if (typeof login_id !== 'string' || !login_id.trim()) {
    return NextResponse.json({ error: 'ログインIDを入力してください' }, { status: 400 });
  }
  const pwError = validatePassword(password);
  if (pwError) {
    return NextResponse.json({ error: pwError }, { status: 400 });
  }

  const password_hash = await hashPassword(password as string);

  // アカウント作成（login_id 重複は unique 制約違反 23505 → 409）。
  const { data: created, error: createErr } = await supabase
    .from('portal_accounts')
    .insert({ display_name: display_name.trim(), login_id: login_id.trim(), password_hash })
    .select('id, display_name')
    .single();

  if (createErr) {
    if (createErr.code === '23505') {
      return NextResponse.json({ error: 'このログインIDは既に使われています' }, { status: 409 });
    }
    console.error('[mypage/invite/accept] アカウント作成に失敗:', createErr.message);
    return NextResponse.json({ error: 'アカウント作成に失敗しました' }, { status: 500 });
  }

  const accountId = created.id;

  // 生徒紐づけ。失敗したら作ったアカウントを後始末して 500。
  const linkResult = await linkStudent(
    supabase,
    accountId,
    invitation.student_id,
    relation,
    relationNote
  );
  if (linkResult.error) {
    await supabase.from('portal_accounts').delete().eq('id', accountId);
    return linkResult.error;
  }

  const marked = await markAccepted(supabase, invitation.id, accountId);
  if (marked) return marked;

  // 自動ログイン（JWT署名 + cookie）。
  const jwt = await signPortalJwt(accountId);
  await setPortalSession(jwt);

  return NextResponse.json({
    ok: true,
    mode: 'created',
    account: { id: accountId, display_name: created.display_name },
  });
}

/**
 * portal_account_students に紐づけを1行入れる。
 * 既に同じ (account_id, student_id) があれば冪等に成功扱い（onConflict do nothing）。
 */
async function linkStudent(
  supabase: ReturnType<typeof getPortalServiceClient>,
  accountId: string,
  studentId: string,
  relation: string,
  relationNote: string | null
): Promise<{ error: NextResponse | null }> {
  const { error } = await supabase
    .from('portal_account_students')
    .upsert(
      { account_id: accountId, student_id: studentId, relation, relation_note: relationNote },
      { onConflict: 'account_id,student_id', ignoreDuplicates: true }
    );
  if (error) {
    console.error('[mypage/invite/accept] 紐づけに失敗:', error.message);
    return { error: NextResponse.json({ error: '生徒の紐づけに失敗しました' }, { status: 500 }) };
  }
  return { error: null };
}

/**
 * 招待を受諾済みにマークする（accepted_at / accepted_by）。
 * @returns エラー時は NextResponse、成功時は null
 */
async function markAccepted(
  supabase: ReturnType<typeof getPortalServiceClient>,
  invitationId: string,
  accountId: string
): Promise<NextResponse | null> {
  const { error } = await supabase
    .from('portal_invitations')
    .update({ accepted_at: new Date().toISOString(), accepted_by: accountId })
    .eq('id', invitationId);
  if (error) {
    console.error('[mypage/invite/accept] 受諾マークに失敗:', error.message);
    return NextResponse.json({ error: '受諾処理に失敗しました' }, { status: 500 });
  }
  return null;
}
