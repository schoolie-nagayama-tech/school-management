-- 出勤簿改定: ワークフロー拡張、準備給日数計算、交通費、備考、退職日

-- attendance_types に授業系フラグを追加（準備給の日数カウントに使用）
ALTER TABLE attendance_types
  ADD COLUMN IF NOT EXISTS is_class_type boolean DEFAULT true NOT NULL;

-- attendance_sheets: ステータス拡張 + 管理者入力フィールド
-- reviewed = 教室長が管理者に提出済み
ALTER TABLE attendance_sheets
  DROP CONSTRAINT IF EXISTS attendance_sheets_status_check;
ALTER TABLE attendance_sheets
  ADD CONSTRAINT attendance_sheets_status_check
    CHECK (status IN ('draft', 'submitted', 'reviewed', 'approved', 'rejected'));

ALTER TABLE attendance_sheets
  ADD COLUMN IF NOT EXISTS transport_cost integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS admin_note text,
  ADD COLUMN IF NOT EXISTS is_koma_changing boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_to uuid;

-- user_profiles に退職日を追加
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS exit_date date;
