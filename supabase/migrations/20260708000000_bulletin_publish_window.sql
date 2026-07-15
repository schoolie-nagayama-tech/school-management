-- ============================================================
-- 連絡掲示板: 公開期間（表示期間）の設定を追加
--
-- 背景:
--   これまで掲示板の投稿は「作成 → 削除（論理削除 is_archived）」しかできず、
--   期間限定の連絡（例: 今週のイベント告知）を出しても、期間が過ぎたら手動で
--   消すしかなかった。公開開始・終了日時を持たせ、期間外の投稿は講師には
--   自動的に表示されない／未読ゲートの対象外になるようにする。
--
--   いずれも NULL 許可:
--     publish_start_at = NULL → 即時公開（開始日の制限なし）
--     publish_end_at   = NULL → 無期限（終了日の制限なし）
--
--   アーカイブ（is_archived）は既存カラムをそのまま「削除せず過去分を残す」
--   用途に流用する。公開期間はアーカイブとは独立（期間終了しても投稿は残り、
--   管理者は引き続き閲覧・アーカイブできる）。
-- ============================================================

ALTER TABLE bulletin_posts
  ADD COLUMN IF NOT EXISTS publish_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publish_end_at TIMESTAMPTZ;

COMMENT ON COLUMN bulletin_posts.publish_start_at IS '公開開始日時（NULL=即時公開）。この日時以降に講師へ表示・未読集計される';
COMMENT ON COLUMN bulletin_posts.publish_end_at IS '公開終了日時（NULL=無期限）。この日時を過ぎると講師には表示されない（データは残る）';

-- 公開中の投稿を素早く絞り込むためのインデックス（school_id ＋ 期間）
CREATE INDEX IF NOT EXISTS idx_bulletin_posts_publish_window
  ON bulletin_posts (school_id, publish_start_at, publish_end_at)
  WHERE NOT is_archived;
