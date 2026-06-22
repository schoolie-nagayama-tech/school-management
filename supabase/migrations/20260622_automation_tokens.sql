-- ============================================================
-- 外部システム自動入力（ブックマークレット・ローダー方式）トークン
--
-- NEST内で「流し込む」を押すと、そのユーザーの保留ジョブ(pending_payload)に
-- actions(各フィールドのname/value, checkすべきname 等)を保存する。
-- 対象サイト(日本教材出版/スクールIE等)上でローダー・ブックマークレットが
-- /api/automation/pull?token=... を fetch して actions を取得し、フォームを充填する。
--
-- inquiry_import_tokens と同じ「bearerトークン＋service role」方式。クリップボードを使わず
-- クロスオリジンでデータを受け渡すための保留ジョブをトークン行に持たせる。
--
-- セキュリティ:
--   - bearer シークレットなので RLS はポリシー無し（authenticated からは読めない）。
--     発行・失効・キュー投入・取得はすべて service role の API ルートが行う。
--   - anon ポリシーは作らない。
--   - 取り扱うのは発行者本人の自塾データのみ。漏洩時は DELETE /api/automation/token で一括失効。
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.automation_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token           text NOT NULL UNIQUE,
  label           text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked         boolean NOT NULL DEFAULT false,
  -- 保留中の流し込みジョブ。queue で上書き、pull で読み取り後にクリアする。
  pending_payload jsonb,
  pending_at      timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- RLS 有効・ポリシー無し（authenticated からは一切アクセス不可。service role のみ）。
ALTER TABLE public.automation_tokens ENABLE ROW LEVEL SECURITY;

COMMIT;
