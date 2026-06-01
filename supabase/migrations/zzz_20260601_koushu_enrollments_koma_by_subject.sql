-- 講習申込を科目別コマ数で管理する。
-- koma_by_subject: { subject_id(text): コマ数 }。koma_count は合計(=値の総和)、subject_ids はキー集合（後方互換のため維持）。
ALTER TABLE koushu_enrollments
  ADD COLUMN IF NOT EXISTS koma_by_subject jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 既存の「単一科目」行はバックフィル（科目が1つなら全コマ数をその科目に割当）。
UPDATE koushu_enrollments
SET koma_by_subject = jsonb_build_object((subject_ids[1])::text, koma_count)
WHERE array_length(subject_ids, 1) = 1
  AND koma_count > 0
  AND koma_by_subject = '{}'::jsonb;
