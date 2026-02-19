-- form_periods の匿名ユーザー向けRLSポリシーを修正
-- 公開可否は publish_start/publish_end の日付で判定するため、is_active 条件を削除
-- （アプリ側の getActiveFormPeriod と整合させる）

DROP POLICY IF EXISTS "form_periods_allow_select_anon" ON form_periods;
CREATE POLICY "form_periods_allow_select_anon" ON form_periods
  FOR SELECT TO anon USING (
    (is_archived IS NULL OR is_archived = false)
    AND (publish_start IS NULL OR publish_start <= NOW())
    AND (publish_end IS NULL OR publish_end >= NOW())
  );
