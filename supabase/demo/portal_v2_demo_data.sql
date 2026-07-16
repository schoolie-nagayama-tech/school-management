-- ============================================================================
-- 保護者ポータル v2 デモデータ（本番に「デモ」として置くためのダミー一式）
-- ============================================================================
--
-- ■ 何のためのファイルか
--   保護者ポータルv2（/mypage）を教室長が実際に触って評価できるようにするため、
--   「全画面が中身入りで見える」ダミーデータ一式を投入する。
--   空の画面では評価にならないので、6画面（マイページ/予定/報告書/お知らせ/
--   連絡/手続き）すべてに表示されるデータを作る。
--
-- ■ 業務データからの二重隔離（設計判断済み・変更しないこと）
--   このデータは本番DBに入るが、既存の2つの仕組みで業務から二重に隔離される:
--     1. デモ教室  schools.is_demo = true
--        → 教室ドロップダウン・cron集計等から既に除外される
--     2. デモ生徒  students.is_test = true
--        → 講習進捗・回答率等の業務集計から既に除外される（src/lib/api/students.ts 等）
--   さらにポータルのRLSは「自分に紐づいた在籍生徒」しか見せないため、デモアカウントは
--   実データに構造的に到達できない。
--
-- ■ 冪等性
--   完全に冪等。何度流しても行数は増えず、同じ結果になる。
--   - マスタ系は on conflict (id) do update / where not exists
--   - 予定・報告書は「デモ生徒ぶんを delete してから再生成」（後述）
--   ★ 予定の日付は current_date からの相対で作る。時間が経つと画面が空になるので、
--     デモが古びたらこのファイルを再実行すれば「今日」を基準に作り直される。
--
-- ■ 実行方法
--   psql "<接続文字列>" -f supabase/demo/portal_v2_demo_data.sql
--   前提: portal v2 のマイグレーション4本
--         （20260714000000 / 20260714010000 / 20260714020000 / 20260715000000）
--         と 20260716000000_schools_meeting_booking_url
--         が適用済みであること。未適用だと audience 列や portal_* テーブル、
--         schools.meeting_booking_url が無く失敗する。
--
-- ■ 削除方法（デモを撤去するとき）
--   デモ教室に全てがぶら下がっているので、以下で消える（実データには触れない）:
--     delete from public.portal_accounts        where id = 'd0000000-0000-4000-8000-000000000031';
--     delete from public.students               where school_id = 'd0000000-0000-4000-8000-000000000001';
--     delete from public.bulletin_posts         where school_id = 'd0000000-0000-4000-8000-000000000001';
--     delete from public.form_periods           where school_id = 'd0000000-0000-4000-8000-000000000001';
--     delete from public.schedule_time_slots    where school_id = 'd0000000-0000-4000-8000-000000000001';
--     delete from public.user_schools           where school_id = 'd0000000-0000-4000-8000-000000000001';
--     delete from public.user_profiles          where id in ('d0000000-0000-4000-8000-000000000011','d0000000-0000-4000-8000-000000000012');
--     delete from auth.users                    where id in ('d0000000-0000-4000-8000-000000000011','d0000000-0000-4000-8000-000000000012');
--     delete from public.textbooks              where name like 'デモ教材%';
--     delete from public.schools                where id = 'd0000000-0000-4000-8000-000000000001';
--   ※ subjects（教科マスタ）は本番の既存行を再利用するだけなので消さないこと。
--
-- ■ UUID 規則
--   すべて d0000000-0000-4000-8000-0000000000xx（先頭 d = demo）。
--   一目でデモ行だと分かるようにしてある。実データのUUIDと衝突しない。
--
-- ============================================================================

begin;

-- ============================================================================
-- 1) デモ教室
-- ============================================================================
--   is_demo=true により教室ドロップダウン・各種集計から既に除外される。
--   ★ 既存の「デフォルト教室」(is_demo=true) は使わない。素性不明のデータ
--     （在籍8名）が混ざっており、デモとして見せる内容を制御できないため新設する。
--   code='demo' は手続きハブのリンク先 /portal/demo/<form_type> の組み立てに使われる
--   （formGuidance.buildFormHref が students → schools.code を引く）。
--
--   meeting_booking_url: 面談希望の自動返信に載る予約URL（chatTemplates.buildAckBody）。
--     ★ 実在しないダミーURLにすること。実物の予約ページを入れると、デモを触った
--       教室長が本物の枠を押さえてしまう。
-- ----------------------------------------------------------------------------
insert into public.schools (id, name, code, is_demo, meeting_booking_url)
values ('d0000000-0000-4000-8000-000000000001', 'デモ校（保護者ポータル体験）', 'demo', true,
        'https://calendar.app.google/demo-booking-example')
on conflict (id) do update
  set name = excluded.name,
      code = excluded.code,
      is_demo = excluded.is_demo,
      meeting_booking_url = excluded.meeting_booking_url;


-- ============================================================================
-- 2) デモ講師
-- ============================================================================
--   ★ auth.users の行が必須（当初「user_profiles に auth.users へのFKは無い」と
--     想定していたが、実際には base_schema に
--       user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
--     が存在する ＝ 本番にも存在する）。よって auth ユーザー無しでは講師を作れない。
--     講師は portal_teacher_names ビュー（予定・報告書の講師名表示）に必要なので省けない。
--
--   ★ このデモ auth ユーザーでログインされない三重の鍵:
--     (a) encrypted_password = ランダム文字列の bcrypt（誰も知らない＝一致しない）
--     (b) auth.identities の行を作らない（GoTrue のパスワードログインは identity を
--         引けないと成立しない。seed.sql が identity を作っているのと対照的）
--     (c) banned_until を遠い未来に設定（GoTrue が banned ユーザーを拒否する）
--     万一 (a)(b) をすり抜けても、この講師は user_schools でデモ校にしか紐づかないため
--     実教室のデータには check_school_access で到達できない。
--
--   ★★ auth.users に入れる値の罠（実機のGoTrueログで確定。本番を壊すので厳守）★★
--     (1) banned_until に 'infinity' を入れてはいけない。
--         Postgres は infinity を受け付けるが、GoTrue(Go) のドライバが time.Time へ
--         変換できず落ちる:
--           Scan error on column "banned_until": storing driver.Value type string
--           into type *time.Time  → GET /admin/users が 500
--         これは auth.admin.listUsers() を使う **本番のユーザー管理画面(/users) が
--         500 になる** ということ。よって「具体的な遠い未来の日時」を入れる。
--     (2) confirmation_token / recovery_token / email_change / email_change_token_new は
--         NULL にしてはいけない（NOT NULL 制約は無いが GoTrue は string で受ける）:
--           Scan error on column "confirmation_token": converting NULL to string
--           is unsupported  → POST /token が 500（"Database error querying schema"）
--         空文字 '' を明示的に入れる。※同じ罠を supabase/seed.sql も踏んでいた。
-- ----------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, banned_until,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  raw_app_meta_data, raw_user_meta_data
)
select
  '00000000-0000-0000-0000-000000000000',
  v.id::uuid,
  'authenticated', 'authenticated', v.email,
  -- 誰も知らないランダム値の bcrypt ＝ 事実上ログイン不可能なパスワード。
  crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf')),
  now(), now(), now(),
  -- 念押しの遮断。GoTrue は banned_until が未来のユーザーの認証を拒否する。
  -- ★ 'infinity' は使わない（上記の罠(1)。listUsers が 500 になる）。
  '2999-12-31 00:00:00+00'::timestamptz,
  -- ★ NULL 禁止（上記の罠(2)。ログインAPIが 500 になる）。
  '', '', '', '',
  '{"provider":"email","providers":["email"]}', '{}'
