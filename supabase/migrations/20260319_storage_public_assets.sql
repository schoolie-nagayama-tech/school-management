-- public-assets バケットを作成（ロゴ画像など公開アセット用）
INSERT INTO storage.buckets (id, name, public)
VALUES ('public-assets', 'public-assets', true)
ON CONFLICT (id) DO NOTHING;

-- 認証済みユーザーはアップロード可能
CREATE POLICY "Authenticated users can upload public assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'public-assets');

-- 認証済みユーザーは更新可能
CREATE POLICY "Authenticated users can update public assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'public-assets');

-- 誰でも閲覧可能（公開バケット）
CREATE POLICY "Public assets are publicly accessible"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'public-assets');

-- 認証済みユーザーは削除可能
CREATE POLICY "Authenticated users can delete public assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'public-assets');
