-- 発注を請求管理に載せるかどうかを、発注レコード自体に持たせる。
--
-- ★ 画面のチェックボックスだけでは足りない理由:
--   請求への反映（createOrderWithBilling）は「その生徒の請求期間内の全発注から教材名を
--   集め直して請求セルを上書きする」作りになっている。1件目の発注を画面上でスキップしても、
--   あとから同じ生徒に2件目を発注した時点で、集計が1件目を拾って請求に戻してしまう。
--   除外は発注レコードに残し、集計クエリ側でも除外する必要がある。
--
-- 既定は false（＝請求に載る）。既存の発注はこれまでどおり請求に載り続ける。
-- true にするのは、入会時の初回教材のように本部で別途請求するものだけ。

ALTER TABLE public.material_orders
  ADD COLUMN IF NOT EXISTS exclude_from_billing boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.material_orders.exclude_from_billing IS
  '請求管理に載せない発注（入会時の初回教材など、本部で別途請求するもの）。既定 false＝載る。';