from (values
  ('d0000000-0000-4000-8000-000000000011', 'demo-teacher-1@demo.invalid'),
  ('d0000000-0000-4000-8000-000000000012', 'demo-teacher-2@demo.invalid')
) as v(id, email)
on conflict (id) do update
  -- 既存行があっても遮断状態を必ず上書きする（過去に緩い値で作られていても是正する）。
  set banned_until = '2999-12-31 00:00:00+00'::timestamptz,
      encrypted_password = crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf')),
      -- 過去に NULL で作られていた場合の是正（GoTrue の 500 を防ぐ）。
      confirmation_token = coalesce(auth.users.confirmation_token, ''),
      recovery_token = coalesce(auth.users.recovery_token, ''),
      email_change = coalesce(auth.users.email_change, ''),
      email_change_token_new = coalesce(auth.users.email_change_token_new, '');

-- ★ auth.identities は意図的に作らない（上記 (b)）。作るとパスワードログインの
--   経路が開いてしまう。ここに identity を足さないこと。

-- ★ display_name に「先生」を入れないこと（実機で確認したUIの前提）:
--   ポータルUIは講師名を必ず `{display_name}先生` の形で描画する
--   （ScheduleView.tsx / ReportsView.tsx / reports/[reportId]/page.tsx / AbsenceSheet.tsx）。
--   display_name を「デモ 先生」にすると画面に「デモ 先生先生」と出る。
--   よって姓名だけを入れ、「デモ」を姓にしてダミーだと分かるようにする（→「デモ 山田先生」）。
insert into public.user_profiles (id, email, display_name, last_name, first_name, role, is_active)
values
  ('d0000000-0000-4000-8000-000000000011', 'demo-teacher-1@demo.invalid', 'デモ 山田', 'デモ', '山田', 'teacher', true),
  ('d0000000-0000-4000-8000-000000000012', 'demo-teacher-2@demo.invalid', 'デモ 佐藤', 'デモ', '佐藤', 'teacher', true)
on conflict (id) do update
  set display_name = excluded.display_name,
      last_name = excluded.last_name,
      first_name = excluded.first_name,
      role = excluded.role,
      -- is_active=true は portal_teacher_names ビューの述語（退職者を出さない）を満たすため必須。
      is_active = true;

-- portal_teacher_names ビューは「紐づけ生徒の在籍校に所属するスタッフ」に限定するため、
-- user_schools の行が無いと講師名が一切解決できない（予定・報告書が「講師名なし」になる）。
insert into public.user_schools (id, user_id, school_id)
values
  ('d0000000-0000-4000-8000-000000000013', 'd0000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000014', 'd0000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000001')
on conflict (id) do update
  set user_id = excluded.user_id,
      school_id = excluded.school_id;


-- ----------------------------------------------------------------------------
-- 2-b) 教室長以上をデモ校の担当に加える（スタッフ側もデモを触れるようにする）
-- ----------------------------------------------------------------------------
--   ★ なぜ必要か:
--     スタッフの受信箱 /admin/portal-chat は auth.schoolIds（＝user_schools）で絞る
--     （src/app/api/admin/portal-chat/threads/route.ts）。デモ校の担当でないと
--     保護者からのデモ連絡が1件も見えず、「保護者が送る→教室が返す」という
--     ポータルの核心（双方向）を体験できない。
--
--   ★ なぜ安全か（2026-07-15 本番実測にもとづく判断）:
--     教室長以上11名のうち8名は既に is_demo=true の「デフォルト教室」の担当に
--     入っている。よってデモ校を足すのは今と同じ性質の変更で、業務動線は変わらない。
--     加えて二重の隔離が効く: デモ校は is_demo=true で教室ドロップダウンから除外され、
--     デモ生徒は is_test=true で業務集計（講習進捗・回答率・cron集計等）から除外される。
--
--   ★ 使い方（重要）:
--     is_demo の教室はドロップダウンに出ないので個別選択はできない。受信箱を見るには
--     教室切替を「すべての教室」にする（API は school_id 未指定なら自分の全スコープを
--     返すため、デモ校のスレッドが含まれる）。
--
--   ★ 対象は manager 以上だけ。講師（72名）には広げない（デモの対象外）。
--   ★ 冪等: UNIQUE(user_id, school_id) があるので do nothing で足りる。
--     既存の担当は一切変更しない（追加のみ）。
insert into public.user_schools (id, user_id, school_id)
select gen_random_uuid(), up.id, 'd0000000-0000-4000-8000-000000000001'
from public.user_profiles up
where up.is_active
  and up.role in ('manager', 'admin', 'owner')
on conflict (user_id, school_id) do nothing;


-- ============================================================================
-- 3) デモ生徒 2名
-- ============================================================================
--   is_test=true で業務集計から除外。status='active' / withdrawal_date is null は
--   ポータルRLSの在籍条件（withdrawal_date is null or >= current_date）を満たすため必須。
--   明らかにダミーと分かる氏名にする。
-- ----------------------------------------------------------------------------
insert into public.students (
  id, school_id, student_code, last_name, first_name, last_name_kana, first_name_kana,
  grade, status, withdrawal_date, is_test, school_name, class_name
)
values
  ('d0000000-0000-4000-8000-000000000021', 'd0000000-0000-4000-8000-000000000001',
   'DEMO001', '体験', '太郎', 'タイケン', 'タロウ', 8, 'active', null, true, 'デモ中学校', '2年A組'),
  ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000001',
   'DEMO002', '体験', '花子', 'タイケン', 'ハナコ', 6, 'active', null, true, 'デモ小学校', '6年1組')
