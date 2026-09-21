-- ============================================================
-- 志望校の school_id を生徒の所属校に強制する
-- ============================================================
-- 正典: docs/interview-script-ai-plan.md §4-1
--
-- ★`student_target_schools.school_id` は RLS（`check_school_access`）が見る唯一の列。
--   ここが生徒の所属校とズレると、その行は担当の講師から見えなくなる。
--   所持教材（`student_textbooks`）で同じ事故を起こしており、あちらも
--   `sync_student_textbook_school_id` トリガーで強制している。同じ型で塞ぐ。
--
-- ★これでクライアントは school_id を渡さなくてよくなる（渡しても上書きされる）。
--   NOT NULL だが BEFORE トリガーで埋まるので、NULL で INSERT しても通る。
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_student_target_school_school_id()
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

COMMENT ON FUNCTION public.sync_student_target_school_school_id() IS
  '志望校の school_id を生徒の所属校で上書きする。RLSが見る列なのでズレると行が見えなくなる。';

-- トリガー関数は直接呼ぶものではない。RPC として叩けないように閉じる。
REVOKE ALL ON FUNCTION public.sync_student_target_school_school_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_student_target_schools_sync_school ON public.student_target_schools;
CREATE TRIGGER trg_student_target_schools_sync_school
  BEFORE INSERT OR UPDATE OF student_id, school_id ON public.student_target_schools
  FOR EACH ROW EXECUTE FUNCTION public.sync_student_target_school_school_id();
