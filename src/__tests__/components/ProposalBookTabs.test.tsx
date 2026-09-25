/**
 * コンポーネントテスト: 提案書の新規作成のテキストのタブ（1冊目・2冊目…）
 *
 * ★並べ替えのつかみ（グリップ）は2冊以上のときだけ出す。1冊では順番が無い。
 * ★タブを押したら切り替え、グリップとは別のボタンにしてある（押し間違いで入れ替わらないように）。
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProposalBookTabs } from '@/components/proposals/ProposalBookTabs';

const BOOKS = [
  { textbookId: 1, label: '数学 ステップ', koma: 6 },
  { textbookId: 2, label: '都立入試過去問', koma: 4 },
];

describe('ProposalBookTabs', () => {
  const base = { onSwitch: vi.fn(), onRemove: vi.fn(), onReorder: vi.fn() };

  it('並び順に「1冊目」「2冊目」を振り、2冊以上なら入れ替えのつかみを出す', () => {
    render(<ProposalBookTabs {...base} books={BOOKS} selectedTextbookId={1} />);
    expect(screen.getByText('1冊目')).toBeInTheDocument();
    expect(screen.getByText('2冊目')).toBeInTheDocument();
    expect(screen.getAllByTitle('ドラッグして順番を入れ替え')).toHaveLength(2);
  });

  it('1冊のときはつかみも「外す」も出さない', () => {
    render(<ProposalBookTabs {...base} books={[BOOKS[0]]} selectedTextbookId={1} />);
    expect(screen.queryByTitle('ドラッグして順番を入れ替え')).not.toBeInTheDocument();
    expect(screen.queryByTitle('このテキストを外す')).not.toBeInTheDocument();
  });

  it('タブを押すと切り替え、並べ替えは呼ばない', async () => {
    const onSwitch = vi.fn();
    const onReorder = vi.fn();
    render(
      <ProposalBookTabs
        {...base}
        books={BOOKS}
        selectedTextbookId={1}
        onSwitch={onSwitch}
        onReorder={onReorder}
      />
    );
    await userEvent.click(screen.getByText('都立入試過去問'));
    expect(onSwitch).toHaveBeenCalledWith(2);
    expect(onReorder).not.toHaveBeenCalled();
  });
});

describe('ProposalBookTabs（講習テンプレの編集画面）', () => {
  it('alwaysRemovable なら1冊でも外せる（テンプレは全部外すとテキスト選択に戻れる）', async () => {
    const onRemove = vi.fn();
    render(
      <ProposalBookTabs
        books={[BOOKS[0]]}
        selectedTextbookId={1}
        onSwitch={vi.fn()}
        onRemove={onRemove}
        onReorder={vi.fn()}
        alwaysRemovable
        removeTarget="講習"
      />
    );
    await userEvent.click(screen.getByLabelText('数学 ステップ を講習から外す'));
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});
