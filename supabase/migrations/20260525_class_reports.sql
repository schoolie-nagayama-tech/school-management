-- 授業報告書 (class_reports)
-- 背景：
--  - 講師が毎授業ごとに「学習目標/進度/宿題/テスト/講評/次回宿題」をフォームから記録する
--  - 1コマ × 1生徒 = 1レコード（集団は将来別途簡易版を用意）
--  - 進行表 (progress_sessions / student_progress / student_textbook_exams) と双方向リンク
--    - 入力 → 進行表へ転記：学校進度、授業単元×教材セット
--    - 進行表 → 入力初期値：中期目標、次の未着手単元
--  - 「下書き → 提出 → 室長承認 → 保護者公開」ワークフロー
--  - 子テーブル lesson_report_units で「単元×教材セット」を可変個保持（メイン1 + サブN）

-- 1. メインテーブル
CREATE TABLE IF NOT EXISTS "public"."class_reports" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id" UUID NOT NULL REFERENCES "public"."schools"("id") ON DELETE CASCADE,
  -- どのコマ×生徒に紐づくか
  "schedule_entry_id" UUID NOT NULL REFERENCES "public"."schedule_entries"("id") ON DELETE CASCADE,
  "student_id" UUID NOT NULL REFERENCES "public"."students"("id") ON DELETE CASCADE,
  "teacher_id" UUID NOT NULL REFERENCES "public"."user_profiles"("id") ON DELETE RESTRICT,
  -- 授業日付（schedule_entry から冗長持ちして集計を高速化）
  "lesson_date" DATE NOT NULL,

  -- 目標
  "short_term_goal" TEXT,        -- 短期：この授業のゴール（必須相当・空欄でも保存可）
  "mid_term_goal_snapshot" TEXT, -- 中期教材目標のスナップショット（記入時点の進行表内容）
  "mid_action_goal_snapshot" TEXT, -- 中期行動目標のスナップショット

  -- 進度・教材
  "school_progress" TEXT,        -- 学校進度（保存時に進行表へ転記される）
  -- 教材セットは別テーブル lesson_report_units に持つ

  -- 宿題・テスト
  "homework_completion_pct" INTEGER CHECK ("homework_completion_pct" IS NULL OR ("homework_completion_pct" >= 0 AND "homework_completion_pct" <= 100)),
  "homework_correct_pct" INTEGER CHECK ("homework_correct_pct" IS NULL OR ("homework_correct_pct" >= 0 AND "homework_correct_pct" <= 100)),
  "today_correct_pct" INTEGER CHECK ("today_correct_pct" IS NULL OR ("today_correct_pct" >= 0 AND "today_correct_pct" <= 100)),
  -- 英単語テスト：scored / total / passed
  "vocab_test_score" INTEGER,
  "vocab_test_total" INTEGER,
  "vocab_test_passed" BOOLEAN,
  -- 確認テスト：scored / total / passed
  "check_test_score" INTEGER,
  "check_test_total" INTEGER,
  "check_test_passed" BOOLEAN,

  -- 講評（自由テキスト）
  "review_comment" TEXT,

  -- 次回までの宿題：JSON 配列 [{ date: 'YYYY-MM-DD', text: '...' }]
  -- 構造が可変（行数も日付付きも追加削除可能）なので別テーブル化せず JSON で持つ
  "homework_assignments" JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- 科目別欄：科目によってフォーマットが違う（英語=単語練習 / 数学=計算 / 国語=漢字）
  -- 例：{ kind: 'vocab', range: 'Unit 6 単語', pages: '46-49', times_per_day: 5, duration: '1週間' }
  "subject_specific" JSONB,

  -- ワークフロー状態
  "status" TEXT NOT NULL DEFAULT 'draft'
    CHECK ("status" IN ('draft', 'submitted', 'approved', 'rejected')),
  "submitted_at" TIMESTAMPTZ,
  "approved_at" TIMESTAMPTZ,
  "approved_by" UUID REFERENCES "public"."user_profiles"("id"),
  "rejected_at" TIMESTAMPTZ,
  "rejected_by" UUID REFERENCES "public"."user_profiles"("id"),
  "rejection_reason" TEXT,

  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW(),

  -- 1コマ×1生徒 = 1報告書を保証（schedule_entry_id だけで一意。student_id は冗長カラム）
  UNIQUE ("schedule_entry_id")
);

