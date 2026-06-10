-- 2026-06-09 セキュリティ修正 (MCP経由で本番適用済み・リポジトリ同期用)
--
-- function_search_path_mutable 対策: search_path を固定し、呼び出し側の search_path 改ざんによる
-- オブジェクト横取り(特にSECURITY DEFINER)を防ぐ。本文は変更せず設定のみ付与（非破壊）。
-- public を先頭に固定 → 本文の非修飾参照(public配下)はそのまま解決。PG17は非特権ユーザーが
-- public にオブジェクト作成不可のため横取り不可。

alter function public.handle_new_user() set search_path = public, pg_temp;
alter function public.reassign_slot_numbers(p_school_id uuid) set search_path = public, pg_temp;
alter function public.reorder_time_slots(p_school_id uuid, p_ordered_ids uuid[]) set search_path = public, pg_temp;
alter function public.set_updated_at_teacher_availability_periods() set search_path = public, pg_temp;
alter function public.update_attendance_updated_at() set search_path = public, pg_temp;
alter function public.update_google_calendar_tokens_updated_at() set search_path = public, pg_temp;
alter function public.update_schools_updated_at_column() set search_path = public, pg_temp;
alter function public.update_updated_at_column() set search_path = public, pg_temp;
