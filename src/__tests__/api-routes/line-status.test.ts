/**
 * APIルートテスト: /api/admin/line-status (GET)
 *
 * LINE連携状況の一覧。教室長（manager）以上＋自教室スコープ。
 * 次が壊れていないことを固定する:
 *   1) 未認証は 401 / manager 未満は 403（DBに触れない）
 *   2) ★自教室以外の school_id を指定したら 403（他教室の生徒名を覗けない）
 *   3) 生徒別ビューの状態判定（連携済み/ブロック中/ID・PWのみ/招待中/期限切れ/未招待/送信対象外）
 *   4) 複数アカウントがあるときは「一番良い状態」を代表にする
 *   5) デモ教室・研修用テスト生徒は excluded（通知の宛先から外れるのと同じ境界）
 *   6) line_user_id の値は漏らさない
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const authHolder = vi.hoisted(() => ({
  auth: null as null | { userId: string; role: string; schoolIds: string[] },
}));
vi.mock('@/lib/api-auth', () => ({
  getApiAuth: vi.fn(async () => ({ auth: authHolder.auth, cookieResponse: undefined })),
}));

const mockAdmin = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/mypage/serviceClient', () => ({
  getPortalServiceClient: () => mockAdmin,
}));

import { GET } from '@/app/api/admin/line-status/route';

const SCHOOL_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SCHOOL_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111';

function makeRequest(params = `school_id=${SCHOOL_ID}`) {
  return new NextRequest(`http://localhost:3000/api/admin/line-status?${params}`);
}

/**
 * 生徒別ビューが叩くクエリ一式をモックする。
 *   schools → students → portal_account_students → portal_invitations → line_message_logs
 */
function mockStudentsView(options: {
  isDemo?: boolean;
  students: Array<{
    id: string;
    last_name: string;
    first_name: string;
    grade: number | null;
    is_test?: boolean;
  }>;
  links?: unknown[];
  invitations?: Array<{ student_id: string; expires_at: string }>;
  logs?: unknown[];
  /** 今月の送信通数集計（アドミンのときだけ叩かれる .gte().order().range()）。 */
  usageLogs?: Array<{ status: string; message_count: number | null }>;
}) {
  mockAdmin.from.mockImplementation((table: string) => {
    if (table === 'schools') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { id: SCHOOL_ID, name: '松木校', is_demo: options.isDemo === true },
                error: null,
              }),
          }),
        }),
      };
    }
    if (table === 'students') {
      // .eq().eq().is().order().order().range() の順に繋がる（range で解決）
      const chain = {
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        range: () => Promise.resolve({ data: options.students, error: null }),
      };
      return { select: () => chain };
    }
    if (table === 'portal_account_students') {
      return {
        select: () => ({ in: () => Promise.resolve({ data: options.links ?? [], error: null }) }),
      };
    }
    if (table === 'portal_invitations') {
      return {
        select: () => ({
          in: () => ({
            is: () => Promise.resolve({ data: options.invitations ?? [], error: null }),
          }),
        }),
      };
    }
    if (table === 'line_message_logs') {
      return {
        select: () => ({
          // 直近の通知（生徒ごと）: .in().gte().order().limit()
          in: () => ({
            gte: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: options.logs ?? [], error: null }),
              }),
            }),
          }),
          // 今月の送信通数（全校）: .gte().order().range()
          gte: () => ({
            order: () => ({
              range: () => Promise.resolve({ data: options.usageLogs ?? [], error: null }),
            }),
          }),
        }),
      };
    }
    throw new Error(`未設定のテーブル: ${table}`);
  });
}

/** 紐づけ1件を作る補助。 */
function link(
  studentId: string,
  account: { line_user_id?: string | null; line_followed?: boolean; display_name?: string }
) {
  return {
    account_id: ACCOUNT_ID,
    student_id: studentId,
    relation: 'guardian',
    relation_note: null,
    created_at: '2026-07-01T00:00:00.000Z',
    portal_accounts: {
      id: ACCOUNT_ID,
      display_name: account.display_name ?? '山田 母',
      login_id: null,
      line_user_id: account.line_user_id === undefined ? 'U-secret' : account.line_user_id,
      line_followed: account.line_followed ?? true,
      line_follow_updated_at: null,
      last_login_at: '2026-08-30T12:00:00.000Z',
    },
  };
}

const STUDENT = { id: 's-1', last_name: '山田', first_name: '太郎', grade: 8 };

beforeEach(() => {
  vi.clearAllMocks();
  authHolder.auth = { userId: 'u-manager', role: 'manager', schoolIds: [SCHOOL_ID] };
});