on conflict (id) do update
  set school_id = excluded.school_id,
      student_code = excluded.student_code,
      last_name = excluded.last_name,
      first_name = excluded.first_name,
      grade = excluded.grade,
      status = 'active',
      withdrawal_date = null,
      -- 業務集計からの除外は is_test が担保する。再実行で必ず true に戻す。
      is_test = true;


-- ============================================================================
-- 4) ポータルアカウント（デモ保護者）＋ 紐づけ
-- ============================================================================
--   ★ パスワードを「使えない値」にする理由:
--     デモは **スタッフ認証を通した専用セッション発行** でのみ入る設計であり、
--     ログインフォーム（/mypage/login）経由では入らせない。
--     将来 portal_v2_enabled を ON にしたときに、'demo-parent' が弱いパスワードの
--     公開ログイン口として残っている事故を防ぐ。
--     よって password_hash には「誰も知らないランダム文字列の bcrypt」を入れる。
--     ＝ 正しいパスワードが存在しないので、ログインフォームからは絶対に入れない。
--
--   ★ 再実行のたびにハッシュ値は変わるが、観測される結果（誰もログインできない）は
--     常に同じ＝冪等。むしろ過去に弱い値で作られていた場合に毎回是正できる。
-- ----------------------------------------------------------------------------
insert into public.portal_accounts (id, login_id, password_hash, display_name)
values (
  'd0000000-0000-4000-8000-000000000031',
  'demo-parent',
  crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf')),
  'デモ保護者'
)
on conflict (id) do update
  set login_id = excluded.login_id,
      display_name = excluded.display_name,
      password_hash = excluded.password_hash;

-- 紐づけ。★ デモ生徒以外には絶対に紐づけないこと（実データへの到達経路になる）。
insert into public.portal_account_students (account_id, student_id, relation)
values
  ('d0000000-0000-4000-8000-000000000031', 'd0000000-0000-4000-8000-000000000021', 'mother'),
  ('d0000000-0000-4000-8000-000000000031', 'd0000000-0000-4000-8000-000000000022', 'mother')
on conflict (account_id, student_id) do update
  set relation = excluded.relation;


-- ============================================================================
-- 5) 時限（schedule_time_slots）
-- ============================================================================
--   予定の「17:00〜18:30」表示に必要（portal_schedule_time_slots_select_linked で
--   自校ぶんだけ可視）。slot_number は 1..7 の CHECK があるので範囲内にする。
-- ----------------------------------------------------------------------------
insert into public.schedule_time_slots (id, school_id, slot_number, start_time, end_time, is_active, display_order, formation)
values
  ('d0000000-0000-4000-8000-000000000041', 'd0000000-0000-4000-8000-000000000001', 3, '13:30', '15:00', true, 3, 'individual'),
  ('d0000000-0000-4000-8000-000000000042', 'd0000000-0000-4000-8000-000000000001', 4, '15:10', '16:40', true, 4, 'individual'),
  ('d0000000-0000-4000-8000-000000000043', 'd0000000-0000-4000-8000-000000000001', 5, '17:00', '18:30', true, 5, 'individual'),
  ('d0000000-0000-4000-8000-000000000044', 'd0000000-0000-4000-8000-000000000001', 6, '18:40', '20:10', true, 6, 'individual')
on conflict (id) do update
  set slot_number = excluded.slot_number,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      is_active = true,
      display_order = excluded.display_order,
      formation = excluded.formation;


-- ============================================================================
-- 6) 教科（subjects）
-- ============================================================================
--   ★ subjects は school_id を持たない全教室共通マスタ。
--     本番には既に「数学/英語/算数/国語」があるはずなので、**存在すれば再利用**し、
--     無いときだけ作る（＝本番のマスタを汚さない）。ローカル検証DBは subjects が
--     空なのでここで作られる。
--   ★ 重複を避けるため name + grade_category で判定する（同名でも学年区分が違えば別行）。
-- ----------------------------------------------------------------------------
insert into public.subjects (name, grade_category, sort_order)
select v.name, v.gc, v.so
from (values
  ('英語', 'middle', 10),
  ('数学', 'middle', 20),
  ('国語', 'elementary', 10),
  ('算数', 'elementary', 20)
) as v(name, gc, so)
where not exists (
  select 1 from public.subjects s
  where s.name = v.name and s.grade_category = v.gc
);


-- ============================================================================
-- 7) 通塾日程パターン（schedule_regular_patterns）
-- ============================================================================
--   予定画面が呼ぶ /api/mypage/transfer-usage の「今月の残り振替回数」は
--   **有効な通塾日程パターン数** を上限として計算する（transferQuota.ts）。
--   これが0件だと残り0回と出て注記が不自然になるため、週2回ぶんを作る。
--   day_of_week: 0=日 .. 6=土
-- ----------------------------------------------------------------------------
insert into public.schedule_regular_patterns (
  id, school_id, student_id, day_of_week, time_slot_id, teacher_id, subject_ids,
  seat_label, period_type, is_active, effective_from, formation, ratio, duration_minutes
)
values
  -- 体験 太郎（中2）: 月=数学 / 水=英語 / 金=数学、18:40〜20:10（週3回）
  ('d0000000-0000-4000-8000-000000000051', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000021', 1, 'd0000000-0000-4000-8000-000000000044',
   'd0000000-0000-4000-8000-000000000011',
   array[(select id from public.subjects where name = '数学' and grade_category = 'middle' order by sort_order limit 1)],
   'A-1', 'regular', true, current_date - 90, 'individual', 2, 90),
  ('d0000000-0000-4000-8000-000000000052', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000021', 3, 'd0000000-0000-4000-8000-000000000044',
   'd0000000-0000-4000-8000-000000000011',
   array[(select id from public.subjects where name = '英語' and grade_category = 'middle' order by sort_order limit 1)],
   'A-1', 'regular', true, current_date - 90, 'individual', 2, 90),
  ('d0000000-0000-4000-8000-000000000055', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000021', 5, 'd0000000-0000-4000-8000-000000000044',
   'd0000000-0000-4000-8000-000000000011',
   array[(select id from public.subjects where name = '数学' and grade_category = 'middle' order by sort_order limit 1)],
   'A-1', 'regular', true, current_date - 90, 'individual', 2, 90),
  -- 体験 花子（小6）: 火=算数 / 木=国語、17:00〜18:30
  ('d0000000-0000-4000-8000-000000000053', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000022', 2, 'd0000000-0000-4000-8000-000000000043',
   'd0000000-0000-4000-8000-000000000012',
   array[(select id from public.subjects where name = '算数' and grade_category = 'elementary' order by sort_order limit 1)],
   'B-2', 'regular', true, current_date - 90, 'individual', 2, 90),
  ('d0000000-0000-4000-8000-000000000054', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000022', 4, 'd0000000-0000-4000-8000-000000000043',
   'd0000000-0000-4000-8000-000000000012',
   array[(select id from public.subjects where name = '国語' and grade_category = 'elementary' order by sort_order limit 1)],
   'B-2', 'regular', true, current_date - 90, 'individual', 2, 90)
