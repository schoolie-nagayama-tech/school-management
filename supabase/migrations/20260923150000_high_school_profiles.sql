-- ============================================================
-- 高校マスタに「生徒が学校を選ぶ材料」を足す
-- ============================================================
-- 正典: docs/high-school-profile-plan.md
--
-- ★学校単位の親（high_school_campuses）を新設する。
--   今の high_schools は「学校×学科」で1行。部活・進学実績・行事・校則は学校全体の情報なので、
--   学科の行に持たせると「小平」と「小平（外）」に同じ部活一覧が2回入り、片方だけ直す事故が起きる。
--   倍率・生徒数のような学科ごとの数字は、high_school_stats の course_label で学科を区別する。
--
-- ★どの行にも出典（source_url）・時点・確認日（verified_at）を持つ。
--   AIヘルプには verified_at のある値だけを渡す（間違ったヘルプは無いヘルプより悪い）。
--   試し調査で、調査エージェントの誤りが2件・訂正の誤りまで出た（設計書 §7）。
--
-- ★全教室で共通の参照マスタ。school_id（教室）は持たない。
--   書き込みは admin / owner だけ（今の高校マスタと同じ理由：全教室が同じ行を見る）。
--   取込は service role のスクリプトから行う。
-- ============================================================

-- ------------------------------------------------------------
-- 学校（親）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.high_school_campuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prefecture text NOT NULL,
  school_name text NOT NULL,
  -- 都教委の学校番号（6桁）。都立だけ。神奈川は県CSVのIDが重複していたので使わない
  school_code text,
  -- 文部科学省の学校コード（13桁、例 D114210010188）。神奈川の県統計に載っている。
  -- 神奈川は学校名で突き合わせてきたが、同名・改称に弱いので、これを結合キーに育てる
  mext_code text,
  official_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT high_school_campuses_unique_name UNIQUE (prefecture, school_name)
);

COMMENT ON TABLE public.high_school_campuses IS '高校（学校単位）。high_schools（学校×学科）の親。部活・進学実績・校則・変化はここにぶら下げる';
COMMENT ON COLUMN public.high_school_campuses.mext_code IS '文部科学省の学校コード（13桁）。神奈川の県統計に載っている';

CREATE UNIQUE INDEX IF NOT EXISTS idx_hs_campuses_mext_code
  ON public.high_school_campuses (mext_code) WHERE mext_code IS NOT NULL;

