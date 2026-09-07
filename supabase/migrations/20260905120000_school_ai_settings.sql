-- ============================================================
-- 教室ごとのAI機能の入切
-- ============================================================
-- 正典: docs/bulletin-ai-assist.html
--
-- ★これは費用の調整ではなく、外部に出してよいかの歯止め。
--   掲示板の読み取りは、投稿の件名と本文をそのまま Anthropic に送る。
--   プライバシーポリシー（docs/legal/privacy-policy.md）はリーガルチェック中で、
--   Anthropic をまだ追記できていない。チェックが終わるまで、
--   出してよいと決めた教室以外では送信そのものを起こさないための栓。
--
-- ★既定はOFF。行が無ければOFFとして扱う。
--   「設定を作り忘れた教室が黙って送信していた」を起こさないため、
--   既定ONにはしない（DEFAULT false かつ 行なし=OFF の二重の安全側）。
--
-- ★school_widget_settings は使わない。あちらは
--   「authenticated なら誰でも書き換え可」のRLSで、講師でも外部送信を始められてしまう。
--   ここは書き込みを service role に閉じ、APIで admin/owner だけに開ける。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.school_ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,

  -- 機能キー。第一弾は 'bulletin_extract'（掲示板の投稿から依頼を読み取る）
  feature_key text NOT NULL,

  -- ★既定OFF
  enabled boolean NOT NULL DEFAULT false,

  -- 誰がいつ切り替えたか。外部送信の入切なので、記録が要る
  updated_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (school_id, feature_key)
);

COMMENT ON TABLE public.school_ai_settings IS
  '教室ごとのAI機能の入切。行が無ければOFF（docs/bulletin-ai-assist.html）';
COMMENT ON COLUMN public.school_ai_settings.enabled IS
  '既定OFF。掲示板の読み取りは投稿本文を外部AIに送るため、出してよいと決めた教室だけONにする';

CREATE INDEX IF NOT EXISTS idx_school_ai_settings_school
  ON public.school_ai_settings (school_id, feature_key);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
-- 読みは自教室のスタッフ。書きは service role だけ（APIで admin/owner に限定する）。
-- ★Supabaseの既定権限で anon/authenticated に ALL が付くため、明示的に剥がしてから付け直す。
ALTER TABLE public.school_ai_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_ai_settings FROM anon, authenticated;
GRANT SELECT ON public.school_ai_settings TO authenticated;

DROP POLICY IF EXISTS school_ai_settings_select ON public.school_ai_settings;
CREATE POLICY school_ai_settings_select ON public.school_ai_settings
  FOR SELECT TO authenticated
  USING (public.check_school_access(school_id));
