-- ============================================================
-- 高校マスタ（high_schools / high_school_standards）
-- ============================================================
-- 正典: docs/interview-script-ai-plan.md §4-2
-- データの出どころと注意: docs/data/README.md
--
-- 面談で「志望校との差」を見せるために要る。材料は docs/data/ の4つのCSV。
--
-- ★学校そのものと、年度ごとに変わる合格めやすを、2つのテーブルに分ける。
--   めやすは毎年更新される。上書きしてしまうと、過去の面談で保護者に示した数字を
--   後から再現できなくなる。版を積み上げる形にする。
--
-- ★school_id を持たない。全教室で共通の参照マスタ。
--   教室ごとに別々の都立高校があるわけではない。
--
-- ★書き込みは admin / owner だけ。教室長・講師には読ませるが直させない。
--   全教室が同じ行を見るので、1人が直すと全員に効いてしまう。
--   実際の取込は service role のスクリプトから行う（scripts/import-high-schools.mjs）。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.high_schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  prefecture text NOT NULL DEFAULT '東京都',
  school_name text NOT NULL,
  -- ★course は NULL ではなく空文字。NULL を許すと (prefecture, school_name, course) の
  --   UNIQUE が効かなくなる（Postgres では NULL 同士は重複とみなされない）。
  --   普通科の本体は空文字、「小平（外）」は '外国語'。
  course text NOT NULL DEFAULT '',
  category text NOT NULL,

  -- 都教委の学校番号。所在地データとの結合キー。
  -- 産業技術高専は高等専門学校で都教委の高校一覧に載らないため NULL。
  school_code text,
  old_district smallint,

  municipality text,
  address text,
  lat numeric(9, 6),
  lon numeric(9, 6),

  -- 最寄駅と沿線。★primary_station を「学校の最寄駅」として保護者に見せない。
  --   直線距離で出しているため実態と食い違う（docs/data/README.md の永山高校の例）。
  --   使ってよいのは access_lines での絞り込みまで。
  primary_station text,
  primary_lines text[],
  access_lines text[],
  -- '算出' / '手動'（公式サイトで確認して上書き）/ '鉄道なし' / '座標なし'
  station_source text,

  location_source text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT high_schools_unique_course UNIQUE (prefecture, school_name, course)
);

COMMENT ON TABLE public.high_schools IS '高校マスタ。学校×学科で1行。全教室共通の参照専用データ。';
COMMENT ON COLUMN public.high_schools.course IS '学科・コース。普通科の本体は空文字（NULLにするとUNIQUEが効かない）。';
COMMENT ON COLUMN public.high_schools.primary_station IS '主たる最寄駅。★直線距離ベースなので学校案内の最寄駅として保護者に見せない。';
COMMENT ON COLUMN public.high_schools.access_lines IS '通える駅に乗り入れる路線。沿線での絞り込みはこれを使う。';
COMMENT ON COLUMN public.high_schools.station_source IS '最寄駅の出どころ。手動＝学校公式サイトのアクセスページで確認して上書きしたもの。';

CREATE INDEX IF NOT EXISTS idx_high_schools_name ON public.high_schools (prefecture, school_name);
CREATE INDEX IF NOT EXISTS idx_high_schools_municipality ON public.high_schools (municipality);
-- 沿線での絞り込み（access_lines && ARRAY['京王電鉄 京王線']）を効かせる
CREATE INDEX IF NOT EXISTS idx_high_schools_access_lines ON public.high_schools USING gin (access_lines);

-- ------------------------------------------------------------
-- 合格めやす。版ごとに1行
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.high_school_standards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  high_school_id uuid NOT NULL REFERENCES public.high_schools (id) ON DELETE CASCADE,

  source text NOT NULL,                 -- '進学研究会Vもぎ'
  source_year smallint NOT NULL,        -- 2026（令和8年度受験用）
  source_label text NOT NULL,           -- 'Vもぎ 2025年9月版'。画面に出す出典表記

  total_score smallint,                 -- 1000点満点・合格可能性60%の位置
  naishin smallint,
  naishin_max smallint,                 -- 65 / 75（3教科校）/ 52（産業技術高専）
  hensachi smallint,
  exam_type text,                       -- '共通' / '自校作成'
  gakuryoku_ratio text,                 -- '7:3' / '6:4'
  note text,

  -- ★紙と突き合わせた日。NULL = 未確認。
  --   いまの数値は紙の資料からの手起こしで、突き合わせが済んでいない。
  --   未確認の数字を保護者に見せる画面に出すときは、その旨が分かるようにする。
  verified_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT high_school_standards_unique_version UNIQUE (high_school_id, source, source_year)
);

COMMENT ON TABLE public.high_school_standards IS '合格めやす。年度・出典ごとに1行を積む（上書きしない）。';
COMMENT ON COLUMN public.high_school_standards.naishin_max IS '換算内申の満点。65が既定、3教科校は75、産業技術高専は独自換算で52。混ぜて比較しない。';
COMMENT ON COLUMN public.high_school_standards.verified_at IS '紙の原本と突き合わせた日時。NULLは未確認。';

CREATE INDEX IF NOT EXISTS idx_hs_standards_school ON public.high_school_standards (high_school_id);
CREATE INDEX IF NOT EXISTS idx_hs_standards_year ON public.high_school_standards (source_year, hensachi);

-- ------------------------------------------------------------
-- updated_at
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_high_schools_updated_at ON public.high_schools;
CREATE TRIGGER trg_high_schools_updated_at
  BEFORE UPDATE ON public.high_schools
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_high_school_standards_updated_at ON public.high_school_standards;
CREATE TRIGGER trg_high_school_standards_updated_at
  BEFORE UPDATE ON public.high_school_standards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.high_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.high_school_standards ENABLE ROW LEVEL SECURITY;

-- 読みは認証済みなら全員。講師も面談で見る。
DROP POLICY IF EXISTS high_schools_select ON public.high_schools;
CREATE POLICY high_schools_select ON public.high_schools
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS hs_standards_select ON public.high_school_standards;
CREATE POLICY hs_standards_select ON public.high_school_standards
  FOR SELECT TO authenticated USING (true);

-- 書き込みは admin / owner だけ。教室長は含めない（§先頭の★の理由）。
DROP POLICY IF EXISTS high_schools_write ON public.high_schools;
CREATE POLICY high_schools_write ON public.high_schools
  FOR ALL TO authenticated
  USING (public.check_user_role(ARRAY['admin'::text, 'owner'::text]))
  WITH CHECK (public.check_user_role(ARRAY['admin'::text, 'owner'::text]));

DROP POLICY IF EXISTS hs_standards_write ON public.high_school_standards;
CREATE POLICY hs_standards_write ON public.high_school_standards
  FOR ALL TO authenticated
  USING (public.check_user_role(ARRAY['admin'::text, 'owner'::text]))
  WITH CHECK (public.check_user_role(ARRAY['admin'::text, 'owner'::text]));

-- ★既定権限で anon / authenticated に ALL が付く。止めているのはRLSだけなので、
--   revoke してから必要な分だけ付け直す。
REVOKE ALL ON public.high_schools FROM anon, authenticated;
REVOKE ALL ON public.high_school_standards FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.high_schools TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.high_school_standards TO authenticated;
