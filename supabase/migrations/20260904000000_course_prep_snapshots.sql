-- 講習進捗管理表のスナップショット（確定保存）。
--
-- 背景: /courses/progress の数字は毎回ライブデータから再計算しているため、
--       期が終わったあとも過去の実績が動き続ける。
--       - 退塾すると生徒の行ごと消える（退塾日の翌日に日次cronで withdrawn になる）
--       - 週回数・コマ数が「現在の」通塾パターン（schedule_regular_patterns）から計算される
--       - 提案／取得コマが現在の提案書から再計算される
--       結果、年度末に前年を振り返ると「今も在籍している生徒だけの夏期」しか見えない。
--
-- 方針: 集計結果ではなく「集計の入力」を凍結する。
--       集計は computeDashboardAggregates(students, items, progressData, autoValues, period, today)
--       という純関数に一元化済みなので、この引数5点セットを payload に保存すれば
--       表・ダッシュボード・A3レポート・全校サマリーを改造せずに当時の姿で再生できる。
--       計算は常に現行ロジックで行うため、定義を直したときに過去も新定義で揃う。
--
-- 正典: docs/koushu-progress-snapshot-plan.md

CREATE TABLE IF NOT EXISTS course_prep_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  season         text NOT NULL,
  year           integer NOT NULL,

  -- 集計の入力を凍結したもの（正典）。
  -- { version, students[], items[], progress[], autoValues{}, period{} }
  -- 生徒は表示に要る項目だけのホワイトリスト（住所・連絡先は保存しない）。
  payload        jsonb NOT NULL,

  -- 一覧表示用のキャッシュ。payload からいつでも再生成できるので正典ではない。
  summary        jsonb,

  student_count  integer NOT NULL DEFAULT 0,
  captured_at    timestamptz NOT NULL DEFAULT now(),
  captured_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- 'manual' = 教室長以上が確定保存 / 'auto' = 期間終了後の日次cronが自動確定
  capture_reason text NOT NULL DEFAULT 'manual',

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- 版管理はしない。取り直しは同じ行への upsert（captured_at でいつ時点かが分かる）。
  CONSTRAINT course_prep_snapshots_unique_period UNIQUE (school_id, season, year),
  CONSTRAINT course_prep_snapshots_capture_reason_check
    CHECK (capture_reason IN ('manual', 'auto'))
);

-- 一覧（教室ごとに新しい期から）と、cronの「未確定の期を探す」に効く。
CREATE INDEX IF NOT EXISTS idx_course_prep_snapshots_school_period
  ON course_prep_snapshots (school_id, year DESC, season);

DROP TRIGGER IF EXISTS trg_course_prep_snapshots_updated_at ON course_prep_snapshots;
CREATE TRIGGER trg_course_prep_snapshots_updated_at
  BEFORE UPDATE ON course_prep_snapshots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: 兄弟テーブル（course_prep_*）と同じく check_school_access() に揃える。
-- admin/owner/manager は全校TRUE、それ以外は所属校のみ、anon は FALSE。
ALTER TABLE course_prep_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prep_snapshots_select ON course_prep_snapshots;
DROP POLICY IF EXISTS prep_snapshots_insert ON course_prep_snapshots;
DROP POLICY IF EXISTS prep_snapshots_update ON course_prep_snapshots;
DROP POLICY IF EXISTS prep_snapshots_delete ON course_prep_snapshots;
CREATE POLICY prep_snapshots_select ON course_prep_snapshots FOR SELECT
  USING (check_school_access(school_id));
CREATE POLICY prep_snapshots_insert ON course_prep_snapshots FOR INSERT
  WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_snapshots_update ON course_prep_snapshots FOR UPDATE
  USING (check_school_access(school_id)) WITH CHECK (check_school_access(school_id));
CREATE POLICY prep_snapshots_delete ON course_prep_snapshots FOR DELETE
  USING (check_school_access(school_id));

-- 既定権限で anon/authenticated に ALL が付くため、明示的に revoke してから付け直す
-- （止めているのが RLS だけ、という状態にしない）。生徒氏名を含む凍結物なので anon は完全に落とす。
REVOKE ALL ON course_prep_snapshots FROM anon;
REVOKE ALL ON course_prep_snapshots FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON course_prep_snapshots TO authenticated;
