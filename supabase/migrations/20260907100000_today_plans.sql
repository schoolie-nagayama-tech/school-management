-- ============================================================
-- 今日の段取り（ダッシュボードの「今日やること」を時間帯に割り付けたもの）
-- ============================================================
-- 正典: docs/today-plan-ai-plan.md
--
-- ★教室×日付で1行。段取りは「今日の教室の話」であって個人のメモではない。
--   教室長が休んだ日に別の人が開いても同じ段取りが出ないと、引き継げない。
--
-- ★直した結果が正典。AIが組んだものは初期値でしかなく、
--   教室長がチェック・書き換え・移動・削除したあとの plan がその日の答えになる。
--   だから「生成結果」と「手で直したもの」を別の列に分けない（分けるとどちらが本物か決まらない）。
--   組み直しをさせないのも同じ理由で、作り直すと直した並びが消える。
--   generated_at が入っていて plan が空でなければ、その日はもう組まない。
--
-- ★block はコマIDで持つ（'slot:<schedule_time_slots.id>'）。
--   コマ番号（3限）で持つと、教室ごとにコマの時刻が違ううえ、
--   個別と集団で同じ番号に別の時刻が割り当たっているため、どの時間の話か決まらない。
--
-- ★plan は jsonb の配列そのまま。列に割らないのは、行が
--   「チェック・本文・理由・移動先」を1件ずつ持つ短命なメモで、
--   その日を過ぎたら検索も集計もしないため。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.today_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,

  -- 段取りを組んだ日（教室のローカル日付。画面がその日の 'YYYY-MM-DD' を送る）
  plan_date date NOT NULL,

  -- PlanItem[]（src/lib/ai/todayPlan.ts）。★手で直した結果がそのまま入る
  plan jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- 朝に組んだ時刻。★NULL なら「まだ組んでいない」＝画面に「組む」ボタンを出す
  generated_at timestamptz,

  -- 最後に手を入れた人。誰の段取りかではなく、誰が直したかの記録
  updated_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (school_id, plan_date)
);

COMMENT ON TABLE public.today_plans IS
  '今日の段取り。教室×日付で1行・直した結果が正典（docs/today-plan-ai-plan.md）';
COMMENT ON COLUMN public.today_plans.plan IS
  'PlanItem[]。block は before / slot:<time_slot_id> / after / later';
COMMENT ON COLUMN public.today_plans.generated_at IS
  'AIが組んだ時刻。入っていて plan が空でなければ組み直さない（直した並びが消えるため）';

-- 画面はいつも「その教室の直近の日付」を1件引く
CREATE INDEX IF NOT EXISTS idx_today_plans_school_date
  ON public.today_plans (school_id, plan_date DESC);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
-- ★Supabaseの既定権限で anon / authenticated に ALL が付く。止めているのはRLSだけなので、
--   まず剥がしてから要るぶんだけ付け直す。
-- 削除は開けない。消したい行があるなら plan の中身から消せばよく、
-- 行ごと消せる口を開けると「今日はまだ組んでいない」に戻ってしまう。
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
