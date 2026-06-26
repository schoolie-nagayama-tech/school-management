-- ============================================================
-- 講習提案書: 公開中の進行表転記を「現在の単元＋結合状態」で再導出（2026-06-26 本番適用済み）
-- ============================================================
-- 背景:
--   取り残しクリア(zzz_20260626_koushu_progress_stale_cleanup.sql)後も、公開後に結合(group)を
--   編集して再公開していない提案書では、進行表の application_count / proposal_count や
--   結合番号(group_number / applied_group_number)が旧状態のまま残り、特に「複数単元を1コマ」で
--   結合した行が先頭=合計・他=0 に畳まれず申込コマが過大になっていた。
--
-- 是正:
--   status='approved' の提案書について、その student_textbook の student_progress を
--   現在の単元構成・結合状態から再導出して上書きする。ロジックはアプリの
--   syncProposalToProgress / syncApplicationToProgress と同一:
--     - 提案結合(group_id) ≥2単元 → 先頭(sort_order最小)に koma_count、他は0、group_number=group_id
--     - 申込結合(applied_group_id, applied_koma>0) ≥2単元 → 先頭に applied_koma、他は0、applied_group_number
--     - 非結合 → そのまま koma_count / applied_koma(未入力は koma_count)、番号は NULL
--   併せて seasonal_proposals.applied_koma を進行表合計に揃えた(キャッシュ是正)。
--
-- 実績(本番 school-db-tokyo):
--   - student_progress 126行を再導出(影響10テキスト)。検証で再導出残差0・結合ヘッド重複0。
--   - seasonal_proposals.applied_koma 9件(うちNULL7件)を進行表合計に是正。
--   - 旧値は public._koushu_progress_backup_20260626 / _seasonal_proposal_applied_koma_backup_20260626 に退避済み。
--
-- 再発防止: コード(publishProposal の転記)が現単元外をクリアするよう修正済みのため、
--   以後の公開・再公開で結合状態は常に正しく転記される。
-- 注記: 下記SQLは本番に適用済み。アプリ実装(syncProposalToProgress/syncApplicationToProgress)が
--   正典であり、運用上は対象提案書を再公開すれば同じ結果になる。冪等(差分のみ更新)。
-- ============================================================

WITH u AS (
  SELECT spu.proposal_id, spu.curriculum_item_id, spu.koma_count, spu.applied_koma,
         spu.group_id, spu.applied_group_id, spu.sort_order, sp.student_textbook_id,
         count(*) OVER (PARTITION BY spu.proposal_id, spu.group_id) AS g_cnt,
         count(*) FILTER (WHERE COALESCE(spu.applied_koma,0) > 0)
           OVER (PARTITION BY spu.proposal_id, spu.applied_group_id) AS ag_pos_cnt
  FROM seasonal_proposal_units spu
  JOIN seasonal_proposals sp ON sp.id = spu.proposal_id
  WHERE sp.status = 'approved' AND sp.student_textbook_id IS NOT NULL
),
heads_p AS (
  SELECT proposal_id, group_id, min(sort_order) AS hs
  FROM seasonal_proposal_units WHERE group_id > 0 GROUP BY proposal_id, group_id
),
heads_a AS (
  SELECT proposal_id, applied_group_id, min(sort_order) AS hs
  FROM seasonal_proposal_units WHERE applied_group_id > 0 AND COALESCE(applied_koma,0) > 0
  GROUP BY proposal_id, applied_group_id
),
calc AS (
  SELECT u.student_textbook_id AS stb, u.curriculum_item_id AS cid,
    CASE WHEN u.group_id > 0 AND u.g_cnt >= 2
         THEN (CASE WHEN u.sort_order = hp.hs THEN COALESCE(hpu.koma_count,0) ELSE 0 END)
         ELSE u.koma_count END AS exp_prop_count,
    CASE WHEN u.group_id > 0 AND u.g_cnt >= 2 THEN u.group_id ELSE NULL END AS exp_group,
    CASE WHEN u.applied_group_id > 0 AND COALESCE(u.applied_koma,0) > 0 AND u.ag_pos_cnt >= 2
         THEN (CASE WHEN u.sort_order = ha.hs THEN COALESCE(hau.applied_koma,0) ELSE 0 END)
         ELSE COALESCE(u.applied_koma, u.koma_count) END AS exp_app_count,
    CASE WHEN u.applied_group_id > 0 AND COALESCE(u.applied_koma,0) > 0 AND u.ag_pos_cnt >= 2
         THEN u.applied_group_id ELSE NULL END AS exp_app_group
  FROM u
  LEFT JOIN heads_p hp ON hp.proposal_id = u.proposal_id AND hp.group_id = u.group_id
  LEFT JOIN seasonal_proposal_units hpu ON hpu.proposal_id = u.proposal_id AND hpu.group_id = u.group_id AND hpu.sort_order = hp.hs
  LEFT JOIN heads_a ha ON ha.proposal_id = u.proposal_id AND ha.applied_group_id = u.applied_group_id
  LEFT JOIN seasonal_proposal_units hau ON hau.proposal_id = u.proposal_id AND hau.applied_group_id = u.applied_group_id AND hau.sort_order = ha.hs
)
UPDATE student_progress sp
SET application_count = c.exp_app_count,
    applied_group_number = c.exp_app_group,
    proposal_count = c.exp_prop_count,
    group_number = c.exp_group
FROM calc c
WHERE sp.student_textbook_id = c.stb
  AND sp.curriculum_item_id = c.cid
  AND (COALESCE(sp.application_count,0) <> c.exp_app_count
       OR COALESCE(sp.applied_group_number,-1) <> COALESCE(c.exp_app_group,-1)
       OR COALESCE(sp.proposal_count,0) <> c.exp_prop_count
       OR COALESCE(sp.group_number,-1) <> COALESCE(c.exp_group,-1));

-- seasonal_proposals.applied_koma のキャッシュ是正（進行表合計に一致させる）
WITH prog AS (
  SELECT student_textbook_id AS stb_id, COALESCE(sum(application_count),0) AS prog_applied
  FROM student_progress GROUP BY student_textbook_id
)
UPDATE seasonal_proposals sp
SET applied_koma = p.prog_applied
FROM prog p
WHERE p.stb_id = sp.student_textbook_id
  AND sp.status = 'approved' AND sp.student_textbook_id IS NOT NULL
  AND COALESCE(sp.applied_koma,-999) <> COALESCE(p.prog_applied,0);
