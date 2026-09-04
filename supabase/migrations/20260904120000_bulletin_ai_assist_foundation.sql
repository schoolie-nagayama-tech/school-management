-- ============================================================
-- 連絡掲示板AIアシスト: 土台
-- ============================================================
-- 正典: docs/bulletin-ai-assist.html
--
-- 掲示板の投稿からタスクを抽出し、済/未済を実データで判定して、
-- 授業中の講師に1件だけ知らせる仕組みの土台。
-- ここではテーブルと列だけを用意する（抽出・判定・表示は別PR）。
--
-- ★この土台が要る理由（2026-09-04 に実データで確認）:
--   清瀬校では、実データ上は内申が41名入力済だったのに、手動チェックは13名しか
--   付いておらず、教室長は手動チェックを見て督促を4回繰り返していた。
--   実態は「チェックの付け忘れ」で、督促そのものが不要だった。
--   だから済の判定は実データ側で行い、手動チェックはそこから自動で付ける。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 申込状況のチェックに「誰が付けたか」を持たせる
-- ------------------------------------------------------------
-- ★これが無いと自動チェックは事故る。
--   いまはチェックを外すと行ごと消えるため、「まだ付けていない」と
--   「人が意図して外した」が区別できない。そのまま自動で付けると、
--   教室長が外したチェックを翌日また自動が付け直してしまう。
--
--   規約:
--     - 自動が書き込んでよいのは「行が無い」か「set_by = 'auto'」のときだけ。
--     - 人が触った行は必ず set_by = 'manual' になり、自動は二度と触らない。
--     - 人が自動の行を外すときは、行を消さずに status = NULL・set_by = 'manual' で残す
--       （消すと未着手と区別できず、自動が付け直してしまうため）。
--
--   既定を 'manual' にしているので、既存の行はすべて自動の対象外になる。
--   （not_applicable を自動が completed で塗り替える事故を防ぐ）
ALTER TABLE public.student_applications
  ADD COLUMN IF NOT EXISTS set_by text NOT NULL DEFAULT 'manual';

ALTER TABLE public.student_applications
  DROP CONSTRAINT IF EXISTS student_applications_set_by_check;
ALTER TABLE public.student_applications
  ADD CONSTRAINT student_applications_set_by_check CHECK (set_by IN ('manual', 'auto'));

COMMENT ON COLUMN public.student_applications.set_by IS
  '誰が付けたか。manual=人が触った（自動は二度と触らない）／auto=実データから自動で付いた。docs/bulletin-ai-assist.html';

-- ------------------------------------------------------------
-- 2. 掲示板の投稿から抽出したタスク
-- ------------------------------------------------------------
-- ★AIは13種の有限カタログから選ぶだけで、種別を自由に作らない。
--   ここを自由記述にすると、済の判定式が種別に紐づかなくなり仕組みが成立しない。
CREATE TABLE IF NOT EXISTS public.bulletin_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,

  -- 13種の有限カタログ（内申入力・テスト結果転記・目標設定・進行表入力・
  -- シフト提出・シフト確認・出勤簿入力・教材配布チェック・所持教材確認・
  -- テスト対策提案・申込状況チェック・報告書の期限・報告書タイトル形式）
  kind text NOT NULL,

  -- 誰に出すか（全生徒 / 担当生徒 / 学年 / 特定生徒 / 講師自身）
  scope text NOT NULL,
  -- scope='grade' のときの対象学年。空なら学年で絞らない
  target_grades int[] NOT NULL DEFAULT '{}',

  -- 期限の型（date=その日まで / every=授業のたび / none=期限なし）
  due_type text NOT NULL DEFAULT 'none',
  due_date date,

  -- ★教室長が投稿直後に「追跡しない」へ落とせる。承認は挟まず、既定は追跡する。
  --   承認待ちにすると「押し忘れたら何も起きない」で、いまの督促と同じ問題が形を変えて残る。
  tracked boolean NOT NULL DEFAULT true,

  -- 済がそろって終了したタスク。再掲で復活しうるので削除はしない
  closed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bulletin_tasks
  DROP CONSTRAINT IF EXISTS bulletin_tasks_scope_check;
ALTER TABLE public.bulletin_tasks
  ADD CONSTRAINT bulletin_tasks_scope_check
  CHECK (scope IN ('all_students', 'assigned_students', 'grade', 'specific_students', 'teacher_self'));

ALTER TABLE public.bulletin_tasks
  DROP CONSTRAINT IF EXISTS bulletin_tasks_due_type_check;
ALTER TABLE public.bulletin_tasks
  ADD CONSTRAINT bulletin_tasks_due_type_check CHECK (due_type IN ('date', 'every', 'none'));

COMMENT ON TABLE public.bulletin_tasks IS
  '掲示板の投稿から抽出した依頼。kind は13種の有限カタログ（docs/bulletin-ai-assist.html）';
COMMENT ON COLUMN public.bulletin_tasks.tracked IS
  '教室長が投稿直後に「追跡しない」へ落とせる。既定は追跡する（承認は挟まない）';

