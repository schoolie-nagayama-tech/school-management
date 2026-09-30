-- ============================================================
-- セキュリティ総点検（2026-09-30）: 権限昇格と部外者アクセスを塞ぐ
-- ============================================================
--
-- ■ 何を塞ぐか（どれも「ブラウザの公開キー＋ログイン」だけで、PostgREST を直接叩けば実行できた）
--   1. 講師が自分の user_profiles.role を 'admin' に書き換えられた。
--      "Users can update own profile" に WITH CHECK も列の制限も無く、authenticated に GRANT ALL が
--      付いていたため。getApiAuth は role をこの表から読むので、全APIで管理者扱いになっていた。
--   2. 教室長（manager）が、他人（自分自身も）の role を admin にできた。
--      "Admins can update all profiles" / "Admins can manage user_schools" /
--      "Admins can manage invitations" が manager を含み、上下関係を見ていなかった。
--      招待（user_invitations.role）を admin で直接 INSERT → 受諾、でも管理者を作れた。
--   3. 未ログイン（anon）で在籍講師全員の行（氏名・メール・性別・入社日…）を読めた。
--      出勤簿ページが anon で読むための "Anyone can view active teachers for attendance portal"。
--      出勤簿ページはサーバーAPI経由に移した（同じPR）ので、「スタッフのログイン中だけ」に置き換える。
--   4. user_profiles の INSERT ポリシーにある「プロフィールが0件なら誰でも作れる」条件。
--      ★3を消すと、プロフィールの無い新規登録者からは1行も見えなくなり、この条件が真になって
--        自分を admin で INSERT できてしまう（組み合わせの罠）。3と必ず同時に消す。
--   5. 監査ログ（admin_audit_logs）を教室長が UPDATE / DELETE で改ざん・消去できた。
--   6. 新規登録しただけの人（プロフィール無し）や anon が、全教室共通のマスタを書き換え・削除できた。
--      科目を消すと生徒の受講データが CASCADE で消える。course_prep_templates は TO 指定が無く
--      anon でも共通テンプレートを消せた。
--   7. 公開バケット public-assets に、ログインしていれば誰でも上書き・削除・任意ファイルを置けた。
--      アプリは service role 経由（/api/upload/logo）でしか書かないので、書き込みポリシーは不要。
--
-- ■ 方針
--   - 「ロールを上げる」操作はサーバー（service role）経由でしかできないようにする。
--     ユーザー管理API（/api/admin/users/**）と招待完了API（/api/invite/complete）はサーバー側で
--     上下関係を検証してから service role で書くので、そちらは今までどおり動く。
--   - 画面から直接書いている既存の操作（講師の有効/無効切替、退職日・社員番号・入社日・契約更新日の
--     編集、教室の割当）は、上下関係が正しい限り今までどおり通す（壊さない）。
--   - マスタ系は「スタッフのプロフィールを持つ人」に絞るだけで、講師の今の操作範囲は変えない。
--
-- ■ 本番への適用
--   CLAUDE.md のとおり Supabase MCP の apply_migration で当てる（db push を本番に向けない）。
--   何度流しても同じ結果になるよう DROP ... IF EXISTS / CREATE OR REPLACE で書いてある。
-- ============================================================


-- ------------------------------------------------------------
-- 0. 共通の判定関数
-- ------------------------------------------------------------

-- ロール名 → 階層値。src/types/database.ts の USER_ROLE_LEVELS と同じ値にする（片方だけ変えない）。
create or replace function public.role_level(p_role text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(p_role, ''))
    when 'admin' then 5
    when 'owner' then 4
    when 'manager' then 3
    when 'teacher' then 2
    when 'parent' then 1
    else 0
  end
$$;

-- 呼び出した本人の階層値（プロフィールが無ければ 0）。
-- SECURITY DEFINER にするのは、RLS の評価中やトリガーの中から user_profiles を読むときに
-- 呼び出し元の RLS で自分自身を再帰的に評価しないため（check_user_role と同じ作法）。
create or replace function public.auth_role_level()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.role_level(up.role) from public.user_profiles up where up.id = auth.uid()),
    0
  )
$$;

-- 指定ユーザーの階層値。トリガーで「相手が自分より下か」を見るのに使う。
create or replace function public.user_role_level(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.role_level(up.role) from public.user_profiles up where up.id = p_user_id),
    0
  )
$$;

-- スタッフ（講師以上）のプロフィールを持つか。
-- 新規登録しただけの人（プロフィール無し）や保護者を、スタッフ用の表から締め出すのに使う。
-- ★is_active は見ない: 既存の check_school_access / check_user_role も見ておらず、
--   ここだけ変えると「無効化された講師がマスタだけ見えない」という中途半端な状態になるため。
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.auth_role_level() >= 2
$$;

-- 「信頼できる呼び出し元」か。service role（サーバーAPI）と、マイグレーション・
-- SECURITY DEFINER 関数（postgres 所有）からの書き込みは、トリガーの検査を通す。
-- ★トリガー関数は SECURITY INVOKER のままにすること。DEFINER にすると current_user が
--   関数の所有者（postgres）になり、全員が「信頼できる呼び出し元」扱いになって検査が消える。
create or replace function public.is_trusted_db_caller()
returns boolean
language sql
stable
set search_path = public
as $$
  select current_user in ('service_role', 'postgres', 'supabase_admin')
$$;

revoke all on function public.role_level(text) from public;
revoke all on function public.auth_role_level() from public;
revoke all on function public.user_role_level(uuid) from public;
revoke all on function public.is_staff() from public;
revoke all on function public.is_trusted_db_caller() from public;
grant execute on function public.role_level(text) to authenticated, service_role;
grant execute on function public.auth_role_level() to authenticated, service_role;
grant execute on function public.user_role_level(uuid) to authenticated, service_role;
grant execute on function public.is_staff() to authenticated, service_role;
grant execute on function public.is_trusted_db_caller() to authenticated, service_role;


-- ------------------------------------------------------------
-- 1. user_profiles
-- ------------------------------------------------------------

-- 3. anon に講師名簿を見せていたポリシーを、「スタッフのログイン中だけ」に置き換え、anon の権限も外す。
--    ★消すだけにしてはいけない: このポリシーは TO 指定が無く、ログイン中の講師にも効いている。
--      講師の画面（掲示板の既読集計・時間割の講師名・シフト・同僚の一覧など。lib/api/bulletin.ts,
--      school-teachers.ts, schedule.ts, teacher-shifts.ts, teacher-availability.ts）が
--      同僚の行をこのポリシーで読んでいるので、消すと講師の画面から同僚が消える。
--    （anon から user_profiles を読む正当な経路は出勤簿ページだけで、サーバーAPIに移した）
drop policy if exists "Anyone can view active teachers for attendance portal" on public.user_profiles;
drop policy if exists "Staff can view active teachers" on public.user_profiles;
create policy "Staff can view active teachers" on public.user_profiles
  for select to authenticated
  using (role = 'teacher' and is_active = true and public.is_staff());
revoke all on table public.user_profiles from anon;

-- 4. 「0件なら誰でも INSERT 可」の条件を外す。INSERT は教室長以上のみ（上下関係はトリガーで検査）。
drop policy if exists "Admins can insert profiles" on public.user_profiles;
create policy "Admins can insert profiles" on public.user_profiles
  for insert to authenticated
  with check (public.check_user_role(array['admin', 'owner', 'manager']));

-- 1. 本人更新のポリシーに WITH CHECK を付ける（id を他人に付け替える更新を拒否）。
--    列ごとの制限（role 等）は下のトリガーで行う。
drop policy if exists "Users can update own profile" on public.user_profiles;
create policy "Users can update own profile" on public.user_profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 2. user_profiles への書き込みの検査。
--    ポリシーは「どの行を触れるか」しか決められないので、「どの列をどう変えたか」はここで見る。
--    列の比較を to_jsonb で行うのは、本番とローカルで列の有無が違っても（後から足した列など）
--    トリガーが実行時エラーにならないようにするため（無い列は両方 NULL になり、差分なし扱い）。
create or replace function public.guard_user_profiles_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_caller_level integer;
  v_target_level integer;
  v_old jsonb;
  v_new jsonb;
  v_key text;
  -- 本人が自分で変えてはいけない列（人事・権限・本人確認に関わるもの）。
  -- employee_no などの人事項目は、エリアマネージャー以上なら自分の分も直せる（出勤簿の運用）。
  v_self_locked_always text[] := array['role', 'is_active', 'email', 'invited_by', 'invited_at', 'created_at'];
  v_self_locked_hr text[] := array[
    'employee_no', 'hire_date', 'exit_date', 'contract_renewal_date',
    'is_teaching_staff', 'teacher_ai_assist'
  ];
begin
  if public.is_trusted_db_caller() then
    return new;
  end if;

  v_caller_level := public.auth_role_level();

  if tg_op = 'INSERT' then
    -- 画面から直接プロフィールを作るのは教室長以上、かつ自分より下のロールだけ。
    -- （通常はユーザー管理API・招待完了APIが service role で作るので、ここは通らない）
    if v_caller_level < 3 or public.role_level(new.role) >= v_caller_level then
      raise exception '自分と同等以上の権限のプロフィールは作成できません'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id then
    raise exception 'プロフィールのIDは変更できません' using errcode = '42501';
  end if;

  -- ロールの変更は、上下関係を検証するユーザー管理API（service role）だけで行う。
  if new.role is distinct from old.role then
    raise exception 'ロールの変更はユーザー管理画面からのみ行えます' using errcode = '42501';
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);

  if old.id = auth.uid() then
    -- 本人による更新
    foreach v_key in array v_self_locked_always loop
      if (v_new -> v_key) is distinct from (v_old -> v_key) then
        raise exception '自分の % は変更できません', v_key using errcode = '42501';
      end if;
    end loop;
    if v_caller_level < 4 then
      foreach v_key in array v_self_locked_hr loop
        if (v_new -> v_key) is distinct from (v_old -> v_key) then
          raise exception '自分の % は変更できません', v_key using errcode = '42501';
        end if;
      end loop;
    end if;
    return new;
  end if;

  -- 他人の行の更新: 教室長以上で、相手が自分より下のロールのときだけ。
  -- （ユーザー管理APIの「自分より権限が下のユーザーのみ編集可能」と同じ規則）
  v_target_level := public.role_level(old.role);
  if v_caller_level < 3 or v_target_level >= v_caller_level then
    raise exception '自分と同等以上の権限のユーザーは編集できません' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_user_profiles_write on public.user_profiles;
create trigger guard_user_profiles_write
  before insert or update on public.user_profiles
  for each row execute function public.guard_user_profiles_write();


-- ------------------------------------------------------------
-- 2. user_schools（教室の割当）
-- ------------------------------------------------------------
-- 教室長が自分自身を任意の教室に足して、教室スコープを広げられた。
-- 教室長は「自分の担当教室」に「自分より下のロールの人」を割り当て・解除するだけにする
-- （講師編集画面 admin/teachers/[teacherId]/edit の操作はこの範囲に収まる）。
create or replace function public.guard_user_schools_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_caller_level integer;
  v_row public.user_schools%rowtype;
begin
  if public.is_trusted_db_caller() then
    return coalesce(new, old);
  end if;

  v_caller_level := public.auth_role_level();

  -- エリアマネージャー・管理者は全教室を扱う（教室削除時の割当の一括解除など）。
  if v_caller_level >= 4 then
    return coalesce(new, old);
  end if;

  if v_caller_level < 3 then
    raise exception '教室の割当を変更する権限がありません' using errcode = '42501';
  end if;

  -- UPDATE は旧行・新行の両方を検査する（別の教室・別の人への付け替えを防ぐ）
  foreach v_row in array (
    case tg_op
      when 'INSERT' then array[new]
      when 'DELETE' then array[old]
      else array[old, new]
    end
  ) loop
    if v_row.user_id = auth.uid() then
      raise exception '自分自身の教室の割当は変更できません' using errcode = '42501';
    end if;
    if public.user_role_level(v_row.user_id) >= v_caller_level then
      raise exception '自分と同等以上の権限のユーザーの割当は変更できません' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.user_schools us
      where us.user_id = auth.uid() and us.school_id = v_row.school_id
    ) then
      raise exception '担当外の教室の割当は変更できません' using errcode = '42501';
    end if;
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists guard_user_schools_write on public.user_schools;
create trigger guard_user_schools_write
  before insert or update or delete on public.user_schools
  for each row execute function public.guard_user_schools_write();


-- ------------------------------------------------------------
-- 3. user_invitations（招待）
-- ------------------------------------------------------------
-- 招待の role は受諾時にそのままプロフィールに入る。教室長が admin の招待を直接 INSERT すれば
-- 管理者を作れたので、「自分より下のロールの招待しか作れない」「招待者は自分」を DB でも強制する。
-- （招待完了APIでも招待者の階層を再検証している。二重に見るのは、片方が崩れても破られないため）
create or replace function public.guard_user_invitations_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_caller_level integer;
begin
  if public.is_trusted_db_caller() then
    return new;
  end if;

  v_caller_level := public.auth_role_level();
  if v_caller_level < 3 or public.role_level(new.role) >= v_caller_level then
    raise exception '自分と同等以上の権限の招待は作成できません' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.invited_by is distinct from auth.uid() then
    raise exception '招待者は自分自身にしてください' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
    new.role is distinct from old.role
    or new.email is distinct from old.email
    or new.token is distinct from old.token
    or new.invited_by is distinct from old.invited_by
    or new.school_ids is distinct from old.school_ids
  ) then
    raise exception '作成済みの招待の内容は変更できません' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_user_invitations_write on public.user_invitations;
create trigger guard_user_invitations_write
  before insert or update on public.user_invitations
  for each row execute function public.guard_user_invitations_write();


-- ------------------------------------------------------------
-- 4. admin_audit_logs（監査ログ）は教室長以上が「読むだけ」
-- ------------------------------------------------------------
-- 書き込みは src/lib/audit-log.ts が service role で行う（RLS を通らない）ので、
-- authenticated に書き込みポリシーは要らない。改ざん・消去できる監査ログは証拠にならない。
drop policy if exists "admin_audit_logs_manager_all" on public.admin_audit_logs;
drop policy if exists "admin_audit_logs_manager_select" on public.admin_audit_logs;
create policy "admin_audit_logs_manager_select" on public.admin_audit_logs
  for select to authenticated
  using (public.check_user_role(array['admin', 'owner', 'manager']));
revoke insert, update, delete, truncate on table public.admin_audit_logs from anon, authenticated;


-- ------------------------------------------------------------
-- 5. マスタ系: 「スタッフのプロフィールを持つ人」に絞る
-- ------------------------------------------------------------
-- USING (true) / auth.uid() IS NOT NULL / auth.role() = 'authenticated' は
-- 「ログインさえしていれば誰でも」なので、新規登録しただけの人も通っていた。
-- 講師以上の今の操作範囲は変えない（is_staff() は講師以上で真）。

-- subjects（同じ中身のポリシーが2本あったので1本にまとめる）
drop policy if exists "Allow all for authenticated users" on public.subjects;
drop policy if exists "subjects_allow_all_auth" on public.subjects;
drop policy if exists "subjects_staff_all" on public.subjects;
create policy "subjects_staff_all" on public.subjects
  to authenticated using (public.is_staff()) with check (public.is_staff());

-- textbooks
drop policy if exists "textbooks_allow_all_auth" on public.textbooks;
drop policy if exists "textbooks_staff_all" on public.textbooks;
create policy "textbooks_staff_all" on public.textbooks
  to authenticated using (public.is_staff()) with check (public.is_staff());

-- curriculum_items
drop policy if exists "curriculum_items_allow_all_auth" on public.curriculum_items;
drop policy if exists "curriculum_items_staff_all" on public.curriculum_items;
create policy "curriculum_items_staff_all" on public.curriculum_items
  to authenticated using (public.is_staff()) with check (public.is_staff());

-- alert_settings
drop policy if exists "alert_settings_school_member_modify" on public.alert_settings;
drop policy if exists "alert_settings_school_member_select" on public.alert_settings;
drop policy if exists "alert_settings_staff_all" on public.alert_settings;
create policy "alert_settings_staff_all" on public.alert_settings
  to authenticated using (public.is_staff()) with check (public.is_staff());

-- assessment_subjects
drop policy if exists "assessment_subjects_modify" on public.assessment_subjects;
drop policy if exists "assessment_subjects_select" on public.assessment_subjects;
drop policy if exists "assessment_subjects_staff_all" on public.assessment_subjects;
create policy "assessment_subjects_staff_all" on public.assessment_subjects
  to authenticated using (public.is_staff()) with check (public.is_staff());

-- monthly_tasks / monthly_task_templates
drop policy if exists "monthly_tasks_delete" on public.monthly_tasks;
drop policy if exists "monthly_tasks_insert" on public.monthly_tasks;
drop policy if exists "monthly_tasks_select" on public.monthly_tasks;
drop policy if exists "monthly_tasks_update" on public.monthly_tasks;
drop policy if exists "monthly_tasks_staff_all" on public.monthly_tasks;
create policy "monthly_tasks_staff_all" on public.monthly_tasks
  to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "monthly_templates_delete" on public.monthly_task_templates;
drop policy if exists "monthly_templates_insert" on public.monthly_task_templates;
drop policy if exists "monthly_templates_select" on public.monthly_task_templates;
drop policy if exists "monthly_templates_update" on public.monthly_task_templates;
drop policy if exists "monthly_templates_staff_all" on public.monthly_task_templates;
create policy "monthly_templates_staff_all" on public.monthly_task_templates
  to authenticated using (public.is_staff()) with check (public.is_staff());

-- 共通行（school_id IS NULL）を持つ表: 共通行もスタッフだけ。教室の行は今までどおり教室スコープ。
-- course_prep_templates は TO 指定が無く anon にも効いていた（共通テンプレートを anon が消せた）。
drop policy if exists "prep_templates_delete" on public.course_prep_templates;
drop policy if exists "prep_templates_insert" on public.course_prep_templates;
drop policy if exists "prep_templates_select" on public.course_prep_templates;
drop policy if exists "prep_templates_update" on public.course_prep_templates;
create policy "prep_templates_select" on public.course_prep_templates
  for select to authenticated
  using (public.is_staff() and (school_id is null or public.check_school_access(school_id)));
create policy "prep_templates_insert" on public.course_prep_templates
  for insert to authenticated
  with check (public.is_staff() and (school_id is null or public.check_school_access(school_id)));
create policy "prep_templates_update" on public.course_prep_templates
  for update to authenticated
  using (public.is_staff() and (school_id is null or public.check_school_access(school_id)))
  with check (public.is_staff() and (school_id is null or public.check_school_access(school_id)));
create policy "prep_templates_delete" on public.course_prep_templates
  for delete to authenticated
  using (public.is_staff() and (school_id is null or public.check_school_access(school_id)));
revoke all on table public.course_prep_templates from anon;

-- inquiry_mail_templates（見込み保護者に送るメール本文。共通行を部外者が書き換えるとフィッシングの入口）
drop policy if exists "inquiry_mail_templates_scope_auth" on public.inquiry_mail_templates;
create policy "inquiry_mail_templates_scope_auth" on public.inquiry_mail_templates
  to authenticated
  using (public.is_staff() and (school_id is null or public.check_school_access(school_id)))
  with check (public.is_staff() and (school_id is null or public.check_school_access(school_id)));

-- schedule_closed_days（共通の休校日）
drop policy if exists "schedule_closed_days_school_scope_auth" on public.schedule_closed_days;
create policy "schedule_closed_days_school_scope_auth" on public.schedule_closed_days
  to authenticated
  using (public.is_staff() and (school_id is null or public.check_school_access(school_id)))
  with check (public.is_staff() and (school_id is null or public.check_school_access(school_id)));


-- ------------------------------------------------------------
-- 6. Storage: public-assets の書き込みは service role だけ
-- ------------------------------------------------------------
-- 閲覧ポリシー（公開バケットなので誰でも読める）はロゴ表示に必要なので残す。
drop policy if exists "Authenticated users can upload public assets" on storage.objects;
drop policy if exists "Authenticated users can update public assets" on storage.objects;
drop policy if exists "Authenticated users can delete public assets" on storage.objects;
