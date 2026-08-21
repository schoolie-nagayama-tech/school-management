-- ============================================================
-- 授業報告書: 次回の予定（機能D）
-- ============================================================
--
-- 背景（docs/lesson-report-next-plan.md §0）:
--   progress_sessions.handover の実データに「次回：進行表通り」「次回、進行表通り」という
--   手打ちが多数ある。この機能はその入力を構造化データに置き換える。
--   既定は「進行表通り」を自動で入れる（講師が何もしなくても正しい状態になる）。
--
-- 設計:
--   - 進行表側（progress_sessions）は **単元ID** で持つ。次回の授業の「前回の授業」カードに
--     「前回の予定」として出すため、教材の目次と突き合わせられる形が要る。
--   - 保護者側（class_reports）は **名前のスナップショット** で持つ。単元IDを保護者に
--     露出させないため、また後から進行表の目次が編集されても過去の報告書の文面が
--     変わらないようにするため（保存時点の確定値が正典）。
--   - 「自動（進行表通り）か手動か」は保存しない。保存されるのは最終的に画面に出ていた
--     単元だけで、表示のたびに再計算はしない。
--
-- 不変条件:
--   - どちらも「既定値つきの列追加」なので、現行運用中の進行表の挙動は変わらない。
--     既存行は空配列で埋まる。
--   - recordSession は報告書から呼ばれたときだけ新列を書く（進行表の授業記録パネルから
--     呼ばれたときは列を patch に載せない）。report_id とまったく同じ作法。
--
-- 適用状況: **未適用**。本番へは MCP の apply_migration で別途適用する
--           （ローカルの db push は本番に旧版を再適用する地雷があるため使わない）。
-- ============================================================


-- ============================================================
-- 1) progress_sessions に「次回やる予定の単元ID」を追加
-- ============================================================
alter table public.progress_sessions
  add column if not exists next_plan_curriculum_item_ids integer[] not null default '{}'::integer[];

comment on column public.progress_sessions.next_plan_curriculum_item_ids is
  '次回やる予定の単元ID。次回授業の「前回の授業」カードに前回の予定として出す';


-- ============================================================
-- 2) class_reports に保護者公開用のスナップショットを追加
-- ============================================================
alter table public.class_reports
  add column if not exists next_plan jsonb not null default '[]'::jsonb;

comment on column public.class_reports.next_plan is
  '次回の予定のスナップショット [{textbookName, unitTitles[]}]。保護者公開';


-- ============================================================
-- 3) 限定公開ビュー portal_class_reports に next_plan を追加
-- ============================================================
--
--   ★ 20260821100000_class_reports_attendance_marks.sql の定義を**丸ごと再掲**して、
--     末尾に1列だけ足した形。create or replace view は「既存列の名前・型・並びを
--     変えない」限り通るので、追加は必ず select の末尾に置く（既存列を1つでも
--     並べ替えると replace が失敗する）。
--     述語・join・security_invoker 方針は元の定義から一切変更していない。
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
    coalesce(subj.names, '{}'::text[]) as subject_names,
    -- 本日の様子マーク
    cr.tardy,
    cr.homework_not_done,
    -- ★ ここから追加（末尾に足すこと）: 次回の予定
    cr.next_plan
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
  '保護者に公開する授業報告書の限定公開ビュー（§7-4）。status=approved のみ・自分の紐づけ生徒・在籍中・教室スコープ。差し戻し理由/行動目標/承認者等の内部列は列ごと遮断。class_reports 本体は portal に開けない。security_invoker は意図的に付けない（列の限定公開が目的）。遅刻/宿題未実施マークは「本日の様子」として公開する（2026-08-21 追加）。次回の予定は名前のスナップショットで公開する（2026-08-22 追加）。';

-- create or replace はビューを作り直すため grant を維持するが、念のため冪等に再付与する。
grant select on public.portal_class_reports to portal;
