import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * 登録済みポータルアカウントの一覧・紐づけ解除・アカウント削除（アドミン限定）。
 *
 * 認可は招待API（portal-invitations）と揃えて requireAdmin（admin/owner を通す）。
 * portal_* は portal ロール本人しか読めない RLS なので、スタッフ側の運用操作は
 * すべて service role クライアント経由で行う（招待APIと同じ作法）。
 *
 * ★ なぜこの画面が必要か:
 *   テスト運用・本番運用で「誤って別の子に紐づけた」「アカウントを作り直したい」を
 *   スタッフが自己解決できるようにするため。紐づけ解除・アカウント削除のUI/APIは
 *   これが初出（招待の発行/一覧はあるが、受諾後の後始末は手段が無かった）。
 */

/** UUID v4 形式の緩い検証（ハイフン区切り・16進）。値が不正なら早期に 400 で弾く。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LinkedStudentRow {
  student_id: string;
  relation: string;
  students: { last_name: string | null; first_name: string | null } | null;
}

export async function GET(request: NextRequest) {
  // 招待発行と同じくクローズド期間はアドミンのみ扱える。
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const supabase = getPortalServiceClient();

  // アカウント本体。
  // ★ line_user_id の「値そのもの」は返さない（不要な外部識別子を画面に出さない）。
  //   連携の有無だけ boolean に畳んで返す。
  // ★ PostgRESTの1000行上限に注意: 現状テスト段階では少数だが、全件を安定順で返すため
  //   order を明示（last_login_at 降順→created_at 降順）。件数が1000を超える規模に
  //   なったらページング（range）へ切り替える。
  const { data: accounts, error: accErr } = await supabase
    .from('portal_accounts')
    .select('id, display_name, login_id, line_user_id, last_login_at, created_at')
    .order('last_login_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (accErr) {
    console.error('[admin/portal-accounts] アカウント一覧取得に失敗:', accErr.message);
    return NextResponse.json({ error: '一覧の取得に失敗しました' }, { status: 500 });
  }

  const accountRows = (accounts ?? []) as Array<{
    id: string;
    display_name: string;
    login_id: string | null;
    line_user_id: string | null;
    last_login_at: string | null;
    created_at: string;
  }>;

  // 紐づけ生徒（生徒名つき）。アカウントが0件なら .in([]) の無駄打ちを避ける。
  const accountIds = accountRows.map((a) => a.id);
  const linksByAccount = new Map<
    string,
    Array<{ student_id: string; student_name: string; relation: string }>
  >();

  if (accountIds.length > 0) {
    const { data: links, error: linkErr } = await supabase
      .from('portal_account_students')
      .select('account_id, student_id, relation, students(last_name, first_name)')
      .in('account_id', accountIds);

    if (linkErr) {
      console.error('[admin/portal-accounts] 紐づけ取得に失敗:', linkErr.message);
      return NextResponse.json({ error: '一覧の取得に失敗しました' }, { status: 500 });
    }

    // PostgREST は多対一の埋め込み students を単一オブジェクトで返すが、生成型は配列に
    // 推論しがちなため unknown 経由でこちらの明示型に寄せる。
    for (const row of (links ?? []) as unknown as Array<
      LinkedStudentRow & { account_id: string }
    >) {
      const name = row.students
        ? `${row.students.last_name ?? ''} ${row.students.first_name ?? ''}`.trim()
        : '';
      const list = linksByAccount.get(row.account_id) ?? [];
      list.push({
        student_id: row.student_id,
        student_name: name || '（不明な生徒）',
        relation: row.relation,
      });
      linksByAccount.set(row.account_id, list);
    }
  }

  const result = accountRows.map((a) => ({
    id: a.id,
    display_name: a.display_name,
    login_id: a.login_id,
    // 値ではなく有無だけ。画面はこれで「LINE連携」バッジを出す。
    has_line: a.line_user_id != null,
    last_login_at: a.last_login_at,
    students: linksByAccount.get(a.id) ?? [],
  }));

  return NextResponse.json({ accounts: result });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    captureApiError(error, {
      route: 'DELETE /api/admin/portal-accounts',
    });
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const accountId = body.account_id;
  const studentId = body.student_id;

  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) {
    return NextResponse.json({ error: 'アカウントIDが不正です' }, { status: 400 });
  }
  // student_id は「紐づけ1件解除」モードでのみ必須。指定時は形式を検証する。
  const hasStudent = studentId !== undefined && studentId !== null;
  if (hasStudent && (typeof studentId !== 'string' || !UUID_RE.test(studentId))) {
    return NextResponse.json({ error: '生徒IDが不正です' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();

  if (hasStudent) {
    // モード1: 紐づけ1件だけ解除（アカウントは残す）。
    // この保護者/生徒から当該生徒の閲覧権が切れるだけ。他の兄弟の紐づけは残る。
    const { error } = await supabase
      .from('portal_account_students')
      .delete()
      .eq('account_id', accountId)
      .eq('student_id', studentId as string);

    if (error) {
      console.error('[admin/portal-accounts] 紐づけ解除に失敗:', error.message);
      return NextResponse.json({ error: '解除に失敗しました' }, { status: 500 });
    }

    // 対象が無くても 200（冪等）。目的は「その紐づけが存在しないこと」。
    return NextResponse.json({ ok: true, mode: 'unlinked' });
  }

  // モード2: アカウントごと削除。
  // ★ portal_accounts を消すと portal_account_students（紐づけ）と portal_consents
  //   （同意ログ）が on delete cascade で一緒に消える。
  //   これは「アカウント削除＝退会に相当し、同意の主体（本人）が消えるため同意ログも
  //   消える」という設計判断。将来「退会後も同意の証跡を残す」要件が出たら、ここは
  //   物理削除ではなく論理削除（無効フラグ）に作り変える論点になる。
  //   なお portal_invitations.accepted_by は on delete set null なので、招待記録自体は
  //   「誰が受諾したか」を失うだけで残る（発行の履歴は消えない）。
  const { error } = await supabase.from('portal_accounts').delete().eq('id', accountId);

  if (error) {
    console.error('[admin/portal-accounts] アカウント削除に失敗:', error.message);
    return NextResponse.json({ error: '削除に失敗しました' }, { status: 500 });
  }

  // 対象が無くても 200（冪等）。
  return NextResponse.json({ ok: true, mode: 'account_deleted' });
}
