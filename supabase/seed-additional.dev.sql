-- 追加サンプルデータ（既存データは削除しません）
-- 既存のデータを残したまま、Heavy アラート用の成績サンプルを追加します
-- Supabase SQL Editorで実行してください

-- =============================================
-- ⚠️  本番環境での実行を禁止する安全ガード
-- =============================================
DO $$
BEGIN
  -- students テーブルに100件以上のデータがあれば本番とみなして中止
  IF (SELECT COUNT(*) FROM students) > 100 THEN
    RAISE EXCEPTION '⛔ 本番環境での seed 実行を検出しました。100件以上の生徒データが存在します。処理を中止します。';
  END IF;
END $$;

-- ============================================
-- Heavy アラート用サンプル（成績・テスト関連）
-- score_drop: 前回比10点以上低下 / score_missing: 未入力科目
-- ============================================
DO $$
DECLARE
  school_id_val UUID;
  student_id_val UUID;
  asm1_id UUID;
  asm2_id UUID;
  asm3_id UUID;
BEGIN
  SELECT id INTO school_id_val FROM schools WHERE code = 'DEFAULT' LIMIT 1;
  IF school_id_val IS NULL THEN RETURN; END IF;

  -- 山田太郎（S0001）の ID を取得
  SELECT id INTO student_id_val FROM students
  WHERE school_id = school_id_val AND student_code = 'S0001' LIMIT 1;
  IF student_id_val IS NULL THEN RETURN; END IF;

  -- 既に同じ成績が入っていればスキップ
  IF EXISTS (
    SELECT 1 FROM assessments
    WHERE student_id = student_id_val AND name_code = 'term2_final' AND exam_month = '2024-11-01'::date
  ) THEN
    RETURN;
  END IF;

  -- 成績1: 2024年10月（過去）- 数学80, 英語70 など
  INSERT INTO assessments (school_id, student_id, category, name_code, title, exam_month, exam_date, grade)
  VALUES (school_id_val, student_id_val, 'regular_test', 'term2_mid', '2学期中間', '2024-10-01'::date, '2024-10-01'::date, 7)
  RETURNING id INTO asm1_id;

  INSERT INTO assessment_scores (assessment_id, subject, value) VALUES
    (asm1_id, 'english', 70),
    (asm1_id, 'math', 80),
    (asm1_id, 'japanese', 75),
    (asm1_id, 'social', 68),
    (asm1_id, 'science', 72);

  -- 成績2: 2024年11月（最新）- 数学65（-15点）、英語72
  INSERT INTO assessments (school_id, student_id, category, name_code, title, exam_month, exam_date, grade)
  VALUES (school_id_val, student_id_val, 'regular_test', 'term2_final', '2学期期末', '2024-11-01'::date, '2024-11-01'::date, 7)
  RETURNING id INTO asm2_id;

  INSERT INTO assessment_scores (assessment_id, subject, value) VALUES
    (asm2_id, 'english', 72),
    (asm2_id, 'math', 65),
    (asm2_id, 'japanese', 78),
    (asm2_id, 'social', 70),
    (asm2_id, 'science', 74);

  -- 成績3: 成績未入力用 - 一部 null（鈴木花子 S0002）
  SELECT id INTO student_id_val FROM students
  WHERE school_id = school_id_val AND student_code = 'S0002' LIMIT 1;
  IF student_id_val IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assessments
    WHERE student_id = student_id_val AND name_code = 'term2_mid' AND exam_month = '2024-10-01'::date
  ) THEN
    INSERT INTO assessments (school_id, student_id, category, name_code, title, exam_month, exam_date, grade)
    VALUES (school_id_val, student_id_val, 'regular_test', 'term2_mid', '2学期中間', '2024-10-01'::date, '2024-10-01'::date, 8)
    RETURNING id INTO asm3_id;

    INSERT INTO assessment_scores (assessment_id, subject, value) VALUES
      (asm3_id, 'english', 85),
      (asm3_id, 'math', NULL),
      (asm3_id, 'japanese', 90),
      (asm3_id, 'social', NULL),
      (asm3_id, 'science', 88);
  END IF;
END $$;