on conflict (id) do update
  set day_of_week = excluded.day_of_week,
      time_slot_id = excluded.time_slot_id,
      teacher_id = excluded.teacher_id,
      subject_ids = excluded.subject_ids,
      is_active = true,
      effective_from = excluded.effective_from;


-- ============================================================================
-- 8) 予定（schedule_entries）: 過去3週間＋未来2週間
-- ============================================================================
--   ★ delete → 再生成にする理由:
--     日付を current_date からの相対で作るため、日をまたいで再実行すると
--     「前回ぶんの古い予定」が残って窓の外に溜まっていく。デモ生徒に限定して
--     全消ししてから作り直すのが最も単純で、常に同じ結果になる（＝冪等）。
--   ★ この delete は class_reports へ CASCADE する
--     （class_reports_schedule_entry_id_fkey ON DELETE CASCADE）。
--     報告書は §10 で作り直すので問題ない。順序を入れ替えないこと。
--   ★ 対象は必ずデモ生徒2名の id に限定する（school_id 条件だけに頼らない）。
-- ----------------------------------------------------------------------------
delete from public.schedule_entries
where student_id in (
  'd0000000-0000-4000-8000-000000000021',
  'd0000000-0000-4000-8000-000000000022'
);

insert into public.schedule_entries (
  id, school_id, entry_date, time_slot_id, teacher_id, student_id,
  subject_ids, seat_label, status, attendance_status, kind, formation, ratio, duration_minutes
)
select
  gen_random_uuid(),
  'd0000000-0000-4000-8000-000000000001',
  p.d,
  p.time_slot_id,
  p.teacher_id,
  p.student_id,
  array[p.subject_id],
  p.seat_label,
  -- 過去は実施済み、未来は予定。
  case when p.d < current_date then 'completed' else 'scheduled' end,
  -- 過去のみ出席を記録する（未来に出欠は付かない）。
  case when p.d < current_date then 'present' else null end,
  'regular',
  'individual',
  2,
  90
from (
  select
    g.d::date as d,
    case
      when extract(dow from g.d) in (1, 3, 5) then 'd0000000-0000-4000-8000-000000000021'::uuid
      else 'd0000000-0000-4000-8000-000000000022'::uuid
    end as student_id,
    case
      when extract(dow from g.d) in (1, 3, 5) then 'd0000000-0000-4000-8000-000000000044'::uuid
      else 'd0000000-0000-4000-8000-000000000043'::uuid
    end as time_slot_id,
    case
      when extract(dow from g.d) in (1, 3, 5) then 'd0000000-0000-4000-8000-000000000011'::uuid
      else 'd0000000-0000-4000-8000-000000000012'::uuid
    end as teacher_id,
    case
      when extract(dow from g.d) in (1, 3, 5) then 'A-1'
      else 'B-2'
    end as seat_label,
    case extract(dow from g.d)
      when 1 then (select id from public.subjects where name = '数学' and grade_category = 'middle' order by sort_order limit 1)
      when 3 then (select id from public.subjects where name = '英語' and grade_category = 'middle' order by sort_order limit 1)
      when 5 then (select id from public.subjects where name = '数学' and grade_category = 'middle' order by sort_order limit 1)
      when 2 then (select id from public.subjects where name = '算数' and grade_category = 'elementary' order by sort_order limit 1)
      when 4 then (select id from public.subjects where name = '国語' and grade_category = 'elementary' order by sort_order limit 1)
    end as subject_id
  from generate_series(current_date - 21, current_date + 14, interval '1 day') g(d)
  -- 月(1)・水(3)・金(5)＝太郎（週3回） / 火(2)・木(4)＝花子（週2回）。土日はコマ無し。
  -- ★ 太郎を週3回にしている理由: 予定画面は「今週」を初期表示する。週2回だと
  --   曜日の巡り合わせによっては今週に未来コマが1つも無く、下の「振替」バッジが
  --   今週に出ない（＝デモで見えない）。週3回にして遭遇率を上げている。
  where extract(dow from g.d) in (1, 2, 3, 4, 5)
) p
on conflict do nothing;

-- ── 表示バリエーション（バッジの見え方を確認できるようにする）──
--   ScheduleView は status=transferred_in を「振替」、status=cancelled を「休講」
--   （打ち消し表示）としてバッジ化する。両方が1件も無いと確認できないので作る。

-- ★ offset を使わず「直近の未来コマ」(offset 0)を選ぶ理由:
--   予定画面は「今週」を初期表示する。offset 1 にすると1回ぶん先の週に飛びやすく、
--   今週の画面にバッジが出ない（実機で確認済み: 水曜に流したら振替が翌週月曜に付いた）。
--   直近の未来コマなら今週内に収まる可能性が最も高い。

-- 太郎の直近の未来コマを「振替」にする。
update public.schedule_entries
set status = 'transferred_in'
where id = (
  select id from public.schedule_entries
  where student_id = 'd0000000-0000-4000-8000-000000000021'
    and entry_date > current_date
  order by entry_date
  limit 1
);

-- 花子の直近の未来コマを「休講」にする。
update public.schedule_entries
set status = 'cancelled'
where id = (
  select id from public.schedule_entries
  where student_id = 'd0000000-0000-4000-8000-000000000022'
    and entry_date > current_date
  order by entry_date
  limit 1
);


