-- Notta（文字起こしアプリ）から Zapier 経由で届く録音データを保存するテーブル
CREATE TABLE IF NOT EXISTS notta_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT,
  recorded_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER,
  transcript TEXT NOT NULL,
  audio_url TEXT,
  speakers JSONB,
  raw_payload JSONB,
  external_id TEXT,
  linked_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  linked_interview_id UUID REFERENCES student_interviews(id) ON DELETE SET NULL,
  linked_at TIMESTAMP WITH TIME ZONE,
  is_archived BOOLEAN DEFAULT FALSE,
  archived_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (school_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_notta_transcripts_school_created
  ON notta_transcripts(school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notta_transcripts_school_unlinked
  ON notta_transcripts(school_id, created_at DESC)
  WHERE linked_student_id IS NULL AND is_archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_notta_transcripts_linked_student
  ON notta_transcripts(linked_student_id)
  WHERE linked_student_id IS NOT NULL;

ALTER TABLE notta_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all access for all users" ON notta_transcripts
  FOR ALL USING (true) WITH CHECK (true);
