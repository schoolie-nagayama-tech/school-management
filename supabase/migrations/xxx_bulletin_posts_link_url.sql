-- 連絡掲示板の投稿にリンクURLを追加
ALTER TABLE bulletin_posts ADD COLUMN IF NOT EXISTS link_url TEXT NULL;