-- ============================================================================
-- 9) 教材・単元・所持教材
-- ============================================================================
--   portal_lesson_report_units ビューは
--     lesson_report_units → student_textbooks → textbooks（教材名）
--     lesson_report_units.curriculum_item_ids → curriculum_items（単元名）
--   を辿って「名前」を解決する。ここが無いと報告書詳細の「学習内容」が空になる。
--
--   ★ textbooks は school_id を持たない全教室共通マスタなので、デモ教材が
--     講師の教材ピッカーに出てこないよう is_active=false にする
--     （getTextbooks は既定で is_active=true だけを返す＝ピッカーから隠れる）。
--     ビューは is_active を見ないので、報告書の教材名は問題なく解決される。
--
--   ★ textbooks / curriculum_items は integer のシーケンスPK。固定IDをハードコード
--     すると本番のシーケンスと衝突する（採番が進まず、後続の実データ登録が失敗する）。
--     よってIDは採番に任せ、name で存在判定・name で引き直す。
-- ----------------------------------------------------------------------------
insert into public.textbooks (name, publisher, school_type, grade, subject, grade_category, is_active)
select v.name, v.publisher, v.school_type, v.grade, v.subject, v.gc, false
from (values
  ('デモ教材 中2数学ワーク（保護者ポータル体験用）', 'デモ出版', '中学', '中2', '数学', 'middle'),
  ('デモ教材 中2英単語トレーニング（保護者ポータル体験用）', 'デモ出版', '中学', '中2', '英語', 'middle'),
  ('デモ教材 小6算数ドリル（保護者ポータル体験用）', 'デモ出版', '小学', '小6', '算数', 'elementary')
) as v(name, publisher, school_type, grade, subject, gc)
where not exists (select 1 from public.textbooks t where t.name = v.name);

-- 単元（報告書詳細の「学習内容」に単元名として出る）。
insert into public.curriculum_items (textbook_id, sort_order, item_number, title)
select t.id, v.so, v.num, v.title
from (values
  ('デモ教材 中2数学ワーク（保護者ポータル体験用）', 10, '3-1', '一次関数とグラフ'),
  ('デモ教材 中2数学ワーク（保護者ポータル体験用）', 20, '3-2', '一次関数の変化の割合'),
  ('デモ教材 中2数学ワーク（保護者ポータル体験用）', 30, '3-3', '一次関数の利用'),
  ('デモ教材 中2英単語トレーニング（保護者ポータル体験用）', 10, 'U5', 'Unit 5 動名詞'),
  ('デモ教材 小6算数ドリル（保護者ポータル体験用）', 10, '4-1', '分数のかけ算'),
  ('デモ教材 小6算数ドリル（保護者ポータル体験用）', 20, '4-2', '分数のわり算')
) as v(tb_name, so, num, title)
join public.textbooks t on t.name = v.tb_name
where not exists (
  select 1 from public.curriculum_items c
  where c.textbook_id = t.id and c.title = v.title
);

-- 所持教材（student_textbooks）。
--   ★ student_textbooks.school_id は「生徒所属校と一致」がDBトリガーで強制される不変条件
--     （MEMORY: student_textbooks_school_id_invariant）。デモ校を明示的に入れる。
insert into public.student_textbooks (id, school_id, student_id, textbook_id, is_active, sort_order, track_progress)
select v.id::uuid, 'd0000000-0000-4000-8000-000000000001', v.student_id::uuid, t.id, true, v.so, true
from (values
  ('d0000000-0000-4000-8000-0000000000b1', 'd0000000-0000-4000-8000-000000000021', 'デモ教材 中2数学ワーク（保護者ポータル体験用）', 0),
  ('d0000000-0000-4000-8000-0000000000b2', 'd0000000-0000-4000-8000-000000000021', 'デモ教材 中2英単語トレーニング（保護者ポータル体験用）', 1),
  ('d0000000-0000-4000-8000-0000000000b3', 'd0000000-0000-4000-8000-000000000022', 'デモ教材 小6算数ドリル（保護者ポータル体験用）', 0)
) as v(id, student_id, tb_name, so)
join public.textbooks t on t.name = v.tb_name
on conflict (id) do update
  set school_id = excluded.school_id,
      student_id = excluded.student_id,
      textbook_id = excluded.textbook_id,
      is_active = true;


-- ============================================================================
-- 10) 授業報告書（class_reports）＋ 学習内容（lesson_report_units）
-- ============================================================================
--   ★ portal_class_reports ビューが保護者に出す条件（1つでも外すと画面が空になる）:
--     (1) status = 'approved'                     ← 公開ゲート。draft/submitted/rejected は出ない
--     (2) portal_account_students に紐づけがある
--     (3) 生徒が在籍中（withdrawal_date is null or >= current_date）
--     (4) 生徒の所属校 = class_reports.school_id  ← 教室スコープ
--   ★ 教科名はビューが schedule_entry_id → schedule_entries.subject_ids → subjects
--     を辿って解決する。よって報告書は必ず「教科の入った予定」に紐づける。
--
--   §8 で予定を作り直した直後なので、報告書は毎回まっさらに作られる
--   （CASCADE で消えている）。過去コマの新しい順に太郎2本・花子1本を付ける。
--
--   ★ vocab_test_*（英単語テスト）を入れない理由（確定仕様）:
--     テストは確認テストに一本化された。講師フォーム
--     （app/lesson-reports/[scheduleEntryId]）は確認テストしか入力させず、
--     vocab_test_* には null しか書かない。デモデータも「実際に生成されるデータ」と
--     同じ形にしないと、保護者面から英単語を外したのにデータにだけ値が残る、という
--     食い違いが起きる。よって列ごと insert から外す（＝ null が入る）。
--     class_reports の列と portal_class_reports ビューはそのまま残す
--     （列の削除は適用済みマイグレーションの改変になるため。列は死んだまま無害）。
-- ----------------------------------------------------------------------------
insert into public.class_reports (
  id, school_id, schedule_entry_id, student_id, teacher_id, lesson_date,
  short_term_goal, mid_term_goal_snapshot, school_progress,
  homework_completion_pct, homework_correct_pct, today_correct_pct,
  check_test_score, check_test_total, check_test_passed,
  review_comment, homework_assignments, status, submitted_at, approved_at, approved_by
)
select
  v.id::uuid,
  'd0000000-0000-4000-8000-000000000001',
  e.id,
  v.student_id::uuid,
  e.teacher_id,
  e.entry_date,
  v.short_term_goal,
  v.mid_term_goal,
  v.school_progress,
  v.hw_completion, v.hw_correct, v.today_correct,
  v.check_score, v.check_total, v.check_passed,
  v.review_comment,
  -- ★ 次回までの宿題は「日割り」（確定仕様）:
  --   授業日の翌日から次回授業日までを1日ずつに割り、hw_texts を順に当てる。
  --   以前は date に '次回まで' という文字列を入れていたが、これは日付の位置に
  --   日付でないものを入れており、画面（ReportDetail の formatShortDate）が
  --   日付として整形できず日割りにならなかった。
  --   ★ 日付は必ず授業日（＝current_date 相対で作られる予定）から導出する。
  --     固定日付を書くと再実行のたびに古びる（このファイル全体の方針）。
  --   上限を +3 日で切るのは、通塾間隔が空くコマでも宿題が延々と並ばないようにするため
  --   （太郎=月水金・花子=火木なので実際は 2〜3 日ぶんになる）。
  (
    select jsonb_agg(
             jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'), 'text', v.hw_texts[d.i])
             order by d.i
           )
    from (
      select gs::date as day, row_number() over (order by gs) as i
      from generate_series(
             e.entry_date + 1,
             least(nx.next_date, e.entry_date + 3),
             interval '1 day'
           ) gs
    ) d
    -- 日数ぶんの文章が無ければその日は宿題なし（配列長を超えたら出さない）。
    where v.hw_texts[d.i] is not null
  ),
  -- ★ 承認済みでないと保護者に一切見えない（ビューの公開ゲート）。
  'approved',
  e.entry_date + time '21:00',
  e.entry_date + time '21:30',
  'd0000000-0000-4000-8000-000000000011'
