/**
 * APIルートテスト: /api/tasks (POST) の教室スコープ
 *
 * このルートは service role クライアント（RLS 完全バイパス）で動くため、
 * マルチテナントの境界を守れるのはアプリ側の判定だけ。次を固定する:
 *   1) 自教室外の school_id を指定した操作は 403（DB に触れない）
 *   2) 自教室の school_id を指定した通常フローは従来どおり通る
 *   3) schoolId 省略時、教室長はベースタスク（全教室共通）を書き換えず
 *      自教室ぶんのオーバーライドに落ちる
 *   4) 講習タスクの一括削除（全教室ぶん）は admin / owner のみ
 *   5) ロールの大文字小文字で判定がぶれない
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createMockSupabaseAdmin, createMockChain } from './helpers';

const mockAdmin = createMockSupabaseAdmin();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin),
}));

const authHolder = vi.hoisted(() => ({
  auth: null as null | { userId: string; role: string; schoolIds: string[] },
}));

vi.mock('@/lib/api-auth', () => ({
  getApiAuth: vi.fn(async () => ({ auth: authHolder.auth, cookieResponse: undefined })),
  // isSchoolInScope は検証対象そのものなので true 固定のモックにはせず、実装と同じ判定を置く。
  isSchoolInScope: (targetSchoolId: string, callerSchoolIds: string[]) =>
    callerSchoolIds.includes(targetSchoolId),
}));

const MY_SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MY_SCHOOL_2 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OTHER_SCHOOL = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TASK_ID = '11111111-1111-1111-1111-111111111111';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 各テーブルへのアクセスを記録しつつ、共通のクエリチェーンを返す */
function mockTables(resolved: unknown = null) {
  const chains = new Map<string, ReturnType<typeof createMockChain>>();
  mockAdmin.from.mockImplementation(((table: string) => {
    if (!chains.has(table)) chains.set(table, createMockChain(resolved));
    return chains.get(table) as never;
  }) as unknown as () => Record<string, ReturnType<typeof vi.fn>>);
  return chains;
}

