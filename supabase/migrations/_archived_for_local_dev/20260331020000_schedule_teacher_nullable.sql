-- マトリクスUIから教師未指定でパターン作成可能にする
ALTER TABLE schedule_regular_patterns
  ALTER COLUMN teacher_id DROP NOT NULL;
