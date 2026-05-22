-- 開始時刻順でslot_numberを自動再割り当てするRPC関数
-- 単一UPDATE文なのでUNIQUE制約は最終状態でのみチェックされる
CREATE OR REPLACE FUNCTION public.reassign_slot_numbers(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
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
END;
$$;
