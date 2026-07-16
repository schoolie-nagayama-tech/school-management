-- regular_shift_submissions に user_id を追加（既存講師アカウントとの紐づけ用）
-- 季節シフトの 20260429_seasonal_shift_user_id.sql と同じパターンに揃える。

ALTER TABLE regular_shift_submissions
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_regular_shift_submissions_user_id
  ON regular_shift_submissions(user_id);

-- 同一アカウントは同一設定に1回のみ提出可能（手動リンクでも重複防止）
CREATE UNIQUE INDEX IF NOT EXISTS idx_regular_shift_submissions_user_setting
  ON regular_shift_submissions(setting_id, user_id)
  WHERE user_id IS NOT NULL;

-- 既存の全許可ポリシーを削除してロール別に分離
DROP POLICY IF EXISTS "regular_shift_submissions_auth" ON regular_shift_submissions;
DROP POLICY IF EXISTS "regular_shift_submissions_manager_all" ON regular_shift_submissions;
DROP POLICY IF EXISTS "regular_shift_submissions_teacher_own" ON regular_shift_submissions;

-- admin/owner/manager: 全提出を操作可能
CREATE POLICY "regular_shift_submissions_manager_all"
  ON regular_shift_submissions FOR ALL TO authenticated
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
CREATE POLICY "regular_shift_submissions_teacher_own"
  ON regular_shift_submissions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
