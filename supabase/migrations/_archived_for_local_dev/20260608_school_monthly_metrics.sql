-- ============================================================
-- 教室の月次経営指標（在籍数の推移・入会・休会、実績/予算）
--
-- 目的:
--   教室長ダッシュボードの経営指標（在籍トレンドの昨対比・増減・予実）を
--   月次集計で持つ。アプリ導入前の過去実績や予算は student_logs から復元できないため、
--   この集計テーブルを「正」として手入力 or 取り込みで埋める。
--
-- 1 行 = ある教室の ある年月の (実績 or 予算) の月次サマリー。
--   active_count は月末在籍数（独立した実測値として扱う。入会−休会の算術と
--   厳密一致しない月があっても、トレンド/予実は active_count をそのまま使う）。
--   leave_count（休会数）は在籍が減る要因（実質的な離脱）として扱う。
--
-- RLS:
--   既存の check_school_access(school_id) に統一（admin/owner/manager は全校、
--   teacher は user_schools 所属校のみ）。20260520_rls_school_scope_phase2 に倣う。
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.school_monthly_metrics (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  year         integer NOT NULL,
  month        integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  kind         text NOT NULL DEFAULT 'actual' CHECK (kind IN ('actual', 'budget')),
  new_count    integer NOT NULL DEFAULT 0,   -- 入会数
  leave_count  integer NOT NULL DEFAULT 0,   -- 休会数（在籍減の要因として扱う）
  active_count integer NOT NULL DEFAULT 0,   -- 月末在籍数
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- 同一 教室×年月×種別 は 1 行（再投入は upsert で更新）
  UNIQUE (school_id, year, month, kind)
);

-- トレンド取得は school_id + year で範囲スキャンするためのインデックス
CREATE INDEX IF NOT EXISTS idx_school_monthly_metrics_school_year
  ON public.school_monthly_metrics (school_id, year);

ALTER TABLE public.school_monthly_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "school_monthly_metrics_school_scope_auth" ON public.school_monthly_metrics;
CREATE POLICY "school_monthly_metrics_school_scope_auth"
  ON public.school_monthly_metrics FOR ALL TO authenticated
  USING (public.check_school_access(school_id))
  WITH CHECK (public.check_school_access(school_id));

-- ────────────────────────────────────────────────────────────
-- 永山校の実データ投入（school 名で参照し、school_id はハードコードしない）
--   2024 実績 / 2025 実績 / 2026 予算 / 2026 実績(1〜6月の判明分)。
--   2026 実績の 7 月以降は未確定のため投入しない（予実を誤って未達に見せないため）。
--   永山校が見つからない場合は 0 行 INSERT（安全に no-op）。
-- ────────────────────────────────────────────────────────────
INSERT INTO public.school_monthly_metrics
  (school_id, year, month, kind, new_count, leave_count, active_count)
SELECT s.id, v.year, v.month, v.kind, v.new_count, v.leave_count, v.active_count
FROM (SELECT id FROM public.schools WHERE name LIKE '%永山%' ORDER BY name LIMIT 1) s
CROSS JOIN (VALUES
  -- 2024 実績
  (2024, 1,'actual', 4,0, 8),(2024, 2,'actual',3,0,11),(2024, 3,'actual',5,1,16),
  (2024, 4,'actual', 8,0,23),(2024, 5,'actual',5,1,28),(2024, 6,'actual',4,0,31),
  (2024, 7,'actual',14,1,45),(2024, 8,'actual',3,2,47),(2024, 9,'actual',2,1,47),
  (2024,10,'actual', 3,1,49),(2024,11,'actual',2,2,50),(2024,12,'actual',7,3,55),
  -- 2025 実績
  (2025, 1,'actual', 1,4,53),(2025, 2,'actual',3,5,52),(2025, 3,'actual',8,3,55),
  (2025, 4,'actual', 7,1,59),(2025, 5,'actual',4,1,62),(2025, 6,'actual',3,1,64),
  (2025, 7,'actual', 9,3,72),(2025, 8,'actual',2,2,73),(2025, 9,'actual',1,4,71),
  (2025,10,'actual', 3,2,72),(2025,11,'actual',2,1,70),(2025,12,'actual',2,1,70),
  -- 2026 予算
  (2026, 1,'budget', 2,4,72),(2026, 2,'budget',3,6,71),(2026, 3,'budget',8,5,73),
  (2026, 4,'budget', 6,1,74),(2026, 5,'budget',4,1,77),(2026, 6,'budget',3,1,79),
  (2026, 7,'budget', 9,1,87),(2026, 8,'budget',3,2,89),(2026, 9,'budget',3,1,89),
  (2026,10,'budget', 2,1,90),(2026,11,'budget',2,2,91),(2026,12,'budget',3,2,92),
  -- 2026 実績（判明分: 1〜6月。6月の入会は未集計のため 0）
  (2026, 1,'actual', 1,6,70),(2026, 2,'actual',3,4,67),(2026, 3,'actual',5,7,68),
  (2026, 4,'actual', 6,3,67),(2026, 5,'actual',8,1,72),(2026, 6,'actual',0,1,71)
) AS v(year, month, kind, new_count, leave_count, active_count)
ON CONFLICT (school_id, year, month, kind) DO UPDATE
  SET new_count    = EXCLUDED.new_count,
      leave_count  = EXCLUDED.leave_count,
      active_count = EXCLUDED.active_count,
      updated_at   = now();

COMMIT;
