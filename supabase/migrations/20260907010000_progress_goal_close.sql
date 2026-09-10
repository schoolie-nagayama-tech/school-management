-- 進行表の目標に「終了」を持たせる。
-- 正典: docs/progress-goal-close-plan.md
--
-- 目標は「生徒×科目」で共有されている（20260905000000_progress_goal_subject_level.sql）。
-- 講習で立てた目標は、後続の目標を立てない限り試験日を過ぎても消えず、activeExamOf() が
-- 選び続けてしまう。終了日時を持たせ、選択から外す。行は削除しない（履歴・取り消しのため）。

alter table public.student_textbook_exams
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.user_profiles(id) on delete set null;

comment on column public.student_textbook_exams.closed_at is
  '目標を終えた日時。NULL=進行中。講習の目標が次の目標を立てるまで居座るのを止めるために教室長以上が付ける。行は消さない（履歴と取り消しのため）';

comment on column public.student_textbook_exams.closed_by is
  '目標を終えた操作者(user_profiles.id)。監査目的のみで機能には使わない。
   ★ FKは ON DELETE SET NULL（CASCADEにしない）。講師アカウントを消したときに
   終了済みの目標まで道連れで消えてはいけない（提案書FK・目標親FKで踏んだ罠と同じ）。';

-- インデックスは追加しない。1生徒あたり数十行で、既存の
-- idx_student_textbook_exams_student_subject（student_id, subject_key, exam_date）で足りる。
-- RLS も変更不要。行の所属（student_id）は変わらない。
