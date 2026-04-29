-- seasonal_shift_submissions に user_id を追加（アカウント紐づけ）

ALTER TABLE seasonal_shift_submissions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_seasonal_shift_submissions_user_id
  ON seasonal_shift_submissions(user_id);

-- 同一アカウントは同一設定に1回のみ提出可能
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasonal_shift_submissions_user_setting
  ON seasonal_shift_submissions(setting_id, user_id)
  WHERE user_id IS NOT NULL;

-- 既存の全許可ポリシーを削除してロール別に分離
DROP POLICY IF EXISTS "seasonal_shift_submissions_auth" ON seasonal_shift_submissions;

-- admin/owner/manager: 全提出を操作可能
CREATE POLICY "seasonal_shift_submissions_manager_all"
  ON seasonal_shift_submissions FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'owner', 'manager')
    )
  );

-- teacher: 自分の提出のみ参照・更新可能
CREATE POLICY "seasonal_shift_submissions_teacher_own"
  ON seasonal_shift_submissions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
