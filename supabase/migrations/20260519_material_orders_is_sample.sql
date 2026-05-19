-- 見本教材の発注を生徒なしで行えるようにする
-- is_sample = true のとき student_id は NULL 許容

-- 1. is_sample カラムを追加
ALTER TABLE material_orders
  ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

-- 2. student_id を nullable に変更
ALTER TABLE material_orders
  ALTER COLUMN student_id DROP NOT NULL;

-- 3. CHECK 制約: is_sample=false なら student_id 必須
ALTER TABLE material_orders
  ADD CONSTRAINT chk_sample_or_student
  CHECK (is_sample = true OR student_id IS NOT NULL);
