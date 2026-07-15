-- 全教室に「単語練習帳」教材を自動登録（未登録の教室のみ）
INSERT INTO materials (school_id, name, description, category, unit, stock_quantity, low_stock_threshold, is_active)
SELECT s.id, '単語練習帳', '弊社オリジナル単語練習ノート', '教材', '冊', 0, 5, true
FROM schools s
WHERE NOT EXISTS (
  SELECT 1 FROM materials m WHERE m.school_id = s.id AND m.name = '単語練習帳'
);
