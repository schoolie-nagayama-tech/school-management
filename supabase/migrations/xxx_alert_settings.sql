-- アラート設定テーブル：教室ごとに各アラートの ON/OFF・しきい値を保存
CREATE TABLE IF NOT EXISTS alert_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, alert_type)
);
CREATE INDEX IF NOT EXISTS idx_alert_settings_school ON alert_settings(school_id);

ALTER TABLE alert_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alert_settings_school_member_select ON alert_settings;
CREATE POLICY alert_settings_school_member_select ON alert_settings FOR SELECT
  USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS alert_settings_school_member_modify ON alert_settings;
CREATE POLICY alert_settings_school_member_modify ON alert_settings FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
