/**
 * コンポーネントテスト: PortalInviteSection
 *
 * 権限の出し分けを固定する:
 *   - セクション全体は manager 以上で表示（教室長も紐づけ解除のために見られる）
 *   - 招待発行ブロックは owner 以上のみ（発行APIが admin/owner 限定のため）
 *   - teacher など manager 未満には何も出さない
 * さらに発行成功→受諾URL表示の基本フローも見る。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PortalInviteSection } from '@/components/students/PortalInviteSection';

// テストごとにロールを差し替えられるよう、hoisted な可変ホルダーを経由して useAuth をモックする
const { roleHolder } = vi.hoisted(() => ({ roleHolder: { role: 'admin' } }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { role: roleHolder.role }, selectedSchoolId: 'school-1' }),
}));

// 教室名は配布シートの見出しに使うだけ。Provider を立てずに済むようモックする。
vi.mock('@/contexts/MasterDataContext', () => ({
  useMasterData: () => ({ schools: [{ id: 'school-1', name: 'テスト校' }] }),
}));

// qrcode は canvas に依存するため jsdom では動かない。固定の data URL を返させる。
vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,QQ==') },
}));

// fetchWithAuth をモックし、URL / method でルーティングする（呼び出し順に依存しない）
const fetchWithAuthMock = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  fetchWithAuth: (...args: Parameters<typeof fetch>) => fetchWithAuthMock(...args),
}));

/** GET(招待一覧)/GET(紐づけ一覧)/POST(発行) を URL・method で振り分けるモック。 */
function mockRoutes(opts?: {
  invitations?: unknown[];
  accounts?: unknown[];
  recentLogs?: unknown[];
  acceptUrl?: string;
}) {
  const {
    invitations = [],
    accounts = [],
    recentLogs = [],
    acceptUrl = 'https://example.com/mypage/invite/abc',
  } = opts ?? {};
  fetchWithAuthMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, accept_url: acceptUrl }) });
    }
    if (typeof url === 'string' && url.includes('/portal-links')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ accounts, recent_logs: recentLogs }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ invitations }) });
  });
}

/** 紐づけ済みアカウント1件を作る補助（APIの返り値に合わせる）。 */
function account(overrides: Record<string, unknown> = {}) {
  return {
    account_id: 'acc-1',
    display_name: '山田 花子',
    login_id: null,
    has_line: true,
    line_followed: true,
    line_follow_updated_at: null,
    last_login_at: '2026-08-30T12:04:00.000Z',
    linked_at: '2026-07-12T00:00:00.000Z',
    relation: 'guardian',
    relation_note: null,
    other_students: [],
    ...overrides,
  };
}

