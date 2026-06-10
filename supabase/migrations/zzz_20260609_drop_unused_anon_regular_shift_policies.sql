-- 2026-06-09 セキュリティ修正 (MCP経由で本番適用済み・リポジトリ同期用)
--
-- 公開シフト提出/編集は /api/regular-shift/public/* がサービスロールキーで実行され
-- RLSをバイパスするため、以下のanonポリシーはアプリから一切使われていない。
-- 匿名キー(publishable key)だけで他人のシフト提出を直接 読み書き/削除 できる穴なので削除する。
-- スタッフUIは authenticated ポリシーで動作するため影響なし。

-- regular_shift_submission_slots (anon 読み書き削除を全廃)
drop policy if exists "regular_shift_slots_anon_delete" on public.regular_shift_submission_slots;
drop policy if exists "regular_shift_slots_anon_update" on public.regular_shift_submission_slots;
drop policy if exists "regular_shift_slots_anon_insert" on public.regular_shift_submission_slots;
drop policy if exists "regular_shift_slots_anon_select" on public.regular_shift_submission_slots;

-- regular_shift_submissions (anon 書き込み/読み取りを全廃)
drop policy if exists "regular_shift_submissions_anon_update" on public.regular_shift_submissions;
drop policy if exists "regular_shift_submissions_anon_insert" on public.regular_shift_submissions;
drop policy if exists "regular_shift_submissions_anon_select" on public.regular_shift_submissions;

-- regular_shift_slot_settings (anon 読み取りを廃止: 公開GETはサービスロール経由)
drop policy if exists "regular_shift_slot_settings_anon_select" on public.regular_shift_slot_settings;
