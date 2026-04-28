-- 所持教材と進行表表示を分離するためのフラグ
-- track_progress=true のときだけ進行表ページに表示する
-- 既存データは true のまま、新規登録分は false（所持のみ）が初期値
ALTER TABLE student_textbooks
  ADD COLUMN IF NOT EXISTS track_progress BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE student_textbooks ALTER COLUMN track_progress SET DEFAULT false;