ALTER TABLE public.high_schools
  ADD COLUMN IF NOT EXISTS campus_id uuid REFERENCES public.high_school_campuses (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_high_schools_campus ON public.high_schools (campus_id);

-- 既存の学科の行から学校を起こす（2026-09-23 時点で 404行 → 301校）
INSERT INTO public.high_school_campuses (prefecture, school_name, school_code)
SELECT prefecture, school_name, max(school_code)
FROM public.high_schools
GROUP BY prefecture, school_name
ON CONFLICT (prefecture, school_name) DO NOTHING;

UPDATE public.high_schools h
SET campus_id = c.id
FROM public.high_school_campuses c
WHERE c.prefecture = h.prefecture
  AND c.school_name = h.school_name
  AND h.campus_id IS NULL;

-- ★学科の行を足したら、親の学校を自動で付ける。
--   既存の取込スクリプト（import-high-schools.mjs / import-kanagawa-schools.mjs）は campus_id を知らない。
--   スクリプト側で付け忘れると、その学科だけ部活も進学実績も出ない学校になる（黙って欠ける）。
CREATE OR REPLACE FUNCTION public.high_schools_attach_campus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.campus_id IS NULL THEN
    INSERT INTO public.high_school_campuses (prefecture, school_name, school_code)
    VALUES (NEW.prefecture, NEW.school_name, NEW.school_code)
    ON CONFLICT (prefecture, school_name) DO NOTHING;

    SELECT id INTO NEW.campus_id
    FROM public.high_school_campuses
    WHERE prefecture = NEW.prefecture AND school_name = NEW.school_name;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.high_schools_attach_campus() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_high_schools_attach_campus ON public.high_schools;
CREATE TRIGGER trg_high_schools_attach_campus
  BEFORE INSERT ON public.high_schools
  FOR EACH ROW EXECUTE FUNCTION public.high_schools_attach_campus();

ALTER TABLE public.high_schools ALTER COLUMN campus_id SET NOT NULL;

-- ------------------------------------------------------------
-- 年度ごとの数字・事実
-- ------------------------------------------------------------
-- 1行＝学校（か学科）×年度×項目×（学年・男女・内訳）。
-- ★項目キー（metric）はコードで閉じる（src/lib/highSchools/metrics.ts）。DBの CHECK にしないのは、
--   項目を足すたびにマイグレーションが要るのを避けるため。取込スクリプトがキーを検査する。
-- ★fiscal_year の意味は項目で決まる（入試＝入学年度、進学実績＝卒業年度、生徒数＝5月1日の年度）。
--   学校の経営計画の「R6実績」は入試年度と1年ずれることがある（日野で確認）ので、取込側で揃える。
CREATE TABLE IF NOT EXISTS public.high_school_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid NOT NULL REFERENCES public.high_school_campuses (id) ON DELETE CASCADE,
  -- マスタの学科に当たったときだけ埋める。資料の学科名は course_label にそのまま残す
  high_school_id uuid REFERENCES public.high_schools (id) ON DELETE SET NULL,
  -- 資料上の学科・コース名。学校全体の値は空文字（NULLにしない。一意制約を素直に効かせるため）
  course_label text NOT NULL DEFAULT '',
  fiscal_year smallint NOT NULL,
  metric text NOT NULL,
  -- 内訳。大学名・大学群（'GMARCH'）・入試方式（'指定校推薦'）など。無ければ空文字
  item text NOT NULL DEFAULT '',
  grade smallint CHECK (grade BETWEEN 1 AND 4),   -- NULL＝全学年
  sex text CHECK (sex IN ('male', 'female')),     -- NULL＝男女計
  -- 合格実績の数え方。★延べ・現役・実進学を混ぜて比べない
  basis text CHECK (basis IN ('延べ', '現役', '実進学')),
  value_num numeric,
  value_text text,
  source_url text NOT NULL,
  source_label text NOT NULL,   -- 画面に出す出典表記（'都教委 令和7年度 公立学校一覧'）
  as_of date,                   -- 資料の時点
  verified_at timestamptz,      -- 人（か別資料との一致）で確かめた日時。NULL＝未確認
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT high_school_stats_has_value CHECK (value_num IS NOT NULL OR value_text IS NOT NULL),
  CONSTRAINT high_school_stats_unique UNIQUE NULLS NOT DISTINCT
    (campus_id, course_label, fiscal_year, metric, item, grade, sex, basis)
);

COMMENT ON TABLE public.high_school_stats IS '高校の年度ごとの数字・事実（生徒数・倍率・合格実績・校則の要約など）。項目キーは src/lib/highSchools/metrics.ts';
COMMENT ON COLUMN public.high_school_stats.basis IS '合格実績の数え方。延べ／現役／実進学。混ぜて比べない';

CREATE INDEX IF NOT EXISTS idx_hs_stats_campus ON public.high_school_stats (campus_id, metric, fiscal_year);

-- ------------------------------------------------------------
-- 部活
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.high_school_clubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid NOT NULL REFERENCES public.high_school_campuses (id) ON DELETE CASCADE,
  -- 統一した部名（検索・珍しさの集計用）。学校ごとの表記揺れ（サッカー部／蹴球部）をここで揃える
  club_key text NOT NULL,
  -- 学校での呼び名（原文）
  name text NOT NULL,
  kind text CHECK (kind IN ('運動', '文化', '同好会')),
  -- 男子バスケ・女子バスケは別の部。男女とも・区別なしは空文字
  sex text NOT NULL DEFAULT '' CHECK (sex IN ('', '男子', '女子')),
  -- ★活動の重さは強さと別に持つ。「強豪ではない所で続けたい」生徒に答えるため
  days_per_week numeric(2, 1),
  weekend text CHECK (weekend IN ('土日', '土', '日', 'なし', '試合のみ')),
  days_note text,               -- 原文（'月・水・木・金・土・(日)'）
  -- 1=私立と戦える／2=都立（県立）の強豪／3=普通に活動／4=ゆるめ。★根拠なしで付けない
  tier smallint CHECK (tier BETWEEN 1 AND 4),
  tier_basis text,
  designation text,             -- 公式の指定（'Premiere Club Tier1'）
  source_url text,
  as_of date,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT high_school_clubs_tier_needs_basis CHECK (tier IS NULL OR tier_basis IS NOT NULL),
  CONSTRAINT high_school_clubs_unique UNIQUE (campus_id, club_key, sex)
);

