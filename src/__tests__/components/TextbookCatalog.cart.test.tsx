/**
 * コンポーネントテスト: TextbookCatalog のカート永続化
 *
 * カートは TextbookCatalog の useState だが、親ページが fetchData() する度に
 * isLoading の出し分けで本コンポーネントごとアンマウントされる（教材登録・在庫調整など、
 * ページから移動していなくても起きる）。sessionStorage への退避・復元でカートが
 * 黙って消えないことと、教室切替では逆に破棄されることを固定する。
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextbookCatalog, type CartItem } from '@/components/ordering/TextbookCatalog';

const CART_KEY = 'nest-ordering-cart-v1';

const cartItem: CartItem = {
  id: 'c1',
  textbookName: 'フォレスタステップ | 3年 | 数学',
  studentId: 'stu-1',
  studentLabel: '腰尾 友惟',
  quantity: 2,
  // Textbook は DB 生成型のため never でキャスト（カート表示に使う項目のみ持たせる）
  textbook: { id: 'tb-1', name: 'フォレスタステップ', grade: '3年', subject: '数学' } as never,
};

const baseProps = {
  textbooks: [],
  students: [],
  canEdit: true,
  materials: [],
  onOrder: vi.fn(),
  onStockAdjust: vi.fn(),
  onStockRegister: vi.fn(),
};

/** 前回セッションで保存されたカートを模す */
function seedCart(scope: string, items: CartItem[]) {
  sessionStorage.setItem(CART_KEY, JSON.stringify({ scope, items }));
}

function readCart(): { scope: string; items: CartItem[] } | null {
  const raw = sessionStorage.getItem(CART_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe('TextbookCatalog カート永続化', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('同じ教室なら保存済みカートを復元する（再取得でアンマウントされても消えない）', () => {
    seedCart('school-1', [cartItem]);
    render(<TextbookCatalog {...baseProps} onBulkOrder={vi.fn()} schoolScopeKey="school-1" />);
    expect(screen.getByText('カート: 1件（2冊）')).toBeInTheDocument();
  });

  it('教室が違えば保存済みカートを復元しない（別教室の生徒・教材が混ざるため）', () => {
    seedCart('school-1', [cartItem]);
    render(<TextbookCatalog {...baseProps} onBulkOrder={vi.fn()} schoolScopeKey="school-2" />);
    expect(screen.queryByText(/カート:/)).not.toBeInTheDocument();
  });

  it('壊れた保存データでも落ちずに空カートで開く', () => {
    sessionStorage.setItem(CART_KEY, '{壊れたJSON');
    render(<TextbookCatalog {...baseProps} onBulkOrder={vi.fn()} schoolScopeKey="school-1" />);
    expect(screen.queryByText(/カート:/)).not.toBeInTheDocument();
  });

  it('マウントしたまま教室が切り替わったらカートを捨てる', () => {
    seedCart('school-1', [cartItem]);
    const { rerender } = render(
      <TextbookCatalog {...baseProps} onBulkOrder={vi.fn()} schoolScopeKey="school-1" />
    );
    expect(screen.getByText('カート: 1件（2冊）')).toBeInTheDocument();

    rerender(<TextbookCatalog {...baseProps} onBulkOrder={vi.fn()} schoolScopeKey="school-2" />);

    expect(screen.queryByText(/カート:/)).not.toBeInTheDocument();
    // 旧教室のカートが新教室のスコープで保存され続けないこと
    expect(readCart()).toBeNull();
  });

  it('発注が成功したらカートも保存データも空になる', async () => {
    const user = userEvent.setup();
    seedCart('school-1', [cartItem]);
    const onBulkOrder = vi.fn().mockResolvedValue(undefined);
    render(<TextbookCatalog {...baseProps} onBulkOrder={onBulkOrder} schoolScopeKey="school-1" />);

    await user.click(screen.getByText('カート: 1件（2冊）'));
    await user.click(screen.getByText('まとめて発注する'));

    expect(onBulkOrder).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/カート:/)).not.toBeInTheDocument();
    expect(readCart()).toBeNull();
  });

  it('発注が失敗したらカートを残す（入力し直しを避ける・無言で消さない）', async () => {
    const user = userEvent.setup();
    seedCart('school-1', [cartItem]);
    const onBulkOrder = vi.fn().mockRejectedValue(new Error('発注の登録に失敗しました'));
    render(<TextbookCatalog {...baseProps} onBulkOrder={onBulkOrder} schoolScopeKey="school-1" />);

    await user.click(screen.getByText('カート: 1件（2冊）'));
    await user.click(screen.getByText('まとめて発注する'));

    expect(onBulkOrder).toHaveBeenCalledTimes(1);
    expect(screen.getByText('カート: 1件（2冊）')).toBeInTheDocument();
    expect(readCart()?.items).toHaveLength(1);
  });
});
