-- form_responsesテーブルのRLSポリシーを修正
-- 開発環境用：匿名ユーザーがINSERTできるようにする

-- 既存のポリシーを確認して削除
DROP POLICY IF EXISTS "form_responses_allow_insert_anon" ON form_responses;
DROP POLICY IF EXISTS "form_responses_allow_all_anon" ON form_responses;

-- 匿名ユーザーはINSERTのみ可能（フォーム送信用）
-- WITH CHECK句を明示的に指定
CREATE POLICY "form_responses_allow_insert_anon" ON form_responses
  FOR INSERT TO anon 
  WITH CHECK (true);

-- 開発環境では、匿名ユーザーが全操作可能にする場合（より確実な方法）
-- コメントアウトを外して使用してください
-- DROP POLICY IF EXISTS "form_responses_allow_all_anon" ON form_responses;
-- CREATE POLICY "form_responses_allow_all_anon" ON form_responses
--   FOR ALL TO anon USING (true) WITH CHECK (true);

-- ポリシーが正しく設定されているか確認
-- SELECT * FROM pg_policies WHERE tablename = 'form_responses';
