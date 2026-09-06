-- ============================================================
-- 今日の段取り（AI機能 today_plan）の保存先
-- ============================================================
-- 正典: docs/today-plan-ai-plan.md
--
-- ★教室×日付で1行。段取りは「読み物」ではなく教室長が直すタスクなので、
--   AIが組んだ結果をそのまま正典にしない。直した結果（消した・並べ替えた・足した）が正典で、
--   描き直しても消えないよう、行ごと丸ごと jsonb で持つ。
--
-- ★2段構え（毎朝10:00にcronで組む／日中は1件ずつ差し込む）のどちらも同じ行を更新する。
--   差し込みは既存の並びを壊さないため、行の中の items に1件足すだけ。
--
-- plan の形（src/lib/ai/todayPlan.ts の PlanItem と同じ）:
--   [{ id, block, text, why, done, source, todoId?, when? }]
--   block = 'before' | 'slot:<schedule_time_slots.id>' | 'after' | 'later'
--   ★時限の名前は教室ごとに違う（永山は3限16:20〜／堀之内は別）ので、
--     'p3' のような固定キーにせず、コマIDで持つ。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.today_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  plan_date date NOT NULL,

  -- 段取りの中身。★AIの出力をそのまま入れず、parse を通した形だけ入れる
  plan jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- 1段目（cron）が組んだ時刻。NULL = まだ組んでいない（手で足しただけ）
  generated_at timestamptz,

  updated_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (school_id, plan_date)
);

COMMENT ON TABLE public.today_plans IS
  '今日の段取り。教室×日付で1行。直した結果が正典（docs/today-plan-ai-plan.md）';

CREATE INDEX IF NOT EXISTS idx_today_plans_school_date
  ON public.today_plans (school_id, plan_date DESC);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
-- 読み書きとも自教室のスタッフ（教室長以上が使う画面だが、講師が読めても困る内容ではない）。
-- cron は service role で書く。
-- ★Supabaseの既定権限で anon/authenticated に ALL が付くため、明示的に剥がしてから付け直す。
ALTER TABLE public.today_plans ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.today_plans FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.today_plans TO authenticated;

DROP POLICY IF EXISTS today_plans_select ON public.today_plans;
CREATE POLICY today_plans_select ON public.today_plans
  FOR SELECT TO authenticated
  USING (public.check_school_access(school_id));

DROP POLICY IF EXISTS today_plans_insert ON public.today_plans;
CREATE POLICY today_plans_insert ON public.today_plans
  FOR INSERT TO authenticated
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS today_plans_update ON public.today_plans;
CREATE POLICY today_plans_update ON public.today_plans
  FOR UPDATE TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));
