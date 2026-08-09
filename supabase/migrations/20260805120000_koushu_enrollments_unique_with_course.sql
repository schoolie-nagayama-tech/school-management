-- 講習申込Web化 Q2: 複数コース参加のための unique 張り替え（仕様書 決定39）
--
-- ★ 何のため:
--   小集団・プログラミングは1人が複数コースに参加できる（決定39）。
--   現行の UNIQUE (school_id, season, student_id, formation) だと、同じ形態の
--   2つ目のコース行が入らない。course_id を unique に含める必要がある。
--
-- ★ なぜ NULLS NOT DISTINCT か:
--   単純に course_id を足すと、Postgres の既定では NULL 同士が「別物」扱いになり
--   course_id IS NULL の個別申込が同じ生徒で何行でも作れてしまう（＝個別の
--   「1生徒1行」不変条件が壊れる）。
--   部分ユニークインデックス2本に分ける案は、PostgREST の upsert が
--   部分インデックスを推論できない（ON CONFLICT に WHERE 述語を渡せない）ため不可。
--   Postgres 15+ の NULLS NOT DISTINCT なら NULL 同士も衝突扱いになり、
--   1本の通常 unique で「個別=1行 / コースは course_id ごとに1行」を両立できる。
--   本番は PostgreSQL 17 なので利用可能。
--
-- ★ コードとの対: src/lib/api/seasonalCourses.ts の upsertKoushuEnrollment が
--   onConflict にこの列並びを渡す。**DDLとコードは必ず同時に反映すること**。
--   （片方だけだと「no unique or exclusion constraint matching」で保存が落ちる）
--
-- 本番0行のためデータ移行は不要。

alter table public.koushu_enrollments
  drop constraint if exists koushu_enrollments_school_season_student_formation_key;

alter table public.koushu_enrollments
  add constraint koushu_enrollments_school_season_student_formation_course_key
  unique nulls not distinct (school_id, season, student_id, formation, course_id);
