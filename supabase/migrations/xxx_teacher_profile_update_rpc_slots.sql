-- 講師プロファイル更新 RPC に曜日別出勤可能コマを追加（xxx_teacher_available_slots_by_day の実行後に必要）
CREATE OR REPLACE FUNCTION update_teacher_profile(
  p_user_id UUID,
  p_display_name TEXT DEFAULT NULL,
  p_teachable_subject_ids UUID[] DEFAULT NULL,
  p_available_days_of_week INTEGER[] DEFAULT NULL,
  p_available_slot_numbers_by_day JSONB DEFAULT NULL
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
    available_slot_numbers_by_day = COALESCE(p_available_slot_numbers_by_day, available_slot_numbers_by_day),
    updated_at = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_profiles: row not found for id %', p_user_id;
  END IF;

  SELECT * INTO v_row FROM user_profiles WHERE id = p_user_id;
  RETURN to_json(v_row);
END;
$$;
