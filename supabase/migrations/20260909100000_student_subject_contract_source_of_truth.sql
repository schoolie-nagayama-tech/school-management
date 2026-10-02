-- 科目ごとのコース（PS1／PS2／キッズ）を「実登録の写し」から「正のソース」に戻す。
--
-- 用語:
--   画面では「コース」と呼ぶ（PS1=1対1・90分 / PS2=1対2・90分 / キッズ=1対2・45分）。
--   テーブル名 student_subject_contracts は本番にあるものをそのまま使う（改名すると移行が要るため）。
--   コード上の呼び名がズレるので、ここに対応を書いておく。
--
-- 背景:
--   通塾日程・座席表のフォームで選んだ比率が upsertStudentContract でコースに書き戻されていた。
--   同じ「英語は1対1」という事実を、曜日を足すたび・版を切るたび・講師を変えるたびに
--   選ばされ、そのつど上書きされる。どこか1回で1対2を選べばコースごと1対2になり、
--   矛盾が残らないので誰も気づけない（他社システムで数か月気づかれなかった事故と同じ構造）。
--   コースは生徒×科目に1つだけ持ち、動かすのは「コースを変更する」専用操作だけにする。
--
-- このマイグレーションでやること:
--   1. student_subject_contracts に duration_minutes / updated_by を追加。
--      コースが ratio だけだと「この生徒のこの科目は45分」を表現できず、
--      45分/90分が教室共通の subjects.duration_minutes 由来のままになる。
--      実際のコースは PS1 / PS2 / キッズ(45分) なので (ratio, duration_minutes) の組で持つ。
--   2. 変更履歴テーブル student_subject_contract_changes を新設。
--
-- ★既存の通塾日程からの一括投入は「やらない」。
--   座席表がまだ稼働しておらず、比率欄は誰にも触られていない（本番の個別授業1,386コマのうち
--   1対1は0件・コースは11行のみ）。いまの登録を写しても「全員1対2」という根拠のないデータが
--   450件できるだけで、それを正のコースとして固定すると事故の構造が変わらない。
--   コースは座席表の稼働に合わせ、通塾日程の初回登録のときに1回だけ聞いて埋める。
--
-- 挙動不変の保証:
--   duration_minutes は NULL 許容で既定 NULL。NULL = 「科目マスタ(subjects.duration_minutes)に従う」
--   という従来どおりの意味なので、既存11行の解釈は変わらない。
--
-- ロールバック:
--   ALTER TABLE public.student_subject_contracts
--     DROP COLUMN IF EXISTS duration_minutes,
--     DROP COLUMN IF EXISTS updated_by;
--   DROP TABLE IF EXISTS public.student_subject_contract_changes;

-- ============================================================
-- 1. コーステーブルに列を足す
-- ============================================================
ALTER TABLE public.student_subject_contracts
  -- 授業時間(分): 45 or 90。NULL = 科目マスタ(subjects.duration_minutes)に従う（従来の意味）。
  ADD COLUMN IF NOT EXISTS duration_minutes smallint
    CHECK (duration_minutes IS NULL OR duration_minutes IN (45, 90)),
  -- 最終変更者。誰が動かしたかを行だけ見て分かるようにする（経緯は履歴テーブル）。
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;

COMMENT ON TABLE public.student_subject_contracts IS
  '生徒×科目のコース(PS1=1対1・90分 / PS2=1対2・90分 / キッズ=1対2・45分)。'
  '通塾日程・座席表の比率と時間はここが正のソース。授業登録フォームからは書き換えない。';
COMMENT ON COLUMN public.student_subject_contracts.duration_minutes IS
  'コース上の授業時間(分): 45 or 90。NULL=科目マスタ(subjects.duration_minutes)に従う。'
  '教室共通の科目マスタでは「この生徒のこの科目だけ45分」を表せないためコース側に持つ。';

-- ============================================================
-- 2. 変更履歴
-- ============================================================
-- コースを動かした事実そのものを残す。コース行を UPDATE で上書きしても、
-- 「いつ・誰が・なぜ・何から何へ」変えたかが分かるようにするのがこのテーブルの目的。
-- 初回登録（それまでコースが無かった科目に入れた）は from_* を NULL にして1行残す。
CREATE TABLE IF NOT EXISTS public.student_subject_contract_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  -- 変更前。NULL = 初回登録（それまでコースが無かった）。
  from_ratio smallint CHECK (from_ratio IS NULL OR from_ratio IN (1, 2)),
  from_duration_minutes smallint CHECK (from_duration_minutes IS NULL OR from_duration_minutes IN (45, 90)),
  -- 変更後。
  to_ratio smallint NOT NULL CHECK (to_ratio IN (1, 2)),
  to_duration_minutes smallint CHECK (to_duration_minutes IS NULL OR to_duration_minutes IN (45, 90)),
  -- 理由。選択肢＋自由記述。理由を必須にするのは「片手間に変えられなくする」ため。
  reason_code text NOT NULL
    CHECK (reason_code IN ('initial', 'correction', 'course_change', 'grade_change', 'other')),
  reason_note text,
  changed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_changes_student
  ON public.student_subject_contract_changes USING btree (student_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_contract_changes_school
  ON public.student_subject_contract_changes USING btree (school_id, changed_at DESC);

COMMENT ON TABLE public.student_subject_contract_changes IS
  '科目ごとのコース(1対1/1対2・45分/90分)の変更履歴。理由の記録が必須。'
  'コースが授業登録のついでに動かないようにした際、「動かしたなら痕跡が残る」を担保する台帳。';
COMMENT ON COLUMN public.student_subject_contract_changes.reason_code IS
  'initial=初回登録 / correction=登録の誤りを訂正 / course_change=保護者申出のコース変更 / '
  'grade_change=学年の切り替え / other=その他';

ALTER TABLE public.student_subject_contract_changes ENABLE ROW LEVEL SECURITY;

-- コーステーブルと同型（check_school_access）。書き込みを教室長以上に絞るのはアプリ側で行う
-- （RLS でロールまで見ると既存ポリシーと流儀が変わるため、ここは自校スコープの境界だけ引く）。
DROP POLICY IF EXISTS "contract_changes_school_scope_auth"
  ON public.student_subject_contract_changes;
CREATE POLICY "contract_changes_school_scope_auth"
  ON public.student_subject_contract_changes FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- Supabase の既定で anon/authenticated に ALL が付くため、明示的に revoke してから付け直す。
-- 履歴は台帳なので authenticated には SELECT / INSERT だけ与える（訂正は新しい行を積む）。
REVOKE ALL ON TABLE public.student_subject_contract_changes FROM anon;
REVOKE ALL ON TABLE public.student_subject_contract_changes FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.student_subject_contract_changes TO authenticated;
GRANT ALL ON TABLE public.student_subject_contract_changes TO service_role;
