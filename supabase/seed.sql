-- 生徒管理システム - ダミーデータ
-- Supabase SQL Editorで実行してください

-- 既存のデータを削除（外部キー制約の順序に注意）
-- フォーム関連（存在する場合のみ削除）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'form_responses') THEN
    DELETE FROM form_responses;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'form_fields') THEN
    DELETE FROM form_fields;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'forms') THEN
    DELETE FROM forms;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'form_template_fields') THEN
    DELETE FROM form_template_fields;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'form_templates') THEN
    DELETE FROM form_templates;
  END IF;
END $$;

-- 成績関連（最下位から）
DELETE FROM assessment_scores;
DELETE FROM assessments;
-- 申込状況関連
DELETE FROM student_applications;
DELETE FROM application_items;
-- ポータルメニュー
DELETE FROM portal_menu;
-- 生徒関連
DELETE FROM student_subjects;
DELETE FROM student_logs;
DELETE FROM students;
DELETE FROM subjects;
DELETE FROM schools;

-- デフォルト教室の作成
INSERT INTO schools (name, code) VALUES ('デフォルト教室', 'DEFAULT')
ON CONFLICT (code) DO NOTHING;

-- デフォルト科目データの挿入（重複時は無視）
INSERT INTO subjects (name, grade_category, sort_order) VALUES
  -- 小学生（elementary）
  ('算数', 'elementary', 0),
  ('国語', 'elementary', 1),
  ('英語', 'elementary', 2),
  ('理科', 'elementary', 3),
  ('社会', 'elementary', 4),
  ('その他', 'elementary', 5),
  -- 中学生（middle）
  ('数学', 'middle', 0),
  ('英語', 'middle', 1),
  ('国語', 'middle', 2),
  ('理科', 'middle', 3),
  ('社会', 'middle', 4),
  ('その他', 'middle', 5),
  -- 高校生（high）
  ('数学', 'high', 0),
  ('英語', 'high', 1),
  ('国語', 'high', 2),
  ('物理', 'high', 3),
  ('化学', 'high', 4),
  ('生物', 'high', 5),
  ('地学', 'high', 6),
  ('日本史', 'high', 7),
  ('世界史', 'high', 8),
  ('地理', 'high', 9),
  ('政治経済', 'high', 10),
  ('現代文', 'high', 11),
  ('古文', 'high', 12),
  ('漢文', 'high', 13),
  ('その他', 'high', 14);

-- ダミーデータの挿入（デフォルト教室を使用）
INSERT INTO students (
  school_id,
  student_code,
  last_name,
  first_name,
  last_name_kana,
  first_name_kana,
  grade,
  school_name,
  class_name,
  club,
  subject_other,
  status
)
SELECT 
  s.id,
  'S0001',
  '山田',
  '太郎',
  'ヤマダ',
  'タロウ',
  7,
  '第一中学校',
  NULL,
  NULL,
  NULL,
  'active'
FROM schools s WHERE s.code = 'DEFAULT'
UNION ALL
SELECT 
  s.id,
  'S0002',
  '鈴木',
  '花子',
  'スズキ',
  'ハナコ',
  8,
  '第一中学校',
  NULL,
  NULL,
  NULL,
  'active'
FROM schools s WHERE s.code = 'DEFAULT'
UNION ALL
SELECT 
  s.id,
  'S0003',
  '佐藤',
  '一郎',
  'サトウ',
  'イチロウ',
  9,
  '第二中学校',
  NULL,
  NULL,
  NULL,
  'active'
FROM schools s WHERE s.code = 'DEFAULT'
UNION ALL
SELECT 
  s.id,
  'S0004',
  '田中',
  '美咲',
  'タナカ',
  'ミサキ',
  10,
  '県立高校',
  NULL,
  NULL,
  '物理',
  'active'
FROM schools s WHERE s.code = 'DEFAULT'
UNION ALL
SELECT 
  s.id,
  'S0005',
  '高橋',
  '健太',
  'タカハシ',
  'ケンタ',
  6,
  '中央小学校',
  NULL,
  NULL,
  NULL,
  'active'
