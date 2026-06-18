-- ============================================================
-- 問合せコンタクト履歴の method を「追客タイムライン」として拡張
--
-- 既存: 'tel'|'email'|'sms'|'visit'|'other'
-- 追加: 'material_sent'(資料発送)、'status_change'(ステータス変更)
--
-- 用途: ステータス変更や資料発送が自動的にコンタクト履歴へ積まれ、
-- 1つのタイムラインで追客状況が時系列で見えるようにする。
-- ============================================================

BEGIN;

ALTER TABLE public.inquiry_contacts DROP CONSTRAINT IF EXISTS inquiry_contacts_method_check;
ALTER TABLE public.inquiry_contacts ADD CONSTRAINT inquiry_contacts_method_check
  CHECK (method IN ('tel','email','sms','visit','other','material_sent','status_change'));

COMMIT;
