-- ============================================================
-- 保護者ポータル v2 スケジュール（Stage 3）
-- 正典: docs/portal-v2-requirements.md §4「S. スケジュール」/ §7-3
-- ============================================================
-- 目的:
--   (a) 保護者が「紐づけ生徒の予定」を見られるようにする（schedule_entries ほかの
--       portal 可視化）。
--   (b) 振替上限の「例外」を教室が明示的に開けるための新テーブル2つ
--       （portal_transfer_permissions / transfer_free_periods）。
--
-- 不変条件（docs/portal-v2-requirements.md §6-3）:
--   - 既存テーブルのスキーマは変更しない（ポリシー・grant の併存追加のみ）。
--   - 既存ポリシー・既存 grant には一切触れない。
--
-- ポータル可視化の鉄則（Stage1 で確立・Stage2 で踏襲・厳守）:
--   ポータルに見せるテーブルは必ず「grant select ... to portal」＋「to portal の RLS
--   ポリシー」の2点セット。ポリシー内は auth.uid() でなく public.portal_uid() を使う。
--   書き込みは service role 経由の API で行う（portal に INSERT/UPDATE/DELETE を与えない）。
--
-- 適用状況: 2026-07-16 に本番へ適用済み（MCP の apply_migration・版名 portal_v2_schedule）。
--       ※ 以前の「本番には適用しない」は Stage3 開発時点の記述。本番デモ
--         （docs/portal-v2-demo-handoff.md §3-2）で適用したため改めた。
--       portal ロール／portal_uid() は Stage1(20260714000000) で作成済みの前提。冪等に書く。
-- ============================================================


-- ============================================================
-- 1) 振替上限の例外テーブル（§7-3）
-- ============================================================
-- 設計の要:
--   保護者に「生の許可レコード」を見せる必要はない。保護者が知りたいのは
--   「あと何回振替できるか（＝判定結果）」だけであり、それは API
--   (/api/mypage/transfer-usage) が service role で計算して返す。
--   よって以下2テーブルは **portal に grant しない**（＝デフォルト拒否のまま）。
--   これは「見せないものは最初から開けない」という Stage1 の安全側設計の踏襲。
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- portal_transfer_permissions: その生徒のその月の振替上限を extra_count 回ぶん上乗せする。
--
--   意味: 「上限に達したが、事情があるので今月あと1回だけ振替を認める」という
--         教室の明示許可。この行が無い限り保護者は上限でハードストップする（§7-3）。
--         上限判定は limit（＝有効な通塾日程パターン数）＋ extra_count で評価する。
--
--   ★ month の型を date にした理由（text 'YYYY-MM' ではなく）:
--     - date なら「その月の1日」という正規形を CHECK で強制でき、'2026-7' /
--       '2026-07' / '202607' のような表記ゆれが構造的に発生しない。
--     - 期間比較・ソート・索引が素直（text だと辞書順に頼ることになる）。
--     - アプリ側は対象授業日から date_trunc('month') 相当（'YYYY-MM-01'）を作って渡す。
--     不変条件: month は必ずその月の初日（下の CHECK で強制）。
-- ------------------------------------------------------------
create table if not exists public.portal_transfer_permissions (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  -- 対象月。必ず月初日（例: 2026-07-01）。CHECK で正規形を強制する。
  month       date not null,
  -- 上乗せする振替回数（既定1回）。
  extra_count int  not null default 1 check (extra_count > 0),
  granted_by  uuid references public.user_profiles(id),
  note        text,
  created_at  timestamptz not null default now(),
  -- 生徒×月で1行（同じ月に複数許可を積むのではなく extra_count を増やす運用）。
  constraint portal_transfer_permissions_student_month_uniq unique (student_id, month),
  -- month は必ず月初日（表記ゆれ・月途中日付の混入を DB で防ぐ）。
  constraint portal_transfer_permissions_month_is_first_day
    check (month = date_trunc('month', month)::date)
);

comment on table public.portal_transfer_permissions is
  'その生徒のその月の振替上限に extra_count 回ぶん上乗せする教室の明示許可（§7-3）。month は必ず月初日。';
comment on column public.portal_transfer_permissions.month is
  '対象月（必ず月初日 YYYY-MM-01）。判定対象は「対象授業日の月」であって今日の月ではない。';
comment on column public.portal_transfer_permissions.extra_count is
  '上限への上乗せ回数。effectiveLimit = 通塾日程パターン数 + extra_count。';

-- 判定クエリ（生徒×月）の索引。unique 制約で兼ねられるが school 一覧用に別途持つ。
create index if not exists idx_portal_transfer_permissions_school_month
  on public.portal_transfer_permissions (school_id, month);

