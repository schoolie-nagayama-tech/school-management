-- =============================================
-- 監査ログテーブル（ユーザー管理API操作の追跡）
-- =============================================

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,            -- 操作者のuser_id
  actor_role TEXT NOT NULL,          -- 操作時のロール
  action TEXT NOT NULL,              -- 'user.create', 'user.update', 'user.delete'
  target_type TEXT NOT NULL,         -- 'user_profile'
  target_id TEXT,                    -- 操作対象のID
  detail JSONB DEFAULT '{}',        -- 変更内容（変更前後の差分など）
  ip_address TEXT,                   -- リクエスト元IP（取得可能な場合）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_logs_actor ON admin_audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_admin_audit_logs_target ON admin_audit_logs(target_id, created_at DESC);
CREATE INDEX idx_admin_audit_logs_action ON admin_audit_logs(action, created_at DESC);

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- authenticated のみ INSERT 可能（SELECT も authenticated で閲覧可能）
CREATE POLICY "admin_audit_logs_auth_insert" ON admin_audit_logs
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin_audit_logs_auth_select" ON admin_audit_logs
  FOR SELECT TO authenticated USING (true);
