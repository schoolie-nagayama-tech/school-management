-- プッシュ通知サブスクリプションテーブル
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id   uuid        NOT NULL REFERENCES schools(id)    ON DELETE CASCADE,
  endpoint    text        NOT NULL,
  p256dh      text        NOT NULL,
  auth        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- ユーザーは自分のサブスクリプションのみ操作可能
CREATE POLICY "push_subscriptions_self" ON push_subscriptions
  FOR ALL USING (auth.uid() = user_id);

-- サービスロールは全件参照可能（送信時に使用）
CREATE POLICY "push_subscriptions_service_read" ON push_subscriptions
  FOR SELECT USING (true);
