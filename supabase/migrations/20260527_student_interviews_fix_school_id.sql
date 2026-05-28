-- student_interviews.school_id を生徒の所属教室と整合させる
--
-- 背景:
--   Notta 取り込みなど一部の作成経路で、transcript.school_id（アップロード時の教室）が
--   そのまま student_interviews.school_id に保存されていた。生徒の所属教室と異なる場合、
--   アラート集計（school_id でフィルタする getInterviewsBySchool）で新しい面談記録が
--   検出されず、「面談未更新」アラートが消えない問題が発生していた。
--
-- このマイグレーションは既存データを修正する。新規作成側の修正は API レイヤで対応済み。

UPDATE public.student_interviews AS si
SET school_id = s.school_id
FROM public.students AS s
WHERE si.student_id = s.id
  AND si.school_id IS DISTINCT FROM s.school_id;
