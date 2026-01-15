-- =====================================================
-- 講習管理機能 スキーマ
-- =====================================================

-- 1. 講習コースマスタ
CREATE TABLE IF NOT EXISTS seasonal_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- コース名（例：中3夏期 英語基礎）
  season TEXT NOT NULL CHECK (season IN ('spring', 'summer', 'winter')),  -- 季節
  target_grades INTEGER[] DEFAULT '{}',  -- 対象学年（配列：[7,8,9]など）
  total_koma INTEGER DEFAULT 0,          -- 合計コマ数
  comment TEXT,                          -- コメント
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. コースとテキストの紐付け（1コース最大3テキスト）
CREATE TABLE IF NOT EXISTS seasonal_course_textbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES seasonal_courses(id) ON DELETE CASCADE,
  textbook_id INTEGER REFERENCES textbooks(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(course_id, textbook_id)
);

-- 3. コースのカリキュラム設定（単元ごとの提案回数・グループ）
CREATE TABLE IF NOT EXISTS seasonal_course_curriculum (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES seasonal_courses(id) ON DELETE CASCADE,
  textbook_id INTEGER REFERENCES textbooks(id) ON DELETE CASCADE,
  curriculum_item_id INTEGER REFERENCES curriculum_items(id) ON DELETE CASCADE,
  proposal_count INTEGER DEFAULT 0,      -- 提案回数（0=やらない）
  group_number INTEGER DEFAULT NULL,     -- グループ番号（NULLなら単独）
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(course_id, curriculum_item_id)
);

-- 4. コース適用履歴（どの生徒にいつ適用したか）
CREATE TABLE IF NOT EXISTS seasonal_course_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID REFERENCES seasonal_courses(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  applied_mode TEXT CHECK (applied_mode IN ('overwrite', 'add')),  -- 上書き or 加算
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_seasonal_courses_school ON seasonal_courses(school_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_courses_season ON seasonal_courses(season);
CREATE INDEX IF NOT EXISTS idx_seasonal_course_textbooks_course ON seasonal_course_textbooks(course_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_course_curriculum_course ON seasonal_course_curriculum(course_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_course_applications_course ON seasonal_course_applications(course_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_course_applications_student ON seasonal_course_applications(student_id);

-- updated_at自動更新トリガー
DROP TRIGGER IF EXISTS update_seasonal_courses_updated_at ON seasonal_courses;
CREATE TRIGGER update_seasonal_courses_updated_at
  BEFORE UPDATE ON seasonal_courses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_seasonal_course_curriculum_updated_at ON seasonal_course_curriculum;
CREATE TRIGGER update_seasonal_course_curriculum_updated_at
  BEFORE UPDATE ON seasonal_course_curriculum
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS ポリシー
ALTER TABLE seasonal_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasonal_course_textbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasonal_course_curriculum ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasonal_course_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all for seasonal_courses" ON seasonal_courses FOR ALL USING (true);
CREATE POLICY "Enable all for seasonal_course_textbooks" ON seasonal_course_textbooks FOR ALL USING (true);
CREATE POLICY "Enable all for seasonal_course_curriculum" ON seasonal_course_curriculum FOR ALL USING (true);
CREATE POLICY "Enable all for seasonal_course_applications" ON seasonal_course_applications FOR ALL USING (true);
