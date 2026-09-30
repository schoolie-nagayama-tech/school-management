-- ============================================================
-- セキュリティ総点検（2026-09-30）: 教室長（manager）の閲覧範囲を担当教室に絞る
-- ============================================================
--
-- ■ 何を変えるか
--   check_school_access / check_student_access は admin・owner・manager に常に TRUE を返していた。
--   これらは本番の120以上のポリシーから参照されていて、教室長1人のアカウントが乗っ取られると
--   全教室の生徒・保護者・問合せ（見込み保護者の住所・電話）・面談記録・文字起こしが漏れる状態だった。
--   manager は admin・owner と同じ扱いから外し、講師と同じく user_schools の担当教室だけにする。
--
-- ■ 画面・APIへの影響
--   アプリ側はもともと教室長を「割り当てられた教室だけ」として扱っている
--   （AuthContext の schoolIds、getApiAuth の schoolIds はどちらも manager を user_schools で引く）。
--   DB だけが全教室を許していたので、DB をアプリに合わせる形になる。
--   ★複数教室を見る教室長は、ユーザー管理でその教室をすべて割り当てておくこと。
--     割り当てが無い教室長は、適用後にどの教室の生徒も見えなくなる（画面は元から見えていない）。
--     適用前に本番で次を流し、割り当ての無い教室長がいないか確かめる:
--       select p.id, p.display_name, p.email
--         from public.user_profiles p
--        where p.role = 'manager'
--          and not exists (select 1 from public.user_schools us where us.user_id = p.id);
--
-- ■ 本番への適用: Supabase MCP の apply_migration（db push は使わない）。
--   関数の中身だけを差し替える（署名・所有者・権限は変えない）ので、参照しているポリシーはそのまま効く。
--   STABLE は 20260831120348 で付けたもの。CREATE OR REPLACE で落ちないよう明記する。
-- ============================================================

create or replace function public.check_school_access(school_id_param uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  user_role text;
begin
  -- セキュリティ定義関数内では RLS をバイパスして直接取得
  select role into user_role
  from user_profiles
  where id = auth.uid();

  -- 全教室を見るのはシステム管理者とエリアマネージャーだけ。
  -- 教室長（manager）は担当教室のみ（2026-09-30 総点検で変更。上のヘッダー参照）。
  if user_role in ('admin', 'owner') then
    return true;
  end if;

  return exists (
    select 1 from user_schools us
    where us.user_id = auth.uid()
      and us.school_id = school_id_param
  );
end;
$$;

create or replace function public.check_student_access(student_school_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  user_role text;
begin
  select role into user_role
  from user_profiles
  where id = auth.uid();

  -- check_school_access と同じ規則（教室長は担当教室のみ）
  if user_role in ('admin', 'owner') then
    return true;
  end if;

  return exists (
    select 1 from user_schools us
    where us.user_id = auth.uid()
      and us.school_id = student_school_id
  );
end;
$$;
