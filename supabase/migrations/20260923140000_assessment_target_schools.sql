-- ============================================================
-- 模試の志望校と合格可能性（assessment_target_schools）
-- ============================================================
-- 正典: docs/interview-workspace-layout-2026-09.md「模試の志望校」
--
-- 模試（進研テスト・Vもぎ）の結果には、生徒が書いた志望校（最大5つ）と
-- それぞれの合格可能性が載っている。いままで取り込み画面はこれを読み捨てており、
-- 面談の④で「狛江 60%（前回 50%）」と言えなかった。
--
-- ★assessments に列を足さない。1回の模試に志望校が最大5行あるため。
--
-- ★枠の番号（slot）は模試の位置のまま持つ。1〜3＝公立、4〜5＝私立。
--   空いた枠を詰めると私立が公立の枠に入り、第1志望の自動登録を誤る。
--
-- ★合格可能性の「**」（判定不能）は possibility を NULL にして possibility_unjudged で持つ。
--   0 で持つと「合格可能性ゼロ」と読まれ、次の模試と比べて「上がった」に見える。
--
-- ★学校名は模試に書かれたまま（school_name_raw）で持ち、高校マスタに当たったときだけ
--   high_school_id を埋める（student_target_schools と同じ考え方）。
--   high_school_id は ON DELETE SET NULL。マスタの版の入れ替えで模試の記録を道連れにしない。
--
-- ★assessment_id は ON DELETE CASCADE。模試の行を消したら、その模試の志望校も消える
--  （模試の行と別に残っても、どの模試の数字か分からない）。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.assessment_target_schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  assessment_id uuid NOT NULL REFERENCES public.assessments (id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students (id) ON DELETE CASCADE,
  -- 教室。RLSが見る列。★トリガーで生徒の所属校に強制する（下）
  school_id uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,

  slot smallint NOT NULL,                 -- 模試の志望校欄の位置 1〜5
  is_public boolean NOT NULL,             -- slot 1〜3 が公立
  school_name_raw text NOT NULL,          -- 模試に書かれたまま（「狛江－普通」）
  high_school_id uuid REFERENCES public.high_schools (id) ON DELETE SET NULL,
  possibility smallint,                   -- 合格可能性（%）。判定不能・空欄は NULL
  possibility_unjudged boolean NOT NULL DEFAULT false, -- 「**」（判定不能）だった

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT assessment_target_schools_slot_range CHECK (slot BETWEEN 1 AND 5),
  CONSTRAINT assessment_target_schools_is_public_by_slot CHECK (is_public = (slot <= 3)),
  CONSTRAINT assessment_target_schools_possibility_range CHECK (possibility BETWEEN 0 AND 100),
  -- 判定不能なのに数字がある、は矛盾。どちらかに寄せる
  CONSTRAINT assessment_target_schools_unjudged_has_no_number
    CHECK (NOT (possibility_unjudged AND possibility IS NOT NULL)),
  CONSTRAINT assessment_target_schools_unique_slot UNIQUE (assessment_id, slot)
);

COMMENT ON TABLE public.assessment_target_schools IS '模試に書いた志望校と合格可能性。1回の模試に最大5枠（1〜3公立・4〜5私立）。';
COMMENT ON COLUMN public.assessment_target_schools.slot IS '模試の志望校欄の位置。空き枠を詰めない（1〜3＝公立、4〜5＝私立）。';
COMMENT ON COLUMN public.assessment_target_schools.school_name_raw IS '模試に書かれたままの学校名（「学校－学科」）。';
COMMENT ON COLUMN public.assessment_target_schools.high_school_id IS '高校マスタに当たったときだけ埋める。私立は当たらないのが正常。';
COMMENT ON COLUMN public.assessment_target_schools.possibility IS '合格可能性（%）。判定不能・空欄は NULL。';
COMMENT ON COLUMN public.assessment_target_schools.possibility_unjudged IS '模試の判定が「**」（判定不能）だった。NULL の possibility を 0 と読まないための印。';

CREATE INDEX IF NOT EXISTS idx_assessment_target_schools_student ON public.assessment_target_schools (student_id);
CREATE INDEX IF NOT EXISTS idx_assessment_target_schools_school ON public.assessment_target_schools (school_id);

-- ------------------------------------------------------------
-- school_id を生徒の所属校に強制する
-- ★student_target_schools（20260921130000）と同じ型。RLSが見る唯一の列なので、
--   生徒の所属校とズレると担当の講師から見えなくなる。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_assessment_target_school_school_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s_school uuid;
BEGIN
  SELECT school_id INTO s_school FROM students WHERE id = NEW.student_id;
  IF s_school IS NOT NULL THEN
    NEW.school_id := s_school;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_assessment_target_school_school_id() IS
  '模試の志望校の school_id を生徒の所属校で上書きする。RLSが見る列なのでズレると行が見えなくなる。';

-- トリガー関数は直接呼ぶものではない。RPC として叩けないように閉じる。
REVOKE ALL ON FUNCTION public.sync_assessment_target_school_school_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_assessment_target_schools_sync_school ON public.assessment_target_schools;
CREATE TRIGGER trg_assessment_target_schools_sync_school
  BEFORE INSERT OR UPDATE OF student_id, school_id ON public.assessment_target_schools
  FOR EACH ROW EXECUTE FUNCTION public.sync_assessment_target_school_school_id();

-- ------------------------------------------------------------
-- RLS。students・student_target_schools と同じ教室スコープ
-- ------------------------------------------------------------
ALTER TABLE public.assessment_target_schools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assessment_target_schools_select ON public.assessment_target_schools;
CREATE POLICY assessment_target_schools_select ON public.assessment_target_schools
  FOR SELECT TO authenticated USING (public.check_school_access(school_id));

DROP POLICY IF EXISTS assessment_target_schools_insert ON public.assessment_target_schools;
CREATE POLICY assessment_target_schools_insert ON public.assessment_target_schools
  FOR INSERT TO authenticated WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS assessment_target_schools_update ON public.assessment_target_schools;
CREATE POLICY assessment_target_schools_update ON public.assessment_target_schools
  FOR UPDATE TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

DROP POLICY IF EXISTS assessment_target_schools_delete ON public.assessment_target_schools;
CREATE POLICY assessment_target_schools_delete ON public.assessment_target_schools
  FOR DELETE TO authenticated USING (public.check_school_access(school_id));

-- ★既定権限で anon / authenticated に ALL が付くので revoke してから付け直す。
--   模試の結果と志望校は生徒の個人情報。未ログインから触れてはいけない。
REVOKE ALL ON public.assessment_target_schools FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_target_schools TO authenticated;