-- ------------------------------------------------------------
-- transfer_free_periods: 振替無制限期間（講習前フリー期間）。
--
--   意味: 対象授業日がこの期間内なら **上限判定そのものをスキップ**する（§7-3）。
--         「7/22〜8/9 は振替制限なし」のような教室運用を表す。
--         判定は「対象授業日」が [start_date, end_date] に含まれるか（今日ではない）。
-- ------------------------------------------------------------
create table if not exists public.transfer_free_periods (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  start_date date not null,
  end_date   date not null,
  -- 保護者にも見せる短い説明（例: '夏期講習前フリー期間'）。
  label      text,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now(),
  -- 逆転した期間（終了 < 開始）を DB で禁止する。
  constraint transfer_free_periods_range_valid check (start_date <= end_date)
);

comment on table public.transfer_free_periods is
  '振替無制限期間（講習前フリー期間）。対象授業日がこの期間内なら振替上限判定をスキップする（§7-3）。';
comment on column public.transfer_free_periods.label is
  'ポータルの注記に出す短い説明（例: 夏期講習前フリー期間）。';

-- 「この教室・この日付を含む期間」の判定を高速化する。
create index if not exists idx_transfer_free_periods_school_range
  on public.transfer_free_periods (school_id, start_date, end_date);

-- ------------------------------------------------------------
-- 権限（GRANT）
--   ★ portal には一切与えない（上のコメントの通り、保護者は判定結果だけを API で受け取る）。
--   service_role: 全操作（ポータル API の判定・スタッフ API の付与/取消）。
--   authenticated（スタッフ）: 教室スコープで CRUD（下の RLS で自校のみに絞る）。
-- ------------------------------------------------------------
grant all on public.portal_transfer_permissions to service_role;
grant all on public.transfer_free_periods to service_role;

grant select, insert, update, delete on public.portal_transfer_permissions to authenticated;
grant select, insert, update, delete on public.transfer_free_periods to authenticated;

-- ------------------------------------------------------------
-- RLS
--   スタッフ側は既存流儀（check_school_access(school_id) で自校スコープ・
--   schedule_pending_lessons / student_subject_contracts と同型）に合わせる。
--   portal 向けポリシーは作らない = portal からはデフォルト拒否のまま。
-- ------------------------------------------------------------
alter table public.portal_transfer_permissions enable row level security;
alter table public.transfer_free_periods enable row level security;

drop policy if exists "portal_transfer_permissions_school_scope_auth"
  on public.portal_transfer_permissions;
create policy "portal_transfer_permissions_school_scope_auth"
  on public.portal_transfer_permissions for all to authenticated
  using (public.check_school_access(school_id))
  with check (public.check_school_access(school_id));

drop policy if exists "transfer_free_periods_school_scope_auth"
  on public.transfer_free_periods;
create policy "transfer_free_periods_school_scope_auth"
  on public.transfer_free_periods for all to authenticated
  using (public.check_school_access(school_id))
  with check (public.check_school_access(school_id));


-- ============================================================
-- 2) 予定ビューのための portal 可視化
-- ============================================================

-- ------------------------------------------------------------
-- schedule_entries: 自分の紐づけ生徒の予定だけ見せる。
--
--   ★ 失効条件を「students の portal ポリシーに任せず」この述語自体に持つ理由:
--     RLS ポリシーの述語内で参照する別テーブルには、原則としてそのテーブルの RLS が
--     効かない（ポリシー述語は所有者権限で評価される）。よって
--     「students が RLS で見えないから schedule_entries も自動で消える」とは限らない。
--     ここで EXISTS を students まで辿り、Stage1 と同じ失効条件
--       (withdrawal_date is null or withdrawal_date >= current_date)
--     を明示的に書くことで、退塾超過の生徒の予定が漏れないことを述語自身が担保する
--     （多層防御。Stage1 の書き方に倣う）。
--
--   ※ inquiry_id 側（体験の見込み客）の行は student_id が NULL なので、この EXISTS では
--     常に偽 = ポータルには一切見えない（意図した挙動）。
-- ------------------------------------------------------------
grant select on public.schedule_entries to portal;

alter table public.schedule_entries enable row level security;

drop policy if exists "portal_schedule_entries_select_linked" on public.schedule_entries;
create policy "portal_schedule_entries_select_linked" on public.schedule_entries
  for select to portal
  using (
    exists (
      select 1
      from public.portal_account_students pas
      join public.students s on s.id = pas.student_id
      where pas.account_id = public.portal_uid()
        and pas.student_id = schedule_entries.student_id
        -- Stage1 の students ポリシーと同じ失効条件を、この述語自身にも持たせる。
        and (s.withdrawal_date is null or s.withdrawal_date >= current_date)
    )
  );

