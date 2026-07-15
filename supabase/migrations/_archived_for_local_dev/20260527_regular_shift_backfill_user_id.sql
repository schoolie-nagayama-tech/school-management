-- 既存の通常シフト提出に user_id をバックフィル（座席表の出勤可能講師表示用）
-- 解決順: (1) メール完全一致 (2) 同一教室・氏名完全一致（同名講師が複数いる場合はスキップ）

-- 1. メール（大文字小文字無視）
UPDATE public.regular_shift_submissions AS r
SET user_id = u.id,
    updated_at = NOW()
FROM public.user_profiles AS u
WHERE r.user_id IS NULL
  AND r.teacher_email IS NOT NULL
  AND lower(trim(r.teacher_email)) = lower(trim(u.email))
  AND u.role = 'teacher'
  AND COALESCE(u.is_active, true) = true;

-- 2. 氏名（空白除去後・同一 school_id・候補が1名のみ）
UPDATE public.regular_shift_submissions AS r
SET user_id = matched.user_id,
    updated_at = NOW()
FROM (
  SELECT
    r2.id AS submission_id,
    (array_agg(u.id ORDER BY u.created_at))[1] AS user_id
  FROM public.regular_shift_submissions AS r2
  INNER JOIN public.user_schools AS us ON us.school_id = r2.school_id
  INNER JOIN public.user_profiles AS u ON u.id = us.user_id
  WHERE r2.user_id IS NULL
    AND u.role = 'teacher'
    AND COALESCE(u.is_active, true) = true
    AND regexp_replace(COALESCE(u.display_name, ''), '[\s　]+', '', 'g') <> ''
    AND regexp_replace(COALESCE(u.display_name, ''), '[\s　]+', '', 'g')
      = regexp_replace(COALESCE(r2.teacher_name, ''), '[\s　]+', '', 'g')
  GROUP BY r2.id
  HAVING count(DISTINCT u.id) = 1
) AS matched
WHERE r.id = matched.submission_id
  AND r.user_id IS NULL;
