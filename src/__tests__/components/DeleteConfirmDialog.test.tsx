/**
 * コンポーネントテスト: DeleteConfirmDialog
 * 生徒削除確認ダイアログのテスト
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteConfirmDialog } from '@/components/students/DeleteConfirmDialog';

// Student 型の最小モック
const mockStudent = {
  id: 'student-1',
  school_id: 'school-1',
  last_name: '山田',
  first_name: '太郎',
  last_name_kana: 'ヤマダ',
  first_name_kana: 'タロウ',
  grade: 3,
  student_code: 'S001',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  deleted_at: null,
} as never; // Student型はDB生成型のため never でキャスト

describe('DeleteConfirmDialog', () => {
  const defaultProps = {
    isOpen: true,
    student: mockStudent,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    isLoading: false,
  };

  it('生徒名が表示される', () => {
    render(<DeleteConfirmDialog {...defaultProps} />);
    expect(screen.getByText(/山田/)).toBeInTheDocument();
    expect(screen.getByText(/太郎/)).toBeInTheDocument();
  });

  it('削除確認メッセージが表示される', () => {
    render(<DeleteConfirmDialog {...defaultProps} />);
    expect(screen.getByText(/削除してもよろしいですか/)).toBeInTheDocument();
  });

  it('データ保持の注意書きが表示される', () => {
    render(<DeleteConfirmDialog {...defaultProps} />);
    expect(screen.getByText(/データは保持されます/)).toBeInTheDocument();
  });

  it('削除ボタンをクリックするとonConfirmが呼ばれる', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<DeleteConfirmDialog {...defaultProps} onConfirm={onConfirm} />);

    await user.click(screen.getByText('削除する'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('キャンセルボタンをクリックするとonCancelが呼ばれる', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<DeleteConfirmDialog {...defaultProps} onCancel={onCancel} />);

    await user.click(screen.getByText('キャンセル'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('studentがnullの場合は何もレンダリングしない', () => {
    const { container } = render(<DeleteConfirmDialog {...defaultProps} student={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('isLoadingがtrueの場合、削除ボタンにisLoadingが渡される', () => {
    render(<DeleteConfirmDialog {...defaultProps} isLoading={true} />);
    // Button コンポーネントは isLoading 時に disabled になる
    const deleteButton = screen.getByText('削除する').closest('button');
    expect(deleteButton).toBeDisabled();
  });
});
