-- =====================================================
-- 座席表システム Phase 1: コマ時間・休講日・通常パターン・週次スケジュール
-- =====================================================

-- 1. コマ時間マスタ（教室ごと）
CREATE TABLE IF NOT EXISTS schedule_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL CHECK (slot_number >= 1 AND slot_number <= 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, slot_number)
);

CREATE INDEX IF NOT EXISTS idx_schedule_time_slots_school ON schedule_time_slots(school_id, is_active, display_order);

DROP TRIGGER IF EXISTS update_schedule_time_slots_updated_at ON schedule_time_slots;
CREATE TRIGGER update_schedule_time_slots_updated_at
  BEFORE UPDATE ON schedule_time_slots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE schedule_time_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schedule_time_slots_allow_all_auth" ON schedule_time_slots;
CREATE POLICY "schedule_time_slots_allow_all_auth" ON schedule_time_slots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. 休講日マスタ（祝日・教室休講）
CREATE TABLE IF NOT EXISTS schedule_closed_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  closed_date DATE NOT NULL,
  reason TEXT,
  is_global BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_closed_days_date ON schedule_closed_days(closed_date);
CREATE INDEX IF NOT EXISTS idx_schedule_closed_days_school ON schedule_closed_days(school_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_closed_days_school_date ON schedule_closed_days(school_id, closed_date) WHERE school_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_closed_days_global_date ON schedule_closed_days(closed_date) WHERE school_id IS NULL;

ALTER TABLE schedule_closed_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schedule_closed_days_allow_all_auth" ON schedule_closed_days;
CREATE POLICY "schedule_closed_days_allow_all_auth" ON schedule_closed_days
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 全教室共通は school_id NULL + is_global true で運用（UNIQUEは (school_id, closed_date) のため NULL 同士は複数可にしたい）
-- PostgreSQL では UNIQUE(school_id, closed_date) は NULL を別々に扱うため、is_global の場合は school_id を NULL にして1日1行で登録する想定

-- 3. 通常授業パターン（生徒・曜日・コマ・講師・科目・座席・期間タイプ）
CREATE TABLE IF NOT EXISTS schedule_regular_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  time_slot_id UUID NOT NULL REFERENCES schedule_time_slots(id) ON DELETE RESTRICT,
  teacher_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  subject_ids UUID[] NOT NULL DEFAULT '{}',
  seat_label TEXT,
  period_type TEXT NOT NULL DEFAULT 'regular' CHECK (period_type IN ('regular', 'spring', 'summer', 'winter')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_regular_patterns_school ON schedule_regular_patterns(school_id);
CREATE INDEX IF NOT EXISTS idx_schedule_regular_patterns_student ON schedule_regular_patterns(student_id);
CREATE INDEX IF NOT EXISTS idx_schedule_regular_patterns_teacher ON schedule_regular_patterns(teacher_id);
CREATE INDEX IF NOT EXISTS idx_schedule_regular_patterns_day_slot ON schedule_regular_patterns(school_id, day_of_week, time_slot_id, is_active);

DROP TRIGGER IF EXISTS update_schedule_regular_patterns_updated_at ON schedule_regular_patterns;
CREATE TRIGGER update_schedule_regular_patterns_updated_at
  BEFORE UPDATE ON schedule_regular_patterns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE schedule_regular_patterns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schedule_regular_patterns_allow_all_auth" ON schedule_regular_patterns;
CREATE POLICY "schedule_regular_patterns_allow_all_auth" ON schedule_regular_patterns
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 4. 週次スケジュール（通常パターンから生成された実際の授業）
CREATE TABLE IF NOT EXISTS schedule_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  time_slot_id UUID NOT NULL REFERENCES schedule_time_slots(id) ON DELETE RESTRICT,
  teacher_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_ids UUID[] NOT NULL DEFAULT '{}',
  seat_label TEXT,
  regular_pattern_id UUID REFERENCES schedule_regular_patterns(id) ON DELETE SET NULL,
  attendance_status TEXT CHECK (attendance_status IS NULL OR attendance_status IN ('present', 'absent', 'late')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, entry_date, time_slot_id, teacher_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_entries_school_date ON schedule_entries(school_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_schedule_entries_teacher ON schedule_entries(teacher_id, entry_date);

DROP TRIGGER IF EXISTS update_schedule_entries_updated_at ON schedule_entries;
CREATE TRIGGER update_schedule_entries_updated_at
  BEFORE UPDATE ON schedule_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE schedule_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schedule_entries_allow_all_auth" ON schedule_entries;
CREATE POLICY "schedule_entries_allow_all_auth" ON schedule_entries
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. スケジュール生成ログ（任意）
CREATE TABLE IF NOT EXISTS schedule_generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  entries_created INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_generation_logs_school ON schedule_generation_logs(school_id, week_start_date);

ALTER TABLE schedule_generation_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schedule_generation_logs_allow_all_auth" ON schedule_generation_logs;
CREATE POLICY "schedule_generation_logs_allow_all_auth" ON schedule_generation_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
