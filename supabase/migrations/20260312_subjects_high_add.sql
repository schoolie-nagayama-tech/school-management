-- 高校生科目の追加（すべて 90分, grade_category = 'high'）
-- WHERE NOT EXISTS により二重挿入を防止

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '国語', 'high', 200, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '国語' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '現代文', 'high', 201, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '現代文' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '古典', 'high', 202, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '古典' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '小論文', 'high', 203, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '小論文' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '数学Ⅰ', 'high', 204, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '数学Ⅰ' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '数学Ⅱ', 'high', 205, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '数学Ⅱ' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '数学Ⅲ', 'high', 206, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '数学Ⅲ' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '数学A', 'high', 207, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '数学A' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '数学B', 'high', 208, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '数学B' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '数学C', 'high', 209, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '数学C' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '英語', 'high', 210, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '英語' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '化学', 'high', 211, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '化学' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '生物', 'high', 212, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '生物' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '物理', 'high', 213, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '物理' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '地学', 'high', 214, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '地学' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '化学基礎', 'high', 215, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '化学基礎' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '生物基礎', 'high', 216, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '生物基礎' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '物理基礎', 'high', 217, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '物理基礎' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '地学基礎', 'high', 218, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '地学基礎' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '政治経済', 'high', 219, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '政治経済' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '日本史', 'high', 220, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '日本史' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '世界史', 'high', 221, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '世界史' AND grade_category = 'high'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '地理', 'high', 222, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '地理' AND grade_category = 'high'
);
