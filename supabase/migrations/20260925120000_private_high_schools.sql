-- ============================================================
-- 私立（と国立）の高校を高校マスタに入れる
-- ============================================================
-- 正典: docs/private-high-school-master.md
--
-- ★別テーブルにしない。志望校（student_target_schools.high_school_id）・高校検索・
--   面談④の表・地図が「学校＝high_schools の1行」を前提にしているので、同じ表に
--   設置区分の列を足すほうが、既存の画面を変えずに私立を扱える。
--   都立に準拠する方針（教室長 2026-09-25）なので、列の持ち方も都立に揃える
--  （学校×コースで1行、偏差値は high_school_standards に版を積む）。
--
-- ★私立の推薦・併願優遇の基準は high_school_admission_rules に持つ。
--   都立の「めやす1行」に収まらない（「5科20または9科35」「9科に1は不可」「英検準2級で+1」
--   「2年次＋3年次×2」…）。教室長の方針は「私立の方が複雑で個別の条件がある。だからこそ
--   システムに手伝ってほしい」。条件を式（JSON）で持ち、生徒の内申に当てて判定する
--  （src/lib/interview/privateAdmission.ts）。
-- ============================================================

-- ------------------------------------------------------------
-- high_schools: 設置区分・男女・電話
-- ------------------------------------------------------------
-- ★既定値 '公立' で既存の都立・神奈川県立の行はそのまま公立になる（埋め直し不要）。
ALTER TABLE public.high_schools
  ADD COLUMN IF NOT EXISTS establishment text NOT NULL DEFAULT '公立',
  ADD COLUMN IF NOT EXISTS gender_type text,
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.high_schools DROP CONSTRAINT IF EXISTS high_schools_establishment_check;
ALTER TABLE public.high_schools
  ADD CONSTRAINT high_schools_establishment_check CHECK (establishment IN ('公立', '私立', '国立'));

ALTER TABLE public.high_schools DROP CONSTRAINT IF EXISTS high_schools_gender_type_check;
ALTER TABLE public.high_schools
  ADD CONSTRAINT high_schools_gender_type_check
  CHECK (gender_type IS NULL OR gender_type IN ('男子', '女子', '共学'));

COMMENT ON COLUMN public.high_schools.establishment IS '設置区分。公立（都立・県立・市立）/ 私立 / 国立（国立大附属・国立高専）';
COMMENT ON COLUMN public.high_schools.gender_type IS '男子校・女子校・共学。公立は NULL のまま（ほぼ全校共学）。コース別に男女が違う私立は共学';
COMMENT ON COLUMN public.high_schools.phone IS '学校の電話（私立は冊子の入試窓口の番号）。入試相談の問い合わせに使う';

-- ★一意の範囲に設置区分を入れる。同じ都県に同じ略称の公立と私立がありうる
--  （私立の「八王子」＝八王子学園八王子、私立の「東京」＝東京高校 など、冊子の略称は短い）。
--   取込スクリプトの onConflict もこの並びに揃えてある（scripts/import-*.mjs）。
ALTER TABLE public.high_schools DROP CONSTRAINT IF EXISTS high_schools_unique_course;
ALTER TABLE public.high_schools
  ADD CONSTRAINT high_schools_unique_course UNIQUE (prefecture, establishment, school_name, course);

CREATE INDEX IF NOT EXISTS idx_high_schools_establishment ON public.high_schools (establishment);

-- ------------------------------------------------------------
-- high_school_standards: 男女別の偏差値
-- ------------------------------------------------------------
-- Vもぎの私立の偏差値表は【男子】【女子】で別の表。共学校でも男女で偏差値が違う。
-- ★都立・神奈川県立の行は NULL（男女共通）のまま。
ALTER TABLE public.high_school_standards
  ADD COLUMN IF NOT EXISTS gender text;

ALTER TABLE public.high_school_standards DROP CONSTRAINT IF EXISTS high_school_standards_gender_check;
ALTER TABLE public.high_school_standards
  ADD CONSTRAINT high_school_standards_gender_check
  CHECK (gender IS NULL OR gender IN ('男子', '女子'));

COMMENT ON COLUMN public.high_school_standards.gender IS '男女別のめやす（私立の偏差値表は男子表・女子表で別）。NULL＝男女共通';

-- ★NULLS NOT DISTINCT: gender が NULL の行（都立）同士も重複とみなす。
--   素の UNIQUE だと NULL 同士は別物扱いになり、同じ版を2回入れても弾けない。
ALTER TABLE public.high_school_standards DROP CONSTRAINT IF EXISTS high_school_standards_unique_version;
ALTER TABLE public.high_school_standards
  ADD CONSTRAINT high_school_standards_unique_version
  UNIQUE NULLS NOT DISTINCT (high_school_id, source, source_year, gender);

