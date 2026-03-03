-- portal_menu.school_id の外部キーを ON DELETE CASCADE に変更
-- 教室削除時にポータルメニューも連鎖削除されるようにする

ALTER TABLE portal_menu
  DROP CONSTRAINT IF EXISTS portal_menu_school_id_fkey;

ALTER TABLE portal_menu
  ADD CONSTRAINT portal_menu_school_id_fkey
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE;