COMMENT ON TABLE public.high_school_clubs IS '高校の部活。強さの段階（tier）は根拠（tier_basis）必須。珍しさは保存せずこの表から数える';

CREATE INDEX IF NOT EXISTS idx_hs_clubs_key ON public.high_school_clubs (club_key);

-- 部活の大会実績。★生徒名を入れない（大会結果の資料には個人名が載っている）
CREATE TABLE IF NOT EXISTS public.high_school_club_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.high_school_clubs (id) ON DELETE CASCADE,
  fiscal_year smallint NOT NULL,
  competition text NOT NULL,
  level text NOT NULL CHECK (level IN ('全国', '関東', '都県', '地区', 'その他')),
  -- 回戦の呼び方は資料で違う（学校「1回戦」＝一球速報「2回戦」）。'初戦敗退' '3勝' のように書く
  result text NOT NULL,
  happened_on date,
  source_url text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hs_club_results_club ON public.high_school_club_results (club_id, fiscal_year);

-- ------------------------------------------------------------
-- 指定校推薦の大学
-- ------------------------------------------------------------
-- ★出どころを分ける。学校が公式に出している一覧と、卒塾生・説明会で聞いた話は重みが違う
CREATE TABLE IF NOT EXISTS public.high_school_designated_universities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid NOT NULL REFERENCES public.high_school_campuses (id) ON DELETE CASCADE,
  fiscal_year smallint,         -- NULL＝年度不明（パンフの「主な指定校推薦」など）
  university text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('公式', '塾内')),
  source_url text,
  note text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_designated_univ_unique UNIQUE NULLS NOT DISTINCT
    (campus_id, fiscal_year, university, source_kind)
);

CREATE INDEX IF NOT EXISTS idx_hs_designated_univ_campus ON public.high_school_designated_universities (campus_id);

-- ------------------------------------------------------------
-- 学校の変化（教室長向け：改築・制服変更・学級増減など）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.high_school_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid NOT NULL REFERENCES public.high_school_campuses (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('改築', '改修', '制服', '学級増減', '学科改編', '統合', '指定', '施設', 'その他')),
  happened_on date,             -- 日付が分かるとき
  period_label text NOT NULL,   -- '2025年4月' '2025年度から'。日付が曖昧な資料が多いので文字で必ず持つ
  summary text NOT NULL,
  source_url text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hs_events_campus ON public.high_school_events (campus_id, happened_on);

-- ------------------------------------------------------------
-- updated_at
-- ------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'high_school_campuses', 'high_school_stats', 'high_school_clubs',
    'high_school_club_results', 'high_school_designated_universities', 'high_school_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- RLS（今の高校マスタと同じ：読みは認証済み全員、書きは admin / owner）
-- ------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'high_school_campuses', 'high_school_stats', 'high_school_clubs',
    'high_school_club_results', 'high_school_designated_universities', 'high_school_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON public.%1$I', t);
    EXECUTE format('CREATE POLICY %1$s_select ON public.%1$I FOR SELECT TO authenticated USING (true)', t);

    EXECUTE format('DROP POLICY IF EXISTS %1$s_write ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY %1$s_write ON public.%1$I FOR ALL TO authenticated
         USING (public.check_user_role(ARRAY[''admin''::text, ''owner''::text]))
         WITH CHECK (public.check_user_role(ARRAY[''admin''::text, ''owner''::text]))', t);

    -- ★既定権限で anon / authenticated に ALL が付く。止めているのはRLSだけなので、
    --   revoke してから必要な分だけ付け直す。
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;
