-- ============================================================
-- Phase A: 指導形態の動的マスタ化（小集団・プログラミング等を設定画面から作成・削除できるようにする土台）
--
-- 正典: docs/small-group-programming-schedule-plan.md §2.1〜2.6 / §3 Phase A
--
-- 変更内容:
--   1. schedule_formations 新設（individual/group を is_system でシード）
--   2. 既存5テーブルの formation CHECK 制約を DROP し、schedule_formations(key) への FK(RESTRICT) に置換
--   3. school_formation_capacity 新設（形態別定員。汎用テーブル）
--   4. RLS:
--        schedule_formations       … SELECT=authenticated全員 / 書き込み=manager+
--        school_formation_capacity … SELECT/書き込み=check_school_access(school_id)、書き込みは manager+ に限定
--
-- 挙動不変が前提: シードで individual/group を先に入れてから FK を張るので、既存データは全て親を持ち通る。
--
-- ── ロールバック手順（適用後に戻す場合） ──
--   -- FK を落として CHECK 制約を復元:
--   ALTER TABLE schedule_time_slots       DROP CONSTRAINT schedule_time_slots_formation_fkey;
--   ALTER TABLE schedule_entries          DROP CONSTRAINT schedule_entries_formation_fkey;
--   ALTER TABLE schedule_regular_patterns DROP CONSTRAINT schedule_regular_patterns_formation_fkey;
--   ALTER TABLE koushu_enrollments        DROP CONSTRAINT koushu_enrollments_formation_fkey;
--   ALTER TABLE schedule_match_proposals  DROP CONSTRAINT schedule_match_proposals_formation_fkey;
--   ALTER TABLE schedule_time_slots       ADD CONSTRAINT schedule_time_slots_formation_check       CHECK (formation = ANY (ARRAY['individual','group']));
--   ALTER TABLE schedule_entries          ADD CONSTRAINT schedule_entries_formation_check          CHECK (formation = ANY (ARRAY['individual','group']));
--   ALTER TABLE schedule_regular_patterns ADD CONSTRAINT schedule_regular_patterns_formation_check CHECK (formation = ANY (ARRAY['individual','group']));
--   ALTER TABLE koushu_enrollments        ADD CONSTRAINT koushu_enrollments_formation_check        CHECK (formation = ANY (ARRAY['individual','group']));
--   ALTER TABLE schedule_match_proposals  ADD CONSTRAINT schedule_match_proposals_formation_check  CHECK (formation = ANY (ARRAY['individual','group']));
--   DROP TABLE IF EXISTS school_formation_capacity;
--   DROP TABLE IF EXISTS schedule_formations;
-- ============================================================

BEGIN;

