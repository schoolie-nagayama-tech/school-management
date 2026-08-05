import { describe, it, expect } from 'vitest';
import {
  buildNavEntries,
  isLinkActive,
  isGroupActive,
  type NavContext,
  type NavGroup,
} from '@/components/layout/navConfig';
import {
  hasRoleLevel,
  isManagerOrAbove,
  isOwnerOrAbove,
  isSystemAdmin,
  isTeacher,
} from '@/lib/utils/roles';
import { ROLE_PERMISSIONS, type UserProfile, type UserRole } from '@/types/database';

// 最小限の UserProfile を作るヘルパー（テストで必要な role/id だけ持たせる）
function profileOf(role: UserRole): UserProfile {
  return { id: `u-${role}`, role } as UserProfile;
}

function ctxFor(role: UserRole, overrides: Partial<NavContext> = {}): NavContext {
  return {
    permissions: ROLE_PERMISSIONS[role],
    profile: profileOf(role),
    showAll: false,
    schools: [{ id: 's1', code: 'NAGAYAMA' }],
    ...overrides,
  };
}

/** entries の中から指定 key を持つものを探す（link/group 横断） */
function keys(entries: ReturnType<typeof buildNavEntries>): string[] {
  return entries.map((e) => e.key);
}

describe('roles helpers', () => {
  it('hasRoleLevel は階層で判定する', () => {
    expect(hasRoleLevel('manager', 'manager')).toBe(true);
    expect(hasRoleLevel('owner', 'manager')).toBe(true);
    expect(hasRoleLevel('admin', 'manager')).toBe(true);
    expect(hasRoleLevel('teacher', 'manager')).toBe(false);
    expect(hasRoleLevel(null, 'manager')).toBe(false);
  });

  it('大文字や前後の表記ゆれを正規化する', () => {
    expect(isManagerOrAbove('Manager')).toBe(true);
    expect(isSystemAdmin('ADMIN')).toBe(true);
  });

  it('各述語が期待どおり', () => {
    expect(isManagerOrAbove('teacher')).toBe(false);
    expect(isOwnerOrAbove('manager')).toBe(false);
    expect(isOwnerOrAbove('owner')).toBe(true);
    expect(isSystemAdmin('owner')).toBe(false);
    expect(isTeacher('teacher')).toBe(true);
    expect(isTeacher(undefined)).toBe(false);
  });
});

describe('buildNavEntries: 講師', () => {
  const entries = buildNavEntries(ctxFor('teacher'));

  it('生徒管理・申込状況・テスト対策・自分の出勤簿を出す', () => {
    expect(keys(entries)).toEqual(
      expect.arrayContaining(['students', 'applications', 'test-prep', 'my-attendance'])
    );
  });

  it('教室長以上のグループは出さない', () => {
    const k = keys(entries);
    expect(k).not.toContain('form');
    expect(k).not.toContain('course');
    expect(k).not.toContain('teacher');
    expect(k).not.toContain('business');
    expect(k).not.toContain('progress-feed');
    expect(k).not.toContain('inquiries');
  });

  it('自分の出勤簿リンクは教室コードと講師IDで生成される', () => {
    const my = entries.find((e) => e.key === 'my-attendance');
    expect(my?.kind).toBe('link');
    if (my?.kind === 'link') {
      expect(my.href).toBe('/attendance/NAGAYAMA/u-teacher');
    }
  });

  it('担当教室コードが無ければ出勤簿リンクは出ない', () => {
    const e = buildNavEntries(ctxFor('teacher', { schools: [{ id: 's1', code: null }] }));
    expect(keys(e)).not.toContain('my-attendance');
  });
});

describe('buildNavEntries: 教室長(manager)', () => {
  const entries = buildNavEntries(ctxFor('manager'));

  it('4つの管理グループと進行表確認を出す', () => {
    expect(keys(entries)).toEqual(
      expect.arrayContaining(['form', 'course', 'teacher', 'business', 'progress-feed'])
    );
  });

  it('問合せ管理をトップレベルの単独リンクとして出す', () => {
    const inquiry = entries.find((e) => e.key === 'inquiries');
    expect(inquiry?.kind).toBe('link');
    if (inquiry?.kind === 'link') {
      expect(inquiry.href).toBe('/admin/inquiries');
    }
  });

  it('講師向けのトップレベル テスト対策/出勤簿は出さない', () => {
    const k = keys(entries);
    expect(k).not.toContain('test-prep'); // group内には入るが、トップレベルlinkとしては出さない
    expect(k).not.toContain('my-attendance');
  });

  it('申込状況をトップレベルに出し、回答一覧はフォーム管理グループ内に置く', () => {
    const k = keys(entries);
    expect(k).toContain('applications');
    const form = entries.find((e) => e.key === 'form') as NavGroup;
    expect(form.items.map((i) => i.key)).toEqual([
      'responses',
      'transcriptions',
      'portal',
      'test-prep',
    ]);
  });

  it('講習グループに5項目が正しいラベルで入る', () => {
    const course = entries.find((e) => e.key === 'course') as NavGroup;
    expect(course.items.map((i) => i.label)).toEqual([
      '講習一覧',
      '進捗管理',
      '準備スケジュール',
      '講習提案書',
      '特別講座管理',
    ]);
  });
});

describe('buildNavEntries: showAll(ロード中)', () => {
  it('権限nullでも全グループを表示する', () => {
    const entries = buildNavEntries({
      permissions: null,
      profile: null,
      showAll: true,
      schools: [],
    });
    expect(keys(entries)).toEqual(
      expect.arrayContaining(['students', 'form', 'course', 'teacher', 'business'])
    );
  });
});

describe('isLinkActive', () => {
  it('exact は完全一致のみ', () => {
    const link = { key: 'students', label: '生徒管理', href: '/students', exact: true };
    expect(isLinkActive('/students', link)).toBe(true);
    expect(isLinkActive('/students/123', link)).toBe(false);
  });

  it('既定は前方一致（href/ 配下）も active', () => {
    const link = { key: 'progress', label: '進捗管理', href: '/courses/progress' };
    expect(isLinkActive('/courses/progress', link)).toBe(true);
    expect(isLinkActive('/courses/progress/abc', link)).toBe(true);
    expect(isLinkActive('/courses', link)).toBe(false);
  });

  it('matchPrefixes で別パスも active 扱い', () => {
    const link = {
      key: 'responses',
      label: '回答一覧',
      href: '/responses',
      matchPrefixes: ['/forms/responses'],
    };
    expect(isLinkActive('/forms/responses/moshi/2026', link)).toBe(true);
  });
});

describe('isGroupActive', () => {
  const group: NavGroup = {
    key: 'course',
    label: '講習管理',
    matchPrefixes: ['/courses'],
    items: [{ key: 'courses', label: '講習一覧', href: '/courses', exact: true }],
  };

  it('グループの matchPrefixes 配下なら active（子に無いサブパスも含む）', () => {
    expect(isGroupActive('/courses/unknown-subpage', group)).toBe(true);
  });

  it('無関係なパスでは非 active', () => {
    expect(isGroupActive('/students', group)).toBe(false);
  });
});
