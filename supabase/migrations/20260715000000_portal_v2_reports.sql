-- ============================================================
-- 保護者ポータル v2 授業報告書（Stage 4・保護者面）
-- 正典: docs/portal-v2-requirements.md §7-4「保護者面（読み取り）」
-- ============================================================
-- 目的:
--   (a) 室長が承認した授業報告書だけを保護者に見せる限定公開ビュー2本
--       （portal_class_reports / portal_lesson_report_units）。
--   (b) ポータル側の既読 portal_report_reads。
--   (c) 承認（＝公開）通知の冪等ガード portal_report_notifications。
--
-- 不変条件（docs/portal-v2-requirements.md §6-3）:
--   - 既存テーブルのスキーマは変更しない（ビュー・新テーブルの追加のみ）。
--   - 既存ポリシー・既存 grant には一切触れない。
--
-- ポータル可視化の鉄則（Stage1 で確立・Stage2/3 で踏襲・厳守）:
--   ポータルに見せるテーブルは必ず「grant select ... to portal」＋「to portal の RLS
--   ポリシー」の2点セット。ポリシー内は auth.uid() でなく public.portal_uid() を使う。
--   書き込みは service role 経由の API で行う（portal に INSERT/UPDATE/DELETE を与えない）。
--
-- 適用状況: 2026-07-16 に本番へ適用済み（MCP の apply_migration・版名 portal_v2_reports）。
--       ※ 以前の「本番には適用しない」は Stage4 開発時点の記述。本番デモ
--         （docs/portal-v2-demo-handoff.md §3-2）で適用したため改めた。
--       portal ロール／portal_uid() は Stage1(20260714000000) で作成済みの前提。冪等に書く。
-- ============================================================


-- ============================================================
-- 1) 報告書の限定公開ビュー: portal_class_reports（★このStageの中核）
-- ============================================================
--
--   ★ なぜ class_reports を直接 portal に開けず view にするのか（Stage3 の
--     portal_teacher_names と同じ理由・同じ手法）:
--     class_reports には保護者に見せてはいけない内部運用列が同居している。
--       - rejection_reason        差し戻し理由（室長→講師の内部指摘。保護者が読むものではない）
--       - mid_action_goal_snapshot 行動目標スナップショット（§7-4 で「見せない」と確定）
--       - approved_by / rejected_by / rejected_at / submitted_at / approved_at / status
--                                 ワークフロー内部列（誰が承認/差し戻したか＝スタッフの内部情報）
--     「列の一部だけ」を RLS で隠すことはできない（**RLS は行の制御であって列の制御ではない**）。
--     列を絞る手段は view（または column-level grant）しかない。そこで §7-4 が列挙した
--     「見せる列」だけを持つ narrow view を作り、portal にはこのビューだけを grant する。
--     class_reports 本体は portal からデフォルト拒否のまま（grant しない）。
--     ＝ API の実装ミス（うっかり select('*')）が起きても内部列が構造的に出てこない。
--
--   ★ security_invoker を付けない理由（＝意図した definer 相当の限定公開）:
--     security_invoker=on にすると呼び出しロール(portal)の権限で下層 class_reports を
--     読むため、class_reports に portal の grant/ポリシーが必要になってしまい、
--     「本体は開けない」という目的が達成できない。付けない（既定 off）ことで、ビューは
--     所有者権限で下層を読み、portal には view の列だけが露出する。
--     これがこのビューの設計目的そのもの（列の限定公開）。Stage3 の講師名ビューと同じ。
--
--   ★ 述語をビュー自身に持たせるのが唯一の防壁:
--     ビューには RLS を掛けられない（所有者権限で評価される）ため、絞り込みを書かないと
--     「誰でも全教室の全報告書を読める」状態になる。Stage3 の講師名ビューで実際に
--     踏んだ罠。よって以下4条件をすべてビューの where に持たせる:
--       (1) status = 'approved'  … ★公開ゲート。承認前(draft/submitted)・差し戻し(rejected)は
--                                   絶対に出さない。§7-4「公開＝室長の承認そのもの」。
--       (2) 自分（portal_uid()）の紐づけ生徒であること（portal_account_students）
--       (3) その生徒が在籍中（Stage1 と同じ失効条件）
--       (4) 生徒の所属校 = レポートの school_id（教室スコープ。転校等でズレた行を出さない）
--
--   ★ subject_names をビュー内で解決する理由:
--     一覧カードの「数学 ・ 佐々木先生」に教科名が要るが、教科は class_reports ではなく
--     schedule_entries.subject_ids にある。schedule_entry_id を露出させて呼び出し側に
--     join させると「報告書からコマを辿る」経路を開くことになるので、ビュー内で名前まで
--     解決して text[] で返す（露出は増やさない）。
--     ※ teacher_id は §7-4 の列指定どおり出し、表示名は Stage3 の既存 portal_teacher_names
--       ビュー経由で引く（新しい露出面を増やさない）。
-- ------------------------------------------------------------
create or replace view public.portal_class_reports as
  select
    cr.id,
    cr.student_id,
    cr.lesson_date,
    cr.teacher_id,
    -- 目標
    cr.short_term_goal,        -- 今日の目標
    cr.mid_term_goal_snapshot, -- 今月の目標（★ mid_action_goal_snapshot は出さない）
    -- 進度
    cr.school_progress,
    -- 宿題・演習（3項目のバー表示）
    cr.homework_completion_pct,
    cr.homework_correct_pct,
    cr.today_correct_pct,
    -- テスト（確認テスト／英単語テスト。単語は既存データがあるので出す）
    cr.check_test_score,
    cr.check_test_total,
    cr.check_test_passed,
    cr.vocab_test_score,
    cr.vocab_test_total,
    cr.vocab_test_passed,
    -- 講評・次回宿題・科目別欄
    cr.review_comment,
    cr.homework_assignments,
    cr.subject_specific,
    cr.created_at,
    -- 教科名（コマから解決。schedule_entry_id 自体は露出させない）
    coalesce(subj.names, '{}'::text[]) as subject_names
  from public.class_reports cr
  left join lateral (
    select array_agg(sub.name order by sub.name) as names
    from public.schedule_entries se
    join public.subjects sub on sub.id = any(se.subject_ids)
    where se.id = cr.schedule_entry_id
  ) subj on true
  where
    -- (1) ★公開ゲート: 室長の承認済みだけ。
    cr.status = 'approved'
    -- (2)(3)(4) 紐づけ＋在籍＋教室スコープ。
    and exists (
      select 1
      from public.portal_account_students pas
      join public.students s on s.id = pas.student_id
      where pas.account_id = public.portal_uid()
        and pas.student_id = cr.student_id
        -- Stage1 の students ポリシーと同じ失効条件をこの述語自身にも持たせる（多層防御）。
        and (s.withdrawal_date is null or s.withdrawal_date >= current_date)
        -- 教室スコープ: 生徒の所属校とレポートの school_id が一致すること。
        and s.school_id = cr.school_id
    );

