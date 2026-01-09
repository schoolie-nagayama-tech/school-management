-- 生徒管理システム - ダミーデータ
-- Supabase SQL Editorで実行してください

-- 既存のデータを削除
DELETE FROM student_subjects;
DELETE FROM students;
DELETE FROM subjects;

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

-- ダミーデータの挿入
INSERT INTO students (
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
) VALUES
  (
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
  ),
  (
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
  ),
  (
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
  ),
  (
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
  ),
  (
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
  )
ON CONFLICT (student_code) DO NOTHING;

-- 生徒と科目の関連付け（重複時は無視）
-- 山田太郎（中1）: 数学
INSERT INTO student_subjects (student_id, subject_id)
SELECT s.id, sub.id
FROM students s, subjects sub
WHERE s.student_code = 'S0001' AND sub.name = '数学' AND sub.grade_category = 'middle'
ON CONFLICT (student_id, subject_id) DO NOTHING;

-- 鈴木花子（中2）: 英語
INSERT INTO student_subjects (student_id, subject_id)
SELECT s.id, sub.id
FROM students s, subjects sub
WHERE s.student_code = 'S0002' AND sub.name = '英語' AND sub.grade_category = 'middle'
ON CONFLICT (student_id, subject_id) DO NOTHING;

-- 佐藤一郎（中3）: 数学
INSERT INTO student_subjects (student_id, subject_id)
SELECT s.id, sub.id
FROM students s, subjects sub
WHERE s.student_code = 'S0003' AND sub.name = '数学' AND sub.grade_category = 'middle'
ON CONFLICT (student_id, subject_id) DO NOTHING;

-- 田中美咲（高1）: その他（物理）
INSERT INTO student_subjects (student_id, subject_id)
SELECT s.id, sub.id
FROM students s, subjects sub
WHERE s.student_code = 'S0004' AND sub.name = 'その他' AND sub.grade_category = 'high'
ON CONFLICT (student_id, subject_id) DO NOTHING;

-- 高橋健太（小6）: 国語
INSERT INTO student_subjects (student_id, subject_id)
SELECT s.id, sub.id
FROM students s, subjects sub
WHERE s.student_code = 'S0005' AND sub.name = '国語' AND sub.grade_category = 'elementary'
ON CONFLICT (student_id, subject_id) DO NOTHING;