CREATE INDEX IF NOT EXISTS idx_bulletin_tasks_school_open
  ON public.bulletin_tasks (school_id, created_at DESC)
  WHERE closed_at IS NULL AND tracked = true;

-- ------------------------------------------------------------
-- 3. タスクと投稿の紐づけ（再掲をまとめる）
-- ------------------------------------------------------------
-- ★同じ依頼が繰り返し投稿される（通知表回収は4教室で8投稿、清瀬校だけで4回）。
--   投稿ごとに別タスクとして数えると、進捗が投稿のたびにリセットされてしまう。
--   1本の継続タスクに束ね、投稿は「同じ件の再掲」として紐づける。
CREATE TABLE IF NOT EXISTS public.bulletin_task_posts (
  task_id uuid NOT NULL REFERENCES public.bulletin_tasks(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.bulletin_posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, post_id)
);

COMMENT ON TABLE public.bulletin_task_posts IS
  'タスクと掲示板投稿の紐づけ。再掲は同じ task_id に足していく（新規タスクを作らない）';

-- ------------------------------------------------------------
-- 4. 完了履歴
-- ------------------------------------------------------------
-- ★申込状況も進行表も「いつ済んだか」を持っていない（外すと行ごと消える）。
--   ここでしか履歴が取れないので、初めて済を観測した時刻を残す。
--   ポップアップが効いているかの測定にも要る。
--
--   粒度: タスク×生徒×講師×観測時刻（2026-09-04 決定）。
--   生徒に紐づかないタスク（シフト提出など）は student_id を NULL にする。
CREATE TABLE IF NOT EXISTS public.bulletin_task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.bulletin_tasks(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,

  -- 生徒に紐づかないタスク（シフト提出・出勤簿入力など）では NULL
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  -- 済ませた講師。担当が解決できないときは NULL（清瀬校は座席表も固定講師も0件）
  teacher_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,

  -- ★初めて済と観測した時刻。あとから遡って上書きしない
  observed_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now()
);

-- 同じタスク×生徒は1回だけ。student_id が NULL の行（講師自身のタスク）は
-- NULL 同士が重複扱いにならないので、部分インデックスで2通りに分ける
CREATE UNIQUE INDEX IF NOT EXISTS uq_bulletin_task_completions_student
  ON public.bulletin_task_completions (task_id, student_id)
  WHERE student_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bulletin_task_completions_teacher
  ON public.bulletin_task_completions (task_id, teacher_id)
  WHERE student_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_bulletin_task_completions_task
  ON public.bulletin_task_completions (task_id, observed_at DESC);

COMMENT ON TABLE public.bulletin_task_completions IS
  '初めて済を観測した記録。申込状況・進行表側に履歴が無いためここで持つ（docs/bulletin-ai-assist.html §6）';

-- ------------------------------------------------------------
-- 5. 講師ごとのAIアシスト
-- ------------------------------------------------------------
-- ★既定はOFF。教室長が講師ごとに付ける（2026-09-04 決定）。
--   未対応率のしきい値による自動ONは採らない。最初は数人で試して広げられ、
--   誤爆したときの影響範囲が読めるため。
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS bulletin_ai_assist boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profiles.bulletin_ai_assist IS
  '授業中のAIアシスト（掲示板タスクのポップアップ）を出すか。既定OFF・教室長が講師ごとに付ける';

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------
-- 読みは自教室のスタッフ、書きは API（service role）だけ。
-- ★Supabaseの既定権限で anon/authenticated に ALL が付くため、明示的に剥がしてから付け直す。
ALTER TABLE public.bulletin_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulletin_task_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulletin_task_completions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.bulletin_tasks FROM anon, authenticated;
REVOKE ALL ON public.bulletin_task_posts FROM anon, authenticated;
REVOKE ALL ON public.bulletin_task_completions FROM anon, authenticated;

GRANT SELECT ON public.bulletin_tasks TO authenticated;
GRANT SELECT ON public.bulletin_task_posts TO authenticated;
GRANT SELECT ON public.bulletin_task_completions TO authenticated;

DROP POLICY IF EXISTS bulletin_tasks_select ON public.bulletin_tasks;
CREATE POLICY bulletin_tasks_select ON public.bulletin_tasks
  FOR SELECT TO authenticated
  USING (public.check_school_access(school_id));

DROP POLICY IF EXISTS bulletin_task_completions_select ON public.bulletin_task_completions;
CREATE POLICY bulletin_task_completions_select ON public.bulletin_task_completions
  FOR SELECT TO authenticated
  USING (public.check_school_access(school_id));

-- 紐づけ表は教室列を持たないので、親タスクの教室で判定する
DROP POLICY IF EXISTS bulletin_task_posts_select ON public.bulletin_task_posts;
CREATE POLICY bulletin_task_posts_select ON public.bulletin_task_posts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bulletin_tasks t
      WHERE t.id = bulletin_task_posts.task_id AND public.check_school_access(t.school_id)
    )
  );
