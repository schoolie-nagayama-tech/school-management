-- ============================================================
-- 保護者ポータル v2 成績（Stage 5）: 保護者入力＋閲覧
-- 正典: docs/portal-v2-requirements.md §7-5
-- ============================================================
-- 目的:
--   (a) 保護者が「定期テスト・内申」を入力する中間テーブル portal_score_submissions。
--   (b) 承認済み成績を保護者に見せる限定公開ビュー portal_assessments。
--
-- ★ 中間テーブルにする理由（§7-5 の3本柱の2）:
--   保護者の入力をそのまま assessments に混ぜると、AlertBoard・成績グラフ・PDF・生徒詳細
--   といった既存の全消費者が「未承認の値」を業務データとして扱ってしまう。
--   申請はここに溜め、スタッフの承認で初めて assessments へ転記する。
--   ＝ 既存の消費者は**無改修のまま「承認済みだけ」を見続ける**。
--   報告書の「承認＝公開」ゲート（§7-4）の逆向きの適用（保護者→塾は「承認＝取り込み」）。
--
-- ★ portal ロールへの書き込み権限は一切足さない（§6-3 の不変条件）:
--   書き込みは service role API ＋ 入口の requirePortalStudent（チャット投稿と同じ型）。
--   ここで portal に付けるのは SELECT だけ（しかも自分の申請に限る）。
-- ============================================================

