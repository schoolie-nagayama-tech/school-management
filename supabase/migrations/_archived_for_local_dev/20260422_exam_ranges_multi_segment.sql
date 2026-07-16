-- 試験範囲（student_textbook_exam_ranges）を複数区間対応にする
-- 「単元が飛ぶ」試験範囲（例: 1-3 と 8-10 を同じ試験に設定）をサポートするため、
-- (student_textbook_id, exam_type_id) の UNIQUE 制約を削除する。
ALTER TABLE student_textbook_exam_ranges
  DROP CONSTRAINT IF EXISTS student_textbook_exam_ranges_student_textbook_id_exam_type__key;
