-- 通年講座に「毎週の開催曜日・コマ」を持たせる
--
-- 背景（2026-08-25）:
--   国理社オンラインライブの時間割（曜日×コマ の表）を投入しようとして分かった欠落。
--   フェーズ1では通年講座の時間割はクラス枠（schedule_regular_patterns）で表す設計にしたが、
--   枠は生徒ごとに作るものなので **名簿が空の講座は開催曜日・コマを記録できない**。
--   また枠ごとに曜日を入れ直すと、同じ講座の枠が別々の曜日にぶれても止められない。
--   講座そのものに定例の開催枠を持たせ、枠はそこから引き継ぐのが正しい持ち方。
--
-- 不変条件:
--   どちらも NULL 許容。既存行（講習講座＝日付指定）は NULL のままで挙動不変。
--
-- 適用状況: 本番適用済み（2026-08-25、MCP apply_migration: special_courses_weekly_slot）
alter table public.special_courses
  add column if not exists day_of_week integer
    check (day_of_week is null or (day_of_week between 0 and 6)),
  add column if not exists time_slot_id uuid
    references public.schedule_time_slots(id) on delete set null;

comment on column public.special_courses.day_of_week is
  '通年講座の定例開催曜日（0=日〜6=土）。講習講座は NULL（session_dates で日付指定するため）';
comment on column public.special_courses.time_slot_id is
  '通年講座の定例開催コマ。講習講座は NULL。クラス枠はここを引き継ぐ';

create index if not exists idx_special_courses_weekly_slot
  on public.special_courses (school_id, day_of_week, time_slot_id)
  where day_of_week is not null;
