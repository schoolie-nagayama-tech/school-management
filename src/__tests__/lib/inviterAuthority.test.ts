/**
 * スタッフ招待の「招待者にその権限を配る資格があるか」の判定。
 * ユーザー作成API（/api/admin/users/create）の規則（自分と同等以上は不可・教室長以上のみ・
 * 担当教室の範囲内のみ）と一致していることを固定する。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  canInviterGrantRole,
  areSchoolsInInviterScope,
  verifyInviterAuthority,
} from '@/lib/invite/inviterAuthority';

describe('canInviterGrantRole', () => {
  it('自分より厳密に下のロールだけ付与できる', () => {
    expect(canInviterGrantRole('manager', 'teacher')).toBe(true);
    expect(canInviterGrantRole('owner', 'manager')).toBe(true);
    expect(canInviterGrantRole('admin', 'owner')).toBe(true);
  });

  // 権限昇格の本丸: 教室長が管理者やエリアマネージャーの招待を作っても受諾させない
  it('教室長は自分と同等以上（manager / owner / admin）を付与できない', () => {
    expect(canInviterGrantRole('manager', 'manager')).toBe(false);
    expect(canInviterGrantRole('manager', 'owner')).toBe(false);
    expect(canInviterGrantRole('manager', 'admin')).toBe(false);
  });

  // ユーザー作成APIと同じく、管理者にも例外は無い
  it('管理者でも管理者は付与できない（作成APIと同じ規則）', () => {
    expect(canInviterGrantRole('admin', 'admin')).toBe(false);
  });

  it('講師・保護者・ロール不明の人は招待者になれない', () => {
    expect(canInviterGrantRole('teacher', 'parent')).toBe(false);
    expect(canInviterGrantRole('parent', 'parent')).toBe(false);
    expect(canInviterGrantRole('', 'teacher')).toBe(false);
    expect(canInviterGrantRole(null, 'teacher')).toBe(false);
  });

  it('未知のロールは付与できない', () => {
    expect(canInviterGrantRole('admin', 'superuser')).toBe(false);
    expect(canInviterGrantRole('admin', '')).toBe(false);
  });

  it('大文字小文字は区別しない', () => {
    expect(canInviterGrantRole('Manager', 'TEACHER')).toBe(true);
  });
});

describe('areSchoolsInInviterScope', () => {
  it('すべて範囲内なら true、1つでも外れたら false', () => {
    expect(areSchoolsInInviterScope(['a', 'b'], ['a', 'b', 'c'])).toBe(true);
    expect(areSchoolsInInviterScope(['a', 'x'], ['a', 'b'])).toBe(false);
  });

  it('教室指定なしは true', () => {
    expect(areSchoolsInInviterScope([], [])).toBe(true);
  });
});

/** from(table) ごとに maybeSingle / await の結果を返すだけの最小モック */
function fakeAdmin(tables: Record<string, { data: unknown; error?: unknown }>) {
  return {
    from: vi.fn((table: string) => {
      const result = { data: tables[table]?.data ?? null, error: tables[table]?.error ?? null };
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'in', 'limit']) {
        chain[m] = vi.fn(() => chain);
      }
      chain.maybeSingle = vi.fn(async () => result);
      chain.then = (resolve: (v: unknown) => void) => resolve(result);
      return chain;
    }),
  };
}

describe('verifyInviterAuthority', () => {
  const invitation = { invited_by: 'inviter-1', role: 'teacher', school_ids: ['s1'] };

  it('招待者不明は拒否', async () => {
    const admin = fakeAdmin({});
    const r = await verifyInviterAuthority(admin as never, { ...invitation, invited_by: null });
    expect(r).toEqual({ ok: false, reason: 'no_inviter' });
  });

  it('招待者の行が無ければ拒否', async () => {
    const admin = fakeAdmin({ user_profiles: { data: null } });
    const r = await verifyInviterAuthority(admin as never, invitation);
    expect(r).toEqual({ ok: false, reason: 'no_inviter' });
  });

  it('無効化された招待者の招待は拒否', async () => {
    const admin = fakeAdmin({
      user_profiles: { data: { id: 'inviter-1', role: 'manager', is_active: false } },
    });
    const r = await verifyInviterAuthority(admin as never, invitation);
    expect(r).toEqual({ ok: false, reason: 'inviter_inactive' });
  });

  it('教室長が作った管理者招待は拒否', async () => {
    const admin = fakeAdmin({
      user_profiles: { data: { id: 'inviter-1', role: 'manager', is_active: true } },
    });
    const r = await verifyInviterAuthority(admin as never, { ...invitation, role: 'admin' });
    expect(r).toEqual({ ok: false, reason: 'role_not_allowed' });
  });

  it('教室長は担当外の教室へ招待できない', async () => {
    const admin = fakeAdmin({
      user_profiles: { data: { id: 'inviter-1', role: 'manager', is_active: true } },
      user_schools: { data: [{ school_id: 's2' }] },
    });
    const r = await verifyInviterAuthority(admin as never, invitation);
    expect(r).toEqual({ ok: false, reason: 'school_scope' });
  });

  it('教室長が担当教室へ講師を招待するのは可', async () => {
    const admin = fakeAdmin({
      user_profiles: { data: { id: 'inviter-1', role: 'manager', is_active: true } },
      user_schools: { data: [{ school_id: 's1' }] },
    });
    const r = await verifyInviterAuthority(admin as never, invitation);
    expect(r).toEqual({ ok: true });
  });

  it('エリアマネージャーは全教室が範囲内（user_schools を見ない）', async () => {
    const admin = fakeAdmin({
      user_profiles: { data: { id: 'inviter-1', role: 'owner', is_active: true } },
      user_schools: { data: [] },
    });
    const r = await verifyInviterAuthority(admin as never, { ...invitation, role: 'manager' });
    expect(r).toEqual({ ok: true });
    expect(admin.from).not.toHaveBeenCalledWith('user_schools');
  });
});
