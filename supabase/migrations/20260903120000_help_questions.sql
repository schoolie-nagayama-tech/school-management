-- ============================================================
-- AIヘルプ: 聞かれた質問の記録（help_questions）
-- ============================================================
-- 目的:
--   AIヘルプに聞かれた質問と、答えられたかどうかを残す。
--   ★狙いは「AIを賢くする」ことではなく「FAQを育てる」こと。
--   答えられなかった質問の一覧を admin が見て、FAQ本文を書き足す運用に乗せる
--   （書き足せば次から答えられる）。
--
-- 設計:
--   - 教室スコープは持たない。ヘルプの内容は全社共通で、質問も教室に依存しないため。
--   - 個人情報は入れない前提。question は利用者の自由入力なので、
--     画面側で「生徒名は書かないでください」と明示する。
--   - matched_ids は src/lib/help/faqIndex.ts の faqItemId（question本文から決まる7文字）。
--     FAQの question を書き換えるとIDが変わるが、それは実質「別の項目」なので許容する。
--
-- 正典: docs/ai-help-plan.md §4
-- ============================================================

CREATE TABLE IF NOT EXISTS public.help_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- 質問時のロール（admin/manager/teacher/all）。どの立場で困ったかを見るため
  role text NOT NULL,
  question text NOT NULL,
  -- 質問したときに開いていた画面のパス（クエリ文字列は API 側で落としてある）
  page_path text,
  -- AIが選んだFAQ項目のID
  matched_ids text[] NOT NULL DEFAULT '{}',
  -- 答えられなかった（FAQに無い / 業務判断だった）
  unanswered boolean NOT NULL DEFAULT false,
  -- AIを呼べなかった（鍵未設定・障害）。unanswered と区別して数えたい
  degraded boolean NOT NULL DEFAULT false,
  -- 画面の「役に立った / 立たなかった」。未回答は NULL
  helpful boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.help_questions IS
  'AIヘルプに聞かれた質問の記録。答えられなかった質問をFAQに書き足すための材料（docs/ai-help-plan.md §4）';
COMMENT ON COLUMN public.help_questions.matched_ids IS
  'AIが選んだFAQ項目のID（src/lib/help/faqIndex.ts の faqItemId）';
COMMENT ON COLUMN public.help_questions.unanswered IS
  'FAQに答えが無かった／業務判断だったため答えなかった';
COMMENT ON COLUMN public.help_questions.degraded IS
  'AIを呼べなかった（鍵未設定・障害）。unanswered とは別に数える';

-- 「答えられなかった質問」を新しい順に引く用途に合わせる
CREATE INDEX IF NOT EXISTS idx_help_questions_unanswered
  ON public.help_questions (created_at DESC)
  WHERE unanswered = true;

CREATE INDEX IF NOT EXISTS idx_help_questions_created_at
  ON public.help_questions (created_at DESC);

-- ============================================================
-- RLS
-- ============================================================
-- 書き込みは API（service role）だけが行う。読むのは admin だけ。
-- ★Supabaseの既定権限で anon/authenticated に ALL が付くため、明示的に剥がしてから付け直す。
ALTER TABLE public.help_questions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.help_questions FROM anon, authenticated;
GRANT SELECT ON public.help_questions TO authenticated;

DROP POLICY IF EXISTS help_questions_admin_select ON public.help_questions;
CREATE POLICY help_questions_admin_select ON public.help_questions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid() AND up.role = 'admin'
    )
  );
