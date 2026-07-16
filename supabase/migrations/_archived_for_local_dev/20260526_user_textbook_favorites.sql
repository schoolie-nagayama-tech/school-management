-- ユーザーごとのテキストお気に入り（講習提案書のテキスト選択画面で上位表示するための印）
-- 教室全体ではなくユーザー個人に紐付ける：先生によって担当教科・よく使う教材が違うため。
CREATE TABLE IF NOT EXISTS user_textbook_favorites (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  textbook_id integer     NOT NULL REFERENCES textbooks(id)  ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, textbook_id)
);

CREATE INDEX IF NOT EXISTS user_textbook_favorites_user_id_idx
  ON user_textbook_favorites (user_id);

ALTER TABLE user_textbook_favorites ENABLE ROW LEVEL SECURITY;

-- 自分のお気に入りのみ参照・追加・削除可能。
-- 他人のお気に入りを覗いたり書き換えたりする必要はないので user_id = auth.uid() 限定で十分。
CREATE POLICY "user_textbook_favorites_self" ON user_textbook_favorites
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE user_textbook_favorites IS
  'ユーザーごとのテキストお気に入り。テキスト選択画面で上位表示する用。';
