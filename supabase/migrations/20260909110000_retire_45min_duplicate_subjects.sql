-- 45分専用の科目レコードを廃止し、45分の表現をコース(student_subject_contracts)に一本化する。
--
-- 背景:
--   いま45分の持ち方が2通りある。
--   (a) 小学の「国語」「算数」「英語」は 45分版と90分版が別の科目レコードとして登録されている。
--   (b) 一方で「普通の科目＋パターン側で duration_minutes=45」という行が既に入っている
--       （永山校が2026-10-01から切り替える版）。
--   コースが (ratio, duration_minutes) を持つようになると (a) は不要になり、
--   同じ「45分」が2通りで表せる状態は事故の元なので (b) に一本化する。
--
-- やること:
--   45分科目を、同名・同学年カテゴリの90分科目へ付け替え、その行に duration_minutes=45 を立て、
--   45分科目のレコードを削除する。
--
-- ★half_position は触らない。
--   いまも45分の授業はコマを丸ごと使っている（該当行の half_position は NULL＝全コマ扱い）。
--   ここで前後半を立てると席の詰まり方が変わり、既存の座席が動いてしまう。
--   前後半の割り当ては、座席表の稼働後に教室長が個別に設定する。
--
-- 前提の確認（本番 2026-09-09 時点）:
--   45分科目3件（小学の国語・算数・英語）の参照は
--   パターン16 / コマ130 / マッチング提案7 / 指導可能科目22〜23名 のみ。
--   受講科目・コース・教材・講座・保留授業・テスト対策からの参照は0件。
--   また45分科目を含む行はすべて単一科目（複数科目に混ざっている行は無い）なので、
--   行全体に duration_minutes=45 を立てても他の科目を巻き込まない。
--
-- ロールバック:
--   科目レコードの削除を含むため自動では戻せない。
--   差し戻す場合は 45分科目を再作成し、duration_minutes=45 の行を手で戻す。

DO $$
DECLARE
  m RECORD;
  moved_patterns int;
  moved_entries int;
  moved_proposals int;
  moved_teachers int;