-- ── 1. 指導形態マスタ ──
CREATE TABLE IF NOT EXISTS schedule_formations (
  key         text PRIMARY KEY,                       -- 'individual'/'group' または自動生成キー 'f_xxxxxxxx'
  label       text NOT NULL,                          -- 表示名: 個別 / 集団 / 小集団 / プログラミング…
  lane_type   text NOT NULL DEFAULT 'group'
              CHECK (lane_type IN ('individual', 'group')),
  is_system   boolean NOT NULL DEFAULT false,         -- individual/group は true（削除・改名不可）
  is_active   boolean NOT NULL DEFAULT true,          -- false でタブ非表示（ソフト削除）
  sort_order  integer NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- シード: 既存の individual/group を is_system で投入（FK を張る前に親を用意する）
INSERT INTO schedule_formations (key, label, lane_type, is_system, is_active, sort_order)
VALUES
  ('individual', '個別', 'individual', true, true, 1),
  ('group',      '集団', 'group',      true, true, 2)
ON CONFLICT (key) DO NOTHING;

-- ── 2. 既存5テーブルの CHECK 制約 → FK(RESTRICT) へ置換 ──
-- 制約名はベーススキーマ 00000000000000_base_schema.sql の実名に合わせている。
-- FK は ON DELETE RESTRICT: 参照データがある形態は物理削除できず、無効化(is_active=false)へ誘導する。

ALTER TABLE schedule_time_slots       DROP CONSTRAINT IF EXISTS schedule_time_slots_formation_check;
ALTER TABLE schedule_entries          DROP CONSTRAINT IF EXISTS schedule_entries_formation_check;
ALTER TABLE schedule_regular_patterns DROP CONSTRAINT IF EXISTS schedule_regular_patterns_formation_check;
ALTER TABLE koushu_enrollments        DROP CONSTRAINT IF EXISTS koushu_enrollments_formation_check;
ALTER TABLE schedule_match_proposals  DROP CONSTRAINT IF EXISTS schedule_match_proposals_formation_check;

ALTER TABLE schedule_time_slots
  ADD CONSTRAINT schedule_time_slots_formation_fkey
  FOREIGN KEY (formation) REFERENCES schedule_formations(key) ON DELETE RESTRICT;
ALTER TABLE schedule_entries
  ADD CONSTRAINT schedule_entries_formation_fkey
  FOREIGN KEY (formation) REFERENCES schedule_formations(key) ON DELETE RESTRICT;
ALTER TABLE schedule_regular_patterns
  ADD CONSTRAINT schedule_regular_patterns_formation_fkey
  FOREIGN KEY (formation) REFERENCES schedule_formations(key) ON DELETE RESTRICT;
ALTER TABLE koushu_enrollments
  ADD CONSTRAINT koushu_enrollments_formation_fkey
  FOREIGN KEY (formation) REFERENCES schedule_formations(key) ON DELETE RESTRICT;
ALTER TABLE schedule_match_proposals
  ADD CONSTRAINT schedule_match_proposals_formation_fkey
  FOREIGN KEY (formation) REFERENCES schedule_formations(key) ON DELETE RESTRICT;

-- FK 探索を効率化するインデックス（RESTRICT 削除チェックで参照される）
CREATE INDEX IF NOT EXISTS idx_schedule_entries_formation_key          ON schedule_entries(formation);
CREATE INDEX IF NOT EXISTS idx_schedule_regular_patterns_formation_key ON schedule_regular_patterns(formation);
CREATE INDEX IF NOT EXISTS idx_koushu_enrollments_formation_key        ON koushu_enrollments(formation);
CREATE INDEX IF NOT EXISTS idx_schedule_match_proposals_formation_key  ON schedule_match_proposals(formation);

-- ── 3. 形態別定員（汎用テーブル） ──
CREATE TABLE IF NOT EXISTS school_formation_capacity (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id              uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  formation              text NOT NULL REFERENCES schedule_formations(key) ON DELETE RESTRICT,
  max_students_per_group integer NOT NULL DEFAULT 8,   -- 1枠あたり生徒数上限
  max_concurrent_groups  integer NOT NULL DEFAULT 1,   -- 同時刻の枠数上限
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, formation)
);
CREATE INDEX IF NOT EXISTS idx_school_formation_capacity_school ON school_formation_capacity(school_id);

-- ── 4. RLS ──

-- schedule_formations: 参照は全認証ユーザー（タブ描画に必要）、書き込みは manager+ のみ。
--   （管理系テーブルの system_settings/admin_audit_logs と同型の書き方）
ALTER TABLE schedule_formations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_formations_select_auth ON schedule_formations;
CREATE POLICY schedule_formations_select_auth ON schedule_formations
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS schedule_formations_write_manager ON schedule_formations;
CREATE POLICY schedule_formations_write_manager ON schedule_formations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager')));

-- school_formation_capacity: 教室スコープ（check_school_access）。書き込みは manager+ に限定。
--   check_school_access = admin/owner/manager は全校TRUE、それ以外は所属校のみ、anon はFALSE。
ALTER TABLE school_formation_capacity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS school_formation_capacity_select ON school_formation_capacity;
CREATE POLICY school_formation_capacity_select ON school_formation_capacity
  FOR SELECT TO authenticated
  USING (check_school_access(school_id));

DROP POLICY IF EXISTS school_formation_capacity_write_manager ON school_formation_capacity;
CREATE POLICY school_formation_capacity_write_manager ON school_formation_capacity
  FOR ALL TO authenticated
  USING (
    check_school_access(school_id)
    AND EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager'))
  )
  WITH CHECK (
    check_school_access(school_id)
    AND EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = auth.uid() AND up.role IN ('admin','owner','manager'))
  );

COMMIT;