from (values
  -- ★ 対象コマを「曜日」で指定する理由（offset で選ばない）:
  --   報告書の本文は教科に紐づいた具体的な内容（例: 動名詞＝英語）なので、
  --   「n番目に新しい過去コマ」で選ぶと、実行日によって別教科のコマに付いてしまう
  --   （実機で発生: 英語の報告書が金曜＝数学のコマに付き「教科:数学／本文:動名詞」になった）。
  --   曜日で指定すれば教科と本文が必ず一致する。
  --     太郎: 月(1)=数学 / 水(3)=英語 / 金(5)=数学   花子: 火(2)=算数 / 木(4)=国語
  -- 太郎(数学): 直近の 月 or 金 のコマ
  ('d0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-000000000021', array[1, 5],
   '一次関数の変化の割合を確実に求められるようにする',
   '2学期中間テストで数学80点以上',
   '学校は一次関数の利用に入ったところ',
   100, 85, 78, 8, 10, true,
   'ご家庭でもよく練習してきてくれました。変化の割合の求め方は安定してきています。グラフから読み取る問題であと一歩ミスが出るので、次回はそこを重点的に扱います。集中して最後まで取り組めていました。',
   array['ワーク p.58〜59（変化の割合の練習）',
         'ワーク p.60〜61（グラフの読み取り）',
         '確認テストの直しをノートに1ページ']),
  -- 太郎(英語): 直近の 水 のコマ
  ('d0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-000000000021', array[3],
   '動名詞の使い分けを理解する',
   '2学期中間テストで英語75点以上',
   '学校はUnit5の後半',
   90, 70, 72, 7, 10, false,
   '動名詞と不定詞の使い分けで迷う場面がありました。今日は基本の型を整理したので、次回までに例文を音読して定着させましょう。宿題の取り組み自体はとても丁寧です。',
   array['英単語トレーニング Unit 5 音読10回',
         'ワーク p.12〜13（動名詞の書きかえ）',
         'Unit 5 の例文を3つノートに書く']),
  -- 花子(算数): 直近の 火 のコマ
  ('d0000000-0000-4000-8000-0000000000a3', 'd0000000-0000-4000-8000-000000000022', array[2],
   '分数のかけ算の約分を正確にできるようにする',
   '2学期の計算単元を苦手なく終える',
   '学校は分数のかけ算の途中',
   100, 95, 88, 9, 10, true,
   '約分のミスがほとんどなくなりました。計算のスピードも上がっています。次回から分数のわり算に進みます。最後の応用問題まで粘り強く取り組めました。',
   array['算数ドリル p.24〜25',
         '算数ドリル p.26〜27',
         '計算カード（分数のかけ算）5分'])
) as v(id, student_id, dows, short_term_goal, mid_term_goal, school_progress,
       hw_completion, hw_correct, today_correct,
       check_score, check_total, check_passed,
       review_comment, hw_texts)
-- 指定曜日の「直近の実施済みコマ」を引き当てる（＝教科と本文が必ず一致する）。
join lateral (
  select se.id, se.entry_date, se.teacher_id
  from public.schedule_entries se
  where se.student_id = v.student_id::uuid
    and se.entry_date < current_date
    and se.status = 'completed'
    and extract(dow from se.entry_date)::int = any(v.dows)
  order by se.entry_date desc
  limit 1
) e on true
-- 次回授業日（宿題の日割りの終端）。休講・振替も含めて「次に教室へ来る日」を取る。
-- ★ left join にする理由: 未来のコマが1件も無い場合でも報告書は作られるべき。
--   その場合 next_date is null となり、上の least() が NULL を無視して
--   e.entry_date + 3 が終端になる（＝宿題は3日ぶん）。
left join lateral (
  select min(se2.entry_date) as next_date
  from public.schedule_entries se2
  where se2.student_id = v.student_id::uuid
    and se2.entry_date > e.entry_date
) nx on true
on conflict (id) do update
  set schedule_entry_id = excluded.schedule_entry_id,
      lesson_date = excluded.lesson_date,
      -- 日割りは lesson_date（＝current_date 相対）から導出するので、再実行で作り直す。
      homework_assignments = excluded.homework_assignments,
      status = 'approved';

-- 学習内容（教材×単元×ページ）。
insert into public.lesson_report_units (
  id, report_id, student_textbook_id, is_main, curriculum_item_ids, page_start, page_end, display_order
)
select
  v.id::uuid,
  v.report_id::uuid,
  v.student_textbook_id::uuid,
  v.is_main,
  -- 単元名はタイトルから引き当てる（IDをハードコードしない。§9 の理由と同じ）。
  coalesce(
    (select array_agg(c.id order by c.sort_order)
     from public.curriculum_items c
     where c.title = any(v.titles)),
    '{}'::int[]
  ),
  v.page_start, v.page_end, v.display_order
