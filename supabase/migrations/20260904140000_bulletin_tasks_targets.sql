-- ============================================================
-- 連絡掲示板AIアシスト: タスクに「対象」を持たせる
-- ============================================================
-- 正典: docs/bulletin-ai-assist.html
--
-- 土台（20260904120000）を実装に当てて、2つ足りないと分かった分を足す。

-- ------------------------------------------------------------
-- 1. 特定の生徒だけが対象のタスク
-- ------------------------------------------------------------
-- ★scope='specific_students' を用意しておきながら、対象の生徒を持つ場所が無かった。
--   この列が無いと「〇〇さんの目標を設定してください」型の依頼が判定できない。
ALTER TABLE public.bulletin_tasks
  ADD COLUMN IF NOT EXISTS target_student_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.bulletin_tasks.target_student_ids IS
  'scope=specific_students のときの対象生徒。それ以外では空';

-- ------------------------------------------------------------
-- 2. 自動でチェックを付ける先の申込状況の列
-- ------------------------------------------------------------
-- ★名前で推測しない。本番の申込状況の列は教室ごとにバラバラで、
--   清瀬校は「通知表入力」、京王堀之内校は「通知表の回収」、
--   永山校とデフォルト教室にはそもそも通知表の列が無い。
--   名前で当てにいくと、別の教室で「模試申し込み」に内申の済を書き込む事故が起きる。
--
--   NULL のあいだは自動チェックを行わない（進捗の判定だけ動く）。
--   教室長がその教室の列を1回選んだら、そこへ自動で付くようになる。
ALTER TABLE public.bulletin_tasks
  ADD COLUMN IF NOT EXISTS application_item_id uuid
  REFERENCES public.application_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.bulletin_tasks.application_item_id IS
  '実データが済になったとき自動でチェックを付ける申込状況の列。NULL=自動チェックしない。列名は教室ごとに違うので名前で推測しない';

CREATE INDEX IF NOT EXISTS idx_bulletin_tasks_application_item
  ON public.bulletin_tasks (application_item_id)
  WHERE application_item_id IS NOT NULL;
