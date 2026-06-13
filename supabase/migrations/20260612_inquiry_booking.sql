-- ============================================================
-- 体験・面談 セルフ予約（Phase 1: 面談予約）
--
-- 正典: docs/inquiry-booking-requirements.md
--
-- - inquiry_booking_tokens: 問合せに紐づく公開予約リンク（トークン認可）
-- - inquiry_school_settings.booking_config: 教室別の予約設定（受付曜日・時間帯・
--   カレンダーアカウント等）を jsonb で集約
-- - inquiries.interview_event_id / trial_event_id: 作成した Google カレンダー
--   イベントID（変更・取消用）。trial_event_id は Phase 2 で使用
--
-- セキュリティ: 予約は未登録者の PII 操作。anon ポリシーは作らない。公開予約は
-- API ルートが service role でトークン検証して実施する。
-- ============================================================

BEGIN;

-- ── 予約トークン ──
CREATE TABLE IF NOT EXISTS public.inquiry_booking_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text NOT NULL UNIQUE,
  inquiry_id  uuid NOT NULL REFERENCES public.inquiries(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  purpose     text NOT NULL DEFAULT 'interview' CHECK (purpose IN ('interview','trial')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiry_booking_tokens_inquiry
  ON public.inquiry_booking_tokens (inquiry_id);

-- ── 予約設定（教室別） ──
ALTER TABLE public.inquiry_school_settings
  ADD COLUMN IF NOT EXISTS booking_config jsonb;

-- ── 作成したカレンダーイベントID ──
ALTER TABLE public.inquiries
  ADD COLUMN IF NOT EXISTS interview_event_id text,
  ADD COLUMN IF NOT EXISTS trial_event_id text;

-- ── RLS ──
ALTER TABLE public.inquiry_booking_tokens ENABLE ROW LEVEL SECURITY;

-- 管理側（admin/owner/manager）のみ。公開予約は service role の API 経由でトークン検証。
DROP POLICY IF EXISTS "inquiry_booking_tokens_school_scope_auth" ON public.inquiry_booking_tokens;
CREATE POLICY "inquiry_booking_tokens_school_scope_auth"
  ON public.inquiry_booking_tokens FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

COMMIT;
