/**
 * コンポーネントテスト: ClassroomDeviceGate（講師の教室外モードのページゲート）
 *
 * 正典: docs/classroom-device-plan.md §2
 *
 * 出し分けを固定する:
 *   - 講師 × 教室外モード（教室端末マーク無し）× 教室限定パス → 全画面ブロック
 *   - 講師 × 教室外モード × 教室外OKパス（/today 等） → 何も出さない
 *   - 講師 × 教室端末 → 何も出さない
 *   - 教室長以上 → 端末に関係なく常に何も出さない
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClassroomDeviceGate } from '@/components/layout/ClassroomDeviceGate';
import { isOutsideClassroom } from '@/lib/classroomDevice';

// ロール・端末マーク・現在パスをテストごとに差し替える
const state = vi.hoisted(() => ({
  role: 'teacher' as string,
  trusted: false,
  pathname: '/students',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'u-teacher', role: state.role },
    schoolIds: ['s1'],
    signOut: vi.fn(),
  }),
}));

vi.mock('@/contexts/MasterDataContext', () => ({
  useMasterData: () => ({ schools: [{ id: 's1', code: 'NAGAYAMA', name: '長山' }] }),
}));

// outsideClassroom の算出は本物（lib/classroomDevice.ts）を通す。判定式のズレも一緒に検知したいため。
vi.mock('@/contexts/ClassroomDeviceContext', () => ({
  useClassroomDevice: () => ({
    isTrustedDevice: state.trusted,
    loading: false,
    outsideClassroom: isOutsideClassroom(state.role, state.trusted),
    refresh: vi.fn(),
  }),
}));

const BLOCK_TEXT = 'この機能は教室の端末でのみ利用できます';

beforeEach(() => {
  state.role = 'teacher';
  state.trusted = false;
  state.pathname = '/students';
});

describe('ClassroomDeviceGate', () => {
  it('講師×教室外モード×教室限定パスはブロック表示になる', () => {
    render(<ClassroomDeviceGate />);
    expect(screen.getByText(BLOCK_TEXT)).toBeTruthy();
  });

  it('ブロック時は教室外OKページへの導線とログアウトを出す（閉じ込め防止）', () => {
    render(<ClassroomDeviceGate />);
    expect(screen.getByText('本日の授業')).toBeTruthy();
    expect(screen.getByText('自分の予定')).toBeTruthy();
    // 出勤簿は教室コード + 講師ID で生成する
    const attendance = screen.getByText('出勤簿').closest('a');
    expect(attendance?.getAttribute('href')).toBe('/attendance/NAGAYAMA/u-teacher');
    expect(screen.getByText('ログアウト')).toBeTruthy();
  });

  it('配下パス（/students/123）もブロックする', () => {
    state.pathname = '/students/123';
    render(<ClassroomDeviceGate />);
    expect(screen.getByText(BLOCK_TEXT)).toBeTruthy();
  });

  it.each([
    '/today',
    '/my-schedule',
    '/attendance/NAGAYAMA/u-teacher',
    '/help',
    '/settings/account',
  ])('教室外OKパス（%s）では何も出さない', (path) => {
    state.pathname = path;
    const { container } = render(<ClassroomDeviceGate />);
    expect(container.firstChild).toBeNull();
  });

  it('教室端末（信頼済み）の講師には出さない', () => {
    state.trusted = true;
    const { container } = render(<ClassroomDeviceGate />);
    expect(container.firstChild).toBeNull();
  });

  it.each(['manager', 'owner', 'admin'])('%s は端末に関係なく出さない', (role) => {
    state.role = role;
    state.trusted = false;
    const { container } = render(<ClassroomDeviceGate />);
    expect(container.firstChild).toBeNull();
  });
});
