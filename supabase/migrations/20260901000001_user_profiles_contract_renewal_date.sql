-- ============================================================
-- 講師の契約更新日（user_profiles.contract_renewal_date）
-- ============================================================
-- 背景:
--   規定では入社から3ヶ月が研修期間で、そのあと契約更新が必要になる。
--   ところが契約期間は月単位で切るため、入社日から機械的に3ヶ月後を出しても実態と合わない
--   （6/25入社なら9月末、6月頭入社なら8月末、という具合に教室長が判断する）。
--   自動計算はせず、講師登録のときに研修期間の終了日＝次回の契約更新日を入れてもらう。
--
-- 設計:
--   NULL = 対象外／更新済み（アラートを出さない）。
--   契約を更新したら日付をクリアする運用（更新後は追いかけない）。
--   date 型で日付のみ。月末で切る運用だが、途中の日付も入れられるようにしておく。
-- 冪等: IF NOT EXISTS なので再実行しても安全。
-- ============================================================

alter table public.user_profiles
  add column if not exists contract_renewal_date date;

comment on column public.user_profiles.contract_renewal_date is
  '次回の契約更新日（研修期間の終了日）。NULL=対象外／更新済み。出勤簿管理の契約更新アラートの判定に使う。';

-- 更新日が入っている講師だけを引くための部分インデックス（アラートの絞り込み用）
create index if not exists idx_user_profiles_contract_renewal_date
  on public.user_profiles (contract_renewal_date)
  where contract_renewal_date is not null;
