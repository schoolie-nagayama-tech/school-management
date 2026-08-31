import { NextRequest, NextResponse } from 'next/server';
import { authorizeStudentScope, UUID_RE } from '@/lib/api/portalStudentScope';

export const dynamic = 'force-dynamic';

/**
 * 生徒スコープの保護者ポータル紐づけ 一覧(GET)・追加(POST)・解除(DELETE)。
 *
 * ★ 設定→ポータルアカウント（/api/admin/portal-accounts, requireAdmin＝admin/owner・全校横断）
 *   とは別物。あちらは「教室横断でアカウントを棚卸しし、アカウントごと削除もできる」管理者用。
 *   こちらは生徒詳細モーダルの文脈に絞り、認可を **manager 以上＋自教室スコープ** に下げて
 *   教室長が入会時にその場で紐づけを直せるようにする（工程表 P2-9 の manager 開放に対応）。
 *   認可の実体は lib/api/portalStudentScope.ts に一本化している。
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

/** 直近の通知として返す件数（生徒詳細のカードに収まる数）。 */
const RECENT_LOG_LIMIT = 3;

/** POST で受け付ける続柄。招待受諾（invite/accept）と同じ2択に揃える。 */
const GUARDIAN_RELATIONS = ['guardian', 'other'] as const;
type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];

/** 「その他」を選んだときの続柄メモの最大長（invite/accept の RELATION_NOTE_MAX と揃える）。 */
const RELATION_NOTE_MAX = 20;

interface LinkRow {
  account_id: string;
  relation: string;
  relation_note: string | null;
  created_at: string;
  portal_accounts: {
    id: string;
    display_name: string;
    login_id: string | null;
    line_user_id: string | null;
    line_followed: boolean | null;
    line_follow_updated_at: string | null;
    last_login_at: string | null;
  } | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  const { studentId: studentIdRaw } = await params;
  const gate = await authorizeStudentScope(request, studentIdRaw);
  if (!gate.ok) return gate.error;
  const { supabase, studentId, auth } = gate;

  // この生徒に紐づくアカウントを、アカウント情報つきで取得する。
  const { data: links, error } = await supabase
    .from('portal_account_students')
    .select(
      'account_id, relation, relation_note, created_at, ' +
        'portal_accounts(id, display_name, login_id, line_user_id, line_followed, line_follow_updated_at, last_login_at)'
    )
    .eq('student_id', studentId);

