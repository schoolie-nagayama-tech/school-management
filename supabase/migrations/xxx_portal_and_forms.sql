-- ポータルとフォーム回答管理のマイグレーション
-- Supabase SQL Editorで実行してください

-- ============================================
-- portal_menuテーブルの拡張（link_type追加）
-- ============================================

-- link_typeカラムを追加（既存データは全て'external'とする）
ALTER TABLE portal_menu 
  ADD COLUMN IF NOT EXISTS link_type TEXT DEFAULT 'external' 
  CHECK (link_type IN ('internal', 'external'));

-- 既存のlink_urlがNULLの場合は'external'のまま
-- link_urlが設定されている場合、既存のリンクが外部リンクか内部リンクかを判定
-- デフォルトでは'external'とする
UPDATE portal_menu 
SET link_type = 'external' 
WHERE link_type IS NULL;

-- link_typeをNOT NULLに
ALTER TABLE portal_menu 
  ALTER COLUMN link_type SET NOT NULL;

-- ============================================
-- form_responsesテーブル（フォーム回答共通）
-- ============================================
CREATE TABLE IF NOT EXISTS form_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  form_type TEXT NOT NULL CHECK (form_type IN ('zoukoma', 'moshi', 'mogi', 'shukaisu', 'youbi', 'kyozai', 'soudan')),
  form_period TEXT NOT NULL,
  student_name TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade >= 1 AND grade <= 13),
  email TEXT NOT NULL,
  response_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ,
  status_checks JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- updated_at自動更新
DROP TRIGGER IF EXISTS update_form_responses_updated_at ON form_responses;
CREATE TRIGGER update_form_responses_updated_at
  BEFORE UPDATE ON form_responses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_form_responses_school_id ON form_responses(school_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_form_type ON form_responses(form_type);
CREATE INDEX IF NOT EXISTS idx_form_responses_form_period ON form_responses(form_period);
CREATE INDEX IF NOT EXISTS idx_form_responses_created_at ON form_responses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_responses_school_form_period ON form_responses(school_id, form_type, form_period);
CREATE INDEX IF NOT EXISTS idx_form_responses_linked_student_id ON form_responses(linked_student_id) WHERE linked_student_id IS NOT NULL;

-- RLS (Row Level Security) ポリシー
ALTER TABLE form_responses ENABLE ROW LEVEL SECURITY;

-- 認証ユーザーは全件アクセス可能
DROP POLICY IF EXISTS "form_responses_allow_all_auth" ON form_responses;
CREATE POLICY "form_responses_allow_all_auth" ON form_responses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 匿名ユーザーはINSERTのみ可能（フォーム送信用）
DROP POLICY IF EXISTS "form_responses_allow_insert_anon" ON form_responses;
CREATE POLICY "form_responses_allow_insert_anon" ON form_responses
  FOR INSERT TO anon 
  WITH CHECK (true);

-- 開発環境用：匿名ユーザーが全操作可能（必要に応じてコメントアウトを外す）
-- DROP POLICY IF EXISTS "form_responses_allow_all_anon" ON form_responses;
-- CREATE POLICY "form_responses_allow_all_anon" ON form_responses
--   FOR ALL TO anon USING (true) WITH CHECK (true);

-- ============================================
-- form_periodsテーブル（フォーム公開期間管理）
-- ============================================
CREATE TABLE IF NOT EXISTS form_periods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  form_type TEXT NOT NULL CHECK (form_type IN ('zoukoma', 'moshi', 'mogi', 'shukaisu', 'youbi', 'kyozai', 'soudan')),
  period_key TEXT NOT NULL,
  title TEXT NOT NULL,
  settings JSONB DEFAULT '{}'::jsonb,
  publish_start TIMESTAMPTZ,
  publish_end TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  linked_application_item_id UUID REFERENCES application_items(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, form_type, period_key)
);

-- updated_at自動更新
DROP TRIGGER IF EXISTS update_form_periods_updated_at ON form_periods;
CREATE TRIGGER update_form_periods_updated_at
  BEFORE UPDATE ON form_periods
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- インデックス
CREATE INDEX IF NOT EXISTS idx_form_periods_school_id ON form_periods(school_id);
CREATE INDEX IF NOT EXISTS idx_form_periods_form_type ON form_periods(form_type);
CREATE INDEX IF NOT EXISTS idx_form_periods_school_form_active ON form_periods(school_id, form_type, is_active);
CREATE INDEX IF NOT EXISTS idx_form_periods_publish_dates ON form_periods(publish_start, publish_end) WHERE is_active = true;

-- RLS (Row Level Security) ポリシー
ALTER TABLE form_periods ENABLE ROW LEVEL SECURITY;

-- 認証ユーザーは全件アクセス可能
DROP POLICY IF EXISTS "form_periods_allow_all_auth" ON form_periods;
CREATE POLICY "form_periods_allow_all_auth" ON form_periods
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 匿名ユーザーはSELECTのみ可能（公開中のフォームを表示）
DROP POLICY IF EXISTS "form_periods_allow_select_anon" ON form_periods;
CREATE POLICY "form_periods_allow_select_anon" ON form_periods
  FOR SELECT TO anon USING (
    is_active = true 
    AND (publish_start IS NULL OR publish_start <= NOW())
    AND (publish_end IS NULL OR publish_end >= NOW())
  );
