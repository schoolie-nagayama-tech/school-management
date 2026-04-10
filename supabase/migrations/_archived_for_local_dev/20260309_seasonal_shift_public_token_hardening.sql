BEGIN;

DROP POLICY IF EXISTS "seasonal_shift_submissions_anon_insert" ON seasonal_shift_submissions;
DROP POLICY IF EXISTS "seasonal_shift_submissions_anon_select" ON seasonal_shift_submissions;
DROP POLICY IF EXISTS "seasonal_shift_submissions_anon_update" ON seasonal_shift_submissions;

DROP POLICY IF EXISTS "seasonal_shift_slots_anon_insert" ON seasonal_shift_submission_slots;
DROP POLICY IF EXISTS "seasonal_shift_slots_anon_select" ON seasonal_shift_submission_slots;
DROP POLICY IF EXISTS "seasonal_shift_slots_anon_update" ON seasonal_shift_submission_slots;
DROP POLICY IF EXISTS "seasonal_shift_slots_anon_delete" ON seasonal_shift_submission_slots;

COMMIT;
