-- UNIQUE制約をDEFERRABLEに変更（並び替え時の中間状態を許容）
ALTER TABLE schedule_time_slots
  DROP CONSTRAINT IF EXISTS schedule_time_slots_school_id_slot_number_key;

ALTER TABLE schedule_time_slots
  ADD CONSTRAINT schedule_time_slots_school_id_slot_number_key
  UNIQUE (school_id, slot_number) DEFERRABLE INITIALLY IMMEDIATE;

-- 開始時刻順で slot_number を自動振り直し
CREATE OR REPLACE FUNCTION public.reassign_slot_numbers(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  SET CONSTRAINTS schedule_time_slots_school_id_slot_number_key DEFERRED;

  UPDATE public.schedule_time_slots t
  SET slot_number = sub.rn::integer,
      updated_at = now()
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY start_time ASC) AS rn
    FROM public.schedule_time_slots
    WHERE school_id = p_school_id
  ) sub
  WHERE t.id = sub.id
    AND t.slot_number IS DISTINCT FROM sub.rn::integer;

  SET CONSTRAINTS schedule_time_slots_school_id_slot_number_key IMMEDIATE;
END;
$$;

-- 手動並び替え用: IDの配列順に slot_number を振り直す
CREATE OR REPLACE FUNCTION public.reorder_time_slots(p_school_id uuid, p_ordered_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  SET CONSTRAINTS schedule_time_slots_school_id_slot_number_key DEFERRED;

  UPDATE public.schedule_time_slots t
  SET slot_number = sub.new_number::integer,
      updated_at = now()
  FROM (
    SELECT id, ordinality AS new_number
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ordinality)
  ) sub
  WHERE t.id = sub.id
    AND t.school_id = p_school_id
    AND t.slot_number IS DISTINCT FROM sub.new_number::integer;

  SET CONSTRAINTS schedule_time_slots_school_id_slot_number_key IMMEDIATE;
END;
$$;
