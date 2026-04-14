/**
 * コンポーネントテスト: BulletinPostCard
 * 掲示板投稿カードのテスト
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulletinPostCard } from '@/components/bulletin/BulletinPostCard';
import type { BulletinPost } from '@/types/bulletin';

// DOMPurify モック
vi.mock('isomorphic-dompurify', () => ({
  default: {
    sanitize: vi.fn((html: string) => html),
  },
}));

const basePost: BulletinPost = {
  id: 'post-1',
  school_id: 'school-1',
  label_id: null,
  title: 'テスト投稿タイトル',
  content: 'テスト投稿の本文です。',
  is_pinned: false,
  is_archived: false,
  archived_at: null,
  created_by: 'user-1',
  updated_by: null,
  created_at: '2026-04-01T10:00:00Z',
  updated_at: '2026-04-01T10:00:00Z',
  label: null,
  creator: { display_name: '管理者A', email: 'admin@example.com' },
  read_count: 5,
  is_read: false,
};

describe('BulletinPostCard', () => {
  const defaultProps = {
    post: basePost,
    canEdit: false,
    canRead: false,
    onRead: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onShowReaders: vi.fn(),
  };

  it('タイトルが表示される', () => {
    render(<BulletinPostCard {...defaultProps} />);
    expect(screen.getByText('テスト投稿タイトル')).toBeInTheDocument();
  });

  it('プレーンテキスト本文が表示される', () => {
    render(<BulletinPostCard {...defaultProps} />);
    expect(screen.getByText('テスト投稿の本文です。')).toBeInTheDocument();
  });

  it('HTML本文がサニタイズされて表示される', () => {
    const htmlPost = { ...basePost, content: '<p>HTML本文</p>' };
    const { container } = render(<BulletinPostCard {...defaultProps} post={htmlPost} />);
    // dangerouslySetInnerHTML で表示される
    expect(container.querySelector('.bulletin-post-content')?.innerHTML).toContain('<p>HTML本文</p>');
  });

  it('投稿者名が表示される', () => {
    render(<BulletinPostCard {...defaultProps} />);
    expect(screen.getByText(/管理者A/)).toBeInTheDocument();
  });

  it('投稿者のdisplay_nameがnullの場合emailが表示される', () => {
    const post = { ...basePost, creator: { display_name: null, email: 'fallback@test.com' } };
    render(<BulletinPostCard {...defaultProps} post={post} />);
    expect(screen.getByText(/fallback@test.com/)).toBeInTheDocument();
  });

  it('ピン留めアイコンが表示される', () => {
    const pinnedPost = { ...basePost, is_pinned: true };
    const { container } = render(<BulletinPostCard {...defaultProps} post={pinnedPost} />);
    expect(container.querySelector('.lucide-pin')).toBeInTheDocument();
  });

  it('教室名が渡された場合に表示される', () => {
    render(<BulletinPostCard {...defaultProps} schoolName="教室A" />);
    expect(screen.getByText('教室A')).toBeInTheDocument();
  });

  // ── canRead: 講師の既読機能 ──

  it('canRead=true かつ未読の場合「見ました」ボタンが表示される', () => {
    render(<BulletinPostCard {...defaultProps} canRead={true} />);
    expect(screen.getByText('見ました')).toBeInTheDocument();
  });

  it('canRead=true かつ未読の場合、未読インジケーター●が表示される', () => {
    render(<BulletinPostCard {...defaultProps} canRead={true} />);
    expect(screen.getByText('●')).toBeInTheDocument();
  });

  it('canRead=true かつ既読の場合「✓既読」が表示される', () => {
    const readPost = { ...basePost, is_read: true };
    render(<BulletinPostCard {...defaultProps} canRead={true} post={readPost} />);
    expect(screen.getByText('✓既読')).toBeInTheDocument();
  });

  it('「見ました」ボタンをクリックするとonReadが呼ばれる', async () => {
    const user = userEvent.setup();
    const onRead = vi.fn();
    render(<BulletinPostCard {...defaultProps} canRead={true} onRead={onRead} />);

    await user.click(screen.getByText('見ました'));
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('canRead=false の場合「見ました」ボタンも「✓既読」も表示されない', () => {
    render(<BulletinPostCard {...defaultProps} canRead={false} />);
    expect(screen.queryByText('見ました')).not.toBeInTheDocument();
    expect(screen.queryByText('✓既読')).not.toBeInTheDocument();
  });

  // ── canEdit: 管理者の編集機能 ──

  it('canEdit=true の場合「編集」「削除」ボタンが表示される', () => {
    render(<BulletinPostCard {...defaultProps} canEdit={true} />);
    expect(screen.getByText('編集')).toBeInTheDocument();
    expect(screen.getByText('削除')).toBeInTheDocument();
  });

  it('canEdit=true の場合「既読: N人」が表示される', () => {
    render(<BulletinPostCard {...defaultProps} canEdit={true} />);
    expect(screen.getByText(/既読: 5人/)).toBeInTheDocument();
  });

  it('canEdit=false の場合「編集」「削除」が表示されない', () => {
    render(<BulletinPostCard {...defaultProps} canEdit={false} />);
    expect(screen.queryByText('編集')).not.toBeInTheDocument();
    expect(screen.queryByText('削除')).not.toBeInTheDocument();
  });

  it('編集ボタンをクリックするとonEditが呼ばれる', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<BulletinPostCard {...defaultProps} canEdit={true} onEdit={onEdit} />);

    await user.click(screen.getByText('編集'));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('削除ボタンをクリックするとonDeleteが呼ばれる', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<BulletinPostCard {...defaultProps} canEdit={true} onDelete={onDelete} />);

    await user.click(screen.getByText('削除'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('既読人数をクリックするとonShowReadersが呼ばれる', async () => {
    const user = userEvent.setup();
    const onShowReaders = vi.fn();
    render(<BulletinPostCard {...defaultProps} canEdit={true} onShowReaders={onShowReaders} />);

    await user.click(screen.getByText(/既読: 5人/));
    expect(onShowReaders).toHaveBeenCalledTimes(1);
  });

  // ── ラベル表示 ──

  it('ラベルがある場合にラベル名が表示される', () => {
    const labelPost = {
      ...basePost,
      label_id: 'label-1',
      label: {
        id: 'label-1',
        school_id: 'school-1',
        name: '重要',
        color: '#ff0000',
        is_system: false,
        sort_order: 0,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    };
    render(<BulletinPostCard {...defaultProps} post={labelPost} />);
    expect(screen.getByText('重要')).toBeInTheDocument();
  });
});
