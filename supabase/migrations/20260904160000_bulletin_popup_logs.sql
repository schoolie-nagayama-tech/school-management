-- ============================================================
-- 連絡掲示板AIアシスト: 授業中ポップアップの記録
-- ============================================================
-- 正典: docs/bulletin-ai-assist.html §3
--
-- ★2つの役目がある。
--   1. 1コマにつき1件だけ、を成立させる。出したかどうかをここで見る。
--   2. 効果測定。出した／待った／見送った の内訳と、出した後に済んだかを見る。
--      これが無いと「ポップアップが効いているのか」に答えられず、
--      機能を続けるかどうかの判断ができない。
--
-- ★出さなかった判断も残す。出した回数だけを見ると
--   「AIがどれだけ黙ったか」が分からず、既定を出さない側に倒した設計が
--   効きすぎているのか足りないのかを検証できない。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bulletin_popup_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  schedule_entry_id uuid NOT NULL REFERENCES public.schedule_entries(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.bulletin_tasks(id) ON DELETE CASCADE,

  teacher_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,

  -- 実際に画面へ出したか
  shown boolean NOT NULL DEFAULT false,
  -- show / wait / skip。AIが何と答えたか（強制表示のときは show）
  action text NOT NULL,
  -- そう判断した理由。教室長が読む
  reason text,
  -- 授業の何分時点だったか
  elapsed_minutes int NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bulletin_popup_logs
  DROP CONSTRAINT IF EXISTS bulletin_popup_logs_action_check;
ALTER TABLE public.bulletin_popup_logs
  ADD CONSTRAINT bulletin_popup_logs_action_check CHECK (action IN ('show', 'wait', 'skip'));

COMMENT ON TABLE public.bulletin_popup_logs IS
  '授業中ポップアップの判断の記録。1コマ1件の判定と効果測定に使う（docs/bulletin-ai-assist.html §3）';
COMMENT ON COLUMN public.bulletin_popup_logs.shown IS
  '実際に出したか。出さなかった判断も残すのは、AIがどれだけ黙ったかを見るため';

-- 「このコマでもう出したか」を引く。ここが一番よく叩かれる
CREATE INDEX IF NOT EXISTS idx_bulletin_popup_logs_entry
  ON public.bulletin_popup_logs (schedule_entry_id, shown);

CREATE INDEX IF NOT EXISTS idx_bulletin_popup_logs_school_created
  ON public.bulletin_popup_logs (school_id, created_at DESC);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
-- 読みは自教室のスタッフ、書きは API（service role）だけ。
-- ★Supabaseの既定権限で anon/authenticated に ALL が付くため、明示的に剥がしてから付け直す。
ALTER TABLE public.bulletin_popup_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.bulletin_popup_logs FROM anon, authenticated;
GRANT SELECT ON public.bulletin_popup_logs TO authenticated;

DROP POLICY IF EXISTS bulletin_popup_logs_select ON public.bulletin_popup_logs;
CREATE POLICY bulletin_popup_logs_select ON public.bulletin_popup_logs
  FOR SELECT TO authenticated
  USING (public.check_school_access(school_id));