comment on view public.portal_class_reports is
  '保護者に公開する授業報告書の限定公開ビュー（§7-4）。status=approved のみ・自分の紐づけ生徒・在籍中・教室スコープ。差し戻し理由/行動目標/承認者等の内部列は列ごと遮断。class_reports 本体は portal に開けない。security_invoker は意図的に付けない（列の限定公開が目的）。';

grant select on public.portal_class_reports to portal;


-- ============================================================
-- 2) 学習内容の限定公開ビュー: portal_lesson_report_units
-- ============================================================
--
--   詳細画面の「学習内容（教材×単元×ページ）」用。
--
--   ★ 教材名・単元名をビュー内で解決する理由（露出の最小化）:
--     素の lesson_report_units は student_textbook_id / curriculum_item_ids（＝ID）しか
--     持たないので、そのまま出すと表示のために textbooks / student_textbooks /
--     curriculum_items を portal に grant する必要が出る。しかしそれらは
--       - student_textbooks … 生徒×教材の所持情報（他生徒の行が混ざる。教室運用の情報）
--       - textbooks / curriculum_items … 全教室共通のマスタだが、開ければ全教材・全単元を
--         列挙できてしまう（保護者に必要なのは「自分の子の授業で使った1件の名前」だけ）
--     であり、「表示に必要な文字列」に比べて開ける面が明らかに大きい。
--     そこでビュー内で join して **名前だけ** を出し、これら3テーブルは portal に一切
--     grant しない（デフォルト拒否のまま）。ID も出さない（名前が引ければ用は足りる）。
--
--   ★ 親レポートの可視性:
--     上の portal_class_reports を exists で参照する。これで「承認済み・自分の紐づけ生徒・
--     在籍中・教室スコープ」の4条件がそのまま継承され、条件を二重実装しない
--     （＝片方だけ直して食い違う事故が起きない）。ビューの述語は問い合わせ時に評価される
--     ので portal_uid() はここでも効く。
-- ------------------------------------------------------------
create or replace view public.portal_lesson_report_units as
  select
    lru.id,
    lru.report_id,
    lru.is_main,
    lru.page_start,
    lru.page_end,
    lru.display_order,
    -- 教材名（student_textbooks → textbooks。ID は出さない）
    tb.name as textbook_name,
    -- 単元名（curriculum_item_ids を名前に解決。ID は出さない）
    coalesce(ci.titles, '{}'::text[]) as unit_titles
  from public.lesson_report_units lru
  join public.student_textbooks st on st.id = lru.student_textbook_id
  left join public.textbooks tb on tb.id = st.textbook_id
  left join lateral (
    select array_agg(c.title order by c.sort_order) as titles
    from public.curriculum_items c
    where c.id = any(lru.curriculum_item_ids)
      and c.title is not null
  ) ci on true
  where exists (
    -- ★ 親レポートが上のビューで可視なものだけ（可視条件は一元化）。
    select 1 from public.portal_class_reports pcr where pcr.id = lru.report_id
  );

