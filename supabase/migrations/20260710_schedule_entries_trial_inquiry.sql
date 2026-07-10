-- ============================================================
-- Phase T: 体験授業・追加授業の追加UI — 体験の見込み客を inquiry_id で参照する
-- ============================================================
-- 体験授業は未入会の見込み客（students に存在しない人）も受ける。
-- students に仮レコードを作らず（名簿・請求・集計に構造的に出さないため）、
-- schedule_entries から inquiries を直接参照できるようにする。
--
-- 挙動不変の保証:
--   既存行は全て student_id 有り・inquiry_id NULL。
--   ・DROP NOT NULL は制約を緩めるだけなので既存行に影響なし。
--   ・XOR CHECK は「student_idありつ inquiry_id NULL」を満たすので既存行は全て通る。
--   ・部分ユニークINDEX は inquiry_id IS NOT NULL の行のみ対象なので既存行は対象外。
--   よって適用しても現行の座席表・講習・テスト対策・振替・週次生成は一切変わらない。
--
-- ロールバックSQL（順序に注意：INDEX/CONSTRAINT を先に落としてから列・NOT NULL を戻す）:
--   DROP INDEX IF EXISTS schedule_entries_inquiry_slot_uniq;
--   DROP INDEX IF EXISTS idx_schedule_entries_inquiry;
--   ALTER TABLE schedule_entries DROP CONSTRAINT IF EXISTS schedule_entries_student_xor_inquiry;
--   ALTER TABLE schedule_entries DROP COLUMN IF EXISTS inquiry_id;
--   -- inquiry 由来の student_id=NULL 行が無いことを確認してから NOT NULL を戻すこと:
--   --   SELECT count(*) FROM schedule_entries WHERE student_id IS NULL;  -- 0 であること
--   ALTER TABLE schedule_entries ALTER COLUMN student_id SET NOT NULL;
-- ============================================================

BEGIN;

-- 1. 体験の見込み客は students を持たないため student_id を NULL 許容化する。
ALTER TABLE schedule_entries ALTER COLUMN student_id DROP NOT NULL;

-- 2. 問合せ（見込み客）への参照。問合せ削除時はコマ側を NULL に落とす（コマ自体は履歴として残す）。
ALTER TABLE schedule_entries
  ADD COLUMN inquiry_id uuid REFERENCES inquiries(id) ON DELETE SET NULL;

-- 3. student_id / inquiry_id はどちらか一方のみ（両方 NULL も両方セットも不可）。
--    既存行は全て「student_id あり・inquiry_id NULL」なので全て通る。
ALTER TABLE schedule_entries
  ADD CONSTRAINT schedule_entries_student_xor_inquiry
  CHECK (
    (student_id IS NOT NULL AND inquiry_id IS NULL)
    OR (student_id IS NULL AND inquiry_id IS NOT NULL)
  );

-- 4. student_id を NULL 許容化したことで既存の
--    UNIQUE (school_id, entry_date, time_slot_id, teacher_id, student_id) が
--    inquiry 行（student_id NULL）に効かなくなる（NULL は UNIQUE で重複扱いされない）。
--    同じ見込み客を同一枠に二重登録できてしまう穴を、部分ユニークINDEXで塞ぐ。
CREATE UNIQUE INDEX schedule_entries_inquiry_slot_uniq
  ON schedule_entries (school_id, entry_date, time_slot_id, teacher_id, inquiry_id)
  WHERE inquiry_id IS NOT NULL;

-- 5. inquiry_id での逆引き（問合せ詳細から体験コマを辿る／削除連動）を高速化。
CREATE INDEX idx_schedule_entries_inquiry ON schedule_entries (inquiry_id);

COMMIT;
