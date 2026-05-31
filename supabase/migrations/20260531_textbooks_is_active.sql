-- 教材（textbooks）の無効化（非表示）フラグ。
-- false にすると各種教材ピッカー／一覧から隠れるが、教材マスタ画面には表示され、
-- 既存データ（提案書・進行表・講習などの textbook_id 参照）はそのまま残る。
-- データ削除ではなく「非表示」を実現するためのフラグ。
ALTER TABLE public.textbooks
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
