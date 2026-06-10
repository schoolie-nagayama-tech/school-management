-- 2026-06-09 セキュリティ修正 (MCP経由で本番適用済み・リポジトリ同期用)
--
-- 以下のテーブルは公開ルート(portal/attendance/seasonal-shift/regular-shift/invite)から
-- 一切ブラウザ(anon)読みされていないことをコード調査で確認済み。
-- 公開フローはサービスロールAPI経由、スタッフ操作は authenticated 経由で動作するため、
-- これらの anon/public SELECT ポリシーは未使用の公開穴。削除する。

-- push通知購読: 送信=サービスロール / 登録=認証必須。anon/public読み不要（端末endpoint漏れ防止）
drop policy if exists "push_subscriptions_service_read" on public.push_subscriptions;

-- 講習(seasonal)スロット設定: 公開GETはサービスロール、設定編集は認証スタッフ。anon読み不要
drop policy if exists "seasonal_shift_slot_settings_anon_select" on public.seasonal_shift_slot_settings;

-- マスタ系: 公開フォーム描画はこれらを読まない（components/forms・各フォームlibで未参照）
drop policy if exists "subjects_anon_select" on public.subjects;
drop policy if exists "allow_anon_select" on public.textbooks;
drop policy if exists "allow_anon_select" on public.curriculum_items;
drop policy if exists "system_settings_anon_select" on public.system_settings;
