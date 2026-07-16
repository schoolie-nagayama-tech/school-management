-- ダッシュボード系ウィジェットの表示ON/OFFを教室ごとに保存する汎用テーブル
-- alert_settings と同じ設計（教室単位・種別ごとのenabledフラグ）。
-- 第一弾は生徒管理ページ上部の「講習進捗サマリー」(widget_key = 'course_progress_summary')。
CREATE TABLE IF NOT EXISTS school_widget_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  widget_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, widget_key)
);
CREATE INDEX IF NOT EXISTS idx_school_widget_settings_school ON school_widget_settings(school_id);

ALTER TABLE school_widget_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_widget_settings_school_member_select ON school_widget_settings;
CREATE POLICY school_widget_settings_school_member_select ON school_widget_settings FOR SELECT
  USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS school_widget_settings_school_member_modify ON school_widget_settings;
CREATE POLICY school_widget_settings_school_member_modify ON school_widget_settings FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
