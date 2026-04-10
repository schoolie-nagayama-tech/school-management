-- 小学生科目の追加
-- 「算数４５分」等は name='算数', duration_minutes=45 として保存
-- WHERE NOT EXISTS により二重挿入を防止

-- 45分科目（主に小4以下用）
INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '算数', 'elementary', 100, 45
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '算数' AND grade_category = 'elementary' AND duration_minutes = 45
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '国語', 'elementary', 101, 45
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '国語' AND grade_category = 'elementary' AND duration_minutes = 45
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '英語', 'elementary', 102, 45
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '英語' AND grade_category = 'elementary' AND duration_minutes = 45
);

-- 90分複合科目・その他（既存の場合はスキップ）
INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '算/国', 'elementary', 103, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '算/国' AND grade_category = 'elementary'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT 'その他', 'elementary', 104, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = 'その他' AND grade_category = 'elementary'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '自習', 'elementary', 105, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '自習' AND grade_category = 'elementary'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '算/理', 'elementary', 106, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '算/理' AND grade_category = 'elementary'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '国/社', 'elementary', 107, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '国/社' AND grade_category = 'elementary'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '理/社', 'elementary', 108, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '理/社' AND grade_category = 'elementary'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '英/算', 'elementary', 109, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '英/算' AND grade_category = 'elementary'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '英/国', 'elementary', 110, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '英/国' AND grade_category = 'elementary'
);

INSERT INTO subjects (name, grade_category, sort_order, duration_minutes)
SELECT '国/理', 'elementary', 111, 90
WHERE NOT EXISTS (
  SELECT 1 FROM subjects WHERE name = '国/理' AND grade_category = 'elementary'
);
