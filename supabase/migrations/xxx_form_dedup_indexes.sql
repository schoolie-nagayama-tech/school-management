-- =============================================
-- フォーム送信・シフト提出の重複防止（スパム対策）
-- 同一内容の多重送信をDB側で拒否
-- =============================================

-- form_responses: 同一教室・フォーム種別・期間・生徒名・メールアドレスで重複防止
CREATE UNIQUE INDEX IF NOT EXISTS idx_form_responses_dedup
  ON form_responses(school_id, form_type, form_period, student_name, email);

-- seasonal_shift_submissions: 同一設定・講師名・メールアドレスで重複防止
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasonal_shift_submissions_dedup
  ON seasonal_shift_submissions(setting_id, teacher_name, teacher_email);
