-- 進行表（student_progress）に「申込結合グループ」列を追加し、既存の公開済み提案書をバックフィルする。
--
-- 背景:
--   提案書には2系統の結合がある。
--     - 提案結合 (seasonal_proposal_units.group_id)         … 提案コマをまとめて1コマ扱い
--     - 申込結合 (seasonal_proposal_units.applied_group_id) … 申込コマをまとめて1コマ扱い
--   これまで提案書を公開しても進行表へは結合情報がまったく転記されておらず、結合した単元が
--   バラバラの独立行（特に申込0の行）として表示され、結合が反映されていなかった。
--
-- 方針:
--   進行表は「グループの先頭行に合計・他の行は0」を表示する作り（旧UIはセル結合、新UIは先頭行のみ表示）。
--   提案結合は既存の group_number に、申込結合はこの applied_group_number に持たせ、列ごとに独立して
--   先頭行へ合計を集約する（提案結合と申込結合は別グループになりうるため、1列では表現できない）。

ALTER TABLE student_progress
  ADD COLUMN IF NOT EXISTS applied_group_number INT;

COMMENT ON COLUMN student_progress.applied_group_number IS
  '申込結合グループ番号（提案書 applied_group_id 由来）。同番号の単元は先頭行に申込合計をまとめ、他は0。';

-- ===== 既存の公開済み提案書をバックフィル =====
-- student_textbook_id ごとに最新の approved 提案書を採用し、その単元の結合情報を進行表へ反映する。
-- 先頭行（グループ内で sort_order 最小）に合計を集約し、他の行は 0 にする。
WITH latest_proposal AS (
  -- 同一テキストに複数提案書がぶら下がる場合は最新（updated_at 降順）を正とする
  SELECT DISTINCT ON (p.student_textbook_id)
    p.id AS proposal_id, p.student_textbook_id
  FROM seasonal_proposals p
  WHERE p.status = 'approved' AND p.student_textbook_id IS NOT NULL
  ORDER BY p.student_textbook_id, p.updated_at DESC, p.id
),
units AS (
  SELECT
    lp.student_textbook_id,
    u.curriculum_item_id,
    u.koma_count,
    u.applied_koma,
    u.group_id,
    u.applied_group_id,
    u.sort_order
  FROM latest_proposal lp
  JOIN seasonal_proposal_units u ON u.proposal_id = lp.proposal_id
),
-- 提案結合: group_id ごとの先頭(sort_order最小)と合計(先頭のkoma_count)。2件以上を結合扱い。
prop_groups AS (
  SELECT student_textbook_id, group_id,
         (array_agg(curriculum_item_id ORDER BY sort_order))[1] AS head_item,
         (array_agg(koma_count        ORDER BY sort_order))[1] AS head_koma,
         count(*) AS n
  FROM units
  WHERE group_id > 0
  GROUP BY student_textbook_id, group_id
  HAVING count(*) >= 2
),
-- 申込結合: applied_koma>0 の単元のみ applied_group_id ごとに集計。2件以上を結合扱い。
applied_units AS (
  SELECT * FROM units WHERE applied_group_id > 0 AND COALESCE(applied_koma, 0) > 0
),
applied_groups AS (
  SELECT student_textbook_id, applied_group_id,
         (array_agg(curriculum_item_id ORDER BY sort_order))[1] AS head_item,
         (array_agg(applied_koma       ORDER BY sort_order))[1] AS head_applied,
         count(*) AS n
  FROM applied_units
  GROUP BY student_textbook_id, applied_group_id
  HAVING count(*) >= 2
),
resolved AS (
  SELECT
    u.student_textbook_id,
    u.curriculum_item_id,
    -- 提案結合
    CASE WHEN pg.group_id IS NOT NULL THEN u.group_id ELSE NULL END AS group_number,
    CASE
      WHEN pg.group_id IS NULL THEN NULL                                   -- 非結合: proposal_count は触らない
      WHEN pg.head_item = u.curriculum_item_id THEN pg.head_koma           -- 先頭: 合計
      ELSE 0                                                               -- 他: 0
    END AS new_proposal_count,
    -- 申込結合
    CASE WHEN ag.applied_group_id IS NOT NULL THEN u.applied_group_id ELSE NULL END AS applied_group_number,
    CASE
      WHEN ag.applied_group_id IS NULL THEN NULL                          -- 非結合: application_count は触らない
      WHEN ag.head_item = u.curriculum_item_id THEN ag.head_applied        -- 先頭: 合計
      ELSE 0                                                               -- 他: 0
    END AS new_application_count
  FROM units u
  LEFT JOIN prop_groups    pg ON pg.student_textbook_id = u.student_textbook_id AND pg.group_id        = u.group_id
  LEFT JOIN applied_groups ag ON ag.student_textbook_id = u.student_textbook_id AND ag.applied_group_id = u.applied_group_id
)
UPDATE student_progress sp
SET
  group_number         = r.group_number,
  applied_group_number = r.applied_group_number,
  proposal_count       = COALESCE(r.new_proposal_count, sp.proposal_count),
  application_count     = COALESCE(r.new_application_count, sp.application_count),
  updated_at           = now()
FROM resolved r
WHERE sp.student_textbook_id = r.student_textbook_id
  AND sp.curriculum_item_id  = r.curriculum_item_id;
