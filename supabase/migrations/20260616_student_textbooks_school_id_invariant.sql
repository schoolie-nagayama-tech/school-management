-- ============================================================
-- 所持教材(student_textbooks)の school_id 不変条件をDBで強制する
--
-- 背景:
--   student_textbooks.school_id は RLS(check_school_access) の可視性スコープに使われる。
--   講師は user_schools の自校しか見られないため、この列が生徒の所属校と食い違うと
--   「生徒は見えるが所持教材だけ見えない」状態になる（2026-06-16 に本番で 113 行発生）。
--   発生源は school_id を生徒の所属校以外（デフォルト教室 / 発注校 / 選択中フィルタ校）で
--   作っていたアプリ経路。アプリ側は修正したが、将来の新規経路・直SQL・生徒の転校でも
--   再びズレ得るため、「student_textbooks.school_id は常に students.school_id に一致する」
--   という不変条件をDBレベルで担保する。
-- ============================================================

BEGIN;

-- 1) student_textbooks への書き込み時、school_id を必ず生徒の所属校に正規化する。
--    どのアプリ経路・直SQLから来ても school_id がズレない。
--    SECURITY DEFINER で RLS をバイパスして students を参照する。
CREATE OR REPLACE FUNCTION public.sync_student_textbook_school_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s_school uuid;
BEGIN
  SELECT school_id INTO s_school FROM students WHERE id = NEW.student_id;
  -- 生徒の所属校が取れた場合のみ上書き（取れない異常時は渡された値を尊重）
  IF s_school IS NOT NULL THEN
    NEW.school_id := s_school;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_textbooks_sync_school ON public.student_textbooks;
CREATE TRIGGER trg_student_textbooks_sync_school
  BEFORE INSERT OR UPDATE ON public.student_textbooks
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_student_textbook_school_id();

-- 2) 生徒が転校(students.school_id 変更)したら、その生徒の所持教材を追従させる。
--    所持教材は生徒に帰属するため、転校後は新しい校の講師から見える必要がある。
CREATE OR REPLACE FUNCTION public.cascade_student_school_to_textbooks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.school_id IS DISTINCT FROM OLD.school_id THEN
    UPDATE student_textbooks
    SET school_id = NEW.school_id
    WHERE student_id = NEW.id
      AND school_id IS DISTINCT FROM NEW.school_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_students_cascade_school ON public.students;
CREATE TRIGGER trg_students_cascade_school
  AFTER UPDATE OF school_id ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_student_school_to_textbooks();

COMMIT;
