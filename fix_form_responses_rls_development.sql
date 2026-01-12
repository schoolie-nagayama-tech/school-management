-- form_responsesテーブルのRLSポリシーを修正（開発環境用）
-- このSQLをSupabaseのSQL Editorで実行してください

-- 既存のポリシーを全て削除
DROP POLICY IF EXISTS "form_responses_allow_insert_anon" ON form_responses;
DROP POLICY IF EXISTS "form_responses_allow_all_anon" ON form_responses;
DROP POLICY IF EXISTS "form_responses_allow_all_auth" ON form_responses;

-- 開発環境用：匿名ユーザーが全操作可能（INSERT, SELECT, UPDATE, DELETE）
CREATE POLICY "form_responses_allow_all_anon" ON form_responses
  FOR ALL TO anon 
  USING (true) 
  WITH CHECK (true);

-- 認証ユーザーは全件アクセス可能
CREATE POLICY "form_responses_allow_all_auth" ON form_responses
  FOR ALL TO authenticated 
  USING (true) 
  WITH CHECK (true);

-- ポリシーが正しく設定されているか確認（実行して確認してください）
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies 
-- WHERE tablename = 'form_responses';
