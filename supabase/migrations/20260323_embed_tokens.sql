-- 埋め込みウィジェット用トークンテーブル
CREATE TABLE IF NOT EXISTS embed_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  label text NOT NULL DEFAULT '申込状況ウィジェット',
  embed_type text NOT NULL DEFAULT 'applications', -- 将来拡張用
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_embed_tokens_token ON embed_tokens(token);
CREATE INDEX IF NOT EXISTS idx_embed_tokens_school ON embed_tokens(school_id);

-- RLS
ALTER TABLE embed_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "embed_tokens_select" ON embed_tokens
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "embed_tokens_insert" ON embed_tokens
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "embed_tokens_update" ON embed_tokens
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "embed_tokens_delete" ON embed_tokens
  FOR DELETE TO authenticated USING (true);

-- updated_at トリガー
CREATE TRIGGER update_embed_tokens_updated_at
  BEFORE UPDATE ON embed_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
