/**
 * コンポーネントテスト: FieldEditor
 * フォーム項目エディタのテスト
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldEditor } from '@/components/forms/FieldEditor';

describe('FieldEditor', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
    field: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 新規作成モード ──

  it('新規作成時に「項目を追加」タイトルが表示される', () => {
    render(<FieldEditor {...defaultProps} />);
    expect(screen.getByText('項目を追加')).toBeInTheDocument();
  });

  it('ラベル、プレースホルダー、タイプ選択、必須チェックボックスが表示される', () => {
    render(<FieldEditor {...defaultProps} />);
    expect(screen.getByText('ラベル')).toBeInTheDocument();
    expect(screen.getByText('プレースホルダー')).toBeInTheDocument();
    expect(screen.getByText('項目タイプ')).toBeInTheDocument();
    expect(screen.getByText('必須項目')).toBeInTheDocument();
  });

  it('保存・キャンセルボタンが表示される', () => {
    render(<FieldEditor {...defaultProps} />);
    expect(screen.getByText('保存')).toBeInTheDocument();
    expect(screen.getByText('キャンセル')).toBeInTheDocument();
  });

  it('ラベル未入力で保存ボタンが無効になる', () => {
    render(<FieldEditor {...defaultProps} />);
    const saveButton = screen.getByText('保存').closest('button');
    expect(saveButton).toBeDisabled();
  });

  it('ラベルを入力すると保存ボタンが有効になる', async () => {
    const user = userEvent.setup();
    render(<FieldEditor {...defaultProps} />);

    const labelInput = screen.getByPlaceholderText('例: 希望日程');
    await user.type(labelInput, 'テスト項目');

    const saveButton = screen.getByText('保存').closest('button');
    expect(saveButton).not.toBeDisabled();
  });

  it('ラベル入力して保存するとonSaveが正しい引数で呼ばれる', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<FieldEditor {...defaultProps} onSave={onSave} />);

    await user.type(screen.getByPlaceholderText('例: 希望日程'), 'テスト項目');
    await user.click(screen.getByText('保存'));

    expect(onSave).toHaveBeenCalledWith({
      field_type: 'text',
      label: 'テスト項目',
      placeholder: undefined,
      options: undefined,
      is_required: false,
    });
  });

  it('必須チェックボックスをオンにすると is_required=true で保存される', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<FieldEditor {...defaultProps} onSave={onSave} />);

    await user.type(screen.getByPlaceholderText('例: 希望日程'), 'テスト');
    await user.click(screen.getByLabelText('必須項目'));
    await user.click(screen.getByText('保存'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ is_required: true })
    );
  });

  it('キャンセルボタンでonCloseが呼ばれる', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FieldEditor {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByText('キャンセル'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── 選択肢が必要なフィールドタイプ ──

  it('selectタイプ選択時に選択肢テキストエリアが表示される', async () => {
    const user = userEvent.setup();
    render(<FieldEditor {...defaultProps} />);

    // Select コンポーネントの値を変更
    const typeSelect = screen.getByDisplayValue('テキスト');
    await user.selectOptions(typeSelect, 'select');

    expect(screen.getByText('選択肢')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/会場A/)).toBeInTheDocument();
  });

  it('selectタイプで選択肢未入力のまま保存するとエラーが表示される', async () => {
    const user = userEvent.setup();
    render(<FieldEditor {...defaultProps} />);

    const typeSelect = screen.getByDisplayValue('テキスト');
    await user.selectOptions(typeSelect, 'select');
    await user.type(screen.getByPlaceholderText('例: 希望日程'), 'テスト');
    await user.click(screen.getByText('保存'));

    expect(screen.getByText(/選択肢を入力してください/)).toBeInTheDocument();
  });

  it('selectタイプで選択肢を入力して保存するとoptionsが正しく渡される', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<FieldEditor {...defaultProps} onSave={onSave} />);

    const typeSelect = screen.getByDisplayValue('テキスト');
    await user.selectOptions(typeSelect, 'select');
    await user.type(screen.getByPlaceholderText('例: 希望日程'), 'テスト');
    await user.type(screen.getByPlaceholderText(/会場A/), '選択肢1\n選択肢2\n選択肢3');
    await user.click(screen.getByText('保存'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        field_type: 'select',
        options: ['選択肢1', '選択肢2', '選択肢3'],
      })
    );
  });

  it('textタイプでは選択肢テキストエリアが表示されない', () => {
    render(<FieldEditor {...defaultProps} />);
    expect(screen.queryByText('選択肢')).not.toBeInTheDocument();
  });

  // ── 編集モード ──

  it('既存フィールドが渡された場合「項目を編集」タイトルになる', () => {
    const existingField = {
      field_type: 'text' as const,
      label: '既存ラベル',
      placeholder: '既存プレースホルダー',
      is_required: true,
      options: null,
      sort_order: 0,
    };
    render(<FieldEditor {...defaultProps} field={existingField as never} />);
    expect(screen.getByText('項目を編集')).toBeInTheDocument();
  });

  it('既存フィールドの値がフォームに反映される', () => {
    const existingField = {
      field_type: 'textarea' as const,
      label: '既存ラベル',
      placeholder: '既存プレースホルダー',
      is_required: true,
      options: null,
      sort_order: 0,
    };
    render(<FieldEditor {...defaultProps} field={existingField as never} />);

    expect(screen.getByDisplayValue('既存ラベル')).toBeInTheDocument();
    expect(screen.getByDisplayValue('既存プレースホルダー')).toBeInTheDocument();
    expect(screen.getByLabelText('必須項目')).toBeChecked();
  });

  it('ラベル未入力で保存ボタンを押すとエラーが表示される', async () => {
    const user = userEvent.setup();
    const existingField = {
      field_type: 'text' as const,
      label: 'あ',
      placeholder: '',
      is_required: false,
      options: null,
      sort_order: 0,
    };
    render(<FieldEditor {...defaultProps} field={existingField as never} />);

    // ラベルをクリアして保存 → disabled なのでクリックしても何も起きない
    const labelInput = screen.getByDisplayValue('あ');
    await user.clear(labelInput);

    const saveButton = screen.getByText('保存').closest('button');
    expect(saveButton).toBeDisabled();
  });
});
