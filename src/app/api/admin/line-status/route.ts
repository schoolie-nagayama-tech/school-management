import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isManagerOrAbove, isSystemAdmin } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { UUID_RE } from '@/lib/api/portalStudentScope';

export const dynamic = 'force-dynamic';

/**
 * LINE連携状況の一覧（設定 → LINE連携状況）。
 *
 * 2つの向きを1本のAPIで返す（?view=）:
 *   - students … 生徒起点。「この生徒の保護者に通知が届くか」を在籍生徒ぜんぶ分。
 *                 ★未招待の生徒も行として出る（既存の portal-accounts はアカウント起点なので出ない）。
 *   - accounts … アカウント起点。「この保護者は何人のお子さまを見ているか」。
 *                 問い合わせの電話を受けたときに名前で引く用途。
 *
 * ★ 認可は manager 以上＋自教室スコープ（生徒詳細の portal-links と同じ境界）。
 *   アカウントは教室に属さないので、accounts ビューは
 *   「指定教室の生徒に紐づくアカウント」に絞り、表示する生徒名も指定教室の分だけにする。
 *   結果として、紐づけ0件の残骸アカウントはこのAPIには出ない（掃除は admin の
 *   /settings/portal-accounts の仕事）。
 *
 * portal_* は portal ロール本人しか読めない RLS のため service role 経由（既存 portal 系と同じ作法）。
 */

/** 生徒1人の連携状態。UIのバッジ・絞り込みと1対1で対応する。 */
export type LineLinkStatus =
  | 'linked' // LINE連携済み・友だち追加中 → 通知が届く
  | 'blocked' // LINE連携済みだがブロック/友だち解除 → 届かない
  | 'idpw' // アカウントはあるがLINE未連携 → 画面のみ
  | 'invited' // 招待済み・未受諾・期限内
  | 'expired' // 招待済み・未受諾・期限切れ
  | 'none' // 招待もアカウントも無い
  | 'excluded'; // 研修用テスト生徒 / デモ教室 → そもそも送らない

/**
 * 生徒の状態は「一番良いもの」を代表にする。
 * 例: 母がLINE連携・父がID/PWなら linked。母がブロック・父がID/PWなら idpw
 *     （＝「まだ画面では見られる」を上に出す。届かない理由の重い順に潰したいのは要対応の側なので、
 *       絞り込みチップで blocked を選べば個別に拾える）。
 */
const STATUS_RANK: Record<LineLinkStatus, number> = {
  linked: 6,
  idpw: 5,
  blocked: 4,
  invited: 3,
  expired: 2,
  none: 1,
  excluded: 0,
};

/** 直近の通知ログを遡る日数。古いログまで舐めると重くなるだけで運用上の意味が薄い。 */
const LOG_LOOKBACK_DAYS = 90;

/** ログの読み取り上限（PostgRESTの1000行上限に自分で当てないよう明示する）。 */
const LOG_SCAN_LIMIT = 1000;

/** 1教室の生徒の読み取り上限。現状の1教室は100名台なので当分当たらない。 */
const STUDENT_SCAN_LIMIT = 2000;

/** 今月の送信通数を数えるときの1ページ件数と最大ページ数（暴走防止）。 */
const USAGE_PAGE_SIZE = 1000;
const USAGE_MAX_PAGES = 20;

interface AccountLite {
  id: string;
  display_name: string;
  login_id: string | null;
  line_user_id: string | null;
  line_followed: boolean | null;
  line_follow_updated_at: string | null;
  last_login_at: string | null;
}

/** 認証・ロール・教室スコープの共通ゲート。 */
async function authorizeSchoolScope(request: NextRequest): Promise<
  | { error: NextResponse; ok?: undefined }
  | {
      ok: true;
      supabase: ReturnType<typeof getPortalServiceClient>;
      schoolId: string;
      role: string;
    }
