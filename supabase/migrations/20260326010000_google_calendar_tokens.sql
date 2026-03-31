-- Google Calendar OAuth トークン保存テーブル
CREATE TABLE IF NOT EXISTS google_calendar_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expiry timestamptz NOT NULL,
  calendar_email text, -- 連携先Googleアカウントのメール
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id)
);

-- RLS有効化
ALTER TABLE google_calendar_tokens ENABLE ROW LEVEL SECURITY;

-- ユーザー本人のみ読み書き可
CREATE POLICY "Users can view own tokens"
  ON google_calendar_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tokens"
  ON google_calendar_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tokens"
  ON google_calendar_tokens FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own tokens"
  ON google_calendar_tokens FOR DELETE
  USING (auth.uid() = user_id);

-- service_role はRLSバイパスするので別途ポリシー不要

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_google_calendar_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_google_calendar_tokens_updated_at
  BEFORE UPDATE ON google_calendar_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_google_calendar_tokens_updated_at();
