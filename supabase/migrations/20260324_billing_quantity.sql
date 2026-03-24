-- student_billings に数量フィールドを追加（5週目のコマ数など）
ALTER TABLE student_billings ADD COLUMN IF NOT EXISTS quantity integer DEFAULT NULL;

-- quantity が設定されている場合、is_billed も true にする
COMMENT ON COLUMN student_billings.quantity IS 'Optional numeric value (e.g., number of 5th-week slots). NULL means boolean-only (use is_billed).';
