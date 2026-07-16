-- 研修用テスト生徒フラグ。
-- is_test=true の生徒は「研修（講師の練習）用」。アラート・講習進捗・各種業務集計から除外し、
-- 生徒名簿でのみ表示する（担当講師が研修時に開いて進行表入力などを練習できるようにするため）。
-- 実在教室に置いても業務数値に混ざらないよう、集計クエリは既定で is_test を除外する。
ALTER TABLE students ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN students.is_test IS '研修用テスト生徒。業務集計から除外し名簿のみ表示する。';
