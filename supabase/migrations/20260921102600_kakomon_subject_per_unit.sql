-- 過去問は1冊に全科目が載るので、科目を教材ではなく単元に持たせる。
-- 空なら従来どおり textbooks.subject を使うため、過去問以外の既存データの意味は変わらない。
--
-- ★本番には 2026-09-21 に Supabase MCP の apply_migration で適用済み（版 20260921102600）。
--   ファイルが欠けていたので復元した。本番に再適用しない。
--   欠けたままだとローカル・CI の新規DBにこの列が無く、20261002000000 が
--   「column "subject" of relation "curriculum_items" does not exist」で落ちていた。
-- ★復元したのは列の追加とコメントだけ。本番で同時に流したデータ移行
--   （749〜752 の教材名の変更、科目×年度の単元作成、テンプレ参照の付け替え、旧単元の削除）は
--   本番の教材 id 前提で、空のDBでは教材が無く外部キー違反になるため入れていない。
--   本番の中身は supabase_migrations.schema_migrations の statements で読める。
alter table public.curriculum_items add column if not exists subject text;

comment on column public.curriculum_items.subject is
  '単元の科目。空なら textbooks.subject を使う。過去問のように1冊で複数科目を扱う教材のために設けた。';
