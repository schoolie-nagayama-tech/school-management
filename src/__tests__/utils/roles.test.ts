/**
 * ロール判定ヘルパー（src/lib/utils/roles.ts）の境界を固定する。
 *
 * ★ なぜこのテストが要るか:
 *   保護者ポータルV2デモの公開範囲を「admin のみ」に絞る判断（2026-07-16）は、
 *   **isSystemAdmin が owner を通さない**ことに全面的に依存している。
 *   紛らわしいことに API 側の requireAdmin は名前に反して admin と owner の両方を通す
 *   （＝プロジェクトの「管理者権限」の既定）。この違いを取り違えて isSystemAdmin を
 *   「owner も含める」に“修正”すると、デモが意図より広く（エリアマネージャーにも）
 *   静かに開く。ここで固定して気付けるようにする。
 */
import { describe, it, expect } from 'vitest';
import { isSystemAdmin, isOwnerOrAbove, isManagerOrAbove, isTeacher } from '@/lib/utils/roles';

describe('isSystemAdmin', () => {
  it('admin だけが true', () => {
    expect(isSystemAdmin('admin')).toBe(true);
  });

  // ★ この4件が「アドミンのみ」の実体。特に owner=false が要（requireAdmin とは違う）。
  it.each(['owner', 'manager', 'teacher', 'parent'])('%s は false', (role) => {
    expect(isSystemAdmin(role)).toBe(false);
  });

  it('大文字小文字を吸収する', () => {
    expect(isSystemAdmin('ADMIN')).toBe(true);
  });

  it('未設定・未知のロールは false（安全側）', () => {
    expect(isSystemAdmin(null)).toBe(false);
    expect(isSystemAdmin(undefined)).toBe(false);
    expect(isSystemAdmin('')).toBe(false);
    expect(isSystemAdmin('superuser')).toBe(false);
  });
});

describe('isOwnerOrAbove', () => {
  it('owner と admin が true', () => {
    expect(isOwnerOrAbove('owner')).toBe(true);
    expect(isOwnerOrAbove('admin')).toBe(true);
  });

  it('manager 以下は false', () => {
    expect(isOwnerOrAbove('manager')).toBe(false);
    expect(isOwnerOrAbove('teacher')).toBe(false);
  });
});

describe('isManagerOrAbove', () => {
  it('manager / owner / admin が true', () => {
    expect(isManagerOrAbove('manager')).toBe(true);
    expect(isManagerOrAbove('owner')).toBe(true);
    expect(isManagerOrAbove('admin')).toBe(true);
  });

  it('teacher / parent / 未設定は false', () => {
    expect(isManagerOrAbove('teacher')).toBe(false);
    expect(isManagerOrAbove('parent')).toBe(false);
    expect(isManagerOrAbove(null)).toBe(false);
  });
});

describe('isTeacher', () => {
  it('teacher だけが true（上位ロールは含まない＝階層判定ではない）', () => {
    expect(isTeacher('teacher')).toBe(true);
    expect(isTeacher('manager')).toBe(false);
    expect(isTeacher('admin')).toBe(false);
  });
});