describe('POST /api/tasks の教室スコープ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authHolder.auth = { userId: 'u1', role: 'manager', schoolIds: [MY_SCHOOL] };
  });

  it('update_task: 自教室外の schoolId は 403（DBに触れない）', async () => {
    const chains = mockTables({ task_id: TASK_ID });
    const { POST } = await import('@/app/api/tasks/route');

    const res = await POST(
      makeRequest({
        action: 'update_task',
        taskId: TASK_ID,
        updates: { task_name: '乗っ取り' },
        schoolId: OTHER_SCHOOL,
      })
    );

    expect(res.status).toBe(403);
    expect(chains.size).toBe(0);
  });

  it('delete_task: 自教室外の schoolId は 403（DBに触れない）', async () => {
    const chains = mockTables();
    const { POST } = await import('@/app/api/tasks/route');

    const res = await POST(
      makeRequest({ action: 'delete_task', taskId: TASK_ID, schoolId: OTHER_SCHOOL })
    );

    expect(res.status).toBe(403);
    expect(chains.size).toBe(0);
  });

  it('toggle_check: 自教室外の schoolId は 403（DBに触れない）', async () => {
    const chains = mockTables();
    const { POST } = await import('@/app/api/tasks/route');

    const res = await POST(
      makeRequest({
        action: 'toggle_check',
        taskId: TASK_ID,
        schoolId: OTHER_SCHOOL,
        isCompleted: true,
      })
    );

    expect(res.status).toBe(403);
    expect(chains.size).toBe(0);
  });

  it('update_task: 自教室の schoolId ならオーバーライドとして保存される（通常フロー）', async () => {
    const chains = mockTables({ task_id: TASK_ID, school_id: MY_SCHOOL });
    const { POST } = await import('@/app/api/tasks/route');

    const res = await POST(
      makeRequest({
        action: 'update_task',
        taskId: TASK_ID,
        updates: { task_name: '名称変更' },
        schoolId: MY_SCHOOL,
      })
    );

    expect(res.status).toBe(200);
    const overrides = chains.get('monthly_task_overrides');
    expect(overrides).toBeDefined();
    expect(overrides!.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ school_id: MY_SCHOOL, task_name: '名称変更' }),
      { onConflict: 'task_id,school_id' }
    );
    // ベースタスクには触れていない
    expect(chains.has('monthly_tasks')).toBe(false);
  });

  it('update_task: schoolId 省略時、教室長はベースタスクではなく自教室のオーバーライドに落ちる', async () => {
    authHolder.auth = { userId: 'u1', role: 'manager', schoolIds: [MY_SCHOOL, MY_SCHOOL_2] };
    const chains = mockTables();
    const { POST } = await import('@/app/api/tasks/route');

    const res = await POST(
      makeRequest({ action: 'update_task', taskId: TASK_ID, updates: { task_name: '名称変更' } })
    );

    expect(res.status).toBe(200);
    expect(chains.has('monthly_tasks')).toBe(false);
    const rows = chains.get('monthly_task_overrides')!.upsert.mock.calls[0][0] as Array<{
      school_id: string;
    }>;
    expect(rows.map((r) => r.school_id).sort()).toEqual([MY_SCHOOL, MY_SCHOOL_2].sort());
  });

  it('delete_task: schoolId 省略時、教室長はタスクを削除せず自教室ぶんを非表示にする', async () => {
    const chains = mockTables();
    const { POST } = await import('@/app/api/tasks/route');

    const res = await POST(makeRequest({ action: 'delete_task', taskId: TASK_ID }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ type: 'hidden' });
    // monthly_tasks の delete は呼ばれていない
    expect(chains.has('monthly_tasks')).toBe(false);
    const rows = chains.get('monthly_task_overrides')!.upsert.mock.calls[0][0] as Array<{
      school_id: string;
      is_hidden: boolean;
    }>;
    expect(rows).toEqual([expect.objectContaining({ school_id: MY_SCHOOL, is_hidden: true })]);
  });

  it('delete_task: admin が schoolId を省略した場合は従来どおりベースタスクを削除する', async () => {
    authHolder.auth = { userId: 'u1', role: 'admin', schoolIds: [MY_SCHOOL, OTHER_SCHOOL] };
    const chains = mockTables();
    const { POST } = await import('@/app/api/tasks/route');

    const res = await POST(makeRequest({ action: 'delete_task', taskId: TASK_ID }));

    expect(res.status).toBe(200);
    expect(chains.get('monthly_tasks')!.delete).toHaveBeenCalled();
  });

  it('delete_course_tasks: 教室長は 403（全教室ぶんが消えるため）', async () => {
    const chains = mockTables();
    const { POST } = await import('@/app/api/tasks/route');

    const res = await POST(makeRequest({ action: 'delete_course_tasks', year: 2026, month: 8 }));

    expect(res.status).toBe(403);
    expect(chains.size).toBe(0);
  });

  it('delete_course_tasks: admin は従来どおり実行できる', async () => {
    authHolder.auth = { userId: 'u1', role: 'admin', schoolIds: [MY_SCHOOL, OTHER_SCHOOL] };
    const chains = mockTables([{ id: TASK_ID }]);
    const { POST } = await import('@/app/api/tasks/route');

    const res = await POST(makeRequest({ action: 'delete_course_tasks', year: 2026, month: 8 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: 1 });
    expect(chains.get('monthly_tasks')!.delete).toHaveBeenCalled();
  });

  it('ロールの大文字小文字で編集可否がぶれない（Manager でも編集できる）', async () => {
    authHolder.auth = { userId: 'u1', role: 'Manager', schoolIds: [MY_SCHOOL] };
    mockTables({ task_id: TASK_ID, school_id: MY_SCHOOL });
    const { POST } = await import('@/app/api/tasks/route');

    const res = await POST(
      makeRequest({
        action: 'update_task',
        taskId: TASK_ID,
        updates: { task_name: '名称変更' },
        schoolId: MY_SCHOOL,
      })
    );

    expect(res.status).toBe(200);
  });

  it('講師ロールは編集できない（403）', async () => {
    authHolder.auth = { userId: 'u1', role: 'teacher', schoolIds: [MY_SCHOOL] };
    const chains = mockTables();
    const { POST } = await import('@/app/api/tasks/route');

    const res = await POST(
      makeRequest({
        action: 'update_task',
        taskId: TASK_ID,
        updates: { task_name: 'x' },
        schoolId: MY_SCHOOL,
      })
    );

    expect(res.status).toBe(403);
    expect(chains.size).toBe(0);
  });

  it('未認証は 401', async () => {
    authHolder.auth = null;
    const { POST } = await import('@/app/api/tasks/route');
    const res = await POST(makeRequest({ action: 'update_task', taskId: TASK_ID, updates: {} }));
    expect(res.status).toBe(401);
  });
});
