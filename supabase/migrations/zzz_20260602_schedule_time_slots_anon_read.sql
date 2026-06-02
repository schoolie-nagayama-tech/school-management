-- ============================================================
-- 公開フォーム（週回数変更/曜日変更）が時限マスタをライブ参照できるようにする
-- ============================================================
--
-- 背景:
--   週回数変更・曜日変更フォームの「時限」は、これまで期間設定の
--   available_periods スナップショットを参照しており、コマ時間マスタ
--   (schedule_time_slots) を変更しても自動追従しなかった。
--   フォームをマスタのライブ参照に変更するため、公開ポータル(anon)から
--   マスタを SELECT できるようにする。
--
-- 安全性:
--   schedule_time_slots は時限番号・開始/終了時刻のみで個人情報を含まない。
--   schools / subjects と同様に anon SELECT を許可する公開マスタとして扱う。
--   公開範囲は is_active=true のみ。書込はスタッフ(authenticated)のみ。
-- ============================================================

DROP POLICY IF EXISTS "schedule_time_slots_anon_select" ON public.schedule_time_slots;
CREATE POLICY "schedule_time_slots_anon_select" ON public.schedule_time_slots
  FOR SELECT TO anon
  USING (is_active = true);