COMMENT ON TABLE "public"."class_reports"
  IS '授業報告書。1コマ×1生徒 = 1レコード。schedule_entry_id でスケジュールと紐付き、ワークフローで「下書き→提出→承認→公開」を管理。';

CREATE INDEX IF NOT EXISTS "idx_class_reports_school_lesson_date"
  ON "public"."class_reports" ("school_id", "lesson_date");
CREATE INDEX IF NOT EXISTS "idx_class_reports_student_date"
  ON "public"."class_reports" ("student_id", "lesson_date" DESC);
CREATE INDEX IF NOT EXISTS "idx_class_reports_teacher_status"
  ON "public"."class_reports" ("teacher_id", "status");
CREATE INDEX IF NOT EXISTS "idx_class_reports_pending"
  ON "public"."class_reports" ("school_id", "status")
  WHERE "status" = 'submitted';

DROP TRIGGER IF EXISTS update_class_reports_updated_at ON "public"."class_reports";
CREATE TRIGGER update_class_reports_updated_at
  BEFORE UPDATE ON "public"."class_reports"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "public"."class_reports" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "class_reports_allow_all_auth" ON "public"."class_reports";
CREATE POLICY "class_reports_allow_all_auth" ON "public"."class_reports"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. 子テーブル: 単元×教材セット（メイン1 + サブN）
CREATE TABLE IF NOT EXISTS "public"."lesson_report_units" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "report_id" UUID NOT NULL REFERENCES "public"."class_reports"("id") ON DELETE CASCADE,
  -- 教材：student_textbooks 経由で textbook_id を引く
  "student_textbook_id" UUID NOT NULL REFERENCES "public"."student_textbooks"("id") ON DELETE CASCADE,
  -- メイン教材は1セットだけ true、サブ教材は false
  "is_main" BOOLEAN NOT NULL DEFAULT false,
  -- 単元IDの配列（複数選択対応）。curriculum_items.id への参照だが、配列内 FK は持てないので id 配列で運用
  "curriculum_item_ids" INTEGER[] NOT NULL DEFAULT '{}',
  -- ページ範囲：数字のみ保存。UI 側で "p." を補完表示する
  "page_start" INTEGER,
  "page_end" INTEGER,
  -- 表示順
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "public"."lesson_report_units"
  IS '授業報告書の「単元×教材セット」。1報告書につきメイン1 + サブN を持つ。保存時に進行表 (student_progress_lessons) へ転記される。';
COMMENT ON COLUMN "public"."lesson_report_units"."curriculum_item_ids"
  IS '今回の授業で扱った単元IDの配列（curriculum_items.id）。複数単元を1セットで扱える。';

CREATE INDEX IF NOT EXISTS "idx_lesson_report_units_report"
  ON "public"."lesson_report_units" ("report_id", "display_order");

DROP TRIGGER IF EXISTS update_lesson_report_units_updated_at ON "public"."lesson_report_units";
CREATE TRIGGER update_lesson_report_units_updated_at
  BEFORE UPDATE ON "public"."lesson_report_units"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE "public"."lesson_report_units" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lesson_report_units_allow_all_auth" ON "public"."lesson_report_units";
CREATE POLICY "lesson_report_units_allow_all_auth" ON "public"."lesson_report_units"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. progress_sessions ⇔ class_reports の紐付け
-- progress_sessions は既に schedule_entry_id で座席表と繋がっているので、
-- 報告書側からは schedule_entry_id で逆引きできる。
-- 加えて progress_sessions に report_id を持たせると「セッション → 報告書」を直接たどれて便利。
ALTER TABLE "public"."progress_sessions"
  ADD COLUMN IF NOT EXISTS "report_id" UUID REFERENCES "public"."class_reports"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "public"."progress_sessions"."report_id"
  IS '対応する授業報告書 ID。報告書を保存すると自動で紐付けされる（NULL = 報告書未作成）。';

CREATE INDEX IF NOT EXISTS "idx_progress_sessions_report"
  ON "public"."progress_sessions" ("report_id")
  WHERE "report_id" IS NOT NULL;
