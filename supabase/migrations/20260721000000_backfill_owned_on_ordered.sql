-- ============================================================
-- 所持教材の判定基準を「配布時点」→「発注時点」に変更したことに伴うバックフィル
--
-- 背景:
--   これまで student_textbooks.is_owned は material_orders.status が
--   'distributed'（配布済み）になったタイミングでのみ true になっていた。
--   これをアプリ側の updateOrderStatus で 'ordered'/'delivered'/'distributed'
--   いずれかへの遷移時に true にするよう変更した（発注した時点で入手予定が
--   確定するとみなす）。
--
--   このマイグレーションは、変更前に発注済み・発送済み（まだ配布はされて
--   いない = is_owned が立っていない）の既存注文について、対応する
--   student_textbooks 行の is_owned を true に揃えるためのバックフィル。
--   'distributed' の分はアプリ側の従来ロジックで既に is_owned=true のはず
--   だが、対象を絞らず ordered/delivered/distributed すべてを含めても
--   結果は同じ（is_owned=true への更新は冪等）なので範囲は広めに取っている。
--
-- 対象外:
--   - 'cancelled' の注文（キャンセル済みは所持の根拠にしない）
--   - 対応する student_textbooks 行が存在しないケース（textbooks.material_id
--     の未紐付けなど、名前解決に失敗して行自体が作られていない場合）。
--     これはアプリ側の markMaterialOwned でも同様に静かにスキップされる
--     制約であり、このバックフィルでも同じ扱いとする（新規に行を作らない）。
--
-- 冪等性:
--   is_owned = false の行だけを対象にした UPDATE なので、再実行しても
--   追加の副作用はない。
-- ============================================================

BEGIN;

UPDATE student_textbooks st
SET is_owned = true,
    updated_at = now()
FROM material_orders mo
JOIN textbooks t ON t.material_id = mo.material_id
WHERE mo.status IN ('ordered', 'delivered', 'distributed')
  AND mo.student_id = st.student_id
  AND t.id = st.textbook_id
  AND st.is_owned = false;

COMMIT;
