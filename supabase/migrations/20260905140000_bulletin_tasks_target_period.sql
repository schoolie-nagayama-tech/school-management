-- ============================================================
-- 連絡掲示板AIアシスト: 依頼が「どの回」を指すかを人が選ぶ
-- ============================================================
-- 正典: docs/bulletin-ai-assist.html
--
-- ★AIに推測させない。「テスト結果を入力して」という投稿からは、
--   1学期中間なのか2学期期末なのかが決まらない（本番の定期テストは9種の name_code を持つ）。
--   推測して外すと、入っていない回を見て「全員済」と出す——最も危ない方向に誤る。
--   なので、判定を始める前に教室長が1回だけ選ぶ。選ぶまでは数えない。
--
-- ★内申も同じ問題を抱えていた。判定が name_code='term1' 決め打ちで、
--   2学期の依頼でも1学期のデータを見ていた。1学期が埋まっているので「全員済」に見える。
--   既存の行は term1 として扱い（現時点の実データと一致する）、以後は選べるようにする。
--
-- 値は assessments.name_code と同じ（term1 / term2 / year_end / term1_mid …）。
-- ============================================================

ALTER TABLE public.bulletin_tasks
  ADD COLUMN IF NOT EXISTS target_period text;

COMMENT ON COLUMN public.bulletin_tasks.target_period IS
  '依頼が指す回（assessments.name_code）。内申なら term1 等、定期テストなら term1_mid 等。'
  'NULL=未選択。★AIに推測させず教室長が選ぶ。定期テストは選ぶまで判定しない';

-- 既存の内申タスクは term1 として扱う（判定の決め打ちがそうなっていた。実データとも一致）
UPDATE public.bulletin_tasks
   SET target_period = 'term1'
 WHERE kind = 'report_card_entry' AND target_period IS NULL;