> {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) };
  }
  if (!isManagerOrAbove(auth.role)) {
    return { error: NextResponse.json({ error: '権限がありません' }, { status: 403 }) };
  }

  const schoolId = request.nextUrl.searchParams.get('school_id') ?? '';
  if (!UUID_RE.test(schoolId)) {
    return { error: NextResponse.json({ error: '教室IDが不正です' }, { status: 400 }) };
  }
  // ★ 自教室スコープ。manager は所属校のみ、admin/owner は全校が schoolIds に入る。
  if (!auth.schoolIds.includes(schoolId)) {
    return { error: NextResponse.json({ error: '教室スコープ外です' }, { status: 403 }) };
  }

  return { ok: true, supabase: getPortalServiceClient(), schoolId, role: auth.role };
}

export async function GET(request: NextRequest) {
  const gate = await authorizeSchoolScope(request);
  if (!gate.ok) return gate.error;
  const { supabase, schoolId, role } = gate;

  const view = request.nextUrl.searchParams.get('view') === 'accounts' ? 'accounts' : 'students';

  return view === 'accounts'
    ? accountsView(supabase, schoolId, request.nextUrl.searchParams.get('q') ?? '')
    : // ★ 送信通数（＝コスト）はアドミンにだけ返す。理由は fetchMonthlyLineUsage のコメント参照。
      studentsView(supabase, schoolId, isSystemAdmin(role));
}

/**
 * 今月のLINE送信実績（全校横断）。
 *
 * ★ なぜアドミン限定で、なぜ教室で絞らないか:
 *   LINE Messaging API の課金は「送信人数 × 配信回数」でアカウント単位に効く。プラン
 *   （フリー / ライト / スタンダード）の判断材料になる数字なので、教室で割っても意味がなく、
 *   むしろ教室長に他教室を含む総数を見せることになる。だから全校の合計を出したうえで
 *   アドミンにだけ返す。
 *
 * ★ status の読み方（migration 20260807000000 のコメントが正典）:
 *   実際に課金されるのは status='sent' のぶんだけ。LINE_PUSH_ENABLED が未設定の間は
 *   dry_run として積まれる（＝送っていない）ので、両方を別々に返して取り違えを防ぐ。
 */
async function fetchMonthlyLineUsage(supabase: ReturnType<typeof getPortalServiceClient>): Promise<{
  month: string;
  sent_messages: number;
  sent_events: number;
  dry_run_events: number;
} | null> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let sentMessages = 0;
  let sentEvents = 0;
  let dryRunEvents = 0;

  // PostgREST に SUM が無いので行を読んで足す。1000行上限に自分で当たらないよう
  // ページングし、暴走しないよう最大ページ数で止める（落とし穴_PostgRESTの1000行上限）。
  for (let page = 0; page < USAGE_MAX_PAGES; page++) {
    const from = page * USAGE_PAGE_SIZE;
    const { data, error } = await supabase
      .from('line_message_logs')
      .select('status, message_count')
      .gte('created_at', monthStart.toISOString())
      .order('created_at', { ascending: false })
      .range(from, from + USAGE_PAGE_SIZE - 1);

    if (error) {
      // コスト表示は補助情報。落ちても一覧は出す（null を返して画面側でカードを出さない）。
      console.warn('[admin/line-status] 送信通数の集計に失敗（非表示で継続）:', error.message);
      return null;
    }

    const rows = (data ?? []) as Array<{ status: string; message_count: number | null }>;
    for (const row of rows) {
      if (row.status === 'sent') {
        sentMessages += row.message_count ?? 0;
        sentEvents += 1;
      } else if (row.status === 'dry_run') {
        dryRunEvents += 1;
      }
    }

    if (rows.length < USAGE_PAGE_SIZE) break;
    if (page === USAGE_MAX_PAGES - 1) {
      console.warn('[admin/line-status] 送信通数の集計がページ上限に到達。数字が過小の可能性あり');
    }
  }

  return {
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    sent_messages: sentMessages,
    sent_events: sentEvents,
    dry_run_events: dryRunEvents,
  };
}