-- ------------------------------------------------------------
-- portal_score_submissions: 保護者からの成績申請（承認待ちの器）
-- ------------------------------------------------------------
--   ★ category に 'mock'（模試）を入れない理由:
--     模試は成績表が塾に届き CSV/貼り付けインポートの運用が既にある＝保護者に入れさせる
--     必要がない。アプリ層で弾くだけでなく **DB の CHECK でも入らない**ようにして、
--     将来 API を触る人が誤って開けても構造的に止まるようにする（§7-5）。
--
--   ★ school_id を持つ理由:
--     承認キューを教室で絞る（スタッフの auth.schoolIds スコープ）ため、申請時点の
--     生徒の所属校を焼き込む。student_textbooks.school_id と同じ「所属校と一致」原則。
--
--   ★ exam_month を date（月初日）にする理由:
--     portal_transfer_permissions.month と同じ流儀。'2026-7' / '2026-07' の表記ゆれを
--     構造的に防ぐ。report_card（内申）は月を持たない運用があるので null 可
--     （assessments 側の既存運用と同じ）。
-- ------------------------------------------------------------
create table if not exists public.portal_score_submissions (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  student_id      uuid not null references public.students(id) on delete cascade,
  -- 誰が入れたか（監査）。アカウント削除で申請も消えてよい。
  account_id      uuid not null references public.portal_accounts(id) on delete cascade,
  category        text not null,
  grade           int  not null,
  name_code       text not null,
  exam_month      date,
  -- {"english": 82, "math": 74} 形式。表示前に防御的正規化する
  -- （homework_assignments / subject_specific と同じ思想。DBは器に徹する）。
  scores          jsonb not null default '{}'::jsonb,
  status          text not null default 'submitted',
  -- 差し戻し理由。★ 報告書の rejection_reason（内部向け・保護者に見せない）と違い、
  -- こちらは保護者への返答そのものなので保護者に表示する。
  rejected_reason text,
  reviewed_by     uuid references public.user_profiles(id),
  reviewed_at     timestamptz,
  -- 承認で転記した先（監査・二重転記の検知）。成績行が消えても申請の履歴は残す。
  assessment_id   uuid references public.assessments(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- ★ 模試はDB層でも入れられない（上記の理由）。
  constraint portal_score_submissions_category_check
    check (category in ('regular_test', 'report_card')),
  constraint portal_score_submissions_grade_check
    check (grade >= 1 and grade <= 13),
  constraint portal_score_submissions_status_check
    check (status in ('submitted', 'approved', 'rejected')),
  -- name_code の値域は assessments_name_code_check と同じ（模試の枝は持たない）。
  -- 'legacy' は過去データ移行用の逃がし値なので保護者の新規申請では許さない。
  constraint portal_score_submissions_name_code_check
    check (
      (category = 'regular_test' and name_code in (
        'term1_mid', 'term1_final', 'term2_mid', 'term2_final', 'year_end',
        'first_mid', 'first_final', 'second_mid', 'second_final'
      ))
      or (category = 'report_card' and name_code in (
        'term1', 'term2', 'year_end', 'first', 'second'
      ))
    ),
  -- exam_month は必ず月初日（表記ゆれ・月途中日付の混入をDBで防ぐ）。
  constraint portal_score_submissions_exam_month_is_first_day
    check (exam_month is null or exam_month = date_trunc('month', exam_month)::date),
  -- 差し戻しには理由が要る（保護者に「なぜ」を返さない差し戻しを作らせない）。
  constraint portal_score_submissions_rejected_reason_required
    check (status <> 'rejected' or (rejected_reason is not null and btrim(rejected_reason) <> ''))
);

comment on table public.portal_score_submissions is
  '保護者からの成績申請（定期テスト・内申のみ）。スタッフの承認で assessments へ転記する中間テーブル（§7-5）。模試はCHECKで入らない。';
comment on column public.portal_score_submissions.scores is
  '{"english": 82, ...} の科目→点数。定期テスト=0〜100 / 内申=1〜5 の検証はAPI入口で行う（DBは器）。';
comment on column public.portal_score_submissions.rejected_reason is
  '差し戻し理由。★保護者に表示する（報告書の rejection_reason は内部向けで非表示なのと対照的）。';
comment on column public.portal_score_submissions.assessment_id is
  '承認で転記した先の assessments 行。監査と二重転記の検知に使う。';

-- 承認キュー（教室×状態）と、生徒ごとの申請一覧を高速化する。
create index if not exists idx_portal_score_submissions_school_status
  on public.portal_score_submissions (school_id, status, created_at desc);
create index if not exists idx_portal_score_submissions_student
  on public.portal_score_submissions (student_id, created_at desc);
create index if not exists idx_portal_score_submissions_account
  on public.portal_score_submissions (account_id);

-- ★ 「同じ枠の承認待ちは1件だけ」をDBで担保する（§7-5 の再送＝置き換え）:
--   保護者が同じテストを2回送ったら、承認キューに同じものが2件並んでスタッフが混乱する。
--   API は既存の submitted を更新して置き換えるが、同時送信のレースはDBで止める。
--   nulls not distinct: exam_month が null（内申）でも「同じ枠」として重複を検知する
--   （既定の nulls distinct だと null 同士が別物扱いになり重複を許してしまう。PG15+）。
--   承認済み・差し戻し済みは何件あってもよい（履歴）ので status='submitted' に限定する。
create unique index if not exists idx_portal_score_submissions_pending_slot
  on public.portal_score_submissions (student_id, category, grade, name_code, exam_month)
  nulls not distinct
  where status = 'submitted';

-- ------------------------------------------------------------
-- 権限（GRANT / REVOKE）
--   portal:        自分の申請の SELECT のみ（RLS が更に絞る）。書き込みは service role API。
--   authenticated: 承認キューの表示用に SELECT のみ。★承認操作（UPDATE）は付けない
--                  ＝転記と状態遷移をアトミックに行う service role API を必ず通す。
--   anon:          一切与えない。
--   service_role:  全操作。
--
-- ★★ Supabase の既定権限の罠（2026-07-17 実測で発覚。ここを読むこと）★★
--   Supabase は `alter default privileges in schema public grant all on tables to
--   anon, authenticated, ...` を既定で持っており、**public に作った新規テーブル/ビューには
--   何もしなくても anon と authenticated に ALL（INSERT/UPDATE/DELETE/TRUNCATE 含む）が
--   自動で付く**。つまり `grant select ... to authenticated` と書いても「SELECTだけ付与」には
--   ならず、実際には全権限が付いた状態になる（既存の portal_report_reads /
--   portal_class_reports も同じ状態であることを実測で確認済み）。
--   実際に書き込みを止めているのは RLS（authenticated には SELECT ポリシーしか無い＝
--   INSERT/UPDATE/DELETE はデフォルト拒否）であって、GRANT ではない。
--
--   成績は機微データなので、ここでは**権限レベルでも設計どおりに締める**（多層防御）:
--   一度 revoke してから必要な分だけ grant し直す。これで「authenticated は SELECT のみ」
--   というこのコメントが実態と一致する（RLS はその上の第2層として残る）。
-- ------------------------------------------------------------
revoke all on public.portal_score_submissions from anon;
revoke all on public.portal_score_submissions from authenticated;

grant select on public.portal_score_submissions to portal;
grant select on public.portal_score_submissions to authenticated;
grant all    on public.portal_score_submissions to service_role;

alter table public.portal_score_submissions enable row level security;

-- portal: 自分（account_id = portal_uid()）が出した申請だけ見える。
drop policy if exists "portal_score_submissions_select_self" on public.portal_score_submissions;
create policy "portal_score_submissions_select_self" on public.portal_score_submissions
  for select to portal
  using (account_id = public.portal_uid());

-- authenticated（スタッフ）: 自校の申請だけ見える（既存の教室スコープの流儀）。
drop policy if exists "portal_score_submissions_school_scope_auth" on public.portal_score_submissions;
create policy "portal_score_submissions_school_scope_auth" on public.portal_score_submissions
  for select to authenticated
  using (public.check_school_access(school_id));

-- ------------------------------------------------------------
-- portal_assessments: 保護者に見せる成績の限定公開ビュー
-- ------------------------------------------------------------
--   ★ なぜ assessments を直接 portal に開けずビューにするのか（§7-4 の報告書ビューと同じ手法）:
--     assessments には title / term / created_at 等の内部運用列が同居し、何より
--     **他生徒の行**が同じテーブルに居る。ビューの述語で「自分の紐づけ生徒・在籍中・
--     教室スコープ」を担保し、portal にはこのビューだけを grant する。
--     assessments / assessment_scores 本体は portal から**デフォルト拒否のまま**
--     （grant しない）＝ API の実装ミスがあっても構造的に他生徒に到達しない。
--
--   ★ security_invoker を付けない理由（＝意図した definer 相当の限定公開）:
--     付けると呼び出しロール(portal)の権限で下層 assessments を読むため、本体に
--     portal の grant/ポリシーが必要になり「本体は開けない」目的が崩れる。
--     Stage3 の portal_teacher_names・Stage4 の portal_class_reports と同じ判断。
--
--   ★ 述語がこのビュー唯一の防壁（ビューには RLS を掛けられない）。§7-4 と同じ4条件:
--     (1) 自分（portal_uid()）の紐づけ生徒であること
--     (2) その生徒が在籍中（Stage1 と同じ失効条件。退塾で自動的に見えなくなる）
--     (3) 生徒の所属校 = assessments.school_id（転校等でズレた行を出さない）
--     ※ 報告書と違い「承認ゲート」に当たる status 列は assessments に無い。
--       assessments に在ること自体が「スタッフが認めた成績」＝承認済みの定義。
--
--   ★ 模試を含む全カテゴリを見せる（設計判断・§7-5）:
--     保護者入力は定期・内申だけだが、閲覧はスタッフが入れた模試も含めて見せる方が
--     Grow 置換として自然。絞りたくなったら述語に category 条件を足すだけでよい。
--   ★ relation（保護者/生徒本人）では絞らない＝生徒本人にも自分の成績は見せる。
--
--   ★ scores を jsonb に集約して返す理由:
--     assessment_scores を別途 portal に開けると「行の集合」を露出することになる。
--     ビュー内で {"english": 82, ...} に畳んで返せば、露出は科目名と点数だけで済む
--     （portal_lesson_report_units が教材名・単元名を畳んで返すのと同じ考え方）。
-- ------------------------------------------------------------
create or replace view public.portal_assessments as
  select
    a.id,
    a.student_id,
    a.category,
    a.grade,
    a.name_code,
    a.exam_month,
    a.exam_date,
    -- 値が入っている科目だけを {"科目": 点数} に畳む（null の空セルは出さない）。
    coalesce(
      (
        select jsonb_object_agg(s.subject, s.value)
        from public.assessment_scores s
        where s.assessment_id = a.id
          and s.value is not null
      ),
      '{}'::jsonb
    ) as scores
  from public.assessments a
  where exists (
    select 1
    from public.portal_account_students pas
    join public.students st on st.id = pas.student_id
    where pas.account_id = public.portal_uid()
      and pas.student_id = a.student_id
      -- Stage1 の students ポリシーと同じ失効条件をこの述語自身にも持たせる（多層防御）。
      and (st.withdrawal_date is null or st.withdrawal_date >= current_date)
      -- 教室スコープ: 生徒の所属校と成績の school_id が一致すること。
      and st.school_id = a.school_id
  );

comment on view public.portal_assessments is
  '保護者に公開する成績の限定公開ビュー（§7-5）。自分の紐づけ生徒・在籍中・教室スコープ。assessments/assessment_scores 本体は portal に開けない。security_invoker は意図的に付けない（列と行の限定公開が目的）。';

-- ★ ビューは RLS を掛けられないので、防壁は上の述語だけ。既定権限で anon/authenticated にも
--   ALL が付いてしまう（上記の罠）ため、明示的に revoke して portal だけに絞る。
--   （述語の portal_uid() は anon では null・スタッフでは自分の auth ユーザーIDになり、
--     どちらも portal_accounts.id と一致しないので実際は0行になる。それでも「見えないのは
--     UUIDが偶然衝突しないから」に頼らず、権限で閉じておく。）
revoke all on public.portal_assessments from anon;
revoke all on public.portal_assessments from authenticated;

grant select on public.portal_assessments to portal;
