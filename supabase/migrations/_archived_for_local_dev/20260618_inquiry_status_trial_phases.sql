-- ============================================================
-- 問合せステータスに体験フェーズを追加
--
-- 既存: in_progress / enrolled / unreachable / lost / trial_lost
-- 追加: trial_waiting(体験待ち) / trial_done(体験済み)
--
-- ステータスを「追客の段階」として使えるようにする。
-- 対応中 → 体験待ち → 体験済み → 入会 の funnel を表現でき、
-- コンタクト履歴(=行動ログ)との役割分担を明確にする。
-- ============================================================

BEGIN;

ALTER TABLE public.inquiries DROP CONSTRAINT IF EXISTS inquiries_status_check;
ALTER TABLE public.inquiries ADD CONSTRAINT inquiries_status_check
  CHECK (status IN ('in_progress','trial_waiting','trial_done','enrolled','unreachable','lost','trial_lost'));

COMMIT;
