-- 講師の入社日。「入社3ヶ月」アラートの判定に使用する。
--
-- 従来は user_profiles.created_at（＝アカウント作成日）で判定していたが、システム導入時に
-- 既存講師を一括投入したため created_at が全員ほぼ同日となり、全員が「入社3ヶ月」と誤判定されていた。
-- 入社日は業務上の事実であってアカウント作成日とは別物なので、専用カラムとして持つ。
--
-- NULL=未設定。判定対象から外れる（＝アラートに出ない）ため、入社日を入力した講師だけが対象になる。
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS hire_date date;

COMMENT ON COLUMN user_profiles.hire_date IS '講師の入社日。入社3ヶ月アラートの判定に使用。NULL=未設定（判定対象外）。アカウント作成日(created_at)とは別物';
