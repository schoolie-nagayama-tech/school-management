-- 問合せに「電話がつながりやすい時間帯」を持たせる。
-- 追客の架電タイミングの判断材料。複数選択＋自由記述のため jsonb で保持する。
-- 形: { "slots": ["anytime"|"noon"|"evening"|"night"|"saturday"|"other", ...], "note": "自由記述" }

alter table public.inquiries
  add column if not exists contactable_times jsonb;

comment on column public.inquiries.contactable_times is
  '電話がつながりやすい時間帯。{ slots: string[], note: string }。slots は anytime/noon/evening/night/saturday/other。';
