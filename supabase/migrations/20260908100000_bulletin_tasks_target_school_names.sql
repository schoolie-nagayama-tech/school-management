-- ============================================================
-- 連絡掲示板AIアシスト: 通学校で絞る対象を持たせる
-- ============================================================
-- 正典: docs/bulletin-ai-assist.html
--
-- ★永山校の試用で「諏訪中生は」という投稿が scope=specific_students・
--   target_student_ids=[] になった。「◯◯中生」は通学校の話であって名指しでは
--   ない（永山校は在籍81名中、諏訪中28名）が、通学校で絞る scope がそもそも
--   無かった。scope='attending_school' を足し、その対象を持つ列をここで用意する。
--
-- students.school_name（通学校）には表記ゆれがある（「永山」「永山中」など）。
-- ここでは投稿から読み取った学校名をそのまま入れ、ゆるい突き合わせは
-- 判定側（src/lib/bulletin/progress.ts）で行う。
--
-- ★本番には当てない（このPRの時点では未使用の下準備。当てるのは実装が
--   一通り動作確認できてから）。
ALTER TABLE public.bulletin_tasks
  ADD COLUMN IF NOT EXISTS target_school_names text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.bulletin_tasks.target_school_names IS
  'scope=attending_school のときの対象の通学校（students.school_name の表記そのまま）。それ以外では空';
