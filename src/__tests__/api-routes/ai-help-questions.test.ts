/**
 * APIルートテスト: /api/ai/help/questions (GET)
 *
 * AIの答え合わせ（/admin/ai-feedback）にAIヘルプの評価を並べるため、
 * 一覧（rows）に加えて件数（summary）を返すようにした。そのための確認。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getApiAuth = vi.fn();
const getPortalServiceClient = vi.fn();

vi.mock('@/lib/api-auth', () => ({ getApiAuth: (...a: unknown[]) => getApiAuth(...a) }));
vi.mock('@/lib/mypage/serviceClient', () => ({
  getPortalServiceClient: () => getPortalServiceClient(),
}));

type Row = {
  question: string;
  role: string;
  page_path: string | null;
  created_at: string;
  unanswered: boolean;
  helpful: boolean | null;
};

/**
 * help_questions だけを持つ偽のクライアント。
 * head:true の select は「件数を数える」呼び出しで、eq の組み合わせで件数を返す。
 */
function fakeClient(opts: {
  rows?: Row[];
  counts?: Record<string, number>;
  countFails?: boolean;
  listFails?: boolean;
}) {
  const { rows = [], counts = {}, countFails = false, listFails = false } = opts;
  return {
    from: () => ({
      select: (_cols: string, selectOpts?: { head?: boolean }) => {
        if (selectOpts?.head) {
          const filters: string[] = [];
          const builder = {
            eq(col: string, val: unknown) {
              filters.push(`${col}=${String(val)}`);
              return builder;
            },
            then(resolve: (v: { count: number | null; error: unknown }) => void) {
              const key = filters.join('&') || 'all';
              resolve(
                countFails
                  ? { count: null, error: { message: 'boom' } }
                  : { count: counts[key] ?? 0, error: null }
              );
            },
          };
          return builder;
        }
        const chain = {
          or: () => chain,
          order: () => chain,
          limit: () =>
            Promise.resolve(
              listFails ? { data: null, error: { message: 'boom' } } : { data: rows, error: null }
            ),
        };
        return chain;
      },
    }),
  };
}

const req = () => new NextRequest('http://localhost:3000/api/ai/help/questions');

describe('GET /api/ai/help/questions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未ログインは401', async () => {
    getApiAuth.mockResolvedValue({ auth: null });
    const { GET } = await import('@/app/api/ai/help/questions/route');
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('システム管理者以外は403', async () => {
    getApiAuth.mockResolvedValue({ auth: { userId: 'u1', role: 'manager' } });
    const { GET } = await import('@/app/api/ai/help/questions/route');
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it('件数（summary）と、文面で畳んだ一覧を返す', async () => {
    getApiAuth.mockResolvedValue({ auth: { userId: 'u1', role: 'admin' } });
    getPortalServiceClient.mockReturnValue(
      fakeClient({
        rows: [
          {
            question: '請求の締め日は？',
            role: 'manager',
            page_path: '/billing',
            created_at: '2026-09-10T03:00:00Z',
            unanswered: true,
            helpful: null,
          },
          {
            question: '請求の締め日は？',
            role: 'manager',
            page_path: '/billing',
            created_at: '2026-09-09T03:00:00Z',
            unanswered: true,
            helpful: null,
          },
          {
            question: '座席表の色の意味',
            role: 'teacher',
            page_path: '/schedule',
            created_at: '2026-09-08T03:00:00Z',
            unanswered: false,
            helpful: false,
          },
        ],
        counts: {
          all: 40,
          'helpful=true': 21,
          'helpful=false': 4,
          'unanswered=true': 6,
          'degraded=true': 1,
        },
      })
    );

    const { GET } = await import('@/app/api/ai/help/questions/route');
    const res = await GET(req());
    const json = await res.json();

    expect(json.available).toBe(true);
    expect(json.summary).toEqual({
      total: 40,
      helpful: 21,
      notHelpful: 4,
      unanswered: 6,
      degraded: 1,
    });
    // 同じ文面は1行に畳んで回数にする。回数の多いものが先
    expect(json.rows).toHaveLength(2);
    expect(json.rows[0]).toMatchObject({ question: '請求の締め日は？', count: 2 });
    expect(json.rows[0].lastAskedAt).toBe('2026-09-10T03:00:00Z');
  });

  it('件数が数えられなくても一覧は返し、summary は0で埋めずに null にする', async () => {
    getApiAuth.mockResolvedValue({ auth: { userId: 'u1', role: 'admin' } });
    getPortalServiceClient.mockReturnValue(
      fakeClient({
        rows: [
          {
            question: '請求の締め日は？',
            role: 'manager',
            page_path: null,
            created_at: '2026-09-10T03:00:00Z',
            unanswered: true,
            helpful: null,
          },
        ],
        countFails: true,
      })
    );

    const { GET } = await import('@/app/api/ai/help/questions/route');
    const json = await (await GET(req())).json();

    expect(json.available).toBe(true);
    expect(json.summary).toBeNull();
    expect(json.rows).toHaveLength(1);
  });

  it('一覧が読めないときは available=false（テーブル未作成でも画面を壊さない）', async () => {
    getApiAuth.mockResolvedValue({ auth: { userId: 'u1', role: 'admin' } });
    getPortalServiceClient.mockReturnValue(fakeClient({ listFails: true }));

    const { GET } = await import('@/app/api/ai/help/questions/route');
    const json = await (await GET(req())).json();

    expect(json).toEqual({ rows: [], summary: null, available: false });
  });
});
