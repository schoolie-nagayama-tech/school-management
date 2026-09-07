-- 停止済み通塾パターンの effective_until を埋め戻す。
--
-- 背景: deleteRegularPattern が is_active=false にするだけで effective_until を入れておらず、
--       「いつまで通っていたか」が失われていた。講習の通常回数（course_sessions）は
--       is_active だけで数えていたため、通塾パターンをいじるたびに過去の期の数字が
--       両方向に狂っていた（期の後に停止 → 通常回数↓ → 増コマ水増し／
--       期の後に新設 → 通常回数↑ → 増コマ過少）。
--
-- 対応: 通常回数を「その期に有効だったか」で数えるように変えた。ただし既存の停止済み行は
--       effective_until が空のままだと「今も有効」と解釈されて逆に数が増えるので、
--       停止操作の日として updated_at を1回だけ入れる。
--       厳密な最終通塾日ではない近似だが、NULL のまま放置するより正しい。
--
-- 対象は「停止済み(is_active=false)かつ effective_until が空」の行のみ。
-- 有効な行と、既に期間で締められている行（変更経路が入れたもの）には触らない。
--
-- 確定済みスナップショットは集計の入力ごと保存しているため、この更新では動かない。
--
-- 正典: docs/koushu-progress-snapshot-plan.md

UPDATE public.schedule_regular_patterns
SET effective_until = (updated_at AT TIME ZONE 'Asia/Tokyo')::date
WHERE is_active = false
  AND effective_until IS NULL;
