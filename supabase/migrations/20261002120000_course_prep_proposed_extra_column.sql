-- 冬期2026の講習進捗で「予想増コマ」が0のまま出ない不具合のデータ修正（2026-10-02）
--
-- ★原因: 冬期の進捗項目は既定テンプレ「標準進捗管理項目」から作られたが、そのテンプレの
--   「提示増コマ回数」列に auto_source が付いておらず、手入力の列になっていた。
--   誰も手で入れていないので提案合計が0になり、予想増コマ（提案合計×想定取得率）も0になる。
--   夏期は教室ごとに作った列（提案増コマ）が proposed_extra（提案コマ計−通常回数）だったので出ていた。
--   各科目の提示コマ列（subject_proposal）は自動になっているので、提案書のデータ自体は来ている。
-- ★増コマ回数決定（実績）は手入力のまま。夏期も「増コマ回数」は手入力で運用していた。
-- ★適用前に、冬期2026の「提示増コマ回数」に手入力の値が1件も無いことを確認済み
--   （自動に切り替えても消える入力が無い）。
-- ★本番には apply_migration で適用済み。空のDBでは対象行が無く何もしない。

-- 1) 冬期2026の各教室の列を自動に切り替える
update public.course_prep_progress_items
set auto_source = 'proposed_extra', updated_at = now()
where year = 2026
  and season = 'winter'
  and name = '提示増コマ回数'
  and column_type = 'number'
  and auto_source is null;

-- 2) 次の期でまた手入力の列が作られないよう、既定テンプレも直す
update public.course_prep_templates t
set template_data = (
      select jsonb_agg(
               case
                 when x.e ->> 'name' = '提示増コマ回数' and x.e ->> 'auto_source' is null
                   then jsonb_set(x.e, '{auto_source}', '"proposed_extra"')
                 else x.e
               end
               order by x.ord)
      from jsonb_array_elements(t.template_data) with ordinality as x(e, ord)
    ),
    updated_at = now()
where t.template_type = 'progress'
  and t.is_default
  and t.template_data @> '[{"name": "提示増コマ回数"}]';
