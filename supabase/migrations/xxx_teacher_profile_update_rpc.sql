-- 講師プロファイル更新用 RPC（display_name, teachable_subject_ids, available_days_of_week）
-- xxx_teacher_teachable_subjects_and_available_days の実行後に必要
CREATE OR REPLACE FUNCTION update_teacher_profile(
  p_user_id UUID,
  p_display_name TEXT DEFAULT NULL,
  p_teachable_subject_ids UUID[] DEFAULT NULL,
  p_available_days_of_week INTEGER[] DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row user_profiles%ROWTYPE;
BEGIN
  UPDATE user_profiles
  SET
    display_name = COALESCE(p_display_name, display_name),
    teachable_subject_ids = COALESCE(p_teachable_subject_ids, teachable_subject_ids),
    available_days_of_week = COALESCE(p_available_days_of_week, available_days_of_week),
    updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_profiles: row not found for id %', p_user_id;
  END IF;

  SELECT * INTO v_row FROM user_profiles WHERE id = p_user_id;
  RETURN to_json(v_row);
END;
$$;
