import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';

export const dynamic = 'force-dynamic';

/**
 * 生徒スコープの保護者ポータル紐づけ 一覧(GET)・解除(DELETE)。
 *
 * ★ 設定→ポータルアカウント（/api/admin/portal-accounts, requireAdmin＝admin/owner・全校横断）
 *   とは別物。あちらは「教室横断でアカウントを棚卸しし、アカウントごと削除もできる」管理者用。
 *   こちらは生徒詳細モーダルの文脈に絞り、認可を **manager 以上＋自教室スコープ** に下げて
 *   教室長が入会時にその場で紐づけを直せるようにする（工程表 P2-9 の manager 開放に対応）。
 *
 * ★ アカウント削除機能をここに置かない理由:
 *   生徒詳細の文脈で自然なのは「この生徒とこの保護者の紐づけを外す」だけ。アカウント本体の
 *   抹消は「その保護者が持つ他生徒の閲覧権も失う／ログイン権自体が消える」という生徒1名を
 *   超えた影響があり、教室長の生徒単位の操作としては危険すぎる。アカウント抹消は全校を見渡せる
 *   admin 専用（portal-accounts の DELETE {account_id}）に留める、という設計判断。
 *
 * portal_* は portal ロール本人しか読めない RLS のため、スタッフ側の運用操作はすべて
 * service role クライアント（getPortalServiceClient）経由で行う（既存 portal 系 API と同じ作法）。
 */

/** UUID 形式の緩い検証（ハイフン区切り・16進）。不正値は早期に 400 で弾く。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 共通の前段処理: 認証・ロール・studentId 検証・生徒取得・教室スコープ検証。
 *
 * GET/DELETE の両方で「manager 以上か」「この生徒は自教室か」を必ず通す必要があるため一本化する。
 * @returns 成功時 { supabase, studentId }。失敗時 { error }（そのまま return する NextResponse）。
 */
async function authorizeStudentScope(
  request: NextRequest,
  studentIdRaw: string
): Promise<
  | { error: NextResponse; ok?: undefined }
  | { ok: true; supabase: ReturnType<typeof getPortalServiceClient>; studentId: string }
> {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) };
  }
  // 教室長（manager）以上のみ。teacher など下位ロールはここで弾く。
  if (!isManagerOrAbove(auth.role)) {
    return { error: NextResponse.json({ error: '権限がありません' }, { status: 403 }) };
  }
  // パスパラメータの形式検証（不正な studentId でDBに触れない）。
  if (!UUID_RE.test(studentIdRaw)) {
    return { error: NextResponse.json({ error: '生徒IDが不正です' }, { status: 400 }) };
  }

  const supabase = getPortalServiceClient();

  // 生徒の所属校を取得（存在確認も兼ねる）。
  const { data: student, error: studentErr } = await supabase
    .from('students')
    .select('id, school_id')
    .eq('id', studentIdRaw)
    .maybeSingle();

  if (studentErr) {
    console.error('[admin/students/portal-links] 生徒取得に失敗:', studentErr.message);
    return { error: NextResponse.json({ error: '取得に失敗しました' }, { status: 500 }) };
  }
  if (!student) {
    return { error: NextResponse.json({ error: '生徒が見つかりません' }, { status: 404 }) };
  }

  // ★ 教室スコープ検証（IDOR防止の核心）:
  //   auth.schoolIds は admin/owner なら全校、manager なら所属校のみ。この生徒の school_id が
  //   その中に無ければ「他教室の生徒」なので 403 で弾き、以降のDB操作（解除）へ進ませない。
  //   これが無いと、manager が生徒IDを差し替えるだけで他教室の紐づけを解除できてしまう。
  const schoolId = (student as { school_id: string | null }).school_id;
  if (!schoolId || !auth.schoolIds.includes(schoolId)) {
    return { error: NextResponse.json({ error: '教室スコープ外です' }, { status: 403 }) };
  }

  return { ok: true, supabase, studentId: studentIdRaw };
}

interface LinkRow {
  account_id: string;
  relation: string;
  relation_note: string | null;
  portal_accounts: { id: string; display_name: string; line_user_id: string | null } | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  const { studentId: studentIdRaw } = await params;
  const gate = await authorizeStudentScope(request, studentIdRaw);
  if (!gate.ok) return gate.error;
  const { supabase, studentId } = gate;

  // この生徒に紐づくアカウントを、アカウント表示名つきで取得する。
  const { data: links, error } = await supabase
    .from('portal_account_students')
    .select('account_id, relation, relation_note, portal_accounts(id, display_name, line_user_id)')
    .eq('student_id', studentId);

  if (error) {
    console.error('[admin/students/portal-links] 紐づけ取得に失敗:', error.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }

  // PostgREST は多対一の埋め込み portal_accounts を単一オブジェクトで返すが、生成型は配列に
  // 推論しがちなため unknown 経由でこちらの明示型に寄せる。
  const rows = (links ?? []) as unknown as LinkRow[];

  // ★ line_user_id の「値そのもの」は返さない（不要な外部識別子を画面に出さない）。
  //   連携の有無だけ has_line boolean に畳む（portal-accounts API と同じ方針）。
  const accounts = rows
    .filter((r) => r.portal_accounts != null)
    .map((r) => ({
      account_id: r.account_id,
      display_name: r.portal_accounts!.display_name,
      has_line: r.portal_accounts!.line_user_id != null,
      relation: r.relation,
      relation_note: r.relation_note,
    }));

  return NextResponse.json({ accounts });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  const { studentId: studentIdRaw } = await params;
  const gate = await authorizeStudentScope(request, studentIdRaw);
  if (!gate.ok) return gate.error;
  const { supabase, studentId } = gate;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const accountId = body.account_id;
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) {
    return NextResponse.json({ error: 'アカウントIDが不正です' }, { status: 400 });
  }

  // ★ この生徒×このアカウントの portal_account_students を1行だけ削除する。
  //   ＝この生徒の閲覧権だけを切る。アカウント本体・他の兄弟の紐づけ・同意ログは残す
  //   （アカウント抹消はここではやらない。冒頭コメントの設計判断を参照）。
  const { error } = await supabase
    .from('portal_account_students')
    .delete()
    .eq('account_id', accountId)
    .eq('student_id', studentId);

  if (error) {
    console.error('[admin/students/portal-links] 紐づけ解除に失敗:', error.message);
    return NextResponse.json({ error: '解除に失敗しました' }, { status: 500 });
  }

  // 対象が無くても 200（冪等）。目的は「その紐づけが存在しないこと」。
  return NextResponse.json({ ok: true });
}
