-- 成績の「テストなし」と、生徒の性別（2026-09-27）
--
-- ■ assessment_scores.no_test
--   その科目のテストが無かった（美術のテストが無い回など）ことを持つ印。値（value）は空のまま。
--   ★それまでは、成績未入力アラートを消すために 0 を入れる運用だった（教室長）。0 は「入力済み」と
--     数えられるのでアラートは消えるが、前回比・成績低下アラート・合計・グラフ・保護者ポータルで
--     本当に0点を取ったように扱われていた。
--   ★印が立っている科目は値を持たない（check）。値と印の両方があると、どちらが正か分からなくなる。
--
-- ■ 既存の 0 の置き換え
--   定期テスト・通知表で 0 が入っている科目を「テストなし」にする（教室長の了承・2026-09-27）。
--   定期テストで本当に0点の生徒はほぼいない想定、通知表は1〜5なので0は評定としてありえない。
--   模試は対象外（模試の0は入力の運用が別）。
--
-- ■ students.gender
--   生徒の性別。NULL＝未設定、female＝女、male＝男。「その他」は置かない（入試の男女別の基準・
--   男子校／女子校の判定に使うため）。面談④の私立の提案で使う。
--   ★preferred_teacher_gender（希望する講師の性別）とは別物。

alter table public.assessment_scores
  add column if not exists no_test boolean not null default false;

alter table public.assessment_scores
  drop constraint if exists assessment_scores_no_test_has_no_value;
alter table public.assessment_scores
  add constraint assessment_scores_no_test_has_no_value
  check (not no_test or value is null);

comment on column public.assessment_scores.no_test is
  'その科目のテストが無かった印（テストなし）。true のとき value は NULL。未入力アラートの対象外で、合計・前回比にも使わない。';

update public.assessment_scores s
set value = null, no_test = true
from public.assessments a
where a.id = s.assessment_id
  and a.category in ('regular_test', 'report_card')
  and s.value = 0;

alter table public.students
  add column if not exists gender text;

alter table public.students
  drop constraint if exists students_gender_check;
alter table public.students
  add constraint students_gender_check
  check (gender is null or gender = any (array['male'::text, 'female'::text]));

comment on column public.students.gender is
  '生徒の性別。NULL=未設定、male=男、female=女。面談の私立の提案（男子校・女子校、男女別の偏差値・基準）に使う。';
