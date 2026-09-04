-- ============================================================
-- 生徒テキストに「完了」ラベルを持たせる（student_textbooks.completed_at）
-- ============================================================
-- 背景:
--   使い終わったテキストを一覧から消す手段が is_active=false しか無く、
--   これは進行表そのものが見えなくなる（履歴を追えない）ため運用で使えなかった。
--   「使い終わったが記録は残す」状態を表す列を足し、季節ラベルの隣に完了ラベルとして出す。
--
-- 設計:
--   boolean ではなく timestamptz にして「いつ完了にしたか」も残す。
--   完了 = completed_at IS NOT NULL、解除 = NULL に戻す。
--   is_active / track_progress とは独立（完了にしても進行表は今までどおり開ける）。
-- 冪等: IF NOT EXISTS なので再実行しても安全。
-- ============================================================

alter table public.student_textbooks
  add column if not exists completed_at timestamptz;

comment on column public.student_textbooks.completed_at is
  '使い終わったテキストに付ける完了ラベル。NULL=未完了。進行表の最終単元まで進んだときに確認して設定する。';

-- 一覧で「完了を除く」絞り込みをするための部分インデックス（未完了だけを引く用途）
create index if not exists idx_student_textbooks_active_incomplete
  on public.student_textbooks (student_id)
  where completed_at is null;