BEGIN
  FOR m IN
    SELECT old_s.id AS old_id, new_s.id AS new_id, old_s.name, old_s.grade_category
    FROM public.subjects old_s
    JOIN public.subjects new_s
      ON new_s.name = old_s.name
     AND new_s.grade_category IS NOT DISTINCT FROM old_s.grade_category
     AND new_s.duration_minutes = 90
    WHERE old_s.duration_minutes = 45
  LOOP
    -- 通塾日程パターン: 科目IDを差し替え、45分であることを行に残す。
    -- array_replace で入れ替えたあと、元から90分版も入っていた場合に備えて重複を畳む
    -- （順序は最初に出てきた位置を保つ）。
    WITH upd AS (
      UPDATE public.schedule_regular_patterns p
      SET subject_ids = (
            SELECT array_agg(x ORDER BY ord)
            FROM (
              SELECT x, min(ord) AS ord
              FROM unnest(array_replace(p.subject_ids, m.old_id, m.new_id))
                   WITH ORDINALITY AS t(x, ord)
              GROUP BY x
            ) s
          ),
          duration_minutes = 45,
          updated_at = now()
      WHERE m.old_id = ANY(p.subject_ids)
      RETURNING 1
    ) SELECT count(*) INTO moved_patterns FROM upd;

    -- 授業コマ: 同じ付け替え。
    WITH upd AS (
      UPDATE public.schedule_entries e
      SET subject_ids = (
            SELECT array_agg(x ORDER BY ord)
            FROM (
              SELECT x, min(ord) AS ord
              FROM unnest(array_replace(e.subject_ids, m.old_id, m.new_id))
                   WITH ORDINALITY AS t(x, ord)
              GROUP BY x
            ) s
          ),
          duration_minutes = 45,
          updated_at = now()
      WHERE m.old_id = ANY(e.subject_ids)
      RETURNING 1
    ) SELECT count(*) INTO moved_entries FROM upd;

    -- マッチング提案: 科目IDの差し替えのみ（提案に授業時間の列は無い）。
    WITH upd AS (
      UPDATE public.schedule_match_proposals mp
      SET subject_ids = (
            SELECT array_agg(x ORDER BY ord)
            FROM (
              SELECT x, min(ord) AS ord
              FROM unnest(array_replace(mp.subject_ids, m.old_id, m.new_id))
                   WITH ORDINALITY AS t(x, ord)
              GROUP BY x
            ) s
          )
      WHERE m.old_id = ANY(mp.subject_ids)
      RETURNING 1
    ) SELECT count(*) INTO moved_proposals FROM upd;

    -- 指導可能科目: 45分IDを外し、90分IDが無ければ足す
    -- （45分だけ指導可能だった講師が、付け替えで指導不可になるのを防ぐ）。
    WITH upd AS (
      UPDATE public.user_profiles up
      SET teachable_subject_ids = CASE
            WHEN m.new_id = ANY(up.teachable_subject_ids)
              THEN array_remove(up.teachable_subject_ids, m.old_id)
            ELSE array_replace(up.teachable_subject_ids, m.old_id, m.new_id)
          END
      WHERE m.old_id = ANY(up.teachable_subject_ids)
      RETURNING 1
    ) SELECT count(*) INTO moved_teachers FROM upd;

    RAISE NOTICE '45分科目を付け替え: % (%) → パターン% / コマ% / 提案% / 講師%',
      m.name, m.grade_category, moved_patterns, moved_entries, moved_proposals, moved_teachers;
  END LOOP;

  -- 参照が残っていないことを確かめてから消す。残っていれば中断して原因を出す
  -- （黙って消すと CASCADE で受講科目やコースを巻き込む可能性があるため）。
  IF EXISTS (
    SELECT 1 FROM public.subjects s
    WHERE s.duration_minutes = 45
      AND (
        EXISTS (SELECT 1 FROM public.schedule_regular_patterns p WHERE s.id = ANY(p.subject_ids))
        OR EXISTS (SELECT 1 FROM public.schedule_entries e WHERE s.id = ANY(e.subject_ids))
        OR EXISTS (SELECT 1 FROM public.schedule_match_proposals mp WHERE s.id = ANY(mp.subject_ids))
        OR EXISTS (SELECT 1 FROM public.user_profiles up WHERE s.id = ANY(up.teachable_subject_ids))
        OR EXISTS (SELECT 1 FROM public.student_subjects ss WHERE ss.subject_id = s.id)
        OR EXISTS (SELECT 1 FROM public.student_subject_contracts sc WHERE sc.subject_id = s.id)
        OR EXISTS (SELECT 1 FROM public.textbooks tb WHERE tb.subject_id = s.id)
        OR EXISTS (SELECT 1 FROM public.special_courses spc WHERE spc.subject_id = s.id)
        OR EXISTS (SELECT 1 FROM public.schedule_pending_lessons pl WHERE pl.subject_id = s.id)
        OR EXISTS (SELECT 1 FROM public.test_prep_proposal_units tp WHERE tp.subject_id = s.id)
        OR EXISTS (SELECT 1 FROM public.koushu_enrollments ke WHERE s.id = ANY(ke.subject_ids))
      )
  ) THEN
    RAISE EXCEPTION '45分科目に参照が残っています。付け替え漏れを確認してください（削除を中断しました）';
  END IF;

  DELETE FROM public.subjects WHERE duration_minutes = 45;
END $$;

-- 科目マスタの duration_minutes は「コースが未設定の科目の既定値」としてだけ残す。
COMMENT ON COLUMN public.subjects.duration_minutes IS
  '科目の既定の授業時間(分)。生徒ごとの45分/90分はコース(student_subject_contracts.duration_minutes)が正。'
  'この列は、その科目のコースがまだ設定されていないときの既定値としてだけ使う。'
  '★45分専用の科目レコードを作らないこと（同じ「45分」が2通りで表せる状態に戻る）。';
