-- 志望校の「併願」の印（2026-09-27）
--
-- ■ student_target_schools.is_heigan
--   その志望校を併願で押さえる学校として扱う印。志望パネルの各行の「併願」ボタンで付け外しする。
--   ★志望順位（rank）とは別に持つ。第1志望の都立の下に私立を入れたとき、その私立を
--     「単願で行きたい学校」ではなく「併願で押さえる学校」として話すための区別で、順位では表せない。
--   ★入力欄は増やさない（教室長の要望。ボタン1つで足りる）。
--   ★既存行は false（＝従来どおり志望順位だけの扱い）。

alter table public.student_target_schools
  add column if not exists is_heigan boolean not null default false;

comment on column public.student_target_schools.is_heigan is
  '併願で押さえる学校の印（志望順位とは別。私立を入れたときに併願の区分で話すため）。';
