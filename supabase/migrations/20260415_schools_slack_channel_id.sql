-- Add Slack channel id mapping to schools for Notta→Slack integration
ALTER TABLE schools ADD COLUMN IF NOT EXISTS slack_channel_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_slack_channel_id
  ON schools(slack_channel_id)
  WHERE slack_channel_id IS NOT NULL;
