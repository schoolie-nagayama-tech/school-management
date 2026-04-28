-- 評価科目マスタ：成績・通知表用の科目定義（学校種別×学年×カテゴリ）
-- 既存の `subjects` テーブル（指導科目区分）とは別物
CREATE TABLE IF NOT EXISTS assessment_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NULL REFERENCES schools(id) ON DELETE CASCADE, -- NULL=共通／値=教室カスタム
  code TEXT NOT NULL,                   -- 'hs_eng_com_1' 等
  name TEXT NOT NULL,
  short_name TEXT NULL,
  school_type TEXT NOT NULL CHECK (school_type IN ('小学','中学','高校','共通')),
  applicable_grades INTEGER[] NOT NULL DEFAULT '{}',  -- 1..12（1=小1, 7=中1, 10=高1）
  category TEXT NOT NULL,               -- 'english','math','japanese','science','social','art','pe','tech_home','home','info','exploration','life','other'
  is_required BOOLEAN NOT NULL DEFAULT false,
  is_system BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);

CREATE INDEX IF NOT EXISTS idx_assessment_subjects_school ON assessment_subjects(school_id);
CREATE INDEX IF NOT EXISTS idx_assessment_subjects_school_type ON assessment_subjects(school_type);
CREATE INDEX IF NOT EXISTS idx_assessment_subjects_category ON assessment_subjects(category);

