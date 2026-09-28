-- 志望校を5行までにし、模試から入った行の出どころを持つ（2026-09-28）
--
-- ■ rank 1〜3 → 1〜5
--   模試の志望校欄は5枠（1〜3公立・4〜5私立）。模試の取り込みで私立も志望校に入れるため。
--   ★公立3＋私立2に分けない（教室長「5行までにしよう。私立第一志望もいるからね」）。
--     行は志望順位だけで並べ、私立を第1志望に置けるようにする。
--
-- ■ source_assessment_id
--   その行が模試の取り込みで入ったとき、どの模試か。手で入れた・手で学校を直した行は NULL。
--   ★取り込みのプレビューで「模試の日より後に手で直された志望校」を見分け、差し替えを既定で外すのに使う
--    （面談で聞いた最新の志望を、古い模試で消さないため）。画面では「模試から」の印に使う。
--   ★ON DELETE SET NULL。模試の記録を消しても、志望校は消さない（手で入れた扱いに戻るだけ）。

alter table public.student_target_schools
  drop constraint if exists student_target_schools_rank_range;
alter table public.student_target_schools
  add constraint student_target_schools_rank_range check (rank between 1 and 5);

alter table public.student_target_schools
  add column if not exists source_assessment_id uuid
    references public.assessments (id) on delete set null;

comment on table public.student_target_schools is '生徒の志望校。第1〜第5志望まで。面談の②で聞いて入れるか、模試の取り込みで入れる。';
comment on column public.student_target_schools.source_assessment_id is
  '模試の取り込みで入った行ならその模試。手で入れた・手で学校を直した行は NULL。';
