-- ============================================================
-- 請求管理の拡張: セル値の型対応 + フォーム連携
-- ============================================================

-- 1. billing_items にvalue_typeとlinked_form_typeを追加
ALTER TABLE billing_items
  ADD COLUMN IF NOT EXISTS value_type text NOT NULL DEFAULT 'check'
    CHECK (value_type IN ('check', 'number', 'text')),
  ADD COLUMN IF NOT EXISTS linked_form_type text DEFAULT NULL;

COMMENT ON COLUMN billing_items.value_type IS 'セルの値の型: check=✓/空, number=数値, text=文字列';
COMMENT ON COLUMN billing_items.linked_form_type IS 'フォーム連携: moshi, mogi, zoukoma等。NULLなら手動項目';

-- 2. student_billings にvalue_number, value_textを追加
ALTER TABLE student_billings
  ADD COLUMN IF NOT EXISTS value_number integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS value_text text DEFAULT NULL;

COMMENT ON COLUMN student_billings.value_number IS 'number型項目の値（コマ数、回数等）';
COMMENT ON COLUMN student_billings.value_text IS 'text型項目の値（教材名等）';

-- 3. 既存のデフォルト項目のvalue_typeを更新（既に作成された期間がある場合）
-- 5週目: number
UPDATE billing_items SET value_type = 'number' WHERE name = '5週目' AND value_type = 'check';
-- 単語練習帳: number
UPDATE billing_items SET value_type = 'number' WHERE name = '単語練習帳' AND value_type = 'check';
-- 増コマ: number + form_type
UPDATE billing_items SET value_type = 'number', linked_form_type = 'zoukoma'
  WHERE name = '増コマ' AND value_type = 'check';
-- 模擬: number + form_type
UPDATE billing_items SET value_type = 'number', linked_form_type = 'mogi'
  WHERE name = '模擬' AND value_type = 'check';
-- 模試: number + form_type
UPDATE billing_items SET value_type = 'number', linked_form_type = 'moshi'
  WHERE name = '模試' AND value_type = 'check';
-- 教材発注: text
UPDATE billing_items SET value_type = 'text' WHERE name = '教材発注' AND value_type = 'check';
