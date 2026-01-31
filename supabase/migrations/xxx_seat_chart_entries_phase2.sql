-- =====================================================
-- 座席表 Phase 2: schedule_entries 拡張（status, 出席記録, 振替）
-- =====================================================

-- status: scheduled | completed | cancelled | transferred_out | transferred_in
ALTER TABLE schedule_entries
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scheduled';

ALTER TABLE schedule_entries DROP CONSTRAINT IF EXISTS schedule_entries_status_check;
ALTER TABLE schedule_entries ADD CONSTRAINT schedule_entries_status_check
  CHECK (status IN ('scheduled', 'completed', 'cancelled', 'transferred_out', 'transferred_in'));

-- 出席記録
ALTER TABLE schedule_entries
  ADD COLUMN IF NOT EXISTS attendance_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_recorded_by UUID REFERENCES user_profiles(id);

-- 備考
ALTER TABLE schedule_entries
  ADD COLUMN IF NOT EXISTS note TEXT;

-- 振替リンク
ALTER TABLE schedule_entries
  ADD COLUMN IF NOT EXISTS transfer_from_id UUID REFERENCES schedule_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS transfer_to_id UUID REFERENCES schedule_entries(id) ON DELETE SET NULL;

-- 既存行の status を埋める
UPDATE schedule_entries SET status = 'scheduled' WHERE status IS NULL;
ALTER TABLE schedule_entries ALTER COLUMN status SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schedule_entries_status ON schedule_entries(school_id, entry_date, status);
CREATE INDEX IF NOT EXISTS idx_schedule_entries_transfer ON schedule_entries(transfer_from_id) WHERE transfer_from_id IS NOT NULL;