-- ------------------------------------------------------------
-- schedule_time_slots（時限マスタ）: 自分の紐づけ生徒の所属校の時限だけ見せる。
--   予定の「17:00〜18:30」表示に必要。他教室の時限構成は見せない。
-- ------------------------------------------------------------
grant select on public.schedule_time_slots to portal;

alter table public.schedule_time_slots enable row level security;

drop policy if exists "portal_schedule_time_slots_select_linked" on public.schedule_time_slots;
create policy "portal_schedule_time_slots_select_linked" on public.schedule_time_slots
  for select to portal
  using (
    exists (
      select 1
      from public.portal_account_students pas
      join public.students s on s.id = pas.student_id
      where pas.account_id = public.portal_uid()
        and s.school_id = schedule_time_slots.school_id
        and (s.withdrawal_date is null or s.withdrawal_date >= current_date)
    )
  );

-- ------------------------------------------------------------
-- subjects（教科マスタ）: portal に using(true) で開放する。
--   教科名（英語・数学…）は機微情報ではなく、教室横断で共通のマスタなので
--   絞る意味がない。予定の科目表示に必要。
--   ★ 既存の subjects_allow_all_auth（to authenticated・ALL using(true)）には触らない。
--     ロールが違うので両ポリシーは干渉しない（portal は SELECT のみ・書き込み権限なし）。
-- ------------------------------------------------------------
grant select on public.subjects to portal;

drop policy if exists "portal_subjects_select_all" on public.subjects;
create policy "portal_subjects_select_all" on public.subjects
  for select to portal
  using (true);

-- ------------------------------------------------------------
-- 講師名の限定公開ビュー: portal_teacher_names
--
--   ★ なぜ user_profiles を直接 portal に開けず view にするのか:
--     user_profiles には email / role / employee_no / gender / teachable_subject_ids /
--     available_* など、保護者に見せてはいけないスタッフの PII・内部属性が同居している。
--     「列の一部だけ」を RLS で隠すことはできない（RLS は行の制御であって列の制御ではない）。
--     列を絞る手段は view（または column-level grant）しかない。
--     そこで「予定表示に必要な id と display_name だけ」を持つ narrow view を作り、
--     portal にはこのビューだけを grant する。user_profiles 本体は portal から
--     デフォルト拒否のまま（grant しない）。
--
--   ★ security_invoker を付けない理由（＝意図した definer 相当の限定公開）:
--     security_invoker=on にすると呼び出しロール(portal)の権限で下層 user_profiles を
--     読むため、user_profiles に portal の grant/ポリシーが必要になってしまい、
--     「本体は開けない」という目的が達成できない。付けない（既定 off）ことで、ビューは
--     所有者権限で user_profiles を読み、portal には view の2列だけが露出する。
--     これがこのビューの設計目的そのもの（列の限定公開）。
--
--   is_active=true に絞るのは、退職済みスタッフ名を出さないため。
--
--   ★ 教室スコープが必須な理由（2026-07-14 レビューで是正）:
--     ビューは所有者権限で評価されるため、条件を書かないと「紐づけを1件も持たない
--     ポータルアカウントからでも、全教室の全スタッフ（オーナー・システム管理者を含む）
--     の氏名を列挙できる」状態になる（実機で再現確認済み）。ビュー自体には RLS を
--     掛けられないので、**絞り込みはビューの述語に持たせるしかない**。
--     そこで「自分の紐づけ生徒が在籍している教室に所属するスタッフ」だけに限定する。
--     ビューの述語は問い合わせ時に評価されるため portal_uid() がそのまま使える。
--     （自校の室長名は保護者に見えてよい＝チャットの相手なので、role では絞らない。）
-- ------------------------------------------------------------
create or replace view public.portal_teacher_names as
  select up.id, up.display_name
  from public.user_profiles up
  where up.is_active = true
    and exists (
      select 1
      from public.user_schools us
      join public.portal_account_students pas on pas.account_id = public.portal_uid()
      join public.students s on s.id = pas.student_id
      where us.user_id = up.id
        and us.school_id = s.school_id
        -- 退塾超過の生徒しか紐づいていないなら、その教室のスタッフ名も出さない。
        and (s.withdrawal_date is null or s.withdrawal_date >= current_date)
    );

comment on view public.portal_teacher_names is
  '予定表示用の講師名の限定公開ビュー（id/display_name のみ・自分の紐づけ生徒の在籍校に所属するスタッフに限定）。user_profiles 本体は PII を含むため portal に開けない。security_invoker は意図的に付けない（列の限定公開が目的）。';

grant select on public.portal_teacher_names to portal;
