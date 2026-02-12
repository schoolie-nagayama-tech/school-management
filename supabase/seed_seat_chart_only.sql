-- =====================================================
-- 座席表用ダミーデータ（生徒の座席表をすぐに見たいとき用）
-- =====================================================
-- 既存の教室・生徒・講師はそのまま。デフォルト教室（code='DEFAULT'）にだけ追加します。
-- Supabase SQL Editor で実行してください。
--
-- 前提：
--   - schools に code='DEFAULT' の教室が1件あること
--   - 講師として user_profiles に1人以上いること
--   - 生徒がいると座席表に名前が出ます（いなくてもコマ時間・通塾日程は入ります）

-- デフォルト教室の座席表データを一度削除（再実行しても上書きされるように）
DELETE FROM schedule_entries
WHERE school_id = (SELECT id FROM schools WHERE code = 'DEFAULT' LIMIT 1);

DELETE FROM schedule_regular_patterns
WHERE school_id = (SELECT id FROM schools WHERE code = 'DEFAULT' LIMIT 1);

-- コマ時間（1限・2限・3限）がなければ追加
INSERT INTO schedule_time_slots (school_id, slot_number, start_time, end_time, is_active, display_order)
SELECT s.id, 1, '17:00'::time, '17:50'::time, true, 0 FROM schools s WHERE s.code = 'DEFAULT' LIMIT 1
ON CONFLICT (school_id, slot_number) DO NOTHING;
INSERT INTO schedule_time_slots (school_id, slot_number, start_time, end_time, is_active, display_order)
SELECT s.id, 2, '18:00'::time, '18:50'::time, true, 1 FROM schools s WHERE s.code = 'DEFAULT' LIMIT 1
ON CONFLICT (school_id, slot_number) DO NOTHING;
INSERT INTO schedule_time_slots (school_id, slot_number, start_time, end_time, is_active, display_order)
SELECT s.id, 3, '19:00'::time, '19:50'::time, true, 2 FROM schools s WHERE s.code = 'DEFAULT' LIMIT 1
ON CONFLICT (school_id, slot_number) DO NOTHING;

-- 通塾日程（講師1人・生徒はデフォルト教室の先頭5人を月〜金の1限に割り当て）
DO $$
DECLARE
  school_id_val UUID;
  teacher_id_val UUID;
  slot_id_val UUID;
  dow smallint := 1;
  stu RECORD;
  subj_ids UUID[];
BEGIN
  SELECT id INTO school_id_val FROM schools WHERE code = 'DEFAULT' LIMIT 1;
  IF school_id_val IS NULL THEN RETURN; END IF;
  SELECT id INTO teacher_id_val FROM user_profiles LIMIT 1;
  IF teacher_id_val IS NULL THEN RETURN; END IF;
  SELECT id INTO slot_id_val FROM schedule_time_slots WHERE school_id = school_id_val ORDER BY display_order LIMIT 1;
  IF slot_id_val IS NULL THEN RETURN; END IF;

  FOR stu IN
    SELECT s.id AS student_id
    FROM students s
    WHERE s.school_id = school_id_val
    ORDER BY s.student_code
    LIMIT 5
  LOOP
    SELECT array_agg(ss.subject_id) INTO subj_ids FROM student_subjects ss WHERE ss.student_id = stu.student_id;
    subj_ids := COALESCE(subj_ids, '{}');

    INSERT INTO schedule_regular_patterns (
      school_id, student_id, day_of_week, time_slot_id, teacher_id, subject_ids, period_type, is_active
    ) VALUES (
      school_id_val, stu.student_id, dow, slot_id_val, teacher_id_val, subj_ids, 'regular', true
    );

    dow := dow + 1;
    IF dow > 5 THEN dow := 1; END IF;
  END LOOP;
END $$;

-- 今週の月曜を基準に、座席表に表示する schedule_entries（授業）を挿入
DO $$
DECLARE
  school_id_val UUID;
  teacher_id_val UUID;
  slot1_id_val UUID;
  slot2_id_val UUID;
  slot3_id_val UUID;
  pat RECORD;
  week_start DATE;