-- ------------------------------------------------------------
-- high_school_admission_rules: 推薦・併願優遇の基準
-- ------------------------------------------------------------
-- 1行 = 学校×コース（high_schools の1行）× 入試区分 × 対象（都内生／都神外生 など）× 性別。
-- ★版を積む（source, source_year）。基準は毎年変わる。過去の面談で示した判定を後から
--   再現できるよう、新しい年度を入れても古い年度は消さない（high_school_standards と同じ考え方）。
CREATE TABLE IF NOT EXISTS public.high_school_admission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  high_school_id uuid NOT NULL REFERENCES public.high_schools (id) ON DELETE CASCADE,

  source text NOT NULL,                  -- '推薦・一般入試の基準表'
  source_year smallint NOT NULL,         -- 2027（令和9年度受験用）
  source_label text NOT NULL,            -- 画面に出す出典表記
  source_page text,                      -- 冊子のページ（原本と照らすため）

  section text NOT NULL,                 -- 冊子のどの列から取ったか: '推薦' / '一般'
  exam_label text NOT NULL,              -- 冊子の呼び方そのまま（'B推薦（公私併願, 都神外生）'）
  kind text NOT NULL,                    -- 判定用の正規化: '推薦' / '単願' / '併願'
  public_only boolean NOT NULL DEFAULT false,  -- （公）＝公立併願のみ
  applicant_scope text,                  -- 受験者の住所の限定（'都神外生' '東京・神奈川県生'）
  gender text,                           -- 男女で基準が違う学校だけ
  strength text,                         -- '出願資格' / '出願基準' / '目安'

  -- 条件の式。{ any: Clause[][], gates: Clause[], bonus: Bonus|null, no_criterion: string|null }
  -- 型の正典は src/lib/interview/privateAdmission.ts の AdmissionRuleBody。
  rule jsonb NOT NULL,
  -- 式にできない条件（欠席日数・説明会参加・作文 など）。面談で人が確かめる
  checks text[] NOT NULL DEFAULT '{}',
  -- 冊子の原文。判定がおかしいときに原本と照らす
  raw_text text NOT NULL DEFAULT '',
  -- 書き起こしで読み取りに自信がなかった箇所がある
  uncertain boolean NOT NULL DEFAULT false,
  sort_order smallint NOT NULL DEFAULT 0,

  -- ★紙と突き合わせた日。NULL = 未確認（AIの書き起こしのまま）。
  --   AI同士の読み取りが一致しただけでは入れない。人が原本と照らしたものだけ。
  verified_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT high_school_admission_rules_section_check CHECK (section IN ('推薦', '一般')),
  CONSTRAINT high_school_admission_rules_kind_check CHECK (kind IN ('推薦', '単願', '併願')),
  CONSTRAINT high_school_admission_rules_gender_check CHECK (gender IS NULL OR gender IN ('男子', '女子')),
  CONSTRAINT high_school_admission_rules_strength_check
    CHECK (strength IS NULL OR strength IN ('出願資格', '出願基準', '目安'))
);

COMMENT ON TABLE public.high_school_admission_rules IS
  '私立・国立高校の推薦・併願優遇の基準。条件を式（rule jsonb）で持ち、生徒の内申に当てて判定する。年度ごとに版を積む';
COMMENT ON COLUMN public.high_school_admission_rules.rule IS
  '条件の式。型は src/lib/interview/privateAdmission.ts の AdmissionRuleBody';
COMMENT ON COLUMN public.high_school_admission_rules.kind IS
  '推薦＝単願・専願の推薦／単願＝一般の単願・専願・第1志望優遇／併願＝併願推薦・併願優遇・書類選考の併願';
COMMENT ON COLUMN public.high_school_admission_rules.verified_at IS '紙の原本と突き合わせた日時。NULLは未確認';

CREATE INDEX IF NOT EXISTS idx_hs_admission_rules_school
  ON public.high_school_admission_rules (high_school_id, source_year);

DROP TRIGGER IF EXISTS trg_high_school_admission_rules_updated_at ON public.high_school_admission_rules;
CREATE TRIGGER trg_high_school_admission_rules_updated_at
  BEFORE UPDATE ON public.high_school_admission_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- RLS（high_schools と同じ。全教室共通の参照マスタ）
-- ------------------------------------------------------------
ALTER TABLE public.high_school_admission_rules ENABLE ROW LEVEL SECURITY;

-- 読みは認証済みなら全員。講師も面談で見る。
DROP POLICY IF EXISTS hs_admission_rules_select ON public.high_school_admission_rules;
CREATE POLICY hs_admission_rules_select ON public.high_school_admission_rules
  FOR SELECT TO authenticated USING (true);

-- 書き込みは admin / owner だけ。全教室が同じ行を見るので、1人が直すと全員に効く。
DROP POLICY IF EXISTS hs_admission_rules_write ON public.high_school_admission_rules;
CREATE POLICY hs_admission_rules_write ON public.high_school_admission_rules
  FOR ALL TO authenticated
  USING (public.check_user_role(ARRAY['admin'::text, 'owner'::text]))
  WITH CHECK (public.check_user_role(ARRAY['admin'::text, 'owner'::text]));

-- ★既定権限で anon / authenticated に ALL が付く。止めているのはRLSだけなので、
--   revoke してから必要な分だけ付け直す。
REVOKE ALL ON public.high_school_admission_rules FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.high_school_admission_rules TO authenticated;
