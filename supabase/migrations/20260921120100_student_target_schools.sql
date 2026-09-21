-- ============================================================
-- 志望校（student_target_schools）
-- ============================================================
-- 正典: docs/interview-script-ai-plan.md §4-1
--
-- 面談の②ヒアリングで聞く「第1志望・第2志望とその理由」の置き場。
-- いままでNESTのどこにも無く、④「目標との差の確認」が書けなかった。
--
-- ★students に列を足さない。第1・第2志望で行が増えるため。
--
-- ★学校名は自由記述（school_name）で持ち、高校マスタに当たったときだけ
--   high_school_id を埋める。私立・国立・他県はマスタに無いので、
--   FKを必須にすると入力そのものができなくなる。
--
-- ★high_school_id は ON DELETE SET NULL。
--   マスタを版の入れ替えで消したときに、生徒が入力した志望校まで道連れで
--   消えてはいけない。学校名が残っていれば面談はできる。
--   （提案書のFKで同じ道連れ消失の事故を起こしたことがある）
-- ============================================================

CREATE TABLE IF NOT EXISTS public.student_target_schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 教室。students と同じ見え方にするために持つ
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students (id) ON DELETE CASCADE,

  rank smallint NOT NULL,               -- 1=第1志望, 2=第2志望, 3=第3志望
  school_name text NOT NULL,            -- 入力された学校名。都立以外もある
  high_school_id uuid REFERENCES public.high_schools (id) ON DELETE SET NULL,
  reason text,                          -- 志望の理由。面談で聞いた言葉をそのまま

  updated_by uuid REFERENCES public.user_profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT student_target_schools_rank_range CHECK (rank BETWEEN 1 AND 3),
  CONSTRAINT student_target_schools_unique_rank UNIQUE (student_id, rank)
);

COMMENT ON TABLE public.student_target_schools IS '生徒の志望校。第1〜第3志望まで。面談の②で聞いて入れる。';
COMMENT ON COLUMN public.student_target_schools.school_name IS '学校名の自由記述。マスタに無い私立・国立・他県もここに入る。';
COMMENT ON COLUMN public.student_target_schools.high_school_id IS '高校マスタに当たったときだけ埋める。当たらなければNULLのまま。';
COMMENT ON COLUMN public.student_target_schools.reason IS '志望の理由。保護者・生徒の言葉をそのまま残す。';

CREATE INDEX IF NOT EXISTS idx_student_target_schools_student ON public.student_target_schools (student_id, rank);
CREATE INDEX IF NOT EXISTS idx_student_target_schools_school ON public.student_target_schools (school_id);

DROP TRIGGER IF EXISTS trg_student_target_schools_updated_at ON public.student_target_schools;
CREATE TRIGGER trg_student_target_schools_updated_at
  BEFORE UPDATE ON public.student_target_schools
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- RLS。students と同じ教室スコープ
-- ------------------------------------------------------------
ALTER TABLE public.student_target_schools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_target_schools_select ON public.student_target_schools;
CREATE POLICY student_target_schools_select ON public.student_target_schools
  FOR SELECT TO authenticated USING (public.check_school_access(school_id));

DROP POLICY IF EXISTS student_target_schools_insert ON public.student_target_schools;
CREATE POLICY student_target_schools_insert ON public.student_target_schools
  FOR INSERT TO authenticated WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS student_target_schools_update ON public.student_target_schools;
CREATE POLICY student_target_schools_update ON public.student_target_schools
  FOR UPDATE TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS student_target_schools_delete ON public.student_target_schools;
CREATE POLICY student_target_schools_delete ON public.student_target_schools
  FOR DELETE TO authenticated USING (public.check_school_access(school_id));

-- ★既定権限で anon / authenticated に ALL が付くので revoke してから付け直す。
--   志望校は生徒の個人情報。未ログインから触れてはいけない。
REVOKE ALL ON public.student_target_schools FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_target_schools TO authenticated;