comment on view public.portal_lesson_report_units is
  '報告書の学習内容（教材×単元×ページ）の限定公開ビュー（§7-4）。親レポートが portal_class_reports で可視なものだけ。教材名・単元名はビュー内で解決し、textbooks/student_textbooks/curriculum_items は portal に開けない。';

grant select on public.portal_lesson_report_units to portal;


-- ============================================================
-- 3) ポータル側の既読: portal_report_reads
-- ============================================================
--   Stage2 の bulletin_portal_reads と同型（スタッフ前提のテーブルを汚さない別テーブル）。
-- ------------------------------------------------------------
create table if not exists public.portal_report_reads (
  report_id         uuid not null references public.class_reports(id) on delete cascade,
  portal_account_id uuid not null references public.portal_accounts(id) on delete cascade,
  read_at           timestamptz not null default now(),
  primary key (report_id, portal_account_id)
);

comment on table public.portal_report_reads is
  'ポータル利用者の授業報告書の既読（§7-4）。未読の色帯/「新着」表示に使う。書き込みは service role のみ。';

grant select on public.portal_report_reads to portal;
grant all on public.portal_report_reads to service_role;

alter table public.portal_report_reads enable row level security;

-- portal は自分の既読だけ SELECT できる。書き込みは service role（bulletin_portal_reads と同型）。
drop policy if exists "portal_report_reads_select_self" on public.portal_report_reads;
create policy "portal_report_reads_select_self" on public.portal_report_reads
  for select to portal
  using (portal_account_id = public.portal_uid());


-- ============================================================
-- 4) 承認（＝公開）通知の冪等ガード: portal_report_notifications
-- ============================================================
--   ★ なぜテーブルで持つのか:
--     §7-4 の通知は「承認＝公開の瞬間に1回」。承認ボタンの二度押し・再承認
--     （差し戻し→再提出→再承認）・リトライで保護者に同じ報告書のメールが複数届くのを防ぐ。
--     Stage2 の振替通知は chat_messages.payload.transfer_key を「読んでから書く」方式だが、
--     こちらは PK への insert ... on conflict do nothing を冪等キーそのものとして使う
--     （＝チェックと記録が1文で原子的。同時実行でも二重送信にならない）。
--     insert が0行なら「既に通知済み」＝skip。
--
--   portal には grant しない（保護者が知る必要のない配信ログ＝デフォルト拒否のまま）。
-- ------------------------------------------------------------
create table if not exists public.portal_report_notifications (
  report_id   uuid primary key references public.class_reports(id) on delete cascade,
  notified_at timestamptz not null default now(),
  -- 送達結果の要約（チャネル別の delivered/skipped）。障害調査用。
  result      jsonb
);

comment on table public.portal_report_notifications is
  '授業報告書の公開通知の送信済みマーク（§7-4）。PK への insert on conflict do nothing を冪等キーとして使い、承認の二度押し・再承認での二重通知を防ぐ。portal には開けない。';

grant all on public.portal_report_notifications to service_role;

alter table public.portal_report_notifications enable row level security;

-- スタッフ（authenticated）にも開けない: 通知ログは service role の API だけが触る。
-- RLS 有効＋ポリシー無し＝デフォルト拒否（service role は RLS をバイパスする）。