from (values
  -- 太郎の報告書1: メイン=数学ワーク、サブ=英単語
  ('d0000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-0000000000a1',
   'd0000000-0000-4000-8000-0000000000b1', true, array['一次関数の変化の割合', '一次関数の利用'], 54, 58, 0),
  ('d0000000-0000-4000-8000-0000000000c2', 'd0000000-0000-4000-8000-0000000000a1',
   'd0000000-0000-4000-8000-0000000000b2', false, array['Unit 5 動名詞'], 12, 13, 1),
  -- 太郎の報告書2: メイン=英単語
  ('d0000000-0000-4000-8000-0000000000c3', 'd0000000-0000-4000-8000-0000000000a2',
   'd0000000-0000-4000-8000-0000000000b2', true, array['Unit 5 動名詞'], 10, 13, 0),
  -- 花子の報告書: メイン=算数ドリル
  ('d0000000-0000-4000-8000-0000000000c4', 'd0000000-0000-4000-8000-0000000000a3',
   'd0000000-0000-4000-8000-0000000000b3', true, array['分数のかけ算'], 20, 23, 0)
) as v(id, report_id, student_textbook_id, is_main, titles, page_start, page_end, display_order)
-- 親レポートが実在するときだけ入れる（§10 の lateral が引けなかった場合の保険）。
where exists (select 1 from public.class_reports cr where cr.id = v.report_id::uuid)
on conflict (id) do update
  set report_id = excluded.report_id,
      student_textbook_id = excluded.student_textbook_id,
      is_main = excluded.is_main,
      curriculum_item_ids = excluded.curriculum_item_ids,
      page_start = excluded.page_start,
      page_end = excluded.page_end,
      display_order = excluded.display_order;


-- ============================================================================
-- 11) お知らせ（bulletin_posts）
-- ============================================================================
--   ★ bulletin_posts_select_portal の可視条件（1つでも外すと画面が空になる）:
--     (1) is_archived = false
--     (2) publish_start_at is null or <= now()   ← 予約公開前は出ない
--     (3) publish_end_at   is null or >= now()   ← 公開終了後は出ない
--     (4) 投稿の school_id = 紐づけ生徒の所属校
--     (5) audience: relation='mother'（≠self）なので **'保護者' が入っていること** が必須。
--         既定の '{社内}' のままだと保護者には絶対に出ない（＝既定は安全側）。
--     (6) target_scope='all'（教室全体）
--   ※ audience に '生徒' も入れておくと、将来 relation='self' のデモを足しても見える。
-- ----------------------------------------------------------------------------
insert into public.bulletin_posts (
  id, school_id, title, content, is_pinned, is_archived,
  audience, target_scope, publish_start_at, publish_end_at, created_by, created_at
)
values
  ('d0000000-0000-4000-8000-000000000091', 'd0000000-0000-4000-8000-000000000001',
   '【重要】夏期講習の日程についてのご案内',
   E'保護者の皆さまへ\n\nいつもお世話になっております。\n夏期講習の日程が決まりましたのでお知らせいたします。\n\n・期間: 7月22日（月）〜 8月30日（金）\n・お申し込み締切: 7月10日（水）\n\n面談のご希望がある方は、マイページの「教室との連絡」からお気軽にご相談ください。\n時間割の詳細は個別にご案内いたします。\n\nどうぞよろしくお願いいたします。',
   true, false,
   array['保護者', '生徒'], 'all',
   now() - interval '5 days', null,
   'd0000000-0000-4000-8000-000000000011', now() - interval '5 days'),
  ('d0000000-0000-4000-8000-000000000092', 'd0000000-0000-4000-8000-000000000001',
   '8月の教室カレンダー（お盆休みのお知らせ）',
   E'8月の教室の開講日についてお知らせいたします。\n\n・お盆休み: 8月11日（日）〜 8月15日（木）\n  上記期間は教室をお休みとさせていただきます。\n\n・振替をご希望の場合は、マイページの「予定」から該当のコマを選んでご連絡ください。\n\nご不便をおかけしますが、よろしくお願いいたします。',
   false, false,
   array['保護者', '生徒'], 'all',
   now() - interval '2 days', null,
   'd0000000-0000-4000-8000-000000000011', now() - interval '2 days')
on conflict (id) do update
  set title = excluded.title,
      content = excluded.content,
      is_pinned = excluded.is_pinned,
      is_archived = false,
      -- ★ 保護者に出すための必須条件。再実行で必ず是正する。
      audience = excluded.audience,
      target_scope = excluded.target_scope,
      publish_start_at = excluded.publish_start_at,
      publish_end_at = excluded.publish_end_at;


