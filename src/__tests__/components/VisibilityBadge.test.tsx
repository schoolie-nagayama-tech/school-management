/**
 * コンポーネントテスト: VisibilityBadge
 *
 * 面談申し込みは対象学年ごとに複数リンクを持つため URL は link_urls 側に入り、
 * link_url は null のまま。link_url だけを見ていた頃は「URL未設定」と表示され、
 * 公開/非公開の切り替えボタンも出なかった（保護者ポータルには公開されていたのに止められない）。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisibilityBadge } from '@/components/portal/VisibilityBadge';

describe('VisibilityBadge - 外部リンク', () => {
  it('link_urls にURLがあれば公開中として扱い、非公開にするボタンを出す', () => {
    render(
      <VisibilityBadge
        itemType="external"
        isVisible
        externalUrl={null}
        externalUrls={[{ url: 'https://example.com/a', label: '面談A' }]}
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByText('公開中')).toBeDefined();
    expect(screen.getByRole('button', { name: '非公開にする' })).toBeDefined();
    expect(screen.queryByText(/URL未設定/)).toBeNull();
  });

  it('URLが1つも無くても切り替えボタンは出し、未設定であることを併記する', () => {
    render(
      <VisibilityBadge
        itemType="external"
        isVisible
        externalUrl={null}
        externalUrls={[]}
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '非公開にする' })).toBeDefined();
    expect(screen.getByText(/URL未設定/)).toBeDefined();
  });

  it('非公開のときは公開するボタンになり、押すと onToggle が呼ばれる', async () => {
    const onToggle = vi.fn();
    render(
      <VisibilityBadge
        itemType="external"
        isVisible={false}
        externalUrl="https://example.com/a"
        onToggle={onToggle}
      />
    );

    const button = screen.getByRole('button', { name: '公開する' });
    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
