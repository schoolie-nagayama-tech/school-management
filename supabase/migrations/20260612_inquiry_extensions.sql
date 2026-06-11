-- ============================================================
-- 問合せ管理 拡張機能（第6章提案分）
--
-- 1. メール開封・クリック計測:
--    inquiry_mail_logs に Resend のメールID と開封/クリック時刻を追加。
--    Resend Webhook (email.opened / email.clicked) を
--    /api/webhooks/resend で受信し、resend_email_id で突合して記録する。
--
-- 2. 失注理由:
--    没/体験没にしたときの理由を inquiries.lost_reason に記録し、
--    分析ページで失注理由の内訳を見られるようにする。
-- ============================================================

BEGIN;

-- ── メール開封・クリック計測 ──
ALTER TABLE public.inquiry_mail_logs
  ADD COLUMN IF NOT EXISTS resend_email_id text,
  ADD COLUMN IF NOT EXISTS opened_at  timestamptz,
  ADD COLUMN IF NOT EXISTS clicked_at timestamptz;

-- Webhook からの突合用（resend_email_id で1件引く）
CREATE INDEX IF NOT EXISTS idx_inquiry_mail_logs_resend_id
  ON public.inquiry_mail_logs (resend_email_id)
  WHERE resend_email_id IS NOT NULL;

-- ── 失注理由 ──
-- 値はアプリ側の選択式（料金/他塾に決定/時期が合わない/連絡不通のまま/その他）+自由記述を想定し text で持つ
ALTER TABLE public.inquiries
  ADD COLUMN IF NOT EXISTS lost_reason text;

COMMIT;