describe('PortalInviteSection', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    roleHolder.role = 'admin';
  });

  it('owner 以上（admin）: 発行成功時に受諾URLが表示される', async () => {
    mockRoutes({ acceptUrl: 'https://example.com/mypage/invite/abc123' });

    const user = userEvent.setup();
    render(<PortalInviteSection studentId="student-1" studentName="山田 太郎" />);

    // マウント時に招待一覧・紐づけ一覧を取得する（owner 以上なので両方）
    await waitFor(() =>
      expect(fetchWithAuthMock.mock.calls.some((c) => String(c[0]).includes('/portal-links'))).toBe(
        true
      )
    );

    await user.click(screen.getByRole('button', { name: '招待を発行' }));

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

  it('発行後はQRコードと配布用の印刷ボタンが出る', async () => {
    mockRoutes({ acceptUrl: 'https://example.com/mypage/invite/abc123' });
    const user = userEvent.setup();
    render(<PortalInviteSection studentId="student-1" studentName="山田 太郎" />);

    await user.click(await screen.findByRole('button', { name: '招待を発行' }));

    // QRはURLが決まってから非同期で作るので、出るまで待つ
    const qr = await screen.findByAltText('受諾URLのQRコード');
    expect(qr).toHaveAttribute('src', 'data:image/png;base64,QQ==');
    // 紙で渡す導線とQR画像の保存導線の両方を出す
    expect(screen.getByRole('button', { name: '印刷して渡す' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'QRを保存' })).toBeInTheDocument();
  });

  it('manager: セクションは見えるが招待発行ブロックは出ない（紐づけ一覧のみ取得）', async () => {
    roleHolder.role = 'manager';
    mockRoutes({ accounts: [] });

    const { container } = render(
      <PortalInviteSection studentId="student-1" studentName="山田 太郎" />
    );

    // セクションは表示される（空ではない）
    expect(container.innerHTML).not.toBe('');
    // 紐づけの確認ブロックは出る（見出しは人数と一緒に出す）
    expect(screen.getByText('この生徒を見られる人')).toBeInTheDocument();
    // 招待発行ボタンは出ない（発行APIは admin/owner 限定のため manager には見せない）
    expect(screen.queryByRole('button', { name: '招待を発行' })).toBeNull();

    // 紐づけ一覧は取得するが、招待一覧（portal-invitations）は取得しない
    await waitFor(() =>
      expect(fetchWithAuthMock.mock.calls.some((c) => String(c[0]).includes('/portal-links'))).toBe(
        true
      )
    );
    expect(
      fetchWithAuthMock.mock.calls.some((c) => String(c[0]).includes('/portal-invitations'))
    ).toBe(false);
  });

  it('LINE連携・友だち追加中なら「届く」結論と友だちバッジを出す', async () => {
    roleHolder.role = 'manager';
    mockRoutes({ accounts: [account()] });

    render(<PortalInviteSection studentId="student-1" studentName="山田 太郎" />);

    expect(await screen.findByText('LINE通知が届きます')).toBeInTheDocument();
    expect(screen.getByText('友だち追加中')).toBeInTheDocument();
    // 兄弟がいなければその旨を明示する（空欄にして迷わせない）
    expect(screen.getByText('この生徒だけに紐づいています')).toBeInTheDocument();
  });

  it('ブロック中なら「届かない」結論を出す', async () => {
    roleHolder.role = 'manager';
    mockRoutes({
      accounts: [account({ line_followed: false, line_follow_updated_at: '2026-07-02T00:00:00Z' })],
    });

    render(<PortalInviteSection studentId="student-1" studentName="山田 太郎" />);

    expect(await screen.findByText('LINE通知は届きません')).toBeInTheDocument();
    expect(screen.getByText('ブロック中')).toBeInTheDocument();
  });

  it('ID・PWのみのアカウントは「届かない」＋ID・PWバッジ', async () => {
    roleHolder.role = 'manager';
    mockRoutes({
      accounts: [account({ has_line: false, line_followed: null, login_id: 'yamada' })],
    });

    render(<PortalInviteSection studentId="student-1" studentName="山田 太郎" />);

    expect(await screen.findByText('LINE通知は届きません')).toBeInTheDocument();
    expect(screen.getByText('ID・PWのみ')).toBeInTheDocument();
  });

  it('★兄弟（このアカウントが見ている他の生徒）を表示する', async () => {
    roleHolder.role = 'manager';
    mockRoutes({
      accounts: [
        account({
          other_students: [{ student_id: 's-2', student_name: '山田 次郎', grade: 4 }],
        }),
      ],
    });

    render(<PortalInviteSection studentId="student-1" studentName="山田 太郎" />);

    expect(await screen.findByText('山田 次郎（小4）')).toBeInTheDocument();
  });

  it('アカウントが無ければ「まだ登録されていません」を出す', async () => {
    roleHolder.role = 'manager';
    mockRoutes({ accounts: [] });

    render(<PortalInviteSection studentId="student-1" studentName="山田 太郎" />);

    expect(await screen.findByText('まだ登録されていません')).toBeInTheDocument();
  });

  it('manager でも「登録済みの保護者から選ぶ」（兄弟の追加）は使える', async () => {
    roleHolder.role = 'manager';
    mockRoutes({ accounts: [] });

    render(<PortalInviteSection studentId="student-1" studentName="山田 太郎" />);

    expect(
      await screen.findByRole('button', { name: '登録済みの保護者から選ぶ' })
    ).toBeInTheDocument();
  });

  it('teacher（manager 未満）では何も表示せず、一覧取得も走らない', () => {
    roleHolder.role = 'teacher';
    const { container } = render(
      <PortalInviteSection studentId="student-1" studentName="山田 太郎" />
    );
    expect(container.innerHTML).toBe('');
    expect(fetchWithAuthMock).not.toHaveBeenCalled();
  });
});
