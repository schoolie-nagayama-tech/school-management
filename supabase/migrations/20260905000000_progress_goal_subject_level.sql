-- 進行表の目標（student_textbook_exams）の親を「生徒×テキスト」から「生徒×科目」へ持ち替える。
-- 正典: docs/progress-goal-subject-level-plan.md
--
-- 手順（この順番を変えないこと。§7参照）:
--   1. 列追加（student_id / subject_key）
--   2. バックフィル（既存行の student_id / subject_key を親テキストから埋める）
--   3. 旧FK（student_textbook_id）を ON DELETE SET NULL に付け替え
--   4. RLS を student_textbooks 経由から students 経由に書き換え
-- バックフィル → RLS書き換え の順を守る。逆にすると既存行が一瞬見えなくなる（§4-4）。
--
-- 重複目標の集約（§4-5）はここではやらない。別ステップ。

-- ============================================
-- 1. 列の追加
-- ============================================
alter table public.student_textbook_exams
  add column if not exists student_id  uuid references public.students(id) on delete cascade,
  add column if not exists subject_key text;

create index if not exists idx_student_textbook_exams_student_subject
  on public.student_textbook_exams (student_id, subject_key, exam_date);

-- ============================================
-- 2. バックフィル
-- ============================================
-- subject_key の分類は newProgress.shared.ts の categorizeSubject() と完全に同じ判定・同じ順序にする
-- （国語 → 数学 → 英語 →理科 → 社会 → その他）。ズレると移行後に目標が別科目に飛ぶ。
-- English は大文字小文字を無視する（TS側は /English/i）ので SQL では ~* を使う。
-- t.subject が NULL の行は 'その他'。
update public.student_textbook_exams e
set student_id  = st.student_id,
    subject_key = case
      when t.subject ~ '国語|現代文|古文|漢文|古典'      then '国語'
      when t.subject ~ '数学|算数'                        then '数学'
      when t.subject ~* '英語|English'                    then '英語'
      when t.subject ~ '理科|物理|化学|生物|地学'          then '理科'
      when t.subject ~ '社会|歴史|地理|公民|日本史|世界史|政経|倫理' then '社会'
      else 'その他'
    end
from public.student_textbooks st
left join public.textbooks t on t.id = st.textbook_id
where st.id = e.student_textbook_id
  and e.student_id is null;

-- ★ textbooks を LEFT JOIN にしているのは意図的。
--   教材マスタの行が消えている / textbook_id が NULL の student_textbooks があると、
--   内部結合では student_id が埋まらず、その生徒の目標が「親なし」に見えてしまう。
--   科目が読めないだけなので 'その他' に落として拾う（生徒への紐付けは失われない）。
--
-- ここまでで student_id が埋まらないのは student_textbooks 自体が消えている孤児行だけ。
-- 孤児は表示経路が無く既に見えていないため放置する。
-- ★ 消さないこと。本番データを人が確認してから別途判断する（正典 §4-3）。
--   NOT NULL も同じ理由でここでは付けない。孤児が 0 件であることを下のクエリで確認したうえで、
--   別マイグレーションで付ける。
--
--   select count(*) from student_textbook_exams where student_id is null;

-- ============================================
-- 3. 旧FKの付け替え（ON DELETE CASCADE → SET NULL）
-- ============================================
-- student_textbook_id は「作成元テキストの記録」として残すが、読み込みには使わない。
-- CASCADE のままだとテキストを1冊削除しただけで、その科目の他のテキストも共有している
-- 目標が道連れで消える（提案書FKで踏んだ罠と同じ。講習_提案書FK SET NULL＋偽所持是正 参照）。
alter table public.student_textbook_exams
  drop constraint if exists student_textbook_exams_student_textbook_id_fkey;
alter table public.student_textbook_exams
  alter column student_textbook_id drop not null,
  add constraint student_textbook_exams_student_textbook_id_fkey
    foreign key (student_textbook_id) references public.student_textbooks(id) on delete set null;

-- ============================================
-- 4. RLS の書き換え（必須）
-- ============================================
-- 現行ポリシーは student_textbooks を JOIN して school_id を見ている。
-- student_textbook_id が NULL の新規行はこの条件を満たせず、作った本人にも見えなくなる。
-- students 経由に書き換える。
drop policy if exists "student_textbook_exams_school_scope_auth" on public.student_textbook_exams;
create policy "student_textbook_exams_school_scope_auth" on public.student_textbook_exams
  to authenticated
  using (exists (select 1 from public.students s
                 where s.id = student_textbook_exams.student_id
                   and public.check_school_access(s.school_id)))
  with check (exists (select 1 from public.students s
                      where s.id = student_textbook_exams.student_id
                        and public.check_school_access(s.school_id)));

-- action_goals も student_textbook_exams → student_textbooks の2段JOINだったので同様に
-- student_textbook_exams → students に書き換える。
drop policy if exists "action_goals_school_scope_auth" on public.action_goals;
create policy "action_goals_school_scope_auth" on public.action_goals
  to authenticated
  using (exists (select 1 from public.student_textbook_exams e
                 join public.students s on s.id = e.student_id
                 where e.id = action_goals.student_textbook_exam_id
                   and public.check_school_access(s.school_id)))
  with check (exists (select 1 from public.student_textbook_exams e
                      join public.students s on s.id = e.student_id
                      where e.id = action_goals.student_textbook_exam_id
                        and public.check_school_access(s.school_id)));
