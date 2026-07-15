-- 単語練習帳をテキストマスタに追加（検索で表示されるようにする）
INSERT INTO textbooks (name, publisher, school_type, grade, subject, grade_category)
SELECT '単語練習帳', 'オリジナル', NULL, NULL, '英語', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM textbooks WHERE name = '単語練習帳'
);
