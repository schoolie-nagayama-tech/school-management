-- デフォルト教室（is_demo=true）の試験名を、まだ試験名が未登録の各教室にコピー
INSERT INTO exam_types (school_id, name, sort_order)
SELECT s.id, et.name, et.sort_order
FROM schools s
CROSS JOIN exam_types et
WHERE et.school_id = (SELECT id FROM schools WHERE is_demo = true LIMIT 1)
  AND s.is_demo = false
  AND NOT EXISTS (
    SELECT 1 FROM exam_types ex WHERE ex.school_id = s.id
  )
ORDER BY s.id, et.sort_order;
