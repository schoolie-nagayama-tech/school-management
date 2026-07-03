-- 試験目標に結果点数を追加（「次の目標へ」フローで前回の振り返りとして記録）
ALTER TABLE student_textbook_exams ADD COLUMN result_score integer;
COMMENT ON COLUMN student_textbook_exams.result_score IS '試験終了後に記録する実際の点数（次の目標設定時の振り返り入力）';
