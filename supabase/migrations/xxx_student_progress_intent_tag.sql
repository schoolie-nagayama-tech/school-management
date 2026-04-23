-- student_progress.intent_tag: 意図タグ（面談プレゼン用・自動文章生成元）
-- 値は 6 種のプリセット: 苦手補強 / 既習の定着 / 未習の先取り / 学校進度に合わせる / 直前演習 / 応用発展
ALTER TABLE student_progress ADD COLUMN IF NOT EXISTS intent_tag TEXT;
COMMENT ON COLUMN student_progress.intent_tag IS '意図タグ: 苦手補強 / 既習の定着 / 未習の先取り / 学校進度に合わせる / 直前演習 / 応用発展';
