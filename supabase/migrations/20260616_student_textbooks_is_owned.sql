-- 「所持(物理的に持っている)」を「進行表で管理(track_progress)」と独立に持つ。
-- これまで track_progress 1個で所持と管理を兼用していたため「所持してて管理する」状態が表せず、
-- 所持済み教材まで発注候補に出てしまっていた。is_owned を分離して4状態(所持×管理)を表現する。
ALTER TABLE student_textbooks
  ADD COLUMN IF NOT EXISTS is_owned BOOLEAN NOT NULL DEFAULT false;

-- 既存データ移行:
-- track_progress=false かつ 下書きでない(is_draft=false) 行は、発注/手動登録由来の「所持」とみなす。
-- 公開提案書由来(track_progress=true)は「所持してないけど管理する(③)」の既定とし、所持は配布時/手動で付与する。
-- 下書き(is_draft=true)は所持ではない。
UPDATE student_textbooks
  SET is_owned = true
  WHERE track_progress = false AND is_draft = false;
