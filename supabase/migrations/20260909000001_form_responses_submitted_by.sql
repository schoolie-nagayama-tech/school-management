-- フォーム回答を「誰が出したか」。保護者本人の申込は NULL、教室長が代理で出した場合だけ
-- そのユーザーが入る（＝ NULL かどうかが代理申込の判定そのもの）。
--
-- ★ 値はサーバー側（/api/portal/form-responses）でログイン情報から詰める。
--   クライアントから渡された user_id は信用しない（代理申込は「誰が出したか」が要点のため）。
-- ★ 出勤簿の submitted_by と同じ考え方: 本人の申告か代理かを後から辿れるようにする。

ALTER TABLE public.form_responses
  ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'form_responses_submitted_by_user_id_fkey'
  ) THEN
    ALTER TABLE public.form_responses
      ADD CONSTRAINT form_responses_submitted_by_user_id_fkey
      FOREIGN KEY (submitted_by_user_id) REFERENCES public.user_profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.form_responses.submitted_by_user_id IS
  '代理申込を出した職員。保護者本人の申込は NULL。ON DELETE SET NULL（退職で回答を道連れにしない）。';
