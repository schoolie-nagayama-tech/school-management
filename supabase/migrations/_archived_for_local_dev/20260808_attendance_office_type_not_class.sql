-- 「事務」は授業ではないので is_class_type = false にする。
--
-- 出勤簿の「準備給日数」は is_class_type = true の記録がある日数で数えている
-- （src/lib/api/attendance.ts の prep_days）。事務が true のままだと事務だけの日も
-- 準備給日数に入り、「勤務日数」と必ず同じ値になっていた。
--
-- 本番へは MCP の apply_migration で適用済み（2026-08-08）。このファイルは記録用。
update attendance_types set is_class_type = false where name = '事務';
