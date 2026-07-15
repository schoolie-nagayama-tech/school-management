-- ============================================================
-- 既読ゲート（UnreadBulletinGate）導入のための既読バックフィル
--
-- 背景:
--   未読の連絡がある講師に対して、全画面で掲示板を表示し既読を強制する
--   ゲートを導入する。ゲートの「未読」は bulletin_reads に自分のレコードが
--   無い投稿を指す。導入前に投稿された過去分をそのまま未読扱いにすると、
--   初回ログイン時に過去の全連絡がブロック表示され業務が止まってしまう。
--
--   そこで本マイグレーション適用時点で存在する「アーカイブされていない投稿」×
--   「全講師」の組み合わせを既読済みとして流し込み、ゲートの起点を
--   「これ以降に投稿される新しい連絡」に揃える。
--
-- 冪等性:
--   bulletin_reads は UNIQUE(post_id, user_id) を持つため ON CONFLICT DO NOTHING で
--   二重適用しても安全。read_at は既定の NOW() が入る。
-- ============================================================

BEGIN;

INSERT INTO bulletin_reads (post_id, user_id)
SELECT p.id, up.id
FROM bulletin_posts p
CROSS JOIN user_profiles up
WHERE p.is_archived = false
  AND up.role = 'teacher'
ON CONFLICT (post_id, user_id) DO NOTHING;

COMMIT;
