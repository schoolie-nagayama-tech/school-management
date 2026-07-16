/**
 * コンポーネントテスト: BulletinPostModal
 *
 * 2026-07-16: 配信先(audience) UIを AUDIENCE_UI_ENABLED フラグで非表示化した際の固定テスト。
 *   - 配信先UIが画面に出ないこと
 *   - 新規投稿は audience=['社内'] / target_scope='all' を常に送ること
 *   - 編集保存では audience 系キーを一切送らない（既存値を上書きしない）こと
 *     ※ 本番デモ校には audience=['保護者','生徒'] のお知らせが実在し、
 *       ['社内'] で上書きするとポータルから消えてしまうための回帰防止。
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulletinPostModal } from '@/components/bulletin/BulletinPostModal';
import type { BulletinPost } from '@/types/bulletin';

// next/dynamic はテスト環境でも動作するが、RichTextEditor(tiptap)の初期化が重いため、
// ローダーを即時解決する軽量な実装に差し替える（本文入力欄は textarea で代替）。
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<React.ComponentType<any>>) => {
    function DynamicMock(props: any) {
      const [Comp, setComp] = React.useState<React.ComponentType<any> | null>(null);
      React.useEffect(() => {
        let mounted = true;
        loader().then((C) => {
          if (mounted) setComp(() => C);
        });
        return () => {
          mounted = false;
        };
      }, []);
      if (!Comp) return null;
      return <Comp {...props} />;
    }
    return DynamicMock;
  },
}));

vi.mock('@/components/ui/RichTextEditor', () => ({
  RichTextEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="rich-text-editor"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const createBulletinPost = vi.fn();
const updateBulletinPost = vi.fn();

vi.mock('@/lib/api/bulletin', () => ({
  createBulletinPost: (...args: unknown[]) => createBulletinPost(...args),
  updateBulletinPost: (...args: unknown[]) => updateBulletinPost(...args),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
  },
}));

const existingPost: BulletinPost = {
  id: 'post-1',
  school_id: 'school-1',
  label_id: null,
  title: '既存のお知らせ',
  content: '<p>既存の本文</p>',
  link_url: null,
  is_pinned: false,
  is_archived: false,
  archived_at: null,
  publish_start_at: null,
  publish_end_at: null,
  created_by: 'user-1',
  updated_by: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  // 本番デモ校に実在するパターン：保護者・生徒に配信済み
  audience: ['保護者', '生徒'],
  target_scope: 'all',
  target_grade: null,
  label: null,
  creator: null,
  read_count: 0,
  is_read: false,
};

describe('BulletinPostModal（配信先UI非表示化・AUDIENCE_UI_ENABLED=false）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createBulletinPost.mockResolvedValue({ id: 'new-post' });
    updateBulletinPost.mockResolvedValue({ id: 'post-1' });
  });

  it('配信先セレクタが画面に表示されない', async () => {
    render(
      <BulletinPostModal
        isOpen={true}
        onClose={vi.fn()}
        labels={[]}
        schoolId="school-1"
        onSaved={vi.fn()}
      />
    );
    await screen.findByTestId('rich-text-editor');

    expect(screen.queryByText('配信先')).not.toBeInTheDocument();
    expect(screen.queryByText('届ける範囲')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('生徒名で検索')).not.toBeInTheDocument();
  });

  it('新規投稿は audience=[\'社内\'] / target_scope=\'all\' を常に送る', async () => {
    const user = userEvent.setup();
    render(
      <BulletinPostModal
        isOpen={true}
        onClose={vi.fn()}
        labels={[]}
        schoolId="school-1"
        onSaved={vi.fn()}
      />
    );

    await user.type(screen.getByPlaceholderText('タイトルを入力'), 'テストタイトル');
    const editor = await screen.findByTestId('rich-text-editor');
    await user.type(editor, 'テスト本文');

    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(createBulletinPost).toHaveBeenCalledTimes(1));
    const [, payload] = createBulletinPost.mock.calls[0];
    expect(payload.audience).toEqual(['社内']);
    expect(payload.target_scope).toBe('all');
    expect(payload.target_grade).toBeNull();
    expect(payload.target_student_ids).toEqual([]);
  });

  it('編集保存では audience 系キーを一切送らない（既存の配信先を上書きしない）', async () => {
    const user = userEvent.setup();
    render(
      <BulletinPostModal
        isOpen={true}
        onClose={vi.fn()}
        post={existingPost}
        labels={[]}
        schoolId="school-1"
        onSaved={vi.fn()}
      />
    );

    await screen.findByTestId('rich-text-editor');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(updateBulletinPost).toHaveBeenCalledTimes(1));
    const [, updates] = updateBulletinPost.mock.calls[0];
    expect(updates).not.toHaveProperty('audience');
    expect(updates).not.toHaveProperty('target_scope');
    expect(updates).not.toHaveProperty('target_grade');
    expect(updates).not.toHaveProperty('target_student_ids');
  });
});