-- ============================================================================
-- 12) チャット（生徒ごと1スレッド）
-- ============================================================================
--   chat_threads.student_id は unique（生徒ごと1本がDB制約）。
--   参加者(chat_thread_participants)が無いとRLSで一切見えないので必ず作る。
-- ----------------------------------------------------------------------------
insert into public.chat_threads (id, school_id, student_id, created_by, created_at)
values
  ('d0000000-0000-4000-8000-000000000061', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000021', 'd0000000-0000-4000-8000-000000000011', now() - interval '20 days'),
  ('d0000000-0000-4000-8000-000000000062', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000011', now() - interval '10 days')
on conflict (id) do update
  set school_id = excluded.school_id,
      student_id = excluded.student_id;

-- 参加者。これが無いと chat_threads / chat_messages のRLSが全て偽になる（画面が空）。
insert into public.chat_thread_participants (thread_id, portal_account_id)
values
  ('d0000000-0000-4000-8000-000000000061', 'd0000000-0000-4000-8000-000000000031'),
  ('d0000000-0000-4000-8000-000000000062', 'd0000000-0000-4000-8000-000000000031')
on conflict (thread_id, portal_account_id) do nothing;

-- メッセージ（staff / portal を交互に。振替相談＝ポータルの用途が伝わる内容にする）。
insert into public.chat_messages (id, thread_id, sender_kind, sender_id, body, template_kind, payload, created_at)
values
  -- ── 太郎のスレッド: 振替相談の往復 ──
  ('d0000000-0000-4000-8000-000000000071', 'd0000000-0000-4000-8000-000000000061',
   'staff', 'd0000000-0000-4000-8000-000000000011',
   E'体験 太郎さんの保護者さま\n\nいつもお世話になっております。デモ校の担当です。\nマイページからいつでもご連絡いただけますので、ご都合が悪い日などお気軽にお知らせください。',
   null, null, now() - interval '20 days'),
  ('d0000000-0000-4000-8000-000000000072', 'd0000000-0000-4000-8000-000000000061',
   'portal', 'd0000000-0000-4000-8000-000000000031',
   'ありがとうございます。さっそくですが、来週の月曜日は学校行事で伺えなくなりました。振替をお願いできますでしょうか。',
   null, null, now() - interval '6 days'),
  ('d0000000-0000-4000-8000-000000000073', 'd0000000-0000-4000-8000-000000000061',
   'staff', 'd0000000-0000-4000-8000-000000000011',
   E'ご連絡ありがとうございます。承知いたしました。\n同じ週の金曜18:40〜、または土曜17:00〜であれば席をご用意できます。ご希望はいかがでしょうか。',
   null, null, now() - interval '6 days' + interval '3 hours'),
  ('d0000000-0000-4000-8000-000000000074', 'd0000000-0000-4000-8000-000000000061',
   'portal', 'd0000000-0000-4000-8000-000000000031',
   '金曜日の18:40からでお願いいたします。よろしくお願いします。',
   null, null, now() - interval '5 days'),
  ('d0000000-0000-4000-8000-000000000075', 'd0000000-0000-4000-8000-000000000061',
   'system', null,
   '振替が確定しました。金曜 18:40〜20:10 でお席をご用意しています。',
   null, null, now() - interval '5 days' + interval '1 hour'),
  ('d0000000-0000-4000-8000-000000000076', 'd0000000-0000-4000-8000-000000000061',
   'staff', 'd0000000-0000-4000-8000-000000000011',
   E'振替の手続きが完了しました。当日お待ちしております。\n\nあわせて、2学期の面談期間のご案内を近日中にお送りします。ご希望の時間帯があればこちらへご返信ください。',
   null, null, now() - interval '1 day'),
  -- ── 花子のスレッド: 面談希望 ──
  ('d0000000-0000-4000-8000-000000000077', 'd0000000-0000-4000-8000-000000000062',
   'staff', 'd0000000-0000-4000-8000-000000000012',
   E'体験 花子さんの保護者さま\n\nいつもお世話になっております。\n分数の計算がとても安定してきました。ご家庭での声かけのおかげです。',
   null, null, now() - interval '10 days'),
  ('d0000000-0000-4000-8000-000000000078', 'd0000000-0000-4000-8000-000000000062',
   'portal', 'd0000000-0000-4000-8000-000000000031',
   'ありがとうございます。中学に向けての学習について一度ご相談したいのですが、面談をお願いすることはできますか。',
   null, null, now() - interval '3 days'),
  ('d0000000-0000-4000-8000-000000000079', 'd0000000-0000-4000-8000-000000000062',
   'staff', 'd0000000-0000-4000-8000-000000000012',
   'もちろんです。来週であれば火曜・木曜の17時以降が空いております。ご都合のよい日をお知らせください。',
   null, null, now() - interval '2 days')
on conflict (id) do update
  set body = excluded.body,
      sender_kind = excluded.sender_kind,
      sender_id = excluded.sender_id,
      created_at = excluded.created_at;

-- 既読ポインタ。最後のスタッフ発言より前に置くことで「未読1件」バッジが出る状態にする
-- （未読の見え方も含めてデモで確認できるようにする意図）。
insert into public.chat_reads (thread_id, reader_kind, reader_id, last_read_at)
values
  ('d0000000-0000-4000-8000-000000000061', 'portal', 'd0000000-0000-4000-8000-000000000031', now() - interval '2 days'),
  ('d0000000-0000-4000-8000-000000000062', 'portal', 'd0000000-0000-4000-8000-000000000031', now() - interval '3 days')
on conflict (thread_id, reader_kind, reader_id) do update
  set last_read_at = excluded.last_read_at;


-- ============================================================================
-- 13) 手続き（form_periods）
-- ============================================================================
--   ★ 手続きハブ（/mypage/forms）の「申込プッシュ」が出る条件（formGuidance.ts）:
--     - periodStatus() が 'open' … is_active=true / is_archived=false /
--       publish_start <= now <= publish_end
--     - moshi/mogi は settings.grades に生徒の学年名が含まれること
--       （GRADE_NAME_TO_NUMBER で '中2'→8 / '小6'→6 に写像して students.grade と比較）
--     - **未回答であること**（form_responses に linked_student_id 付きの回答が無い）
--   ★ form_responses は意図的に作らない（未回答＝プッシュが出る状態にする）。
--     加えて form_responses はメール宛先解決の起点になり、実メール送信経路に乗り得るため
--     デモデータとして作ってはいけない。
--   ★ period_key に「/」や空白を入れないこと（URLに載るため404の原因になる）。
-- ----------------------------------------------------------------------------
insert into public.form_periods (
  id, school_id, form_type, period_key, title, settings,
  publish_start, publish_end, is_active, is_archived
)
values
  -- 模試: 対象学年に中2・小6の両方を入れて、2名ともプッシュが出るようにする。
  ('d0000000-0000-4000-8000-000000000081', 'd0000000-0000-4000-8000-000000000001',
   'moshi', 'demo-2026-08', '8月 全国統一模試のお申し込み',
   jsonb_build_object(
     'grades', jsonb_build_array('中2', '小6'),
     'exam_dates', jsonb_build_array(
       jsonb_build_object('date', to_char(current_date + 21, 'YYYY-MM-DD'), 'start_time', '09:00', 'end_time', '12:30')
     )
   ),
   now() - interval '3 days', now() + interval '14 days', true, false),
  -- 相談: 通常一覧（受付中）に出る想定。学年フィルタは無し。
  ('d0000000-0000-4000-8000-000000000082', 'd0000000-0000-4000-8000-000000000001',
   'soudan', 'demo-2026-2gakki', '2学期 個別面談のお申し込み',
   '{}'::jsonb,
   now() - interval '1 day', now() + interval '21 days', true, false)
on conflict (id) do update
  set form_type = excluded.form_type,
      period_key = excluded.period_key,
      title = excluded.title,
      settings = excluded.settings,
      publish_start = excluded.publish_start,
      publish_end = excluded.publish_end,
      is_active = true,
      is_archived = false;

commit;

-- ============================================================================
-- 投入結果の確認（実行後に目視するためのクエリ。副作用なし）
-- ============================================================================
--   select 'schools',                    count(*) from public.schools                    where id = 'd0000000-0000-4000-8000-000000000001'
--   union all select 'students',         count(*) from public.students                   where school_id = 'd0000000-0000-4000-8000-000000000001'
--   union all select 'schedule_entries', count(*) from public.schedule_entries           where school_id = 'd0000000-0000-4000-8000-000000000001'
--   union all select 'class_reports',    count(*) from public.class_reports              where school_id = 'd0000000-0000-4000-8000-000000000001'
--   union all select 'bulletin_posts',   count(*) from public.bulletin_posts             where school_id = 'd0000000-0000-4000-8000-000000000001'
--   union all select 'chat_messages',    count(*) from public.chat_messages              where thread_id in ('d0000000-0000-4000-8000-000000000061','d0000000-0000-4000-8000-000000000062')
--   union all select 'form_periods',     count(*) from public.form_periods               where school_id = 'd0000000-0000-4000-8000-000000000001';
