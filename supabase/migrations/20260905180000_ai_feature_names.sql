-- ============================================================
-- AIが乗る機能を4つに整理し、キーを名前に合わせる
-- ============================================================
-- 正典: src/lib/ai/features.ts
--
-- ★「掲示板AIアシスト」は廃語。あの語は3つの違うものを指していて
--   （講師ごとのスイッチ／教室長が見る「残っている人」／機能全体の総称）、
--   実際に何の話をしているか分からなくなった。
--
-- ★bulletin_ai を2つに割る。1つのキーで
--   「おまかせ下書き」（compose / refine）と「講師のAIサポート」（extract）を
--   まとめて止めていたため、「読み取りは要らないが下書きは使いたい」ができなかった。
--   送るものも違う（書きかけの文章 / 投稿の件名と本文）。
--
-- ★割るときは両方 true にする。bulletin_ai が true だった教室は、
--   すでに両方の送信を許していた。ここで一方を false にすると、
--   いま動いているものが黙って止まる。
-- ============================================================

-- 1) 掲示板の読み取り側 → 講師のAIサポート
UPDATE public.school_ai_settings
   SET feature_key = 'teacher_assist', updated_at = now()
 WHERE feature_key = 'bulletin_ai';

-- 2) 同じ教室に「おまかせ下書き」の行を作る（読み取りと同じ入切で引き継ぐ）
INSERT INTO public.school_ai_settings (school_id, feature_key, enabled, updated_by)
SELECT school_id, 'ai_compose', enabled, updated_by
  FROM public.school_ai_settings
 WHERE feature_key = 'teacher_assist'
ON CONFLICT (school_id, feature_key) DO NOTHING;

-- 3) 講習テーマ → テーマふくらませ
UPDATE public.school_ai_settings
   SET feature_key = 'plan_theme', updated_at = now()
 WHERE feature_key = 'koushu_concept';

COMMENT ON COLUMN public.school_ai_settings.feature_key IS
  '機能キー。ai_compose=おまかせ下書き / teacher_assist=講師のAIサポート / plan_theme=テーマふくらませ（正典 src/lib/ai/features.ts）';

-- ------------------------------------------------------------
-- 講師ごとのスイッチ
-- ------------------------------------------------------------
-- ★列名も「掲示板」を外す。授業中に出るカードは掲示板の画面ではなく、
--   進行表・報告書の画面に出る。掲示板を名乗ると探す場所を間違える。
ALTER TABLE public.user_profiles
  RENAME COLUMN bulletin_ai_assist TO teacher_ai_assist;

COMMENT ON COLUMN public.user_profiles.teacher_ai_assist IS
  '「講師のAIサポート」を、この講師に出すか。既定OFF（教室側の teacher_assist と両方ONで出る）';
