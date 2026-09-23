/**
 * コンポーネントテスト: PrivacyScreen
 *
 * 入試カウントダウンは「抽選に当たった」かつ「対象教室」のときだけ出る。
 * どちらか一方だけで出てしまうと、試験運用の範囲（永山校・100回に1回）が崩れる。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockPrivacyScreen = vi.fn();
const mockAuth = vi.fn();

vi.mock('@/components/privacy-screen/usePrivacyScreen', () => ({
  usePrivacyScreen: () => mockPrivacyScreen(),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuth(),
}));

import { PrivacyScreen } from '@/components/privacy-screen/PrivacyScreen';

/** 永山校（試験運用中の唯一の対象） */
const NAGAYAMA = 'd187f7a3-633a-46ce-8d32-c56c85d17bac';
/** 京王堀之内校（東京だが試験対象外） */
const HORINOUCHI = '9f519794-3673-4e90-b1ea-88a79f70174a';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 22));
});

function setup(opts: { showCountdown: boolean; schoolId: string | 'all' | null }) {
  mockPrivacyScreen.mockReturnValue({
    showOverlay: true,
    showCountdown: opts.showCountdown,
    dismiss: vi.fn(),
    isActive: true,
  });
  mockAuth.mockReturnValue({ selectedSchoolId: opts.schoolId });
  render(<PrivacyScreen />);
}

describe('PrivacyScreen の入試カウントダウン', () => {
  it('抽選に当たり、永山校を選んでいるときは日数を出す', () => {
    setup({ showCountdown: true, schoolId: NAGAYAMA });
    expect(screen.getByText('都立一次まで')).toBeDefined();
    expect(screen.getByText('152')).toBeDefined();
    expect(screen.getByText(/2\/21/)).toBeDefined();
  });

  it('抽選に外れたら出さない（100回に99回はこちら）', () => {
    setup({ showCountdown: false, schoolId: NAGAYAMA });
    expect(screen.queryByText('都立一次まで')).toBeNull();
    expect(screen.queryByText('152')).toBeNull();
  });

  it('当たっても試験対象外の教室では出さない', () => {
    setup({ showCountdown: true, schoolId: HORINOUCHI });
    expect(screen.queryByText('都立一次まで')).toBeNull();
  });

  it('当たっても「すべての教室」では出さない', () => {
    setup({ showCountdown: true, schoolId: 'all' });
    expect(screen.queryByText('都立一次まで')).toBeNull();
  });

  it('オーバーレイ自体はクリックで解除できるまま', () => {
    setup({ showCountdown: true, schoolId: NAGAYAMA });
    expect(screen.getByRole('button', { name: '再開' })).toBeDefined();
  });
});