  if (error) {
    console.error('[admin/students/portal-links] 紐づけ取得に失敗:', error.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }

  // PostgREST は多対一の埋め込み portal_accounts を単一オブジェクトで返すが、生成型は配列に
  // 推論しがちなため unknown 経由でこちらの明示型に寄せる。
  const rows = ((links ?? []) as unknown as LinkRow[]).filter((r) => r.portal_accounts != null);

  // ★ そのアカウントが「他にどの生徒を見ているか」（＝兄弟）を逆引きする。
  //   問い合わせ対応で「弟の報告書も見えていますか」に即答するための情報。
  //   自教室スコープを守るため、auth.schoolIds に含まれる教室の生徒だけを返す
  //   （他教室の兄弟がいても、教室長には名前を出さない）。
  const accountIds = rows.map((r) => r.account_id);
  const othersByAccount = new Map<
    string,
    Array<{ student_id: string; student_name: string; grade: number | null }>
  >();

  if (accountIds.length > 0) {
    const { data: others, error: othersErr } = await supabase
      .from('portal_account_students')
      .select('account_id, student_id, students(last_name, first_name, grade, school_id)')
      .in('account_id', accountIds)
      .neq('student_id', studentId);

    if (othersErr) {
      console.error('[admin/students/portal-links] 兄弟の逆引きに失敗:', othersErr.message);
      return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
    }

    type OtherRow = {
      account_id: string;
      student_id: string;
      students: {
        last_name: string | null;
        first_name: string | null;
        grade: number | null;
        school_id: string | null;
      } | null;
    };

    for (const row of (others ?? []) as unknown as OtherRow[]) {
      const s = row.students;
      // 生徒が取れない（削除済み等）／自教室外は落とす。
      if (!s || !s.school_id || !auth.schoolIds.includes(s.school_id)) continue;
      const name = `${s.last_name ?? ''} ${s.first_name ?? ''}`.trim();
      const list = othersByAccount.get(row.account_id) ?? [];
      list.push({
        student_id: row.student_id,
        student_name: name || '（不明な生徒）',
        grade: s.grade ?? null,
      });
      othersByAccount.set(row.account_id, list);
    }
  }

  // 直近のLINE送信ログ（コスト台帳を通知履歴として読む）。本文は保存していないので種別と結果だけ。
  const { data: logs, error: logErr } = await supabase
    .from('line_message_logs')
    .select('id, kind, status, detail, recipient_count, created_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(RECENT_LOG_LIMIT);

  if (logErr) {
    // 通知履歴は補助情報。ここで500にすると紐づけ一覧まで見えなくなるので、空で続行する。
    console.warn('[admin/students/portal-links] 通知ログ取得に失敗（空で継続）:', logErr.message);
  }

  // ★ line_user_id の「値そのもの」は返さない（不要な外部識別子を画面に出さない）。
  //   連携の有無だけ has_line boolean に畳む（portal-accounts API と同じ方針）。
  const accounts = rows.map((r) => {
    const a = r.portal_accounts!;
    const hasLine = a.line_user_id != null;
    return {
      account_id: r.account_id,
      display_name: a.display_name,
      login_id: a.login_id,
      has_line: hasLine,
      // 連携していないアカウントの友だち状態は意味を持たないので null にする
      // （line_followed の既定値 true をそのまま返すと「友だち追加中」に見えてしまう）。
      line_followed: hasLine ? a.line_followed !== false : null,
      line_follow_updated_at: hasLine ? a.line_follow_updated_at : null,
      last_login_at: a.last_login_at,
      linked_at: r.created_at,
      relation: r.relation,
      relation_note: r.relation_note,
      other_students: othersByAccount.get(r.account_id) ?? [],
    };
  });

  return NextResponse.json({
    accounts,
    recent_logs: logs ?? [],
  });
}

/**
 * 既存アカウントにこの生徒を紐づける（兄弟の追加登録）。
 *
 * ★ なぜ招待の往復なしで足せるようにするか:
 *   兄弟は「弟の招待を発行 → 保護者がログインしたまま受諾URLを開く」でも紐づけられる
 *   （invite/accept のモードa）。ただし保護者が2枚目のQRで新規登録を選ぶと別アカウントが増え、
 *   「弟だけ通知が来ない」という分かりにくい状態になる。教室側から確実に足せる経路を用意する。
 *
 * ★ これは「他人のアカウントに、この生徒の閲覧権を与える」操作である。
 *   取り違えると別家庭に成績・報告書が見える事故になるので、
 *   - 対象アカウントは「自教室の生徒に既に紐づいている」ものだけに限る（下の所属検証）
 *   - UI 側では確認ダイアログを必須にする
 *   の2段で守る。誤って足しても DELETE ですぐ外せる。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> }
) {
  const { studentId: studentIdRaw } = await params;
  const gate = await authorizeStudentScope(request, studentIdRaw);
  if (!gate.ok) return gate.error;
  const { supabase, studentId, auth } = gate;

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

  const relationRaw = body.relation;
  if (
    typeof relationRaw !== 'string' ||
    !GUARDIAN_RELATIONS.includes(relationRaw as GuardianRelation)
  ) {
    return NextResponse.json(
      { error: '続柄（保護者・その他）を選択してください' },
      { status: 400 }
    );
  }
  const relation = relationRaw as GuardianRelation;

  // 「その他」は自由入力を必須にする（誰なのか分からない紐づけを作らない・invite/accept と同じ規則）。
  let relationNote: string | null = null;
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

  // ★ 対象アカウントの所属検証:
  //   「自教室の生徒に1件でも紐づいているアカウント」だけを許可する。
  //   これが無いと、アカウントIDを推測（または他画面から拾って）差し替えるだけで、
  //   面識のない家庭のアカウントに自教室の生徒を紐づけられてしまう。
  //   紐づけ0件のアカウント（作り直しの残骸）もここで弾かれる＝掃除は admin の仕事。
  const { data: ownedLinks, error: ownErr } = await supabase
    .from('portal_account_students')
    .select('student_id, students(school_id)')
    .eq('account_id', accountId);

  if (ownErr) {
    console.error('[admin/students/portal-links] アカウント所属の確認に失敗:', ownErr.message);
    return NextResponse.json({ error: '紐づけに失敗しました' }, { status: 500 });
  }

  type OwnRow = { student_id: string; students: { school_id: string | null } | null };
  const ownRows = (ownedLinks ?? []) as unknown as OwnRow[];
  const inMySchool = ownRows.some(
    (r) => r.students?.school_id && auth.schoolIds.includes(r.students.school_id)
  );
  if (!inMySchool) {
    return NextResponse.json(
      {
        error:
          'このアカウントは教室スコープ外です（自教室の生徒に紐づくアカウントのみ追加できます）',
      },
      { status: 403 }
    );
  }

  // 紐づけを1行入れる。既に同じ (account_id, student_id) があれば冪等に成功扱い。
  const { error } = await supabase.from('portal_account_students').upsert(
    {
      account_id: accountId,
      student_id: studentId,
      relation,
      relation_note: relationNote,
    },
    { onConflict: 'account_id,student_id', ignoreDuplicates: true }
  );

  if (error) {
    console.error('[admin/students/portal-links] 紐づけ追加に失敗:', error.message);
    return NextResponse.json({ error: '紐づけに失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
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