BEGIN
  week_start := date_trunc('week', current_date)::date;

  SELECT id INTO school_id_val FROM schools WHERE code = 'DEFAULT' LIMIT 1;
  IF school_id_val IS NULL THEN RETURN; END IF;
  SELECT id INTO teacher_id_val FROM user_profiles LIMIT 1;
  IF teacher_id_val IS NULL THEN RETURN; END IF;
  SELECT id INTO slot1_id_val FROM schedule_time_slots WHERE school_id = school_id_val AND slot_number = 1 LIMIT 1;
  SELECT id INTO slot2_id_val FROM schedule_time_slots WHERE school_id = school_id_val AND slot_number = 2 LIMIT 1;
  SELECT id INTO slot3_id_val FROM schedule_time_slots WHERE school_id = school_id_val AND slot_number = 3 LIMIT 1;
  IF slot1_id_val IS NULL THEN RETURN; END IF;

  -- 通塾日程に沿って、その週の月〜金に1限の授業を1件ずつ作成
  FOR pat IN
    SELECT id AS pattern_id, student_id, day_of_week, time_slot_id, subject_ids
    FROM schedule_regular_patterns
    WHERE school_id = school_id_val AND is_active = true
  LOOP
    INSERT INTO schedule_entries (
      school_id, entry_date, time_slot_id, teacher_id, student_id,
      subject_ids, seat_label, regular_pattern_id, status
    ) VALUES (
      school_id_val,
      week_start + (pat.day_of_week - 1),
      pat.time_slot_id,
      teacher_id_val,
      pat.student_id,
      COALESCE(pat.subject_ids, '{}'),
      NULL,
      pat.pattern_id,
      'scheduled'
    )
    ON CONFLICT (school_id, entry_date, time_slot_id, teacher_id, student_id) DO NOTHING;
  END LOOP;

  -- 2限にも生徒を数件追加（月・火・水）
  IF slot2_id_val IS NOT NULL THEN
    INSERT INTO schedule_entries (school_id, entry_date, time_slot_id, teacher_id, student_id, subject_ids, status)
    SELECT school_id_val, week_start + 0, slot2_id_val, teacher_id_val, s.id,
           COALESCE((SELECT array_agg(ss.subject_id) FROM student_subjects ss WHERE ss.student_id = s.id), '{}'),
           'scheduled'
    FROM students s WHERE s.school_id = school_id_val ORDER BY s.student_code OFFSET 1 LIMIT 1
    ON CONFLICT (school_id, entry_date, time_slot_id, teacher_id, student_id) DO NOTHING;
    INSERT INTO schedule_entries (school_id, entry_date, time_slot_id, teacher_id, student_id, subject_ids, status)
    SELECT school_id_val, week_start + 1, slot2_id_val, teacher_id_val, s.id,
           COALESCE((SELECT array_agg(ss.subject_id) FROM student_subjects ss WHERE ss.student_id = s.id), '{}'),
           'scheduled'
    FROM students s WHERE s.school_id = school_id_val ORDER BY s.student_code OFFSET 2 LIMIT 1
    ON CONFLICT (school_id, entry_date, time_slot_id, teacher_id, student_id) DO NOTHING;
    INSERT INTO schedule_entries (school_id, entry_date, time_slot_id, teacher_id, student_id, subject_ids, status)
    SELECT school_id_val, week_start + 2, slot2_id_val, teacher_id_val, s.id,
           COALESCE((SELECT array_agg(ss.subject_id) FROM student_subjects ss WHERE ss.student_id = s.id), '{}'),
           'scheduled'
    FROM students s WHERE s.school_id = school_id_val ORDER BY s.student_code OFFSET 3 LIMIT 1
    ON CONFLICT (school_id, entry_date, time_slot_id, teacher_id, student_id) DO NOTHING;
  END IF;

  -- 3限にも生徒を数件追加（火・木）
  IF slot3_id_val IS NOT NULL THEN
    INSERT INTO schedule_entries (school_id, entry_date, time_slot_id, teacher_id, student_id, subject_ids, status)
    SELECT school_id_val, week_start + 1, slot3_id_val, teacher_id_val, s.id,
           COALESCE((SELECT array_agg(ss.subject_id) FROM student_subjects ss WHERE ss.student_id = s.id), '{}'),
           'scheduled'
    FROM students s WHERE s.school_id = school_id_val ORDER BY s.student_code OFFSET 0 LIMIT 1
    ON CONFLICT (school_id, entry_date, time_slot_id, teacher_id, student_id) DO NOTHING;
    INSERT INTO schedule_entries (school_id, entry_date, time_slot_id, teacher_id, student_id, subject_ids, status)
    SELECT school_id_val, week_start + 3, slot3_id_val, teacher_id_val, s.id,
           COALESCE((SELECT array_agg(ss.subject_id) FROM student_subjects ss WHERE ss.student_id = s.id), '{}'),
           'scheduled'
    FROM students s WHERE s.school_id = school_id_val ORDER BY s.student_code OFFSET 2 LIMIT 1
    ON CONFLICT (school_id, entry_date, time_slot_id, teacher_id, student_id) DO NOTHING;
  END IF;
END $$;
