-- ============================================================
-- HP問合せCSVのブックマークレット取込トークン
--
-- 本部HP(tactgroup.net)の問合せCSVを、ログイン中のブラウザから
-- ブックマークレット1クリックで NEST に流し込むための個人トークン。
--
-- ブックマークレットは tactgroup.net 上で download.php を fetch して CSV を取得し、
-- NEST の公開エンドポイント /api/inquiry-import/push?token=... に POST する。
-- そのトークンを検証するためのテーブル。
--
-- セキュリティ:
--   - bearer シークレットなので RLS はポリシー無し（= authenticated からは読めない）。
--     発行・一覧・失効はすべて requireAdmin の API ルートが service role で行う。
--     push エンドポイントも service role でトークン照合する。
--   - anon ポリシーは作らない。
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.inquiry_import_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token        text NOT NULL UNIQUE,
  label        text,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked      boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- RLS 有効・ポリシー無し（authenticated からは一切アクセス不可。service role のみ）。
ALTER TABLE public.inquiry_import_tokens ENABLE ROW LEVEL SECURITY;

COMMIT;
