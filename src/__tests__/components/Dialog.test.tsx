/**
 * コンポーネントテスト: Dialog
 * フォーカス管理（初期フォーカス・Tabの循環・閉じた後のフォーカス復帰）のテスト
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/Dialog';

/** 開閉ボタンとダイアログをまとめたテスト用コンポーネント */
function TestHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>開く</button>
      <Dialog open={open} onOpenChange={setOpen} ariaLabel="テストダイアログ">
        <DialogContent>
          <button>最初のボタン</button>
        </DialogContent>
        <DialogFooter>
          <button>最後のボタン</button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

describe('Dialog フォーカス管理', () => {
  it('開いたときにパネル内の最初のフォーカス可能要素へフォーカスする', async () => {
    render(<TestHarness />);
    const user = userEvent.setup();
    await user.click(screen.getByText('開く'));

    await waitFor(() => {
      expect(screen.getByText('最初のボタン')).toHaveFocus();
    });
  });

  it('Tabキーで先頭と末尾の要素が循環する', async () => {
    render(<TestHarness />);
    const user = userEvent.setup();
    await user.click(screen.getByText('開く'));

    const first = screen.getByText('最初のボタン');
    const last = screen.getByText('最後のボタン');

    await waitFor(() => expect(first).toHaveFocus());

    // 末尾から Tab で先頭へ循環
    last.focus();
    await user.tab();
    expect(first).toHaveFocus();

    // 先頭から Shift+Tab で末尾へ循環
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('閉じたあと、開く直前にフォーカスしていた要素へフォーカスが戻る', async () => {
    render(<TestHarness />);
    const user = userEvent.setup();
    const openButton = screen.getByText('開く');

    openButton.focus();
    await user.click(openButton);

    await waitFor(() => {
      expect(screen.getByText('最初のボタン')).toHaveFocus();
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(openButton).toHaveFocus();
    });
  });
});
