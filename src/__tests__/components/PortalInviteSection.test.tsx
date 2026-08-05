/**
 * コンポーネントテスト: PortalInviteSection
 * 保護者ポータル招待発行セクションの最小ケース（発行成功→受諾URL表示）
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PortalInviteSection } from '@/components/students/PortalInviteSection';

// テストごとにロールを差し替えられるよう、hoisted な可変ホルダーを経由して useAuth をモックする
// 表示ゲートは API（requireAdmin=admin/owner）に合わせて admin/owner のみ（コンポーネントの意図コメント参照）
const { roleHolder } = vi.hoisted(() => ({ roleHolder: { role: 'admin' } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { role: roleHolder.role } }),
}));

// fetchWithAuth をモックし、GET(一覧)/POST(発行)を呼び出し順で判定する
const fetchWithAuthMock = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  fetchWithAuth: (...args: Parameters<typeof fetch>) => fetchWithAuthMock(...args),
}));

describe('PortalInviteSection', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    roleHolder.role = 'admin';
  });

  it('発行成功時に受諾URLが表示される', async () => {
    // 1回目: マウント時の一覧取得（発行済みなし）
    fetchWithAuthMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ invitations: [] }),
    });
    // 2回目: 発行APIのレスポンス
    fetchWithAuthMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        accept_url: 'https://example.com/mypage/invite/abc123',
      }),
    });
    // 3回目: 発行後の一覧再取得
    fetchWithAuthMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        invitations: [
          {
            id: 'inv-1',
            token: 'abc123',
            invite_type: 'guardian',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            accepted_at: null,
          },
        ],
      }),
    });

    const user = userEvent.setup();
    render(<PortalInviteSection studentId="student-1" studentName="山田 太郎" />);

    // 初期一覧取得の完了を待つ
    await waitFor(() => expect(fetchWithAuthMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: '招待を発行' }));

    // 受諾URLがテキストボックスに表示される
    await waitFor(() => {
      expect(
        screen.getByDisplayValue('https://example.com/mypage/invite/abc123')
      ).toBeInTheDocument();
    });

    // POST時のボディに student_id / invite_type が渡っている
    const postCall = fetchWithAuthMock.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(postCall).toBeTruthy();
    const body = JSON.parse((postCall as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ student_id: 'student-1', invite_type: 'guardian' });
  });

  it.each(['teacher', 'manager'])(
    'API認可（admin/owner）に満たないロール（%s）では何も表示しない',
    (role) => {
      roleHolder.role = role;
      const { container } = render(
        <PortalInviteSection studentId="student-1" studentName="山田 太郎" />
      );
      expect(container.innerHTML).toBe('');
      // 権限外の場合は一覧取得も走らない
      expect(fetchWithAuthMock).not.toHaveBeenCalled();
    }
  );
});
