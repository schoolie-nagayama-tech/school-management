-- 教室長のセッション確認機能
-- confirmed_at / confirmed_by で「確認済み」を管理する
ALTER TABLE progress_sessions
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid DEFAULT NULL REFERENCES user_profiles(id);

-- 確認済み / 未確認のフィルタ用インデックス
CREATE INDEX IF NOT EXISTS idx_progress_sessions_confirmed
  ON progress_sessions (confirmed_at)
  WHERE confirmed_at IS NOT NULL;