/** 生徒起点のビュー。在籍生徒に招待・アカウント・通知ログを左結合して状態を確定する。 */
async function studentsView(
  supabase: ReturnType<typeof getPortalServiceClient>,
  schoolId: string,
  /** 今月の送信通数（全校・コスト管理用）を含めるか。アドミンのときだけ true。 */
  includeUsage: boolean
): Promise<NextResponse> {
  // 教室がデモ校なら生徒全員が送信対象外（notify.ts のダミーガードと同じ判定）。
  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .select('id, name, is_demo')
    .eq('id', schoolId)
    .maybeSingle();

  if (schoolErr) {
    console.error('[admin/line-status] 教室取得に失敗:', schoolErr.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }
  const isDemoSchool = (school as { is_demo?: boolean | null } | null)?.is_demo === true;

  // 在籍中の生徒だけを対象にする（退塾済みの棚卸しは目的ではない）。
  // ★ PostgREST は未指定だと1000行で静かに切り捨てるので range を明示し、上限に当たったら警告を出す
  //   （落とし穴_PostgRESTの1000行上限）。1教室で1000名を超えたらページングへ作り変える合図。
  const { data: students, error: stuErr } = await supabase
    .from('students')
    .select('id, last_name, first_name, grade, is_test')
    .eq('school_id', schoolId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('grade', { ascending: true })
    .order('last_name_kana', { ascending: true })
    .range(0, STUDENT_SCAN_LIMIT - 1);

  if (stuErr) {
    console.error('[admin/line-status] 生徒取得に失敗:', stuErr.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }
  if ((students ?? []).length >= STUDENT_SCAN_LIMIT) {
    console.warn('[admin/line-status] 生徒が読み取り上限に到達。一覧が欠けている可能性あり');
  }

  type StudentRow = {
    id: string;
    last_name: string;
    first_name: string;
    grade: number | null;
    is_test: boolean | null;
  };
  const studentRows = (students ?? []) as StudentRow[];
  const studentIds = studentRows.map((s) => s.id);

  if (studentIds.length === 0) {
    // 生徒が0名でも送信通数は全校の数字なので、アドミンには返す。
    return NextResponse.json({
      school_name: (school as { name?: string })?.name ?? '',
      rows: [],
      line_usage: includeUsage ? await fetchMonthlyLineUsage(supabase) : null,
    });
  }

  // 紐づけ＋アカウント。
  const { data: links, error: linkErr } = await supabase
    .from('portal_account_students')
    .select(
      'account_id, student_id, relation, relation_note, created_at, ' +
        'portal_accounts(id, display_name, login_id, line_user_id, line_followed, line_follow_updated_at, last_login_at)'
    )
    .in('student_id', studentIds);

  if (linkErr) {
    console.error('[admin/line-status] 紐づけ取得に失敗:', linkErr.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }

  type LinkRow = {
    account_id: string;
    student_id: string;
    relation: string;
    relation_note: string | null;
    created_at: string;
    portal_accounts: AccountLite | null;
  };

  const accountsByStudent = new Map<
    string,
    Array<{
      account_id: string;
      display_name: string;
      relation: string;
      relation_note: string | null;
      has_line: boolean;
      line_followed: boolean | null;
      last_login_at: string | null;
    }>
  >();

  for (const row of (links ?? []) as unknown as LinkRow[]) {
    const a = row.portal_accounts;
    if (!a) continue;
    const hasLine = a.line_user_id != null;
    const list = accountsByStudent.get(row.student_id) ?? [];
    list.push({
      account_id: row.account_id,
      display_name: a.display_name,
      relation: row.relation,
      relation_note: row.relation_note,
      has_line: hasLine,
      // 未連携アカウントの friends 状態は意味を持たないので null（既定値 true を漏らさない）。
      line_followed: hasLine ? a.line_followed !== false : null,
      last_login_at: a.last_login_at,
    });
    accountsByStudent.set(row.student_id, list);
  }

  // 招待（未受諾のものだけ状態に影響する。受諾済みはアカウント側で表現される）。
  const { data: invitations, error: invErr } = await supabase
    .from('portal_invitations')
    .select('student_id, expires_at, accepted_at')
    .in('student_id', studentIds)
    .is('accepted_at', null);

  if (invErr) {
    console.error('[admin/line-status] 招待取得に失敗:', invErr.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }

  // 生徒ごとに「一番期限の遅い未受諾招待」を代表にする（再発行したら新しいほうが生きている）。
  const inviteByStudent = new Map<string, { expires_at: string }>();
  for (const row of (invitations ?? []) as Array<{ student_id: string; expires_at: string }>) {
    const cur = inviteByStudent.get(row.student_id);
    if (!cur || Date.parse(row.expires_at) > Date.parse(cur.expires_at)) {
      inviteByStudent.set(row.student_id, { expires_at: row.expires_at });
    }
  }

  // 直近の通知ログ（生徒ごとの最新1件だけ使う）。
  const since = new Date(Date.now() - LOG_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: logs, error: logErr } = await supabase
    .from('line_message_logs')
    .select('student_id, kind, status, created_at')
    .in('student_id', studentIds)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(LOG_SCAN_LIMIT);

  if (logErr) {
    // 通知履歴は補助情報。落ちても一覧は出す。
    console.warn('[admin/line-status] 通知ログ取得に失敗（空で継続）:', logErr.message);
  }

  const lastLogByStudent = new Map<string, { kind: string; status: string; created_at: string }>();
  for (const row of (logs ?? []) as Array<{
    student_id: string | null;
    kind: string;
    status: string;
    created_at: string;
  }>) {
    if (!row.student_id) continue;
    // created_at 降順で来ているので、最初に見つかったものが最新。
    if (!lastLogByStudent.has(row.student_id)) {
      lastLogByStudent.set(row.student_id, {
        kind: row.kind,
        status: row.status,
        created_at: row.created_at,
      });
    }
  }

  const now = Date.now();

  const rows = studentRows.map((s) => {
    const accounts = accountsByStudent.get(s.id) ?? [];
    const invite = inviteByStudent.get(s.id);

    let status: LineLinkStatus;
    if (isDemoSchool || s.is_test === true) {
      // ダミーガードと同じ境界。通知の宛先解決が必ず空になるので、状態も分けて表示する。
      status = 'excluded';
    } else if (accounts.length > 0) {
      // アカウントがあるときは「一番良い状態」を代表にする。
      const perAccount: LineLinkStatus[] = accounts.map((a) => {
        if (!a.has_line) return 'idpw';
        return a.line_followed === false ? 'blocked' : 'linked';
      });
      status = perAccount.reduce((best, cur) =>
        STATUS_RANK[cur] > STATUS_RANK[best] ? cur : best
      );
    } else if (invite) {
      status = Date.parse(invite.expires_at) < now ? 'expired' : 'invited';
    } else {
      status = 'none';
    }

    return {
      student_id: s.id,
      student_name: `${s.last_name} ${s.first_name}`.trim(),
      grade: s.grade,
      is_test: s.is_test === true,
      status,
      linked_count: accounts.length,
      accounts,
      invite_expires_at: invite?.expires_at ?? null,
      last_login_at: accounts.reduce<string | null>((latest, a) => {
        if (!a.last_login_at) return latest;
        if (!latest || Date.parse(a.last_login_at) > Date.parse(latest)) return a.last_login_at;
        return latest;
      }, null),
      last_log: lastLogByStudent.get(s.id) ?? null,
    };
  });

  return NextResponse.json({
    school_name: (school as { name?: string })?.name ?? '',
    is_demo_school: isDemoSchool,
    rows,
    // アドミン以外には null。画面側もこの値が無ければカードを出さない。
    line_usage: includeUsage ? await fetchMonthlyLineUsage(supabase) : null,
  });
}

/** アカウント起点のビュー。指定教室の生徒に紐づくアカウントだけを返す。 */
async function accountsView(
  supabase: ReturnType<typeof getPortalServiceClient>,
  schoolId: string,
  q: string
): Promise<NextResponse> {
  // students!inner + school_id で「親行そのもの」を絞る（embed だけ絞ると親が残ってしまう）。
  const { data: links, error: linkErr } = await supabase
    .from('portal_account_students')
    .select(
      'account_id, student_id, relation, relation_note, created_at, students!inner(last_name, first_name, grade, school_id)'
    )
    .eq('students.school_id', schoolId);

  if (linkErr) {
    console.error('[admin/line-status] アカウント紐づけ取得に失敗:', linkErr.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }

  type LinkRow = {
    account_id: string;
    student_id: string;
    relation: string;
    relation_note: string | null;
    created_at: string;
    students: {
      last_name: string | null;
      first_name: string | null;
      grade: number | null;
      school_id: string | null;
    } | null;
  };

  const studentsByAccount = new Map<
    string,
    Array<{
      student_id: string;
      student_name: string;
      grade: number | null;
      relation: string;
      relation_note: string | null;
      linked_at: string;
    }>
  >();

  for (const row of (links ?? []) as unknown as LinkRow[]) {
    const s = row.students;
    if (!s) continue;
    const list = studentsByAccount.get(row.account_id) ?? [];
    list.push({
      student_id: row.student_id,
      student_name: `${s.last_name ?? ''} ${s.first_name ?? ''}`.trim() || '（不明な生徒）',
      grade: s.grade ?? null,
      relation: row.relation,
      relation_note: row.relation_note,
      linked_at: row.created_at,
    });
    studentsByAccount.set(row.account_id, list);
  }

  const accountIds = Array.from(studentsByAccount.keys());
  if (accountIds.length === 0) return NextResponse.json({ rows: [] });

  const { data: accounts, error: accErr } = await supabase
    .from('portal_accounts')
    .select(
      'id, display_name, login_id, line_user_id, line_followed, line_follow_updated_at, last_login_at, created_at'
    )
    .in('id', accountIds);

  if (accErr) {
    console.error('[admin/line-status] アカウント取得に失敗:', accErr.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }

  const needle = q.trim().toLowerCase();

  const rows = ((accounts ?? []) as Array<AccountLite & { created_at: string }>)
    .map((a) => {
      const students = studentsByAccount.get(a.id) ?? [];
      const hasLine = a.line_user_id != null;
      return {
        account_id: a.id,
        display_name: a.display_name,
        // ログインIDは「ID・PWで作ったアカウントか」を示すために返す（パスワードは当然返さない）。
        login_id: a.login_id,
        has_line: hasLine,
        line_followed: hasLine ? a.line_followed !== false : null,
        line_follow_updated_at: hasLine ? a.line_follow_updated_at : null,
        last_login_at: a.last_login_at,
        created_at: a.created_at,
        linked_count: students.length,
        students,
      };
    })
    // 検索は表示名と生徒名の両方に当てる（表示名がLINEのニックネームで本名と違うため）。
    .filter((r) => {
      if (!needle) return true;
      if (r.display_name.toLowerCase().includes(needle)) return true;
      return r.students.some((s) => s.student_name.toLowerCase().includes(needle));
    })
    .sort((a, b) => {
      const at = a.last_login_at ? Date.parse(a.last_login_at) : 0;
      const bt = b.last_login_at ? Date.parse(b.last_login_at) : 0;
      return bt - at;
    });

  return NextResponse.json({ rows });
}