FROM schools s WHERE s.code = 'DEFAULT'
ON CONFLICT (school_id, student_code) DO NOTHING;

-- 生徒と科目の関連付け（重複時は無視）
-- 山田太郎（中1）: 数学
INSERT INTO student_subjects (student_id, subject_id)
SELECT s.id, sub.id
FROM students s, subjects sub, schools sch
WHERE s.student_code = 'S0001' 
  AND s.school_id = sch.id 
  AND sch.code = 'DEFAULT'
  AND sub.name = '数学' 
  AND sub.grade_category = 'middle'
ON CONFLICT (student_id, subject_id) DO NOTHING;

-- 鈴木花子（中2）: 英語
INSERT INTO student_subjects (student_id, subject_id)
SELECT s.id, sub.id
FROM students s, subjects sub, schools sch
WHERE s.student_code = 'S0002' 
  AND s.school_id = sch.id 
  AND sch.code = 'DEFAULT'
  AND sub.name = '英語' 
  AND sub.grade_category = 'middle'
ON CONFLICT (student_id, subject_id) DO NOTHING;

-- 佐藤一郎（中3）: 数学
INSERT INTO student_subjects (student_id, subject_id)
SELECT s.id, sub.id
FROM students s, subjects sub, schools sch
WHERE s.student_code = 'S0003' 
  AND s.school_id = sch.id 
  AND sch.code = 'DEFAULT'
  AND sub.name = '数学' 
  AND sub.grade_category = 'middle'
ON CONFLICT (student_id, subject_id) DO NOTHING;

-- 田中美咲（高1）: その他（物理）
INSERT INTO student_subjects (student_id, subject_id)
SELECT s.id, sub.id
FROM students s, subjects sub, schools sch
WHERE s.student_code = 'S0004' 
  AND s.school_id = sch.id 
  AND sch.code = 'DEFAULT'
  AND sub.name = 'その他' 
  AND sub.grade_category = 'high'
ON CONFLICT (student_id, subject_id) DO NOTHING;

-- 高橋健太（小6）: 国語
INSERT INTO student_subjects (student_id, subject_id)
SELECT s.id, sub.id
FROM students s, subjects sub, schools sch
WHERE s.student_code = 'S0005' 
  AND s.school_id = sch.id 
  AND sch.code = 'DEFAULT'
  AND sub.name = '国語' 
  AND sub.grade_category = 'elementary'
ON CONFLICT (student_id, subject_id) DO NOTHING;

-- ============================================
-- ポータルメニュー初期データ
-- ============================================

DO $$
DECLARE
  school_id_val UUID;
BEGIN
  -- 学校IDを取得
  SELECT id INTO school_id_val FROM schools WHERE code = 'DEFAULT' LIMIT 1;

  IF school_id_val IS NULL THEN
    RAISE EXCEPTION 'デフォルト教室が見つかりません';
  END IF;

  -- 既存のポータルメニューを削除（再作成のため）
  DELETE FROM portal_menu WHERE school_id = school_id_val;

  -- ポータルメニュー項目を作成
  INSERT INTO portal_menu (school_id, menu_key, title, description, is_visible, sort_order) VALUES
    (school_id_val, 'zoukoma', '増コマ申し込み', '追加授業のお申込みはこちら', true, 1),
    (school_id_val, 'moshi', '模試申し込み', '模擬試験のお申込みはこちら', true, 2),
    (school_id_val, 'mendan', '面談申し込み', '面談のご予約はこちら', true, 3),
    (school_id_val, 'mogi', 'Vもぎ申し込み', 'Vもぎのお申込みはこちら', true, 4),
    (school_id_val, 'shukaisu', '週回数変更', '週の授業回数変更のお申込み', true, 5),
    (school_id_val, 'youbi', '曜日変更申し込み', '通塾曜日変更のお申込み', true, 6),
    (school_id_val, 'kyozai', '教材販売', '教材のご購入はこちら', true, 7),
    (school_id_val, 'soudan', 'お客様相談', 'ご相談・ご要望はこちら', true, 8);

END $$;
