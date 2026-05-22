-- user_profiles に姓・名カラムを追加
-- display_name は後方互換のため残し、last_name + first_name から自動生成する運用に移行
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS last_name  text,
  ADD COLUMN IF NOT EXISTS first_name text;

-- 既存データ: スペース区切りがある場合は姓・名に分割、なければ全体を last_name に
UPDATE user_profiles
SET
  last_name  = CASE
    WHEN display_name ~ '[\s　]'
    THEN split_part(regexp_replace(display_name, '[\s　]+', ' ', 'g'), ' ', 1)
    ELSE display_name
  END,
  first_name = CASE
    WHEN display_name ~ '[\s　]'
    THEN substring(
      regexp_replace(display_name, '[\s　]+', ' ', 'g')
      FROM position(' ' IN regexp_replace(display_name, '[\s　]+', ' ', 'g')) + 1
    )
    ELSE NULL
  END
WHERE display_name IS NOT NULL
  AND last_name IS NULL;
