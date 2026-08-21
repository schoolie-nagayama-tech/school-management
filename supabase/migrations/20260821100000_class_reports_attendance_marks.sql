-- ============================================================
-- 授業報告書: 遅刻・宿題未実施マークを保護者公開ゾーンへ（P1-14 報告書×進行表 統合フォーム）
-- ============================================================
--
-- 背景（docs/lesson-report-session-merge-plan.md §0 決定4・5）:
--   遅刻／宿題未実施は従来「教室内のみ」の内部フラグ（progress_sessions 側だけ）だったが、
--   保護者にとっては「今日どうだったか」を示す最重要の一次情報なので、報告書の
--   保護者公開ゾーンに移す。講師の入力はチェックボックスではなくトグルピル。
--
-- 設計:
--   - progress_sessions.tardy / homework_not_done は **そのまま残す**（進行表・進行表確認・
--     面談の月次集計が読んでいる既存の正典）。class_reports 側は「その報告書を提出した
--     時点の値の写し」であり、保護者面に出すためだけの複製。
--   - 宿題未実施マークは homework_completion_pct=0 と双方向同期する（入力UI側の純関数
--     src/lib/lesson-reports/homeworkMark.ts が唯一の同期規則）。DB 側では制約を張らない
--     （過去データには 0% だがマーク無しの行があり、遡って書き換えたくないため）。
--
-- 不変条件:
--   - 既存列・既存ポリシー・既存 grant には触れない（列の追加とビューの再定義のみ）。
--   - 追加列は NOT NULL DEFAULT false。既存行は false（＝該当なし）で埋まる。
--
-- 適用状況: **未適用**。本番へは MCP の apply_migration で別途適用する
--           （ローカルの db push は本番に旧版を再適用する地雷があるため使わない）。
-- ============================================================


-- ============================================================
-- 1) class_reports に2列を追加
-- ============================================================
alter table public.class_reports
  add column if not exists tardy boolean not null default false,
  add column if not exists homework_not_done boolean not null default false;

comment on column public.class_reports.tardy is
  '遅刻マーク（保護者公開）。progress_sessions.tardy と同じ値を提出時に写す';
comment on column public.class_reports.homework_not_done is
  '宿題未実施マーク（保護者公開）。homework_completion_pct=0 と同期';


-- ============================================================
-- 2) 限定公開ビュー portal_class_reports に2列を追加
-- ============================================================
--
--   ★ 20260715000000_portal_v2_reports.sql の定義を**丸ごと再掲**して、末尾に2列だけ
--     足した形。create or replace view は「既存列の名前・型・並びを変えない」限り通るので、
--     追加は必ず select の末尾に置く（既存列を1つでも並べ替えると replace が失敗する）。
--     述語・join・security_invoker 方針は元の定義から一切変更していない。
--     元定義に付けたコメント（なぜ view か・なぜ述語を持たせるか）は元ファイルに残っている
--     ため、ここでは繰り返さない。
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
    -- ★ ここから追加（末尾に足すこと）: 本日の様子マーク
    cr.tardy,
    cr.homework_not_done
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
  '保護者に公開する授業報告書の限定公開ビュー（§7-4）。status=approved のみ・自分の紐づけ生徒・在籍中・教室スコープ。差し戻し理由/行動目標/承認者等の内部列は列ごと遮断。class_reports 本体は portal に開けない。security_invoker は意図的に付けない（列の限定公開が目的）。遅刻/宿題未実施マークは「本日の様子」として公開する（2026-08-21 追加）。';

-- create or replace はビューを作り直すため grant を維持するが、念のため冪等に再付与する。
grant select on public.portal_class_reports to portal;
