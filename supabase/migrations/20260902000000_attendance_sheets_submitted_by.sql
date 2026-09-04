-- ============================================================
-- 出勤簿に「誰が提出したか」を残す（attendance_sheets.submitted_by）
-- ============================================================
-- 背景:
--   出勤簿は本人以外（教室長・管理者）も代理で提出できる。
--   これまで submitted_at しか無く、本人が出したのか代理で出されたのかが
--   後から分からなかった。給与の根拠になる書類なので、誰が出したかを残す。
--
-- 設計:
--   submitted_by = 提出ボタンを押した人。
--   代理提出の判定は submitted_by IS NOT NULL AND submitted_by <> teacher_id。
--   既存行は NULL（＝いつ誰が出したか不明）。過去分を代理扱いにはしない。
--   取り下げ・差し戻しでは消さない（次の提出で上書きされる）。
-- 冪等: IF NOT EXISTS なので再実行しても安全。
-- ============================================================

alter table public.attendance_sheets
  add column if not exists submitted_by uuid references public.user_profiles(id);

comment on column public.attendance_sheets.submitted_by is
  '提出ボタンを押した人。teacher_id と違えば代理提出。NULL=この列を追加する前の提出。';