describe('認可・教室スコープ', () => {
  it('未認証は 401（DBに触らない）', async () => {
    authHolder.auth = null;
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('manager 未満（teacher）は 403（DBに触らない）', async () => {
    authHolder.auth = { userId: 'u-teacher', role: 'teacher', schoolIds: [SCHOOL_ID] };
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('school_id が uuid でなければ 400（DBに触らない）', async () => {
    const res = await GET(makeRequest('school_id=not-a-uuid'));
    expect(res.status).toBe(400);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('★自教室でない school_id は 403（他教室の生徒名を覗けない）', async () => {
    const res = await GET(makeRequest(`school_id=${OTHER_SCHOOL_ID}`));
    expect(res.status).toBe(403);
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });
});

describe('生徒別ビューの状態判定', () => {
  it('LINE連携＋友だち追加中は linked', async () => {
    mockStudentsView({ students: [STUDENT], links: [link('s-1', {})] });
    const json = await (await GET(makeRequest())).json();
    expect(json.rows[0].status).toBe('linked');
    expect(json.rows[0].linked_count).toBe(1);
    // ★ line_user_id の値そのものは返さない。
    expect(JSON.stringify(json)).not.toContain('U-secret');
  });

  it('LINE連携済みだが友だち解除済みなら blocked', async () => {
    mockStudentsView({ students: [STUDENT], links: [link('s-1', { line_followed: false })] });
    const json = await (await GET(makeRequest())).json();
    expect(json.rows[0].status).toBe('blocked');
  });

  it('LINE未連携（ID・PWのみ）は idpw で、line_followed は null', async () => {
    mockStudentsView({ students: [STUDENT], links: [link('s-1', { line_user_id: null })] });
    const json = await (await GET(makeRequest())).json();
    expect(json.rows[0].status).toBe('idpw');
    expect(json.rows[0].accounts[0].line_followed).toBeNull();
  });

  it('複数アカウントは「一番良い状態」を代表にする（ブロック中＋連携済み→linked）', async () => {
    mockStudentsView({
      students: [STUDENT],
      links: [
        link('s-1', { line_followed: false, display_name: '父' }),
        link('s-1', { line_followed: true, display_name: '母' }),
      ],
    });
    const json = await (await GET(makeRequest())).json();
    expect(json.rows[0].status).toBe('linked');
    expect(json.rows[0].linked_count).toBe(2);
  });

  it('未受諾で期限内の招待があれば invited', async () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    mockStudentsView({
      students: [STUDENT],
      invitations: [{ student_id: 's-1', expires_at: future }],
    });
    const json = await (await GET(makeRequest())).json();
    expect(json.rows[0].status).toBe('invited');
    expect(json.rows[0].invite_expires_at).toBe(future);
  });

  it('未受諾で期限切れなら expired', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    mockStudentsView({
      students: [STUDENT],
      invitations: [{ student_id: 's-1', expires_at: past }],
    });
    const json = await (await GET(makeRequest())).json();
    expect(json.rows[0].status).toBe('expired');
  });

  it('招待もアカウントも無ければ none（★未招待の生徒も行として出る）', async () => {
    mockStudentsView({ students: [STUDENT] });
    const json = await (await GET(makeRequest())).json();
    expect(json.rows).toHaveLength(1);
    expect(json.rows[0].status).toBe('none');
  });

  it('研修用テスト生徒は excluded（連携済みでも通知の宛先から外れるため）', async () => {
    mockStudentsView({
      students: [{ ...STUDENT, is_test: true }],
      links: [link('s-1', {})],
    });
    const json = await (await GET(makeRequest())).json();
    expect(json.rows[0].status).toBe('excluded');
  });

  it('デモ教室は生徒全員 excluded', async () => {
    mockStudentsView({ isDemo: true, students: [STUDENT], links: [link('s-1', {})] });
    const json = await (await GET(makeRequest())).json();
    expect(json.rows[0].status).toBe('excluded');
  });
});

describe('今月のLINE送信（コスト管理）', () => {
  const usageLogs = [
    { status: 'sent', message_count: 3 },
    { status: 'sent', message_count: 2 },
    { status: 'dry_run', message_count: 5 },
    { status: 'skipped', message_count: 0 },
    { status: 'error', message_count: 0 },
  ];

  it('★教室長には返さない（他教室を含む全校の数字なので見せない）', async () => {
    mockStudentsView({ students: [STUDENT], usageLogs });
    const json = await (await GET(makeRequest())).json();
    expect(json.line_usage).toBeNull();
  });

  it('★owner（エリアマネージャー）にも返さない（アドミン限定）', async () => {
    authHolder.auth = { userId: 'u-owner', role: 'owner', schoolIds: [SCHOOL_ID] };
    mockStudentsView({ students: [STUDENT], usageLogs });
    const json = await (await GET(makeRequest())).json();
    expect(json.line_usage).toBeNull();
  });

  it('アドミンには status=sent の message_count だけを合計して返す', async () => {
    authHolder.auth = { userId: 'u-admin', role: 'admin', schoolIds: [SCHOOL_ID] };
    mockStudentsView({ students: [STUDENT], usageLogs });
    const json = await (await GET(makeRequest())).json();
    // 課金対象は sent のみ。dry_run(5) は加算しない。
    expect(json.line_usage.sent_messages).toBe(5);
    expect(json.line_usage.sent_events).toBe(2);
    expect(json.line_usage.dry_run_events).toBe(1);
  });

  it('生徒が0名の教室でもアドミンには送信通数を返す（全校の数字のため）', async () => {
    authHolder.auth = { userId: 'u-admin', role: 'admin', schoolIds: [SCHOOL_ID] };
    mockStudentsView({ students: [], usageLogs });
    const json = await (await GET(makeRequest())).json();
    expect(json.rows).toEqual([]);
    expect(json.line_usage.sent_messages).toBe(5);
  });
});
