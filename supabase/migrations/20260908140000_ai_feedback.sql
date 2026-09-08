-- ============================================================
-- AIの読み取りの答え合わせ（ai_feedback）
-- ============================================================
-- 正典: docs/bulletin-ai-assist.html
--
-- ★AIが合っていたかどうかが、どこにも残っていなかった。
--   本番で「PCSを配布 → 教材配布チェック」「諏訪中生 → 対象が空で母数0」という
--   2つの誤りが起きたが、気づけたのは教室長がスクリーンショットを送ってくれたからで、
--   DBを見ても分からなかった。直せるのは、間違いが数えられるようになってからである。
--
-- ★テーブルは1つだけにする。機能ごとにテーブルを作ると、
--   「AIはどこで間違えているか」を横断で数えられなくなり、結局どれも見なくなる。
--   今後どのAI機能のフィードバックもここに入れる（feature と target_kind で分ける）。
--
-- ★bulletin_popup_logs とは別物なので混ぜない。あちらは
--   「AIがカードを出さなかった理由」の機械ログで、1授業ごとに自動で積もる。
--   こちらは人が押したときだけ入る答え合わせで、件数も目的も違う。
--   同じ表にすると、人の答えが機械ログに埋もれて読めなくなる。
--
-- ★本番には当てない（実装が一通り動作確認できてから当てる）。
--
-- ★ファイル名の版番号は 20260908140000。同じ日の 120000 は course_prep_tracks が
--   先に使っているので、ぶつからないようにずらしてある。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,

  -- どのAI機能か。src/lib/ai/features.ts の AiFeatureKey（'teacher_assist' など）
  feature text NOT NULL,

  -- 何についてのフィードバックか。'bulletin_task' など（src/lib/ai/feedback.ts の一覧）
  target_kind text NOT NULL,

  -- ★その対象のID。FKを張らない。
  --   対象（タスクなど）が消えてもフィードバックは残したいため。
  --   「消えたから学べない」では、記録している意味が無くなる。
  target_id uuid,

  -- AIが実際に出したもの（種別・対象・引用など）。あとから読み間違いを再現するための材料
  ai_output jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- 人の答え。★自由記述にしない（数えられなくなる）。値は src/lib/ai/feedback.ts の一覧
  verdict text NOT NULL,

  -- 任意の一言。当面UIからは入れない（押すものを増やさないため）
  note text,

  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_feedback IS
  'AIの読み取りが合っていたかの答え合わせ。全AI機能で1つの表を使う（docs/bulletin-ai-assist.html）';
COMMENT ON COLUMN public.ai_feedback.target_id IS
  '対象のID。★FKを張らない: 対象が消えてもフィードバックは残す（消えたから学べない、では意味がない）';
COMMENT ON COLUMN public.ai_feedback.verdict IS
  '人の答え（misread / already_done / not_needed / ok / other）。自由記述にすると数えられなくなる';
COMMENT ON COLUMN public.ai_feedback.ai_output IS
  'AIが出した中身。種別・対象・根拠にした一文など。どこで読み間違えたかを後から追うため';

-- 教室ごとに新しい順で見る
CREATE INDEX IF NOT EXISTS idx_ai_feedback_school_created
  ON public.ai_feedback (school_id, created_at DESC);

-- 「どの機能でどの判断が何件か」を数える
CREATE INDEX IF NOT EXISTS idx_ai_feedback_feature_verdict
  ON public.ai_feedback (feature, verdict);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
-- 読みは自教室のスタッフ。書きは service role だけ（APIで教室長以上に限定する）。
-- ★Supabaseの既定権限で anon/authenticated に ALL が付くため、明示的に剥がしてから付け直す。
ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_feedback FROM anon, authenticated;
GRANT SELECT ON public.ai_feedback TO authenticated;

DROP POLICY IF EXISTS ai_feedback_select ON public.ai_feedback;
CREATE POLICY ai_feedback_select ON public.ai_feedback
  FOR SELECT TO authenticated
  USING (public.check_school_access(school_id));

-- ------------------------------------------------------------
-- 読み間違いを追うための根拠の一文
-- ------------------------------------------------------------
-- ★「どこで読み間違えたか」は、AIが何を根拠にしたかが分からないと追えない。
--   「PCSを配布」を教材配布チェックに読んだのか、別の行を読んだのかで直し方が変わる。
ALTER TABLE public.bulletin_tasks
  ADD COLUMN IF NOT EXISTS source_excerpt text;

COMMENT ON COLUMN public.bulletin_tasks.source_excerpt IS
  'AIがこの依頼の根拠にした投稿の一文（そのまま）。読み間違いの箇所を追うため。★再掲では上書きしない（最初に読んだ文を残す）';
