-- ============================================================
-- セキュリティ総点検（2026-09-30）: 出勤簿（給与）の自己改ざんを塞ぐ
-- ============================================================
--
-- ■ 何を塞ぐか
--   attendance_sheets_teacher_own は講師本人に自分の出勤簿の ALL を与えていて、列の制限が無かった。
--   ブラウザの公開キーで PostgREST を直接叩けば、講師が自分の出勤簿を
--     - status='approved'（承認済み）にし、approved_by / approved_at を好きな値にする
--     - transport_cost（交通費）やコマ給変更（koma_change_*）を書き換える
--   ことができた。attendance_types も講師に ALL で、unit_price（コマ単価）を変えられた。
--   どちらも給与の不正につながる。
--
-- ■ 講師が画面から正規に行う操作（src/lib/api/attendance.ts）
--   - 自分の出勤簿を作る（下書き。getOrCreateAttendanceSheet / 一覧の下書き一括作成）
--   - 提出する（submitAttendanceSheet: status='submitted', submitted_at, submitted_by）
--   - 取り下げる（withdrawAttendanceSheet: submitted → draft, submitted_at=NULL）
--   交通費・備考・コマ給変更（updateAttendanceSheetMeta）と確認・承認・差し戻しは教室長以上の操作。
--   → 講師本人には「下書き⇄提出の切り替え」と「提出の記録」だけを許す。教室長以上は今までどおり。
--
-- ■ 本番への適用: Supabase MCP の apply_migration。20260930120000 の後に当てる（is_trusted_db_caller 等を使う）。
-- ============================================================

create or replace function public.guard_attendance_sheets_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_key text;
  -- 講師本人が変えてよい列（提出・取り下げで触る列だけ）
  v_teacher_editable text[] := array['status', 'submitted_at', 'submitted_by', 'submitted_to', 'updated_at'];
begin
  if public.is_trusted_db_caller() or public.auth_role_level() >= 3 then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- 講師が作れるのは、承認・金額が何も入っていない下書きだけ
    if new.status is distinct from 'draft'
      or new.approved_at is not null or new.approved_by is not null
      or new.reviewed_at is not null or new.reviewed_by is not null
      or coalesce(new.transport_cost, 0) <> 0
      or coalesce(new.is_koma_changing, false)
      or new.koma_change_from is not null or new.koma_change_to is not null
      or new.admin_note is not null or new.rejection_reason is not null
    then
      raise exception '出勤簿は下書きとしてのみ作成できます' using errcode = '42501';
    end if;
    -- 1対1のコマ給変更列は後から足した列なので、to_jsonb で有無を問わず見る
    v_new := to_jsonb(new);
    if (v_new ->> 'koma_change_from_1to1') is not null or (v_new ->> 'koma_change_to_1to1') is not null then
      raise exception '出勤簿は下書きとしてのみ作成できます' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE: 変わった列が「提出・取り下げの列」だけであること
  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  for v_key in select jsonb_object_keys(v_new) loop
    if (v_new -> v_key) is distinct from (v_old -> v_key) and not (v_key = any (v_teacher_editable)) then
      raise exception '出勤簿の % は教室長以上しか変更できません', v_key using errcode = '42501';
    end if;
  end loop;

  -- 状態は「下書き・提出済み・差し戻し」から「下書き・提出済み」へだけ動かせる。
  -- 承認済み・確認済みの出勤簿を講師が下書きに戻して書き換える、を防ぐ。
  if new.status is distinct from old.status then
    if old.status not in ('draft', 'submitted', 'rejected') or new.status not in ('draft', 'submitted') then
      raise exception '出勤簿の状態をこの操作で変えることはできません' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_attendance_sheets_write on public.attendance_sheets;
create trigger guard_attendance_sheets_write
  before insert or update on public.attendance_sheets
  for each row execute function public.guard_attendance_sheets_write();


-- attendance_types（コマ単価のマスタ）: 読むのは教室のスタッフ、書くのは教室長以上
drop policy if exists "attendance_types_school_scope_auth" on public.attendance_types;
drop policy if exists "attendance_types_staff_select" on public.attendance_types;
drop policy if exists "attendance_types_manager_write" on public.attendance_types;
create policy "attendance_types_staff_select" on public.attendance_types
  for select to authenticated
  using (public.is_staff() and (school_id is null or public.check_school_access(school_id)));
create policy "attendance_types_manager_write" on public.attendance_types
  for all to authenticated
  using (public.auth_role_level() >= 3 and (school_id is null or public.check_school_access(school_id)))
  with check (public.auth_role_level() >= 3 and (school_id is null or public.check_school_access(school_id)));