ALTER TABLE assessment_subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assessment_subjects_select ON assessment_subjects;
CREATE POLICY assessment_subjects_select ON assessment_subjects FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS assessment_subjects_modify ON assessment_subjects;
CREATE POLICY assessment_subjects_modify ON assessment_subjects FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ========== 標準セット（system seed） ==========
INSERT INTO assessment_subjects (code, name, short_name, school_type, applicable_grades, category, is_required, is_system, sort_order)
VALUES
-- 小学校
('elem_japanese',     '国語',         '国',   '小学', ARRAY[1,2,3,4,5,6], 'japanese',  true, true, 110),
('elem_math',         '算数',         '算',   '小学', ARRAY[1,2,3,4,5,6], 'math',      true, true, 120),
('elem_seikatsu',     '生活',         '生',   '小学', ARRAY[1,2],         'life',      true, true, 130),
('elem_science',      '理科',         '理',   '小学', ARRAY[3,4,5,6],     'science',   true, true, 140),
('elem_social',       '社会',         '社',   '小学', ARRAY[3,4,5,6],     'social',    true, true, 150),
('elem_eng_activity', '外国語活動',   '外活', '小学', ARRAY[3,4],         'english',   true, true, 160),
('elem_english',      '外国語(英語)', '英',   '小学', ARRAY[5,6],         'english',   true, true, 161),
('elem_music',        '音楽',         '音',   '小学', ARRAY[1,2,3,4,5,6], 'art',       false, true, 170),
('elem_art',          '図画工作',     '図工', '小学', ARRAY[1,2,3,4,5,6], 'art',       false, true, 180),
('elem_pe',           '体育',         '体',   '小学', ARRAY[1,2,3,4,5,6], 'pe',        false, true, 190),
('elem_home',         '家庭',         '家',   '小学', ARRAY[5,6],         'home',      false, true, 200),
-- 中学校
('jhs_japanese',      '国語',         '国',   '中学', ARRAY[7,8,9], 'japanese', true, true, 310),
('jhs_math',          '数学',         '数',   '中学', ARRAY[7,8,9], 'math',     true, true, 320),
('jhs_english',       '英語',         '英',   '中学', ARRAY[7,8,9], 'english',  true, true, 330),
('jhs_science',       '理科',         '理',   '中学', ARRAY[7,8,9], 'science',  true, true, 340),
('jhs_social_geo',    '社会(地理)',   '地理', '中学', ARRAY[7,8],   'social',   true, true, 350),
('jhs_social_history','社会(歴史)',   '歴史', '中学', ARRAY[7,8,9], 'social',   true, true, 351),
('jhs_social_civics', '社会(公民)',   '公民', '中学', ARRAY[9],     'social',   true, true, 352),
('jhs_music',         '音楽',         '音',   '中学', ARRAY[7,8,9], 'art',      false, true, 360),
('jhs_art',           '美術',         '美',   '中学', ARRAY[7,8,9], 'art',      false, true, 370),
('jhs_pe',            '保健体育',     '保体', '中学', ARRAY[7,8,9], 'pe',       false, true, 380),
('jhs_tech_home',     '技術・家庭',   '技家', '中学', ARRAY[7,8,9], 'tech_home',false, true, 390),
-- 高校（新課程 2022〜）
('hs_gendai_kokugo',  '現代の国語',   '現国', '高校', ARRAY[10],       'japanese', true,  true, 510),
('hs_gengo_bunka',    '言語文化',     '言文', '高校', ARRAY[10],       'japanese', true,  true, 511),
('hs_ronri_kokugo',   '論理国語',     '論国', '高校', ARRAY[11,12],    'japanese', false, true, 512),
('hs_bungaku_kokugo', '文学国語',     '文国', '高校', ARRAY[11,12],    'japanese', false, true, 513),
('hs_kokugo_hyogen',  '国語表現',     '国表', '高校', ARRAY[11,12],    'japanese', false, true, 514),
('hs_koten_tankyu',   '古典探究',     '古探', '高校', ARRAY[11,12],    'japanese', false, true, 515),
('hs_math_1',         '数学Ⅰ',       '数Ⅰ', '高校', ARRAY[10],       'math', true,  true, 520),
('hs_math_a',         '数学A',        '数A', '高校', ARRAY[10],       'math', false, true, 521),
('hs_math_2',         '数学Ⅱ',       '数Ⅱ', '高校', ARRAY[11],       'math', false, true, 522),
('hs_math_b',         '数学B',        '数B', '高校', ARRAY[11],       'math', false, true, 523),
('hs_math_3',         '数学Ⅲ',       '数Ⅲ', '高校', ARRAY[12],       'math', false, true, 524),
('hs_math_c',         '数学C',        '数C', '高校', ARRAY[11,12],    'math', false, true, 525),
('hs_eng_com_1',      '英語コミュニケーションⅠ',  '英コⅠ',   '高校', ARRAY[10],    'english', true,  true, 530),
('hs_eng_com_2',      '英語コミュニケーションⅡ',  '英コⅡ',   '高校', ARRAY[11],    'english', false, true, 531),
('hs_eng_com_3',      '英語コミュニケーションⅢ',  '英コⅢ',   '高校', ARRAY[12],    'english', false, true, 532),
('hs_logic_expr_1',   '論理・表現Ⅰ',              '論表Ⅰ',   '高校', ARRAY[10],    'english', false, true, 533),
('hs_logic_expr_2',   '論理・表現Ⅱ',              '論表Ⅱ',   '高校', ARRAY[11],    'english', false, true, 534),
('hs_logic_expr_3',   '論理・表現Ⅲ',              '論表Ⅲ',   '高校', ARRAY[12],    'english', false, true, 535),
('hs_phys_basic',     '物理基礎',     '物基', '高校', ARRAY[10,11],    'science', false, true, 540),
('hs_chem_basic',     '化学基礎',     '化基', '高校', ARRAY[10,11],    'science', false, true, 541),
('hs_bio_basic',      '生物基礎',     '生基', '高校', ARRAY[10,11],    'science', false, true, 542),
('hs_earth_basic',    '地学基礎',     '地基', '高校', ARRAY[10,11],    'science', false, true, 543),
('hs_phys',           '物理',         '物',   '高校', ARRAY[11,12],    'science', false, true, 544),
('hs_chem',           '化学',         '化',   '高校', ARRAY[11,12],    'science', false, true, 545),
('hs_bio',            '生物',         '生',   '高校', ARRAY[11,12],    'science', false, true, 546),
('hs_earth',          '地学',         '地',   '高校', ARRAY[11,12],    'science', false, true, 547),
('hs_kagaku_jinsei',  '科学と人間生活', '科人', '高校', ARRAY[10],     'science', false, true, 548),
('hs_chiri_sogo',     '地理総合',     '地総', '高校', ARRAY[10,11],    'social',  true,  true, 550),
('hs_rekishi_sogo',   '歴史総合',     '歴総', '高校', ARRAY[10,11],    'social',  true,  true, 551),
('hs_chiri_tankyu',   '地理探究',     '地探', '高校', ARRAY[11,12],    'social',  false, true, 552),
('hs_nihonshi_tankyu','日本史探究',   '日探', '高校', ARRAY[11,12],    'social',  false, true, 553),
('hs_sekaishi_tankyu','世界史探究',   '世探', '高校', ARRAY[11,12],    'social',  false, true, 554),
('hs_kokyo',          '公共',         '公',   '高校', ARRAY[10,11],    'social',  true,  true, 560),
('hs_rinri',          '倫理',         '倫',   '高校', ARRAY[11,12],    'social',  false, true, 561),
('hs_seikei',         '政治・経済',   '政経', '高校', ARRAY[11,12],    'social',  false, true, 562),
('hs_info_1',         '情報Ⅰ',       '情Ⅰ', '高校', ARRAY[10,11],    'info',    true,  true, 570),
('hs_info_2',         '情報Ⅱ',       '情Ⅱ', '高校', ARRAY[11,12],    'info',    false, true, 571),
('hs_music_1',        '音楽Ⅰ',       '音Ⅰ', '高校', ARRAY[10,11],    'art',     false, true, 580),
('hs_art_1',          '美術Ⅰ',       '美Ⅰ', '高校', ARRAY[10,11],    'art',     false, true, 581),
('hs_calligraphy_1',  '書道Ⅰ',       '書Ⅰ', '高校', ARRAY[10,11],    'art',     false, true, 582),
('hs_pe',             '体育',         '体',   '高校', ARRAY[10,11,12], 'pe',      true,  true, 590),
('hs_health',         '保健',         '保',   '高校', ARRAY[10,11],    'pe',      true,  true, 591),
('hs_home_basic',     '家庭基礎',     '家基', '高校', ARRAY[10,11,12], 'home',    false, true, 600),
('hs_home_general',   '家庭総合',     '家総', '高校', ARRAY[10,11,12], 'home',    false, true, 601),
('hs_risu_tankyu_b',  '理数探究基礎', '理探基','高校', ARRAY[10,11],   'exploration', false, true, 610),
('hs_risu_tankyu',    '理数探究',     '理探', '高校', ARRAY[11,12],    'exploration', false, true, 611),
('hs_sogo_tankyu',    '総合的な探究の時間', '総探', '高校', ARRAY[10,11,12], 'exploration', true, true, 612)
ON CONFLICT (school_id, code) DO NOTHING;
