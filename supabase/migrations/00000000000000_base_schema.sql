-- ============================================================
-- BASE SCHEMA (本番DBからdump - ローカル開発/テスト用)
-- ============================================================
-- supabase db dump --linked --schema public で生成。
-- 本番環境には push しないこと（本番に既に適用済み）。
-- 再生成: npm run db:dump
-- ============================================================




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."check_school_access"("school_id_param" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- セキュリティ定義関数内ではRLSをバイパスして直接取得
  SELECT role INTO user_role
  FROM user_profiles
  WHERE id = auth.uid();
  
  -- admin, owner, managerは全アクセス可
  IF user_role IN ('admin', 'owner', 'manager') THEN
    RETURN TRUE;
  END IF;
  
  -- それ以外は自分の教室のみ
  RETURN EXISTS (
    SELECT 1 FROM user_schools us
    WHERE us.user_id = auth.uid()
    AND us.school_id = school_id_param
  );
END;
$$;


ALTER FUNCTION "public"."check_school_access"("school_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_student_access"("student_school_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role
  FROM user_profiles
  WHERE id = auth.uid();

  IF user_role IN ('admin', 'owner', 'manager') THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM user_schools us
    WHERE us.user_id = auth.uid()
    AND us.school_id = student_school_id
  );
END;
$$;


ALTER FUNCTION "public"."check_student_access"("student_school_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_user_role"("required_roles" "text"[]) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- auth.uid()のロールを直接取得（RLSをバイパス）
  SELECT role INTO user_role
  FROM user_profiles
  WHERE id = auth.uid();
  
  -- ロールが要求されたロールのいずれかと一致するかチェック
  RETURN user_role = ANY(required_roles);
END;
$$;


ALTER FUNCTION "public"."check_user_role"("required_roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  user_count INT;
BEGIN
  -- 既存ユーザー数を確認
  SELECT COUNT(*) INTO user_count FROM public.user_profiles;
  
  -- 最初のユーザーはadmin、それ以外はteacher
  INSERT INTO public.user_profiles (id, email, role, is_active, created_at, updated_at)
  VALUES (
    new.id, 
    new.email,
    CASE WHEN user_count = 0 THEN 'admin' ELSE 'teacher' END,
    true,
    now(),
    now()
  );
  
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reassign_slot_numbers"("p_school_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  SET CONSTRAINTS schedule_time_slots_school_id_slot_number_key DEFERRED;

  UPDATE public.schedule_time_slots t
  SET slot_number = sub.rn::integer,
      updated_at = now()
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY start_time ASC) AS rn
    FROM public.schedule_time_slots
    WHERE school_id = p_school_id
  ) sub
  WHERE t.id = sub.id
    AND t.slot_number IS DISTINCT FROM sub.rn::integer;

  SET CONSTRAINTS schedule_time_slots_school_id_slot_number_key IMMEDIATE;
END;
$$;


ALTER FUNCTION "public"."reassign_slot_numbers"("p_school_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_time_slots"("p_school_id" "uuid", "p_ordered_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  SET CONSTRAINTS schedule_time_slots_school_id_slot_number_key DEFERRED;

  UPDATE public.schedule_time_slots t
  SET slot_number = sub.new_number::integer,
      updated_at = now()
  FROM (
    SELECT id, ordinality AS new_number
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, ordinality)
  ) sub
  WHERE t.id = sub.id
    AND t.school_id = p_school_id
    AND t.slot_number IS DISTINCT FROM sub.new_number::integer;

  SET CONSTRAINTS schedule_time_slots_school_id_slot_number_key IMMEDIATE;
END;
$$;


ALTER FUNCTION "public"."reorder_time_slots"("p_school_id" "uuid", "p_ordered_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at_teacher_availability_periods"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at_teacher_availability_periods"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_attendance_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_attendance_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_google_calendar_tokens_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_google_calendar_tokens_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_schools_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_schools_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."action_goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_textbook_exam_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "counter_target" integer,
    "counter_current" integer DEFAULT 0,
    "achieved" boolean DEFAULT false,
    "achieved_at" timestamp with time zone,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."action_goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "actor_role" "text" NOT NULL,
    "action" "text" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "text",
    "detail" "jsonb" DEFAULT '{}'::"jsonb",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alert_dismissals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "alert_type" "text" NOT NULL,
    "alert_key" "text" NOT NULL,
    "dismissed_by" "uuid",
    "dismissed_at" timestamp with time zone DEFAULT "now"(),
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."alert_dismissals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."alert_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "alert_type" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "thresholds" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."alert_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."application_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_hidden" boolean DEFAULT false,
    "ended_at" timestamp with time zone,
    "column_type" "text" DEFAULT 'check'::"text",
    "due_date" "date",
    "teacher_editable" boolean DEFAULT false NOT NULL,
    "manager_only" boolean DEFAULT false NOT NULL,
    CONSTRAINT "application_items_column_type_check" CHECK (("column_type" = ANY (ARRAY['check'::"text", 'number'::"text", 'date'::"text"])))
);


ALTER TABLE "public"."application_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."application_items"."manager_only" IS 'true: 室長権限以上のみ表示（講師には非表示）';



CREATE TABLE IF NOT EXISTS "public"."assessment_scores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "assessment_id" "uuid" NOT NULL,
    "subject" "text" NOT NULL,
    "value" numeric,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."assessment_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assessment_subjects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "short_name" "text",
    "school_type" "text" NOT NULL,
    "applicable_grades" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "category" "text" NOT NULL,
    "is_required" boolean DEFAULT false NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "assessment_subjects_school_type_check" CHECK (("school_type" = ANY (ARRAY['小学'::"text", '中学'::"text", '高校'::"text", '共通'::"text"])))
);


ALTER TABLE "public"."assessment_subjects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assessments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "title" "text" NOT NULL,
    "exam_date" "date",
    "grade" integer NOT NULL,
    "term" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "exam_month" "date",
    "name_code" "text" NOT NULL,
    CONSTRAINT "assessments_category_check" CHECK (("category" = ANY (ARRAY['regular_test'::"text", 'report_card'::"text", 'mock'::"text"]))),
    CONSTRAINT "assessments_grade_check" CHECK ((("grade" >= 1) AND ("grade" <= 13))),
    CONSTRAINT "assessments_name_code_check" CHECK (((("category" = 'regular_test'::"text") AND ("name_code" = ANY (ARRAY['term1_mid'::"text", 'term1_final'::"text", 'term2_mid'::"text", 'term2_final'::"text", 'year_end'::"text", 'first_mid'::"text", 'first_final'::"text", 'second_mid'::"text", 'second_final'::"text", 'legacy'::"text"]))) OR (("category" = 'report_card'::"text") AND ("name_code" = ANY (ARRAY['term1'::"text", 'term2'::"text", 'year_end'::"text", 'first'::"text", 'second'::"text", 'legacy'::"text"]))) OR (("category" = 'mock'::"text") AND ("name_code" = ANY (ARRAY['venue'::"text", 'classroom'::"text", 'legacy'::"text"])))))
);


ALTER TABLE "public"."assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sheet_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "late_early" character varying(50),
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."attendance_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sheet_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "attendance_type_id" "uuid" NOT NULL,
    "value" numeric(5,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."attendance_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_sheets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "year_month" character varying(7) NOT NULL,
    "status" character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    "submitted_at" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    "rejection_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "transport_cost" integer DEFAULT 0 NOT NULL,
    "admin_note" "text",
    "is_koma_changing" boolean DEFAULT false NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "submitted_to" "uuid",
    "koma_change_from" integer,
    "koma_change_to" integer,
    CONSTRAINT "attendance_sheets_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'submitted'::character varying, 'reviewed'::character varying, 'approved'::character varying, 'rejected'::character varying])::"text"[])))
);


ALTER TABLE "public"."attendance_sheets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" character varying(50) NOT NULL,
    "unit" character varying(10) DEFAULT 'count'::character varying NOT NULL,
    "unit_price" integer DEFAULT 0 NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_class_type" boolean DEFAULT true NOT NULL,
    CONSTRAINT "attendance_types_unit_check" CHECK ((("unit")::"text" = ANY ((ARRAY['count'::character varying, 'hours'::character varying])::"text"[])))
);


ALTER TABLE "public"."attendance_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "billing_period_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "source_type" "text" DEFAULT 'free'::"text" NOT NULL,
    "source_form_response_id" "uuid",
    "source_order_id" "uuid",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "value_type" "text" DEFAULT 'check'::"text" NOT NULL,
    "linked_form_type" "text",
    CONSTRAINT "billing_items_source_type_check" CHECK (("source_type" = ANY (ARRAY['free'::"text", 'form_charged'::"text", 'order'::"text"]))),
    CONSTRAINT "billing_items_value_type_check" CHECK (("value_type" = ANY (ARRAY['check'::"text", 'number'::"text", 'text'::"text"])))
);


ALTER TABLE "public"."billing_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."billing_items"."value_type" IS 'セルの値の型: check=✓/空, number=数値, text=文字列';



COMMENT ON COLUMN "public"."billing_items"."linked_form_type" IS 'フォーム連携: moshi, mogi, zoukoma等。NULLなら手動項目';



CREATE TABLE IF NOT EXISTS "public"."billing_periods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."billing_periods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bulletin_labels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#ff8e3c'::"text" NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."bulletin_labels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bulletin_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "label_id" "uuid",
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "is_pinned" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "archived_at" timestamp with time zone,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "link_url" "text"
);


ALTER TABLE "public"."bulletin_posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bulletin_reads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "read_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."bulletin_reads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."class_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "schedule_entry_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "lesson_date" "date" NOT NULL,
    "short_term_goal" "text",
    "mid_term_goal_snapshot" "text",
    "mid_action_goal_snapshot" "text",
    "school_progress" "text",
    "homework_completion_pct" integer,
    "homework_correct_pct" integer,
    "today_correct_pct" integer,
    "vocab_test_score" integer,
    "vocab_test_total" integer,
    "vocab_test_passed" boolean,
    "check_test_score" integer,
    "check_test_total" integer,
    "check_test_passed" boolean,
    "review_comment" "text",
    "homework_assignments" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "subject_specific" "jsonb",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "submitted_at" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    "rejected_at" timestamp with time zone,
    "rejected_by" "uuid",
    "rejection_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "class_reports_homework_completion_pct_check" CHECK ((("homework_completion_pct" IS NULL) OR (("homework_completion_pct" >= 0) AND ("homework_completion_pct" <= 100)))),
    CONSTRAINT "class_reports_homework_correct_pct_check" CHECK ((("homework_correct_pct" IS NULL) OR (("homework_correct_pct" >= 0) AND ("homework_correct_pct" <= 100)))),
    CONSTRAINT "class_reports_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "class_reports_today_correct_pct_check" CHECK ((("today_correct_pct" IS NULL) OR (("today_correct_pct" >= 0) AND ("today_correct_pct" <= 100))))
);


ALTER TABLE "public"."class_reports" OWNER TO "postgres";


COMMENT ON TABLE "public"."class_reports" IS '授業報告書。1コマ×1生徒 = 1レコード。schedule_entry_id でスケジュールと紐付き、ワークフローで「下書き→提出→承認→公開」を管理。';



CREATE TABLE IF NOT EXISTS "public"."course_prep_periods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "season" "text" NOT NULL,
    "year" integer NOT NULL,
    "budget_koma" integer DEFAULT 0,
    "schedule_start_date" "date",
    "schedule_end_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "target_koma" integer DEFAULT 0 NOT NULL,
    "expected_rate" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "course_prep_periods_season_check" CHECK (("season" = ANY (ARRAY['spring'::"text", 'summer'::"text", 'winter'::"text"])))
);


ALTER TABLE "public"."course_prep_periods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_prep_progress_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "season" "text" NOT NULL,
    "year" integer NOT NULL,
    "name" "text" NOT NULL,
    "column_type" "text" DEFAULT 'check'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_hidden" boolean DEFAULT false,
    "manager_only" boolean DEFAULT false,
    "column_group" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deadline" "date",
    "auto_source" "text",
    CONSTRAINT "course_prep_progress_items_auto_source_check" CHECK (("auto_source" = ANY (ARRAY['regular_weekly'::"text", 'course_sessions'::"text", 'proposed_extra'::"text", 'subject_proposal'::"text", 'applied_extra'::"text"]))),
    CONSTRAINT "course_prep_progress_items_column_type_check" CHECK (("column_type" = ANY (ARRAY['check'::"text", 'number'::"text", 'date'::"text"]))),
    CONSTRAINT "course_prep_progress_items_season_check" CHECK (("season" = ANY (ARRAY['spring'::"text", 'summer'::"text", 'winter'::"text"])))
);


ALTER TABLE "public"."course_prep_progress_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_prep_schedule_markers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "marker_date" "date" NOT NULL,
    "label" "text" DEFAULT ''::"text" NOT NULL,
    "color" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."course_prep_schedule_markers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_prep_schedule_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "season" "text" NOT NULL,
    "year" integer NOT NULL,
    "major_category" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "deadline" "text",
    "start_date" "date",
    "end_date" "date",
    "is_completed" boolean DEFAULT false,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "linked_progress_item_id" "uuid",
    CONSTRAINT "course_prep_schedule_tasks_season_check" CHECK (("season" = ANY (ARRAY['spring'::"text", 'summer'::"text", 'winter'::"text"])))
);


ALTER TABLE "public"."course_prep_schedule_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_prep_student_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "status" "text",
    "number_value" numeric,
    "date_value" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "course_prep_student_progress_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'not_applicable'::"text"])))
);


ALTER TABLE "public"."course_prep_student_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_prep_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "template_type" "text" NOT NULL,
    "season" "text",
    "name" "text" NOT NULL,
    "template_data" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_default" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "course_prep_templates_season_check" CHECK (("season" = ANY (ARRAY['spring'::"text", 'summer'::"text", 'winter'::"text"]))),
    CONSTRAINT "course_prep_templates_template_type_check" CHECK (("template_type" = ANY (ARRAY['schedule'::"text", 'progress'::"text"])))
);


ALTER TABLE "public"."course_prep_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."curriculum_items" (
    "id" integer NOT NULL,
    "textbook_id" integer,
    "sort_order" integer,
    "item_number" "text",
    "title" "text",
    "item_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."curriculum_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."curriculum_items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."curriculum_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."curriculum_items_id_seq" OWNED BY "public"."curriculum_items"."id";



CREATE TABLE IF NOT EXISTS "public"."embed_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(32), 'hex'::"text") NOT NULL,
    "label" "text" DEFAULT '申込状況ウィジェット'::"text" NOT NULL,
    "embed_type" "text" DEFAULT 'applications'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."embed_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exam_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."exam_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "form_id" "uuid" NOT NULL,
    "field_type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "placeholder" "text",
    "options" "jsonb",
    "is_required" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "form_fields_field_type_check" CHECK (("field_type" = ANY (ARRAY['text'::"text", 'textarea'::"text", 'select'::"text", 'radio'::"text", 'checkbox'::"text", 'date'::"text", 'number'::"text"])))
);


ALTER TABLE "public"."form_fields" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_periods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "form_type" "text" NOT NULL,
    "period_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "publish_start" timestamp with time zone,
    "publish_end" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "linked_application_item_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_archived" boolean DEFAULT false,
    "archived_at" timestamp with time zone,
    CONSTRAINT "form_periods_form_type_check" CHECK (("form_type" = ANY (ARRAY['zoukoma'::"text", 'moshi'::"text", 'mogi'::"text", 'shukaisu'::"text", 'youbi'::"text", 'kyozai'::"text", 'soudan'::"text"])))
);


ALTER TABLE "public"."form_periods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "form_type" "text" NOT NULL,
    "form_period" "text" NOT NULL,
    "student_name" "text" NOT NULL,
    "grade" integer NOT NULL,
    "email" "text" NOT NULL,
    "response_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "linked_student_id" "uuid",
    "linked_at" timestamp with time zone,
    "status_checks" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_archived" boolean DEFAULT false,
    "archived_at" timestamp with time zone,
    "notification_sent_at" timestamp with time zone,
    "form_id" "uuid",
    CONSTRAINT "form_responses_form_type_check" CHECK (("form_type" = ANY (ARRAY['zoukoma'::"text", 'moshi'::"text", 'mogi'::"text", 'shukaisu'::"text", 'youbi'::"text", 'kyozai'::"text", 'soudan'::"text"]))),
    CONSTRAINT "form_responses_grade_check" CHECK ((("grade" >= 1) AND ("grade" <= 13)))
);


ALTER TABLE "public"."form_responses" OWNER TO "postgres";


COMMENT ON COLUMN "public"."form_responses"."notification_sent_at" IS '申込確認メール送信済み日時（二重送信防止）';



CREATE TABLE IF NOT EXISTS "public"."form_template_fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "field_type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "placeholder" "text",
    "options" "jsonb",
    "is_required" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "form_template_fields_field_type_check" CHECK (("field_type" = ANY (ARRAY['text'::"text", 'textarea'::"text", 'select'::"text", 'radio'::"text", 'checkbox'::"text", 'date'::"text", 'number'::"text"])))
);


ALTER TABLE "public"."form_template_fields" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."form_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."forms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "template_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "slug" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "publish_start" timestamp with time zone,
    "publish_end" timestamp with time zone,
    "completion_message" "text",
    "linked_application_item_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_archived" boolean DEFAULT false NOT NULL,
    "archived_at" timestamp with time zone,
    CONSTRAINT "forms_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."forms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."google_calendar_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "access_token" "text" NOT NULL,
    "refresh_token" "text" NOT NULL,
    "token_expiry" timestamp with time zone NOT NULL,
    "calendar_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."google_calendar_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inquiries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "hp_inquiry_no" "text",
    "inquired_at" timestamp with time zone NOT NULL,
    "student_name" "text",
    "student_name_kana" "text",
    "guardian_name" "text",
    "guardian_name_kana" "text",
    "relationship" "text",
    "grade" "text",
    "gender" "text",
    "phone" "text",
    "email" "text",
    "postal_code" "text",
    "address_pref" "text",
    "address_detail" "text",
    "address_building" "text",
    "school_name" "text",
    "media" "text",
    "channel" "text",
    "request_type" "text",
    "device" "text",
    "initial_message" "text",
    "purpose" "text",
    "preferred_subjects" "text",
    "juku_experience" "text",
    "status" "text" DEFAULT 'in_progress'::"text" NOT NULL,
    "material_sent_at" "date",
    "trial_at" timestamp with time zone,
    "trial_teacher" "text",
    "interview_at" timestamp with time zone,
    "enrolled_at" "date",
    "weekly_count" integer,
    "linked_student_id" "uuid",
    "referrer_inquiry_note" "text",
    "raw_source" "jsonb",
    "note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "lost_reason" "text",
    "interview_event_id" "text",
    "trial_event_id" "text",
    CONSTRAINT "inquiries_status_check" CHECK (("status" = ANY (ARRAY['in_progress'::"text", 'enrolled'::"text", 'unreachable'::"text", 'lost'::"text", 'trial_lost'::"text"])))
);


ALTER TABLE "public"."inquiries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inquiry_booking_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" NOT NULL,
    "inquiry_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "purpose" "text" DEFAULT 'interview'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inquiry_booking_tokens_purpose_check" CHECK (("purpose" = ANY (ARRAY['interview'::"text", 'trial'::"text"])))
);


ALTER TABLE "public"."inquiry_booking_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inquiry_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inquiry_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "contacted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "method" "text" DEFAULT 'tel'::"text" NOT NULL,
    "direction" "text",
    "result" "text",
    "note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "inquiry_contacts_direction_check" CHECK (("direction" = ANY (ARRAY['outbound'::"text", 'inbound'::"text"]))),
    CONSTRAINT "inquiry_contacts_method_check" CHECK (("method" = ANY (ARRAY['tel'::"text", 'email'::"text", 'sms'::"text", 'visit'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."inquiry_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inquiry_import_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" NOT NULL,
    "label" "text",
    "created_by" "uuid",
    "revoked" boolean DEFAULT false NOT NULL,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."inquiry_import_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inquiry_mail_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inquiry_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "template_id" "uuid",
    "method" "text" DEFAULT 'email'::"text" NOT NULL,
    "subject" "text",
    "status" "text" DEFAULT 'sent'::"text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resend_email_id" "text",
    "opened_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    CONSTRAINT "inquiry_mail_logs_method_check" CHECK (("method" = ANY (ARRAY['email'::"text", 'sms'::"text"]))),
    CONSTRAINT "inquiry_mail_logs_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."inquiry_mail_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inquiry_mail_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "name" "text" NOT NULL,
    "subject" "text" DEFAULT ''::"text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "trigger_days" integer,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."inquiry_mail_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inquiry_school_settings" (
    "school_id" "uuid" NOT NULL,
    "hp_school_code" "text",
    "mail_signature" "text",
    "mail_reply_to" "text",
    "yamato_customer_code" "text",
    "yamato_fare_code" "text" DEFAULT '01'::"text",
    "sender_tel" "text",
    "sender_zip" "text",
    "sender_address" "text",
    "sender_name" "text",
    "slack_mention_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "booking_config" "jsonb"
);


ALTER TABLE "public"."inquiry_school_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."koushu_enrollments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid",
    "student_id" "uuid" NOT NULL,
    "koma_count" integer DEFAULT 0 NOT NULL,
    "subject_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "formation" "text" DEFAULT 'individual'::"text" NOT NULL,
    "koma_by_subject" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "school_id" "uuid",
    "season" "text",
    CONSTRAINT "koushu_enrollments_formation_check" CHECK (("formation" = ANY (ARRAY['individual'::"text", 'group'::"text"])))
);


ALTER TABLE "public"."koushu_enrollments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lesson_report_units" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "uuid" NOT NULL,
    "student_textbook_id" "uuid" NOT NULL,
    "is_main" boolean DEFAULT false NOT NULL,
    "curriculum_item_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "page_start" integer,
    "page_end" integer,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."lesson_report_units" OWNER TO "postgres";


COMMENT ON TABLE "public"."lesson_report_units" IS '授業報告書の「単元×教材セット」。1報告書につきメイン1 + サブN を持つ。保存時に進行表 (student_progress_lessons) へ転記される。';



COMMENT ON COLUMN "public"."lesson_report_units"."curriculum_item_ids" IS '今回の授業で扱った単元IDの配列（curriculum_items.id）。複数単元を1セットで扱える。';



CREATE TABLE IF NOT EXISTS "public"."material_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "student_id" "uuid",
    "quantity" integer DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'unconfirmed'::"text" NOT NULL,
    "ordered_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "distributed_at" timestamp with time zone,
    "notes" "text",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_sample" boolean DEFAULT false NOT NULL,
    CONSTRAINT "chk_sample_or_student" CHECK ((("is_sample" = true) OR ("student_id" IS NOT NULL))),
    CONSTRAINT "material_orders_status_check" CHECK (("status" = ANY (ARRAY['unconfirmed'::"text", 'pending'::"text", 'ordered'::"text", 'delivered'::"text", 'distributed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."material_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."material_stock_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "transaction_type" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "reason" "text",
    "related_order_id" "uuid",
    "related_student_id" "uuid",
    "performed_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "material_stock_transactions_transaction_type_check" CHECK (("transaction_type" = ANY (ARRAY['in'::"text", 'out'::"text", 'adjust'::"text"])))
);


ALTER TABLE "public"."material_stock_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."materials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text",
    "unit" "text" DEFAULT '冊'::"text" NOT NULL,
    "stock_quantity" integer DEFAULT 0 NOT NULL,
    "low_stock_threshold" integer DEFAULT 5 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."materials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_task_checks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "is_completed" boolean DEFAULT false NOT NULL,
    "completed_at" timestamp with time zone,
    "completed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."monthly_task_checks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_task_overrides" (
    "task_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "task_name" "text",
    "task_date" "date",
    "category" "text",
    "note" "text",
    "url" "text",
    "is_hidden" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."monthly_task_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_task_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "template_data" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_default" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."monthly_task_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."monthly_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "year" integer NOT NULL,
    "month" integer NOT NULL,
    "task_date" "date" NOT NULL,
    "category" "text" NOT NULL,
    "task_name" "text" NOT NULL,
    "note" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "linked_schedule_task_id" "uuid",
    "template_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "url" "text",
    "google_event_id" "text",
    CONSTRAINT "monthly_tasks_category_check" CHECK (("category" = ANY (ARRAY['business'::"text", 'course'::"text"]))),
    CONSTRAINT "monthly_tasks_month_check" CHECK ((("month" >= 1) AND ("month" <= 12)))
);


ALTER TABLE "public"."monthly_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notta_transcripts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "title" "text",
    "recorded_at" timestamp with time zone,
    "duration_seconds" integer,
    "transcript" "text" NOT NULL,
    "audio_url" "text",
    "speakers" "jsonb",
    "raw_payload" "jsonb",
    "external_id" "text",
    "linked_student_id" "uuid",
    "linked_interview_id" "uuid",
    "linked_at" timestamp with time zone,
    "is_archived" boolean DEFAULT false,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notta_transcripts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."portal_menu" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "menu_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "is_visible" boolean DEFAULT true NOT NULL,
    "link_url" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "link_type" "text" DEFAULT 'external'::"text" NOT NULL,
    "link_urls" "jsonb",
    CONSTRAINT "portal_menu_link_type_check" CHECK (("link_type" = ANY (ARRAY['internal'::"text", 'external'::"text"])))
);


ALTER TABLE "public"."portal_menu" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."progress_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_textbook_id" "uuid" NOT NULL,
    "session_date" "date" NOT NULL,
    "teacher_id" "uuid",
    "teacher_name" "text",
    "handover" "text",
    "homework_not_done" boolean DEFAULT false NOT NULL,
    "tardy" boolean DEFAULT false NOT NULL,
    "schedule_entry_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "confirmed_at" timestamp with time zone,
    "confirmed_by" "uuid",
    "report_id" "uuid"
);


ALTER TABLE "public"."progress_sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."progress_sessions"."report_id" IS '対応する授業報告書 ID。報告書を保存すると自動で紐付けされる（NULL = 報告書未作成）。';



CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."regular_shift_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "deadline" "date",
    "description" "text" DEFAULT ''::"text",
    "weekday_slots" "text" DEFAULT ''::"text" NOT NULL,
    "saturday_slots" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "effective_from" "date",
    "effective_until" "date",
    CONSTRAINT "regular_shift_settings_effective_range_check" CHECK ((("effective_until" IS NULL) OR ("effective_from" IS NULL) OR ("effective_until" >= "effective_from"))),
    CONSTRAINT "regular_shift_settings_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."regular_shift_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."regular_shift_settings"."effective_from" IS '通常シフト募集の有効開始日。NULL は「常に有効（過去互換）」として扱う。';



COMMENT ON COLUMN "public"."regular_shift_settings"."effective_until" IS '通常シフト募集の有効終了日。NULL は「無期限」として扱う。';



CREATE TABLE IF NOT EXISTS "public"."regular_shift_slot_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "setting_id" "uuid" NOT NULL,
    "day_of_week" integer NOT NULL,
    "time_slot" "text" NOT NULL,
    "is_open" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "regular_shift_slot_settings_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6)))
);


ALTER TABLE "public"."regular_shift_slot_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."regular_shift_submission_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "day_of_week" integer NOT NULL,
    "time_slot" "text" NOT NULL,
    "available" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "regular_shift_submission_slots_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6)))
);


ALTER TABLE "public"."regular_shift_submission_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."regular_shift_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "setting_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "teacher_name" "text" NOT NULL,
    "teacher_email" "text" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text" DEFAULT ''::"text",
    "allow_edit" boolean DEFAULT false NOT NULL,
    "edit_token" "uuid" DEFAULT "gen_random_uuid"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "seat_chart_entered" boolean DEFAULT false NOT NULL,
    "user_id" "uuid"
);


ALTER TABLE "public"."regular_shift_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedule_change_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "action_type" "text" NOT NULL,
    "pattern_id" "uuid",
    "entry_id" "uuid",
    "student_id" "uuid",
    "before_teacher_id" "uuid",
    "after_teacher_id" "uuid",
    "description" "text",
    "affected_date" "date",
    "affected_slot_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."schedule_change_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."schedule_change_logs" IS '担当変更履歴ログ。割当・変更・振替・削除を時系列で記録し、監査・問合せ対応に使う。';



CREATE TABLE IF NOT EXISTS "public"."schedule_closed_days" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "closed_date" "date" NOT NULL,
    "reason" "text",
    "is_global" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."schedule_closed_days" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedule_daily_booth_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "assignment_date" "date" NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "booth_no" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "schedule_daily_booth_assignments_booth_no_check" CHECK ((("booth_no" >= 1) AND ("booth_no" <= 100)))
);


ALTER TABLE "public"."schedule_daily_booth_assignments" OWNER TO "postgres";


COMMENT ON TABLE "public"."schedule_daily_booth_assignments" IS '日次の講師ブース番号割当。座席表印刷時に講師名の隣に表示される番号を管理。';



COMMENT ON COLUMN "public"."schedule_daily_booth_assignments"."booth_no" IS 'ブース番号（1始まり）。同日内で同じ番号は1講師しか取れない。';



CREATE TABLE IF NOT EXISTS "public"."schedule_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "entry_date" "date" NOT NULL,
    "time_slot_id" "uuid" NOT NULL,
    "teacher_id" "uuid",
    "student_id" "uuid" NOT NULL,
    "subject_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "seat_label" "text",
    "regular_pattern_id" "uuid",
    "attendance_status" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "attendance_recorded_at" timestamp with time zone,
    "attendance_recorded_by" "uuid",
    "note" "text",
    "transfer_from_id" "uuid",
    "transfer_to_id" "uuid",
    "kind" "text" DEFAULT 'regular'::"text" NOT NULL,
    "formation" "text" DEFAULT 'individual'::"text" NOT NULL,
    "transfer_deadline" "date",
    CONSTRAINT "schedule_entries_attendance_status_check" CHECK ((("attendance_status" IS NULL) OR ("attendance_status" = ANY (ARRAY['present'::"text", 'absent'::"text", 'late'::"text"])))),
    CONSTRAINT "schedule_entries_formation_check" CHECK (("formation" = ANY (ARRAY['individual'::"text", 'group'::"text"]))),
    CONSTRAINT "schedule_entries_kind_check" CHECK (("kind" = ANY (ARRAY['regular'::"text", 'koushu'::"text", 'test_prep'::"text", 'additional'::"text", 'trial'::"text"]))),
    CONSTRAINT "schedule_entries_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'completed'::"text", 'cancelled'::"text", 'transferred_out'::"text", 'transferred_in'::"text"])))
);


ALTER TABLE "public"."schedule_entries" OWNER TO "postgres";


COMMENT ON COLUMN "public"."schedule_entries"."teacher_id" IS '担当講師 ID。NULL は「担当未決定」状態（生徒は登録済みだが講師がまだアサインされていない）。';



COMMENT ON COLUMN "public"."schedule_entries"."kind" IS '授業種別。regular=通常授業（通塾日程から自動生成）、koushu=講習（季節講座、通塾日程と独立）。';



COMMENT ON COLUMN "public"."schedule_entries"."formation" IS '授業形態。individual=個別指導（1講師あたり数名、座席ブース）、group=集団指導（1講師あたり多人数、教室まるごと）。';



COMMENT ON COLUMN "public"."schedule_entries"."transfer_deadline" IS '振替期限。transferred_out のエントリで使用し、元授業日の翌月末日を自動セット。transferred_in が確定すれば実質的に期限消化済みとなる。';



CREATE TABLE IF NOT EXISTS "public"."schedule_generation_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "week_start_date" "date" NOT NULL,
    "entries_created" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."schedule_generation_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedule_match_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "setting_id" "uuid",
    "executed_by" "uuid",
    "executed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mode" "text" DEFAULT 'diff'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "schedule_match_batches_mode_check" CHECK (("mode" = ANY (ARRAY['overwrite'::"text", 'diff'::"text", 'partial'::"text"])))
);


ALTER TABLE "public"."schedule_match_batches" OWNER TO "postgres";


COMMENT ON TABLE "public"."schedule_match_batches" IS 'マッチング実行1回ぶんのバッチ。1バッチ＝N件の提案。';



CREATE TABLE IF NOT EXISTS "public"."schedule_match_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "proposal_date" "date" NOT NULL,
    "time_slot_id" "uuid" NOT NULL,
    "subject_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "formation" "text" DEFAULT 'individual'::"text" NOT NULL,
    "kind" "text" DEFAULT 'koushu'::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "schedule_entry_id" "uuid",
    "published_at" timestamp with time zone,
    "published_by" "uuid",
    "match_meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "schedule_match_proposals_formation_check" CHECK (("formation" = ANY (ARRAY['individual'::"text", 'group'::"text"]))),
    CONSTRAINT "schedule_match_proposals_kind_check" CHECK (("kind" = ANY (ARRAY['regular'::"text", 'koushu'::"text"]))),
    CONSTRAINT "schedule_match_proposals_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."schedule_match_proposals" OWNER TO "postgres";


COMMENT ON TABLE "public"."schedule_match_proposals" IS 'マッチングが出した提案。draft 状態は室長のみ可視。published で schedule_entries に反映。';



CREATE TABLE IF NOT EXISTS "public"."schedule_regular_patterns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "day_of_week" smallint NOT NULL,
    "time_slot_id" "uuid" NOT NULL,
    "teacher_id" "uuid",
    "subject_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "seat_label" "text",
    "period_type" "text" DEFAULT 'regular'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "effective_from" "date" DEFAULT '2020-01-01'::"date" NOT NULL,
    "effective_until" "date",
    "formation" "text" DEFAULT 'individual'::"text" NOT NULL,
    CONSTRAINT "schedule_regular_patterns_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6))),
    CONSTRAINT "schedule_regular_patterns_effective_range_check" CHECK ((("effective_until" IS NULL) OR ("effective_until" >= "effective_from"))),
    CONSTRAINT "schedule_regular_patterns_formation_check" CHECK (("formation" = ANY (ARRAY['individual'::"text", 'group'::"text"]))),
    CONSTRAINT "schedule_regular_patterns_period_type_check" CHECK (("period_type" = ANY (ARRAY['regular'::"text", 'spring'::"text", 'summer'::"text", 'winter'::"text"])))
);


ALTER TABLE "public"."schedule_regular_patterns" OWNER TO "postgres";


COMMENT ON COLUMN "public"."schedule_regular_patterns"."effective_from" IS '通塾日程の適用開始日。この日以降のスケジュール生成・5週目計算で参照される。';



COMMENT ON COLUMN "public"."schedule_regular_patterns"."effective_until" IS '通塾日程の適用終了日（含む）。NULL の場合は無期限。退塾や曜日変更時に旧パターンへセットする。';



COMMENT ON COLUMN "public"."schedule_regular_patterns"."formation" IS '授業形態。individual=個別、group=集団。スケジュール自動生成時に schedule_entries.formation へ引き継がれる。';



CREATE TABLE IF NOT EXISTS "public"."schedule_time_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "slot_number" integer NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "formation" "text" DEFAULT 'individual'::"text" NOT NULL,
    CONSTRAINT "schedule_time_slots_formation_check" CHECK (("formation" = ANY (ARRAY['individual'::"text", 'group'::"text"]))),
    CONSTRAINT "schedule_time_slots_slot_number_check" CHECK ((("slot_number" >= 1) AND ("slot_number" <= 7)))
);


ALTER TABLE "public"."schedule_time_slots" OWNER TO "postgres";


COMMENT ON COLUMN "public"."schedule_time_slots"."formation" IS 'コマ時間の対象形態。individual=個別用の時間枠、group=集団用の時間枠。';



CREATE TABLE IF NOT EXISTS "public"."school_class_capacity" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "max_students_per_teacher_individual" integer DEFAULT 2 NOT NULL,
    "total_individual_seats" integer DEFAULT 12 NOT NULL,
    "max_students_per_group" integer DEFAULT 8 NOT NULL,
    "max_concurrent_groups" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "school_class_capacity_max_concurrent_groups_check" CHECK ((("max_concurrent_groups" >= 1) AND ("max_concurrent_groups" <= 20))),
    CONSTRAINT "school_class_capacity_max_students_per_group_check" CHECK ((("max_students_per_group" >= 1) AND ("max_students_per_group" <= 100))),
    CONSTRAINT "school_class_capacity_max_students_per_teacher_individual_check" CHECK ((("max_students_per_teacher_individual" >= 1) AND ("max_students_per_teacher_individual" <= 10))),
    CONSTRAINT "school_class_capacity_total_individual_seats_check" CHECK ((("total_individual_seats" >= 1) AND ("total_individual_seats" <= 100)))
);


ALTER TABLE "public"."school_class_capacity" OWNER TO "postgres";


COMMENT ON TABLE "public"."school_class_capacity" IS '学校ごとの授業生徒数上限設定。スケジュール作成・マッチング時のバリデーションに使用。';



COMMENT ON COLUMN "public"."school_class_capacity"."max_students_per_teacher_individual" IS '個別指導：1講師あたりの生徒上限（デフォルト2 = 1対2まで）。';



COMMENT ON COLUMN "public"."school_class_capacity"."total_individual_seats" IS '個別指導：教室全体の同時席数（デフォルト12）。';



COMMENT ON COLUMN "public"."school_class_capacity"."max_students_per_group" IS '集団指導：1コマあたりの生徒上限（デフォルト8）。';



COMMENT ON COLUMN "public"."school_class_capacity"."max_concurrent_groups" IS '集団指導：同時に開催できる集団コマ数（デフォルト1 = 1室のみ）。';



CREATE TABLE IF NOT EXISTS "public"."school_monthly_metrics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "year" integer NOT NULL,
    "month" integer NOT NULL,
    "kind" "text" DEFAULT 'actual'::"text" NOT NULL,
    "new_count" integer DEFAULT 0 NOT NULL,
    "leave_count" integer DEFAULT 0 NOT NULL,
    "active_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "school_monthly_metrics_kind_check" CHECK (("kind" = ANY (ARRAY['actual'::"text", 'budget'::"text"]))),
    CONSTRAINT "school_monthly_metrics_month_check" CHECK ((("month" >= 1) AND ("month" <= 12)))
);


ALTER TABLE "public"."school_monthly_metrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schools" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "code" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "notification_email" "text",
    "is_demo" boolean DEFAULT false NOT NULL,
    "notification_emails" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "logo_url" "text",
    "slack_mention_id" "text",
    "slack_channel_id" "text"
);


ALTER TABLE "public"."schools" OWNER TO "postgres";


COMMENT ON COLUMN "public"."schools"."notification_email" IS '申込通知先メールアドレス';



COMMENT ON COLUMN "public"."schools"."is_demo" IS 'デモ用教室フラグ。TRUE の場合、教室選択ドロップダウンなどから非表示にする。';



COMMENT ON COLUMN "public"."schools"."logo_url" IS '教室のロゴ画像URL（ポータルヘッダーに表示）';



CREATE TABLE IF NOT EXISTS "public"."seasonal_course_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid",
    "student_id" "uuid",
    "applied_at" timestamp with time zone DEFAULT "now"(),
    "applied_mode" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "seasonal_course_applications_applied_mode_check" CHECK (("applied_mode" = ANY (ARRAY['overwrite'::"text", 'add'::"text"])))
);


ALTER TABLE "public"."seasonal_course_applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seasonal_course_curriculum" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid",
    "textbook_id" integer,
    "curriculum_item_id" integer,
    "proposal_count" integer DEFAULT 0,
    "group_number" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."seasonal_course_curriculum" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seasonal_course_textbooks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid",
    "textbook_id" integer,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."seasonal_course_textbooks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seasonal_courses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "name" "text" NOT NULL,
    "season" "text" NOT NULL,
    "target_grades" integer[] DEFAULT '{}'::integer[],
    "total_koma" integer DEFAULT 0,
    "comment" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "start_date" "date",
    "end_date" "date",
    CONSTRAINT "seasonal_courses_season_check" CHECK (("season" = ANY (ARRAY['spring'::"text", 'summer'::"text", 'winter'::"text"])))
);


ALTER TABLE "public"."seasonal_courses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seasonal_proposal_units" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "curriculum_item_id" integer NOT NULL,
    "koma_count" integer DEFAULT 1 NOT NULL,
    "reason" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "group_id" integer DEFAULT 0 NOT NULL,
    "applied_koma" integer,
    "intent_tag" "text",
    "applied_group_id" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."seasonal_proposal_units" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seasonal_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_textbook_id" "uuid",
    "season" "text" NOT NULL,
    "year" integer DEFAULT EXTRACT(year FROM "now"()) NOT NULL,
    "theme" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "student_id" "uuid",
    "textbook_id" integer,
    "applied_koma" integer,
    "school_id" "uuid",
    CONSTRAINT "seasonal_proposals_season_check" CHECK (("season" = ANY (ARRAY['spring'::"text", 'summer'::"text", 'winter'::"text"]))),
    CONSTRAINT "seasonal_proposals_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'approved'::"text"])))
);


ALTER TABLE "public"."seasonal_proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seasonal_shift_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "deadline" "date" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "weekday_slots" "text" DEFAULT ''::"text" NOT NULL,
    "saturday_slots" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "seasonal_shift_settings_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."seasonal_shift_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seasonal_shift_slot_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "setting_id" "uuid" NOT NULL,
    "slot_date" "date" NOT NULL,
    "time_slot" "text" NOT NULL,
    "is_open" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."seasonal_shift_slot_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seasonal_shift_student_submission_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "shift_date" "date" NOT NULL,
    "time_slot" "text" NOT NULL,
    "available" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."seasonal_shift_student_submission_slots" OWNER TO "postgres";


COMMENT ON TABLE "public"."seasonal_shift_student_submission_slots" IS '生徒の通塾可能スロット（日付×時間帯）。available=true が「この日時に通える」。';



CREATE TABLE IF NOT EXISTS "public"."seasonal_shift_student_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "setting_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "submitter_email" "text",
    "submitter_name" "text",
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    "allow_edit" boolean DEFAULT false NOT NULL,
    "edit_token" "text",
    "matching_consumed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."seasonal_shift_student_submissions" OWNER TO "postgres";


COMMENT ON TABLE "public"."seasonal_shift_student_submissions" IS '講習期間中の生徒の通塾可能表（提出ヘッダ）。setting は seasonal_shift_settings を講師版と共通流用。';



CREATE TABLE IF NOT EXISTS "public"."seasonal_shift_submission_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "shift_date" "date" NOT NULL,
    "time_slot" "text" NOT NULL,
    "available" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."seasonal_shift_submission_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seasonal_shift_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "setting_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "teacher_name" "text" NOT NULL,
    "teacher_email" "text" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text" DEFAULT ''::"text",
    "allow_edit" boolean DEFAULT false NOT NULL,
    "edit_token" "uuid" DEFAULT "gen_random_uuid"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "seat_chart_entered" boolean DEFAULT false NOT NULL,
    "user_id" "uuid"
);


ALTER TABLE "public"."seasonal_shift_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "status" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "number_value" numeric,
    "date_value" "date",
    CONSTRAINT "student_applications_status_check" CHECK ((("status" IS NULL) OR ("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'not_applicable'::"text"]))))
);


ALTER TABLE "public"."student_applications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_billings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "billing_item_id" "uuid" NOT NULL,
    "is_billed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "quantity" integer,
    "value_number" integer,
    "value_text" "text"
);


ALTER TABLE "public"."student_billings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."student_billings"."quantity" IS 'Optional numeric value (e.g., number of 5th-week slots). NULL means boolean-only (use is_billed).';



COMMENT ON COLUMN "public"."student_billings"."value_number" IS 'number型項目の値（コマ数、回数等）';



COMMENT ON COLUMN "public"."student_billings"."value_text" IS 'text型項目の値（教材名等）';



CREATE TABLE IF NOT EXISTS "public"."student_interviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "interview_date" "date" NOT NULL,
    "interview_type" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_completed" boolean DEFAULT false,
    "completed_at" timestamp with time zone,
    "title" "text",
    CONSTRAINT "student_interviews_interview_type_check" CHECK (("interview_type" = ANY (ARRAY['parent_interview'::"text", 'phone'::"text", 'student_interview'::"text", 'casual'::"text", 'enrollment'::"text", 'other'::"text", 'task'::"text"])))
);


ALTER TABLE "public"."student_interviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "actor" "text",
    "diff" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "student_logs_action_check" CHECK (("action" = ANY (ARRAY['created'::"text", 'updated'::"text", 'soft_deleted'::"text", 'restored'::"text", 'status_changed'::"text"])))
);


ALTER TABLE "public"."student_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_textbook_id" "uuid" NOT NULL,
    "curriculum_item_id" integer NOT NULL,
    "proposal_count" integer DEFAULT 0,
    "application_count" integer DEFAULT 0,
    "exam_range_exam_type_id" "uuid",
    "school_progress_date" "date",
    "handover" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "group_number" integer,
    "teacher_name" "text",
    "intent_tag" "text",
    "homework_not_done" boolean DEFAULT false NOT NULL,
    "tardy" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."student_progress" OWNER TO "postgres";


COMMENT ON COLUMN "public"."student_progress"."intent_tag" IS '意図タグ: 苦手補強 / 既習の定着 / 未習の先取り / 学校進度に合わせる / 直前演習 / 応用発展';



CREATE TABLE IF NOT EXISTS "public"."student_progress_lessons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_progress_id" "uuid" NOT NULL,
    "lesson_number" integer NOT NULL,
    "lesson_date" "date",
    "teacher_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "session_id" "uuid",
    CONSTRAINT "student_progress_lessons_lesson_number_check" CHECK ((("lesson_number" >= 1) AND ("lesson_number" <= 3)))
);


ALTER TABLE "public"."student_progress_lessons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_subjects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."student_subjects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_textbook_exam_ranges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_textbook_id" "uuid" NOT NULL,
    "exam_type_id" "uuid" NOT NULL,
    "range_start_item_number" integer NOT NULL,
    "range_end_item_number" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "student_textbook_exam_ranges_check" CHECK (("range_start_item_number" <= "range_end_item_number"))
);


ALTER TABLE "public"."student_textbook_exam_ranges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_textbook_exams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_textbook_id" "uuid" NOT NULL,
    "exam_type_id" "uuid",
    "exam_date" "date" NOT NULL,
    "target_score" integer,
    "exam_range" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "custom_exam_name" "text",
    CONSTRAINT "student_textbook_exams_exam_name_check" CHECK ((("exam_type_id" IS NOT NULL) OR ("custom_exam_name" IS NOT NULL)))
);


ALTER TABLE "public"."student_textbook_exams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_textbook_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_textbook_id" "uuid" NOT NULL,
    "goal_period" "text",
    "goal_score" integer,
    "approach" "text",
    "homework_style" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."student_textbook_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_textbooks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "textbook_id" integer NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "season" character varying(10),
    "sort_order" integer DEFAULT 0,
    "is_draft" boolean DEFAULT false NOT NULL,
    "track_progress" boolean DEFAULT false NOT NULL,
    CONSTRAINT "student_textbooks_season_check" CHECK ((("season" IS NULL) OR (("season")::"text" = ANY ((ARRAY['spring'::character varying, 'summer'::character varying, 'winter'::character varying])::"text"[]))))
);


ALTER TABLE "public"."student_textbooks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."students" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_code" character varying(20) NOT NULL,
    "last_name" character varying(50) NOT NULL,
    "first_name" character varying(50) NOT NULL,
    "last_name_kana" character varying(50) NOT NULL,
    "first_name_kana" character varying(50) NOT NULL,
    "grade" integer NOT NULL,
    "status" character varying(20) DEFAULT 'active'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "school_name" character varying(100),
    "class_name" character varying(50),
    "club" character varying(100),
    "subject_other" character varying(100),
    "school_id" "uuid" NOT NULL,
    "deleted_at" timestamp with time zone,
    "is_programming" boolean DEFAULT false NOT NULL,
    "is_sibling" boolean DEFAULT false NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL,
    "withdrawal_date" "date",
    "preferred_teacher_gender" "text",
    "fixed_teacher_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "excluded_teacher_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    CONSTRAINT "students_grade_check" CHECK ((("grade" >= 1) AND ("grade" <= 13))),
    CONSTRAINT "students_preferred_teacher_gender_check" CHECK ((("preferred_teacher_gender" IS NULL) OR ("preferred_teacher_gender" = ANY (ARRAY['male'::"text", 'female'::"text"])))),
    CONSTRAINT "students_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'inactive'::character varying, 'withdrawn'::character varying])::"text"[])))
);


ALTER TABLE "public"."students" OWNER TO "postgres";


COMMENT ON COLUMN "public"."students"."is_sibling" IS '兄弟・姉妹がいる場合 true';


COMMENT ON COLUMN "public"."students"."is_test" IS '研修用テスト生徒。業務集計から除外し名簿のみ表示する。';



COMMENT ON COLUMN "public"."students"."withdrawal_date" IS '退塾予定日。この日以降のスケジュール生成・5週目計算から除外される。NULLは在籍中。';



COMMENT ON COLUMN "public"."students"."preferred_teacher_gender" IS '希望講師性別。NULL=指定なし、male=男性のみ、female=女性のみ。';



COMMENT ON COLUMN "public"."students"."fixed_teacher_ids" IS '担当固定講師ID配列。マッチングではこの中の講師を優先（または強制）。';



COMMENT ON COLUMN "public"."students"."excluded_teacher_ids" IS '指名NG講師ID配列。マッチングでこの講師は割り当てない。';



CREATE TABLE IF NOT EXISTS "public"."subjects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(50) NOT NULL,
    "grade_category" character varying(20) NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "duration_minutes" integer DEFAULT 90 NOT NULL,
    CONSTRAINT "subjects_duration_minutes_check" CHECK (("duration_minutes" = ANY (ARRAY[45, 90]))),
    CONSTRAINT "subjects_grade_category_check" CHECK ((("grade_category")::"text" = ANY ((ARRAY['elementary'::character varying, 'middle'::character varying, 'high'::character varying])::"text"[])))
);


ALTER TABLE "public"."subjects" OWNER TO "postgres";


COMMENT ON COLUMN "public"."subjects"."duration_minutes" IS '授業時間（分）: 45または90。小学4年生以下は45分授業の場合が多い。';



CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" character varying(255) NOT NULL,
    "value" "text" NOT NULL,
    "description" "text",
    "category" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teacher_absences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "absence_date" "date" NOT NULL,
    "time_slot_id" "uuid" NOT NULL,
    "reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."teacher_absences" OWNER TO "postgres";


COMMENT ON TABLE "public"."teacher_absences" IS '講師の欠勤（コマ単位）。座席表で講師カードを欠勤表示にするフラグ。生徒の再配置は行わない。';



CREATE TABLE IF NOT EXISTS "public"."teacher_availability_periods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "school_id" "uuid" NOT NULL,
    "effective_from" "date" NOT NULL,
    "effective_until" "date",
    "available_days_of_week" integer[] DEFAULT '{}'::integer[] NOT NULL,
    "available_slot_numbers_by_day" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "available_time_slots_by_day" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "source_submission_id" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "teacher_availability_periods_source_check" CHECK (("source" = ANY (ARRAY['regular_shift'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."teacher_availability_periods" OWNER TO "postgres";


COMMENT ON TABLE "public"."teacher_availability_periods" IS '講師の出勤可能期間。effective_from/until で期間バージョン管理。source=regular_shift はシフト提出由来（自動反映）、manual は手動編集。';



CREATE TABLE IF NOT EXISTS "public"."teacher_badge_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "badge_id" "uuid" NOT NULL,
    "completed_at" "date",
    "note" "text",
    "assigned_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."teacher_badge_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teacher_badges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" DEFAULT 'training'::"text" NOT NULL,
    "rank" "text" DEFAULT 'bronze'::"text" NOT NULL,
    "icon" "text" DEFAULT 'star'::"text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."teacher_badges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teacher_trainings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "period_label" "text",
    "attended_on" "date",
    "note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "training_master_id" "uuid"
);


ALTER TABLE "public"."teacher_trainings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."test_prep_proposal_subjects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "subject_name" "text" NOT NULL,
    "target_score" integer,
    "proposed_koma" integer DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."test_prep_proposal_subjects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."test_prep_proposal_units" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "curriculum_item_id" integer,
    "unit_name" "text" NOT NULL,
    "self_assessment" "text",
    "koma_count" integer DEFAULT 1 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "group_id" "text",
    CONSTRAINT "test_prep_proposal_units_self_assessment_check" CHECK ((("self_assessment" IS NULL) OR ("self_assessment" = ANY (ARRAY['◎'::"text", '○'::"text", '△'::"text", '×'::"text"]))))
);


ALTER TABLE "public"."test_prep_proposal_units" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."test_prep_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "exam_type_id" "uuid",
    "teacher_user_id" "uuid",
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(12), 'hex'::"text") NOT NULL,
    "zoukoma_period_id" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "test_prep_proposals_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."test_prep_proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."textbooks" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "publisher" "text",
    "school_type" "text",
    "grade" "text",
    "subject" "text",
    "revision_date" "text",
    "sheet_gid" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "grade_category" character varying(20),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true NOT NULL,
    "material_id" "uuid",
    CONSTRAINT "textbooks_grade_category_check" CHECK ((("grade_category" IS NULL) OR (("grade_category")::"text" = ANY ((ARRAY['elementary'::character varying, 'middle'::character varying, 'high'::character varying])::"text"[]))))
);


ALTER TABLE "public"."textbooks" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."textbooks_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."textbooks_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."textbooks_id_seq" OWNED BY "public"."textbooks"."id";



CREATE TABLE IF NOT EXISTS "public"."training_masters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "period_label" "text",
    "description" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."training_masters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transfer_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "from_entry_id" "uuid",
    "to_entry_id" "uuid",
    "from_date" "date" NOT NULL,
    "to_date" "date" NOT NULL,
    "from_time_slot_label" "text",
    "to_time_slot_label" "text",
    "delivery_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "delivery_method" "text",
    "sent_at" timestamp with time zone,
    "sent_to" "text",
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "transfer_notifications_delivery_status_check" CHECK (("delivery_status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."transfer_notifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."transfer_notifications" IS '振替確定時の通知レコード。createTransferEntry でINSERT、将来 Edge Function が pending 状態のものを送信する。';



CREATE TABLE IF NOT EXISTS "public"."user_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" NOT NULL,
    "school_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "token" "text" NOT NULL,
    "invited_by" "uuid",
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_invitations_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text", 'teacher'::"text", 'parent'::"text"])))
);


ALTER TABLE "public"."user_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "display_name" "text",
    "role" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "invited_by" "uuid",
    "invited_at" timestamp with time zone,
    "last_login_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "teachable_subject_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "available_days_of_week" integer[] DEFAULT '{1,2,3,4,5,6}'::integer[],
    "default_school_id" "uuid",
    "available_slot_numbers_by_day" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "exit_date" "date",
    "last_name" "text",
    "first_name" "text",
    "gender" "text",
    CONSTRAINT "user_profiles_gender_check" CHECK ((("gender" IS NULL) OR ("gender" = ANY (ARRAY['male'::"text", 'female'::"text", 'other'::"text"])))),
    CONSTRAINT "user_profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text", 'teacher'::"text", 'parent'::"text"])))
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_profiles"."teachable_subject_ids" IS '指導可能な科目IDの配列（空の場合は全科目可）';



COMMENT ON COLUMN "public"."user_profiles"."available_days_of_week" IS '出勤可能曜日 0=日,1=月,...,6=土（空の場合は全曜日）';



COMMENT ON COLUMN "public"."user_profiles"."default_school_id" IS '複数教室権限があるときのデフォルト教室（ログイン時の初期選択）';



COMMENT ON COLUMN "public"."user_profiles"."available_slot_numbers_by_day" IS '曜日ごとの出勤可能コマ番号。キー "0"〜"6"、値は 1〜7 の配列。空または未設定は全コマ可';



COMMENT ON COLUMN "public"."user_profiles"."gender" IS '性別。NULL=未設定、male=男性、female=女性、other=その他。生徒の「女性講師希望」マッチングで使用。';



CREATE TABLE IF NOT EXISTS "public"."user_schools" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "school_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_schools" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_textbook_favorites" (
    "user_id" "uuid" NOT NULL,
    "textbook_id" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_textbook_favorites" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_textbook_favorites" IS 'ユーザーごとのテキストお気に入り。テキスト選択画面で上位表示する用。';



ALTER TABLE ONLY "public"."curriculum_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."curriculum_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."textbooks" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."textbooks_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."action_goals"
    ADD CONSTRAINT "action_goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alert_dismissals"
    ADD CONSTRAINT "alert_dismissals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alert_dismissals"
    ADD CONSTRAINT "alert_dismissals_school_id_student_id_alert_type_alert_key_key" UNIQUE ("school_id", "student_id", "alert_type", "alert_key");



ALTER TABLE ONLY "public"."alert_settings"
    ADD CONSTRAINT "alert_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alert_settings"
    ADD CONSTRAINT "alert_settings_school_id_alert_type_key" UNIQUE ("school_id", "alert_type");



ALTER TABLE ONLY "public"."application_items"
    ADD CONSTRAINT "application_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assessment_scores"
    ADD CONSTRAINT "assessment_scores_assessment_id_subject_key" UNIQUE ("assessment_id", "subject");



ALTER TABLE ONLY "public"."assessment_scores"
    ADD CONSTRAINT "assessment_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assessment_subjects"
    ADD CONSTRAINT "assessment_subjects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assessment_subjects"
    ADD CONSTRAINT "assessment_subjects_school_id_code_key" UNIQUE ("school_id", "code");



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_notes"
    ADD CONSTRAINT "attendance_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_notes"
    ADD CONSTRAINT "attendance_notes_sheet_id_date_key" UNIQUE ("sheet_id", "date");



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_sheet_id_date_attendance_type_id_key" UNIQUE ("sheet_id", "date", "attendance_type_id");



ALTER TABLE ONLY "public"."attendance_sheets"
    ADD CONSTRAINT "attendance_sheets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_sheets"
    ADD CONSTRAINT "attendance_sheets_teacher_id_school_id_year_month_key" UNIQUE ("teacher_id", "school_id", "year_month");



ALTER TABLE ONLY "public"."attendance_types"
    ADD CONSTRAINT "attendance_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_items"
    ADD CONSTRAINT "billing_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_periods"
    ADD CONSTRAINT "billing_periods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bulletin_labels"
    ADD CONSTRAINT "bulletin_labels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bulletin_labels"
    ADD CONSTRAINT "bulletin_labels_school_id_name_key" UNIQUE ("school_id", "name");



ALTER TABLE ONLY "public"."bulletin_posts"
    ADD CONSTRAINT "bulletin_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bulletin_reads"
    ADD CONSTRAINT "bulletin_reads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bulletin_reads"
    ADD CONSTRAINT "bulletin_reads_post_id_user_id_key" UNIQUE ("post_id", "user_id");



ALTER TABLE ONLY "public"."class_reports"
    ADD CONSTRAINT "class_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."class_reports"
    ADD CONSTRAINT "class_reports_schedule_entry_id_key" UNIQUE ("schedule_entry_id");



ALTER TABLE ONLY "public"."course_prep_periods"
    ADD CONSTRAINT "course_prep_periods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_prep_periods"
    ADD CONSTRAINT "course_prep_periods_school_id_season_year_key" UNIQUE ("school_id", "season", "year");



ALTER TABLE ONLY "public"."course_prep_progress_items"
    ADD CONSTRAINT "course_prep_progress_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_prep_schedule_markers"
    ADD CONSTRAINT "course_prep_schedule_markers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_prep_schedule_markers"
    ADD CONSTRAINT "course_prep_schedule_markers_task_id_marker_date_key" UNIQUE ("task_id", "marker_date");



ALTER TABLE ONLY "public"."course_prep_schedule_tasks"
    ADD CONSTRAINT "course_prep_schedule_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_prep_student_progress"
    ADD CONSTRAINT "course_prep_student_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_prep_student_progress"
    ADD CONSTRAINT "course_prep_student_progress_student_id_item_id_key" UNIQUE ("student_id", "item_id");



ALTER TABLE ONLY "public"."course_prep_templates"
    ADD CONSTRAINT "course_prep_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."curriculum_items"
    ADD CONSTRAINT "curriculum_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."embed_tokens"
    ADD CONSTRAINT "embed_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."embed_tokens"
    ADD CONSTRAINT "embed_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."exam_types"
    ADD CONSTRAINT "exam_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_fields"
    ADD CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_periods"
    ADD CONSTRAINT "form_periods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_periods"
    ADD CONSTRAINT "form_periods_school_id_form_type_period_key_key" UNIQUE ("school_id", "form_type", "period_key");



ALTER TABLE ONLY "public"."form_responses"
    ADD CONSTRAINT "form_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_template_fields"
    ADD CONSTRAINT "form_template_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_templates"
    ADD CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forms"
    ADD CONSTRAINT "forms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forms"
    ADD CONSTRAINT "forms_school_id_slug_key" UNIQUE ("school_id", "slug");



ALTER TABLE ONLY "public"."google_calendar_tokens"
    ADD CONSTRAINT "google_calendar_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."google_calendar_tokens"
    ADD CONSTRAINT "google_calendar_tokens_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."inquiries"
    ADD CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inquiry_booking_tokens"
    ADD CONSTRAINT "inquiry_booking_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inquiry_booking_tokens"
    ADD CONSTRAINT "inquiry_booking_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."inquiry_contacts"
    ADD CONSTRAINT "inquiry_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inquiry_import_tokens"
    ADD CONSTRAINT "inquiry_import_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inquiry_import_tokens"
    ADD CONSTRAINT "inquiry_import_tokens_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."inquiry_mail_logs"
    ADD CONSTRAINT "inquiry_mail_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inquiry_mail_templates"
    ADD CONSTRAINT "inquiry_mail_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inquiry_school_settings"
    ADD CONSTRAINT "inquiry_school_settings_pkey" PRIMARY KEY ("school_id");



ALTER TABLE ONLY "public"."koushu_enrollments"
    ADD CONSTRAINT "koushu_enrollments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."koushu_enrollments"
    ADD CONSTRAINT "koushu_enrollments_school_season_student_formation_key" UNIQUE ("school_id", "season", "student_id", "formation");



ALTER TABLE ONLY "public"."lesson_report_units"
    ADD CONSTRAINT "lesson_report_units_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."material_orders"
    ADD CONSTRAINT "material_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."material_stock_transactions"
    ADD CONSTRAINT "material_stock_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."materials"
    ADD CONSTRAINT "materials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_task_checks"
    ADD CONSTRAINT "monthly_task_checks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_task_checks"
    ADD CONSTRAINT "monthly_task_checks_task_id_school_id_key" UNIQUE ("task_id", "school_id");



ALTER TABLE ONLY "public"."monthly_task_overrides"
    ADD CONSTRAINT "monthly_task_overrides_pkey" PRIMARY KEY ("task_id", "school_id");



ALTER TABLE ONLY "public"."monthly_task_templates"
    ADD CONSTRAINT "monthly_task_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."monthly_tasks"
    ADD CONSTRAINT "monthly_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notta_transcripts"
    ADD CONSTRAINT "notta_transcripts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notta_transcripts"
    ADD CONSTRAINT "notta_transcripts_school_id_external_id_key" UNIQUE ("school_id", "external_id");



ALTER TABLE ONLY "public"."portal_menu"
    ADD CONSTRAINT "portal_menu_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portal_menu"
    ADD CONSTRAINT "portal_menu_school_id_menu_key_key" UNIQUE ("school_id", "menu_key");



ALTER TABLE ONLY "public"."progress_sessions"
    ADD CONSTRAINT "progress_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_endpoint_key" UNIQUE ("user_id", "endpoint");



ALTER TABLE ONLY "public"."regular_shift_settings"
    ADD CONSTRAINT "regular_shift_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."regular_shift_slot_settings"
    ADD CONSTRAINT "regular_shift_slot_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."regular_shift_slot_settings"
    ADD CONSTRAINT "regular_shift_slot_settings_setting_id_day_of_week_time_slo_key" UNIQUE ("setting_id", "day_of_week", "time_slot");



ALTER TABLE ONLY "public"."regular_shift_submission_slots"
    ADD CONSTRAINT "regular_shift_submission_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."regular_shift_submissions"
    ADD CONSTRAINT "regular_shift_submissions_edit_token_key" UNIQUE ("edit_token");



ALTER TABLE ONLY "public"."regular_shift_submissions"
    ADD CONSTRAINT "regular_shift_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_change_logs"
    ADD CONSTRAINT "schedule_change_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_closed_days"
    ADD CONSTRAINT "schedule_closed_days_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_daily_booth_assignments"
    ADD CONSTRAINT "schedule_daily_booth_assignme_school_id_assignment_date_boo_key" UNIQUE ("school_id", "assignment_date", "booth_no");



ALTER TABLE ONLY "public"."schedule_daily_booth_assignments"
    ADD CONSTRAINT "schedule_daily_booth_assignme_school_id_assignment_date_tea_key" UNIQUE ("school_id", "assignment_date", "teacher_id");



ALTER TABLE ONLY "public"."schedule_daily_booth_assignments"
    ADD CONSTRAINT "schedule_daily_booth_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_entries"
    ADD CONSTRAINT "schedule_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_entries"
    ADD CONSTRAINT "schedule_entries_school_id_entry_date_time_slot_id_teacher__key" UNIQUE ("school_id", "entry_date", "time_slot_id", "teacher_id", "student_id");



ALTER TABLE ONLY "public"."schedule_generation_logs"
    ADD CONSTRAINT "schedule_generation_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_match_batches"
    ADD CONSTRAINT "schedule_match_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_match_proposals"
    ADD CONSTRAINT "schedule_match_proposals_batch_id_student_id_proposal_date__key" UNIQUE ("batch_id", "student_id", "proposal_date", "time_slot_id");



ALTER TABLE ONLY "public"."schedule_match_proposals"
    ADD CONSTRAINT "schedule_match_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_regular_patterns"
    ADD CONSTRAINT "schedule_regular_patterns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_time_slots"
    ADD CONSTRAINT "schedule_time_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_time_slots"
    ADD CONSTRAINT "schedule_time_slots_school_formation_slot_unique" UNIQUE ("school_id", "formation", "slot_number");



ALTER TABLE ONLY "public"."school_class_capacity"
    ADD CONSTRAINT "school_class_capacity_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."school_class_capacity"
    ADD CONSTRAINT "school_class_capacity_school_id_key" UNIQUE ("school_id");



ALTER TABLE ONLY "public"."school_monthly_metrics"
    ADD CONSTRAINT "school_monthly_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."school_monthly_metrics"
    ADD CONSTRAINT "school_monthly_metrics_school_id_year_month_kind_key" UNIQUE ("school_id", "year", "month", "kind");



ALTER TABLE ONLY "public"."schools"
    ADD CONSTRAINT "schools_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."schools"
    ADD CONSTRAINT "schools_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_course_applications"
    ADD CONSTRAINT "seasonal_course_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_course_curriculum"
    ADD CONSTRAINT "seasonal_course_curriculum_course_id_curriculum_item_id_key" UNIQUE ("course_id", "curriculum_item_id");



ALTER TABLE ONLY "public"."seasonal_course_curriculum"
    ADD CONSTRAINT "seasonal_course_curriculum_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_course_textbooks"
    ADD CONSTRAINT "seasonal_course_textbooks_course_id_textbook_id_key" UNIQUE ("course_id", "textbook_id");



ALTER TABLE ONLY "public"."seasonal_course_textbooks"
    ADD CONSTRAINT "seasonal_course_textbooks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_courses"
    ADD CONSTRAINT "seasonal_courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_proposal_units"
    ADD CONSTRAINT "seasonal_proposal_units_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_proposal_units"
    ADD CONSTRAINT "seasonal_proposal_units_proposal_id_curriculum_item_id_key" UNIQUE ("proposal_id", "curriculum_item_id");



ALTER TABLE ONLY "public"."seasonal_proposals"
    ADD CONSTRAINT "seasonal_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_proposals"
    ADD CONSTRAINT "seasonal_proposals_student_textbook_season_year_key" UNIQUE ("student_id", "textbook_id", "season", "year");



ALTER TABLE ONLY "public"."seasonal_shift_settings"
    ADD CONSTRAINT "seasonal_shift_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_shift_slot_settings"
    ADD CONSTRAINT "seasonal_shift_slot_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_shift_slot_settings"
    ADD CONSTRAINT "seasonal_shift_slot_settings_setting_id_slot_date_time_slot_key" UNIQUE ("setting_id", "slot_date", "time_slot");



ALTER TABLE ONLY "public"."seasonal_shift_student_submission_slots"
    ADD CONSTRAINT "seasonal_shift_student_submis_submission_id_shift_date_time_key" UNIQUE ("submission_id", "shift_date", "time_slot");



ALTER TABLE ONLY "public"."seasonal_shift_student_submission_slots"
    ADD CONSTRAINT "seasonal_shift_student_submission_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_shift_student_submissions"
    ADD CONSTRAINT "seasonal_shift_student_submissions_edit_token_key" UNIQUE ("edit_token");



ALTER TABLE ONLY "public"."seasonal_shift_student_submissions"
    ADD CONSTRAINT "seasonal_shift_student_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_shift_student_submissions"
    ADD CONSTRAINT "seasonal_shift_student_submissions_setting_id_student_id_key" UNIQUE ("setting_id", "student_id");



ALTER TABLE ONLY "public"."seasonal_shift_submission_slots"
    ADD CONSTRAINT "seasonal_shift_submission_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_shift_submissions"
    ADD CONSTRAINT "seasonal_shift_submissions_edit_token_key" UNIQUE ("edit_token");



ALTER TABLE ONLY "public"."seasonal_shift_submissions"
    ADD CONSTRAINT "seasonal_shift_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_applications"
    ADD CONSTRAINT "student_applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_applications"
    ADD CONSTRAINT "student_applications_student_id_item_id_key" UNIQUE ("student_id", "item_id");



ALTER TABLE ONLY "public"."student_billings"
    ADD CONSTRAINT "student_billings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_billings"
    ADD CONSTRAINT "student_billings_student_id_billing_item_id_key" UNIQUE ("student_id", "billing_item_id");



ALTER TABLE ONLY "public"."student_interviews"
    ADD CONSTRAINT "student_interviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_logs"
    ADD CONSTRAINT "student_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_progress_lessons"
    ADD CONSTRAINT "student_progress_lessons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_progress_lessons"
    ADD CONSTRAINT "student_progress_lessons_student_progress_id_lesson_number_key" UNIQUE ("student_progress_id", "lesson_number");



ALTER TABLE ONLY "public"."student_progress"
    ADD CONSTRAINT "student_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_progress"
    ADD CONSTRAINT "student_progress_student_textbook_id_curriculum_item_id_key" UNIQUE ("student_textbook_id", "curriculum_item_id");



ALTER TABLE ONLY "public"."student_subjects"
    ADD CONSTRAINT "student_subjects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_subjects"
    ADD CONSTRAINT "student_subjects_student_id_subject_id_key" UNIQUE ("student_id", "subject_id");



ALTER TABLE ONLY "public"."student_textbook_exam_ranges"
    ADD CONSTRAINT "student_textbook_exam_ranges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_textbook_exams"
    ADD CONSTRAINT "student_textbook_exams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_textbook_settings"
    ADD CONSTRAINT "student_textbook_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_textbook_settings"
    ADD CONSTRAINT "student_textbook_settings_student_textbook_id_key" UNIQUE ("student_textbook_id");



ALTER TABLE ONLY "public"."student_textbooks"
    ADD CONSTRAINT "student_textbooks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_textbooks"
    ADD CONSTRAINT "student_textbooks_student_id_textbook_id_key" UNIQUE ("student_id", "textbook_id");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_school_id_student_code_key" UNIQUE ("school_id", "student_code");



ALTER TABLE ONLY "public"."subjects"
    ADD CONSTRAINT "subjects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teacher_absences"
    ADD CONSTRAINT "teacher_absences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teacher_absences"
    ADD CONSTRAINT "teacher_absences_user_id_absence_date_time_slot_id_key" UNIQUE ("user_id", "absence_date", "time_slot_id");



ALTER TABLE ONLY "public"."teacher_availability_periods"
    ADD CONSTRAINT "teacher_availability_periods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teacher_badge_assignments"
    ADD CONSTRAINT "teacher_badge_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teacher_badge_assignments"
    ADD CONSTRAINT "teacher_badge_assignments_teacher_id_badge_id_key" UNIQUE ("teacher_id", "badge_id");



ALTER TABLE ONLY "public"."teacher_badges"
    ADD CONSTRAINT "teacher_badges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teacher_trainings"
    ADD CONSTRAINT "teacher_trainings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."test_prep_proposal_subjects"
    ADD CONSTRAINT "test_prep_proposal_subjects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."test_prep_proposal_units"
    ADD CONSTRAINT "test_prep_proposal_units_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."test_prep_proposals"
    ADD CONSTRAINT "test_prep_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."test_prep_proposals"
    ADD CONSTRAINT "test_prep_proposals_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."textbooks"
    ADD CONSTRAINT "textbooks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_masters"
    ADD CONSTRAINT "training_masters_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."training_masters"
    ADD CONSTRAINT "training_masters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transfer_notifications"
    ADD CONSTRAINT "transfer_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_invitations"
    ADD CONSTRAINT "user_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_invitations"
    ADD CONSTRAINT "user_invitations_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_schools"
    ADD CONSTRAINT "user_schools_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_schools"
    ADD CONSTRAINT "user_schools_user_id_school_id_key" UNIQUE ("user_id", "school_id");



ALTER TABLE ONLY "public"."user_textbook_favorites"
    ADD CONSTRAINT "user_textbook_favorites_pkey" PRIMARY KEY ("user_id", "textbook_id");



CREATE INDEX "idx_action_goals_exam_id" ON "public"."action_goals" USING "btree" ("student_textbook_exam_id");



CREATE INDEX "idx_action_goals_sort" ON "public"."action_goals" USING "btree" ("student_textbook_exam_id", "sort_order");



CREATE INDEX "idx_admin_audit_logs_action" ON "public"."admin_audit_logs" USING "btree" ("action", "created_at" DESC);



CREATE INDEX "idx_admin_audit_logs_actor" ON "public"."admin_audit_logs" USING "btree" ("actor_id", "created_at" DESC);



CREATE INDEX "idx_admin_audit_logs_target" ON "public"."admin_audit_logs" USING "btree" ("target_id", "created_at" DESC);



CREATE INDEX "idx_alert_dismissals_school_student" ON "public"."alert_dismissals" USING "btree" ("school_id", "student_id");



CREATE INDEX "idx_alert_settings_school" ON "public"."alert_settings" USING "btree" ("school_id");



CREATE INDEX "idx_application_items_is_hidden" ON "public"."application_items" USING "btree" ("is_hidden");



CREATE INDEX "idx_application_items_school_id" ON "public"."application_items" USING "btree" ("school_id", "is_active", "sort_order");



CREATE INDEX "idx_assessment_scores_assessment_id" ON "public"."assessment_scores" USING "btree" ("assessment_id");



CREATE INDEX "idx_assessment_subjects_category" ON "public"."assessment_subjects" USING "btree" ("category");



CREATE INDEX "idx_assessment_subjects_school" ON "public"."assessment_subjects" USING "btree" ("school_id");



CREATE INDEX "idx_assessment_subjects_school_type" ON "public"."assessment_subjects" USING "btree" ("school_type");



CREATE INDEX "idx_assessments_school_student_category_date" ON "public"."assessments" USING "btree" ("school_id", "student_id", "category", "exam_date" DESC);



CREATE INDEX "idx_assessments_school_student_category_grade_month" ON "public"."assessments" USING "btree" ("school_id", "student_id", "category", "grade" DESC, "exam_month" DESC, "name_code");



CREATE INDEX "idx_attendance_notes_sheet" ON "public"."attendance_notes" USING "btree" ("sheet_id");



CREATE INDEX "idx_attendance_records_date" ON "public"."attendance_records" USING "btree" ("date");



CREATE INDEX "idx_attendance_records_sheet" ON "public"."attendance_records" USING "btree" ("sheet_id");



CREATE INDEX "idx_attendance_sheets_lookup" ON "public"."attendance_sheets" USING "btree" ("school_id", "year_month");



CREATE INDEX "idx_attendance_sheets_school" ON "public"."attendance_sheets" USING "btree" ("school_id");



CREATE INDEX "idx_attendance_sheets_status" ON "public"."attendance_sheets" USING "btree" ("status");



CREATE INDEX "idx_attendance_sheets_teacher" ON "public"."attendance_sheets" USING "btree" ("teacher_id");



CREATE INDEX "idx_attendance_sheets_year_month" ON "public"."attendance_sheets" USING "btree" ("year_month");



CREATE INDEX "idx_attendance_types_active" ON "public"."attendance_types" USING "btree" ("school_id", "is_active");



CREATE INDEX "idx_attendance_types_school" ON "public"."attendance_types" USING "btree" ("school_id");



CREATE INDEX "idx_billing_items_period" ON "public"."billing_items" USING "btree" ("billing_period_id");



CREATE INDEX "idx_billing_items_school" ON "public"."billing_items" USING "btree" ("school_id");



CREATE INDEX "idx_billing_periods_school" ON "public"."billing_periods" USING "btree" ("school_id");



CREATE INDEX "idx_bulletin_labels_school" ON "public"."bulletin_labels" USING "btree" ("school_id", "sort_order");



CREATE INDEX "idx_bulletin_posts_pinned" ON "public"."bulletin_posts" USING "btree" ("school_id", "is_pinned", "created_at" DESC) WHERE (NOT "is_archived");



CREATE INDEX "idx_bulletin_posts_school" ON "public"."bulletin_posts" USING "btree" ("school_id", "is_archived", "created_at" DESC);



CREATE INDEX "idx_bulletin_reads_post" ON "public"."bulletin_reads" USING "btree" ("post_id");



CREATE INDEX "idx_bulletin_reads_user" ON "public"."bulletin_reads" USING "btree" ("user_id");



CREATE INDEX "idx_class_reports_pending" ON "public"."class_reports" USING "btree" ("school_id", "status") WHERE ("status" = 'submitted'::"text");



CREATE INDEX "idx_class_reports_school_lesson_date" ON "public"."class_reports" USING "btree" ("school_id", "lesson_date");



CREATE INDEX "idx_class_reports_student_date" ON "public"."class_reports" USING "btree" ("student_id", "lesson_date" DESC);



CREATE INDEX "idx_class_reports_teacher_status" ON "public"."class_reports" USING "btree" ("teacher_id", "status");



CREATE INDEX "idx_curriculum_items_item_type" ON "public"."curriculum_items" USING "btree" ("item_type");



CREATE INDEX "idx_curriculum_items_textbook_id" ON "public"."curriculum_items" USING "btree" ("textbook_id");



CREATE INDEX "idx_embed_tokens_school" ON "public"."embed_tokens" USING "btree" ("school_id");



CREATE INDEX "idx_embed_tokens_token" ON "public"."embed_tokens" USING "btree" ("token");



CREATE INDEX "idx_exam_types_school_id" ON "public"."exam_types" USING "btree" ("school_id", "sort_order");



CREATE INDEX "idx_form_fields_form_id" ON "public"."form_fields" USING "btree" ("form_id", "sort_order");



CREATE INDEX "idx_form_periods_form_type" ON "public"."form_periods" USING "btree" ("form_type");



CREATE INDEX "idx_form_periods_is_archived" ON "public"."form_periods" USING "btree" ("is_archived");



CREATE INDEX "idx_form_periods_publish_dates" ON "public"."form_periods" USING "btree" ("publish_start", "publish_end") WHERE ("is_active" = true);



CREATE INDEX "idx_form_periods_school_form_active" ON "public"."form_periods" USING "btree" ("school_id", "form_type", "is_active");



CREATE INDEX "idx_form_periods_school_id" ON "public"."form_periods" USING "btree" ("school_id");



CREATE INDEX "idx_form_responses_created_at" ON "public"."form_responses" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_form_responses_form_period" ON "public"."form_responses" USING "btree" ("form_period");



CREATE INDEX "idx_form_responses_form_type" ON "public"."form_responses" USING "btree" ("form_type");



CREATE INDEX "idx_form_responses_is_archived" ON "public"."form_responses" USING "btree" ("is_archived");



CREATE INDEX "idx_form_responses_linked_student" ON "public"."form_responses" USING "btree" ("linked_student_id") WHERE ("linked_student_id" IS NOT NULL);



CREATE INDEX "idx_form_responses_linked_student_id" ON "public"."form_responses" USING "btree" ("linked_student_id") WHERE ("linked_student_id" IS NOT NULL);



CREATE INDEX "idx_form_responses_school_form_period" ON "public"."form_responses" USING "btree" ("school_id", "form_type", "form_period");



CREATE INDEX "idx_form_responses_school_id" ON "public"."form_responses" USING "btree" ("school_id");



CREATE INDEX "idx_form_responses_school_period" ON "public"."form_responses" USING "btree" ("school_id", "form_type", "form_period");



CREATE INDEX "idx_form_responses_school_type_archived" ON "public"."form_responses" USING "btree" ("school_id", "form_type", "is_archived");



CREATE INDEX "idx_form_template_fields_template_id" ON "public"."form_template_fields" USING "btree" ("template_id", "sort_order");



CREATE INDEX "idx_form_templates_school_id" ON "public"."form_templates" USING "btree" ("school_id");



CREATE INDEX "idx_forms_publish_dates" ON "public"."forms" USING "btree" ("publish_start", "publish_end");



CREATE INDEX "idx_forms_school_id" ON "public"."forms" USING "btree" ("school_id");



CREATE INDEX "idx_forms_slug" ON "public"."forms" USING "btree" ("school_id", "slug");



CREATE INDEX "idx_forms_status" ON "public"."forms" USING "btree" ("status");



CREATE INDEX "idx_inquiries_email" ON "public"."inquiries" USING "btree" ("email") WHERE ("email" IS NOT NULL);



CREATE INDEX "idx_inquiries_phone" ON "public"."inquiries" USING "btree" ("phone") WHERE ("phone" IS NOT NULL);



CREATE INDEX "idx_inquiries_school_inquired" ON "public"."inquiries" USING "btree" ("school_id", "inquired_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_inquiries_status" ON "public"."inquiries" USING "btree" ("status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_inquiry_booking_tokens_inquiry" ON "public"."inquiry_booking_tokens" USING "btree" ("inquiry_id");



CREATE INDEX "idx_inquiry_contacts_inquiry" ON "public"."inquiry_contacts" USING "btree" ("inquiry_id", "contacted_at" DESC);



CREATE INDEX "idx_inquiry_mail_logs_inquiry" ON "public"."inquiry_mail_logs" USING "btree" ("inquiry_id", "sent_at" DESC);



CREATE INDEX "idx_inquiry_mail_logs_resend_id" ON "public"."inquiry_mail_logs" USING "btree" ("resend_email_id") WHERE ("resend_email_id" IS NOT NULL);



CREATE INDEX "idx_inquiry_mail_templates_school" ON "public"."inquiry_mail_templates" USING "btree" ("school_id", "sort_order");



CREATE INDEX "idx_koushu_enrollments_course" ON "public"."koushu_enrollments" USING "btree" ("course_id");



CREATE INDEX "idx_koushu_enrollments_school_season" ON "public"."koushu_enrollments" USING "btree" ("school_id", "season");



CREATE INDEX "idx_koushu_enrollments_student" ON "public"."koushu_enrollments" USING "btree" ("student_id");



CREATE INDEX "idx_lesson_report_units_report" ON "public"."lesson_report_units" USING "btree" ("report_id", "display_order");



CREATE INDEX "idx_materials_school_active" ON "public"."materials" USING "btree" ("school_id", "is_active");



CREATE INDEX "idx_materials_school_id" ON "public"."materials" USING "btree" ("school_id");



CREATE INDEX "idx_monthly_task_checks_school" ON "public"."monthly_task_checks" USING "btree" ("school_id");



CREATE INDEX "idx_monthly_task_checks_task" ON "public"."monthly_task_checks" USING "btree" ("task_id");



CREATE INDEX "idx_monthly_tasks_linked" ON "public"."monthly_tasks" USING "btree" ("linked_schedule_task_id") WHERE ("linked_schedule_task_id" IS NOT NULL);



CREATE INDEX "idx_monthly_tasks_period" ON "public"."monthly_tasks" USING "btree" ("year", "month", "task_date", "sort_order");



CREATE INDEX "idx_notta_school_unlinked" ON "public"."notta_transcripts" USING "btree" ("school_id", "created_at" DESC) WHERE (("linked_student_id" IS NULL) AND ("is_archived" = false));



CREATE INDEX "idx_notta_transcripts_linked_student" ON "public"."notta_transcripts" USING "btree" ("linked_student_id") WHERE ("linked_student_id" IS NOT NULL);



CREATE INDEX "idx_notta_transcripts_school_created" ON "public"."notta_transcripts" USING "btree" ("school_id", "created_at" DESC);



CREATE INDEX "idx_notta_transcripts_school_unlinked" ON "public"."notta_transcripts" USING "btree" ("school_id", "created_at" DESC) WHERE (("linked_student_id" IS NULL) AND ("is_archived" = false));



CREATE INDEX "idx_orders_material" ON "public"."material_orders" USING "btree" ("material_id");



CREATE INDEX "idx_orders_school" ON "public"."material_orders" USING "btree" ("school_id");



CREATE INDEX "idx_orders_status" ON "public"."material_orders" USING "btree" ("school_id", "status");



CREATE INDEX "idx_orders_student" ON "public"."material_orders" USING "btree" ("student_id");



CREATE INDEX "idx_portal_menu_link_urls" ON "public"."portal_menu" USING "gin" ("link_urls");



CREATE INDEX "idx_portal_menu_school_id" ON "public"."portal_menu" USING "btree" ("school_id");



CREATE INDEX "idx_portal_menu_school_visible_order" ON "public"."portal_menu" USING "btree" ("school_id", "is_visible", "sort_order");



CREATE INDEX "idx_prep_items_scope" ON "public"."course_prep_progress_items" USING "btree" ("school_id", "season", "year", "sort_order");



CREATE INDEX "idx_prep_markers_task" ON "public"."course_prep_schedule_markers" USING "btree" ("task_id");



CREATE INDEX "idx_prep_periods_scope" ON "public"."course_prep_periods" USING "btree" ("school_id", "season", "year");



CREATE INDEX "idx_prep_student_item" ON "public"."course_prep_student_progress" USING "btree" ("student_id", "item_id");



CREATE INDEX "idx_prep_student_school" ON "public"."course_prep_student_progress" USING "btree" ("school_id");



CREATE INDEX "idx_prep_tasks_linked_item" ON "public"."course_prep_schedule_tasks" USING "btree" ("linked_progress_item_id");



CREATE INDEX "idx_prep_tasks_scope" ON "public"."course_prep_schedule_tasks" USING "btree" ("school_id", "season", "year", "sort_order");



CREATE INDEX "idx_progress_lessons_session_id" ON "public"."student_progress_lessons" USING "btree" ("session_id") WHERE ("session_id" IS NOT NULL);



CREATE INDEX "idx_progress_sessions_confirmed" ON "public"."progress_sessions" USING "btree" ("confirmed_at") WHERE ("confirmed_at" IS NOT NULL);



CREATE INDEX "idx_progress_sessions_report" ON "public"."progress_sessions" USING "btree" ("report_id") WHERE ("report_id" IS NOT NULL);



CREATE INDEX "idx_progress_sessions_schedule_entry_id" ON "public"."progress_sessions" USING "btree" ("schedule_entry_id") WHERE ("schedule_entry_id" IS NOT NULL);



CREATE INDEX "idx_progress_sessions_session_date" ON "public"."progress_sessions" USING "btree" ("session_date" DESC);



CREATE INDEX "idx_progress_sessions_student_textbook_id" ON "public"."progress_sessions" USING "btree" ("student_textbook_id", "session_date" DESC);



CREATE INDEX "idx_progress_sessions_teacher_id" ON "public"."progress_sessions" USING "btree" ("teacher_id");



CREATE INDEX "idx_regular_shift_settings_effective" ON "public"."regular_shift_settings" USING "btree" ("school_id", "effective_from", "effective_until") WHERE ("status" = 'published'::"text");



CREATE INDEX "idx_regular_shift_settings_school_id" ON "public"."regular_shift_settings" USING "btree" ("school_id");



CREATE INDEX "idx_regular_shift_settings_status" ON "public"."regular_shift_settings" USING "btree" ("status");



CREATE INDEX "idx_regular_shift_slot_settings_setting" ON "public"."regular_shift_slot_settings" USING "btree" ("setting_id");



CREATE INDEX "idx_regular_shift_slots_submission_id" ON "public"."regular_shift_submission_slots" USING "btree" ("submission_id");



CREATE UNIQUE INDEX "idx_regular_shift_slots_unique" ON "public"."regular_shift_submission_slots" USING "btree" ("submission_id", "day_of_week", "time_slot");



CREATE INDEX "idx_regular_shift_submissions_edit_token" ON "public"."regular_shift_submissions" USING "btree" ("edit_token");



CREATE INDEX "idx_regular_shift_submissions_school_id" ON "public"."regular_shift_submissions" USING "btree" ("school_id");



CREATE INDEX "idx_regular_shift_submissions_setting_id" ON "public"."regular_shift_submissions" USING "btree" ("setting_id");



CREATE INDEX "idx_regular_shift_submissions_user_id" ON "public"."regular_shift_submissions" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_regular_shift_submissions_user_setting" ON "public"."regular_shift_submissions" USING "btree" ("setting_id", "user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_schedule_closed_days_date" ON "public"."schedule_closed_days" USING "btree" ("closed_date");



CREATE UNIQUE INDEX "idx_schedule_closed_days_global_date" ON "public"."schedule_closed_days" USING "btree" ("closed_date") WHERE ("school_id" IS NULL);



CREATE INDEX "idx_schedule_closed_days_school" ON "public"."schedule_closed_days" USING "btree" ("school_id");



CREATE UNIQUE INDEX "idx_schedule_closed_days_school_date" ON "public"."schedule_closed_days" USING "btree" ("school_id", "closed_date") WHERE ("school_id" IS NOT NULL);



CREATE INDEX "idx_schedule_daily_booth_assignments_date" ON "public"."schedule_daily_booth_assignments" USING "btree" ("school_id", "assignment_date");



CREATE INDEX "idx_schedule_entries_formation" ON "public"."schedule_entries" USING "btree" ("school_id", "entry_date", "formation");



CREATE INDEX "idx_schedule_entries_kind" ON "public"."schedule_entries" USING "btree" ("school_id", "entry_date", "kind");



CREATE INDEX "idx_schedule_entries_school_date" ON "public"."schedule_entries" USING "btree" ("school_id", "entry_date");



CREATE INDEX "idx_schedule_entries_status" ON "public"."schedule_entries" USING "btree" ("school_id", "entry_date", "status");



CREATE INDEX "idx_schedule_entries_teacher" ON "public"."schedule_entries" USING "btree" ("teacher_id", "entry_date");



CREATE INDEX "idx_schedule_entries_transfer" ON "public"."schedule_entries" USING "btree" ("transfer_from_id") WHERE ("transfer_from_id" IS NOT NULL);



CREATE INDEX "idx_schedule_entries_transfer_deadline" ON "public"."schedule_entries" USING "btree" ("school_id", "transfer_deadline") WHERE (("status" = 'transferred_out'::"text") AND ("transfer_to_id" IS NULL));



CREATE UNIQUE INDEX "idx_schedule_entries_unique_unassigned" ON "public"."schedule_entries" USING "btree" ("school_id", "entry_date", "time_slot_id", "student_id") WHERE ("teacher_id" IS NULL);



CREATE INDEX "idx_schedule_generation_logs_school" ON "public"."schedule_generation_logs" USING "btree" ("school_id", "week_start_date");



CREATE INDEX "idx_schedule_match_batches_school_executed" ON "public"."schedule_match_batches" USING "btree" ("school_id", "executed_at" DESC);



CREATE INDEX "idx_schedule_match_proposals_batch_status" ON "public"."schedule_match_proposals" USING "btree" ("batch_id", "status");



CREATE INDEX "idx_schedule_match_proposals_school_date" ON "public"."schedule_match_proposals" USING "btree" ("school_id", "proposal_date");



CREATE INDEX "idx_schedule_match_proposals_student" ON "public"."schedule_match_proposals" USING "btree" ("student_id", "proposal_date");



CREATE INDEX "idx_schedule_regular_patterns_day_slot" ON "public"."schedule_regular_patterns" USING "btree" ("school_id", "day_of_week", "time_slot_id", "is_active");



CREATE INDEX "idx_schedule_regular_patterns_effective" ON "public"."schedule_regular_patterns" USING "btree" ("school_id", "effective_from", "effective_until") WHERE ("is_active" = true);



CREATE INDEX "idx_schedule_regular_patterns_formation" ON "public"."schedule_regular_patterns" USING "btree" ("school_id", "formation") WHERE ("is_active" = true);



CREATE INDEX "idx_schedule_regular_patterns_school" ON "public"."schedule_regular_patterns" USING "btree" ("school_id");



CREATE INDEX "idx_schedule_regular_patterns_student" ON "public"."schedule_regular_patterns" USING "btree" ("student_id");



CREATE INDEX "idx_schedule_regular_patterns_teacher" ON "public"."schedule_regular_patterns" USING "btree" ("teacher_id");



CREATE INDEX "idx_schedule_time_slots_formation" ON "public"."schedule_time_slots" USING "btree" ("school_id", "formation", "is_active", "display_order");



CREATE INDEX "idx_schedule_time_slots_school" ON "public"."schedule_time_slots" USING "btree" ("school_id", "is_active", "display_order");



CREATE INDEX "idx_school_monthly_metrics_school_year" ON "public"."school_monthly_metrics" USING "btree" ("school_id", "year");



CREATE UNIQUE INDEX "idx_schools_slack_channel_id" ON "public"."schools" USING "btree" ("slack_channel_id") WHERE ("slack_channel_id" IS NOT NULL);



CREATE INDEX "idx_seasonal_course_applications_course" ON "public"."seasonal_course_applications" USING "btree" ("course_id");



CREATE INDEX "idx_seasonal_course_applications_student" ON "public"."seasonal_course_applications" USING "btree" ("student_id");



CREATE INDEX "idx_seasonal_course_curriculum_course" ON "public"."seasonal_course_curriculum" USING "btree" ("course_id");



CREATE INDEX "idx_seasonal_course_textbooks_course" ON "public"."seasonal_course_textbooks" USING "btree" ("course_id");



CREATE INDEX "idx_seasonal_courses_school" ON "public"."seasonal_courses" USING "btree" ("school_id");



CREATE INDEX "idx_seasonal_courses_season" ON "public"."seasonal_courses" USING "btree" ("season");



CREATE INDEX "idx_seasonal_proposal_units_proposal" ON "public"."seasonal_proposal_units" USING "btree" ("proposal_id");



CREATE INDEX "idx_seasonal_proposals_school" ON "public"."seasonal_proposals" USING "btree" ("school_id");



CREATE INDEX "idx_seasonal_proposals_st" ON "public"."seasonal_proposals" USING "btree" ("student_textbook_id");



CREATE INDEX "idx_seasonal_proposals_student" ON "public"."seasonal_proposals" USING "btree" ("student_id");



CREATE INDEX "idx_seasonal_proposals_textbook" ON "public"."seasonal_proposals" USING "btree" ("textbook_id");



CREATE INDEX "idx_seasonal_shift_settings_school_id" ON "public"."seasonal_shift_settings" USING "btree" ("school_id");



CREATE INDEX "idx_seasonal_shift_settings_status" ON "public"."seasonal_shift_settings" USING "btree" ("status");



CREATE INDEX "idx_seasonal_shift_slot_settings_setting" ON "public"."seasonal_shift_slot_settings" USING "btree" ("setting_id");



CREATE INDEX "idx_seasonal_shift_slots_submission_id" ON "public"."seasonal_shift_submission_slots" USING "btree" ("submission_id");



CREATE UNIQUE INDEX "idx_seasonal_shift_slots_unique" ON "public"."seasonal_shift_submission_slots" USING "btree" ("submission_id", "shift_date", "time_slot");



CREATE INDEX "idx_seasonal_shift_student_sub_slots_date_time" ON "public"."seasonal_shift_student_submission_slots" USING "btree" ("shift_date", "time_slot") WHERE ("available" = true);



CREATE INDEX "idx_seasonal_shift_student_sub_slots_submission" ON "public"."seasonal_shift_student_submission_slots" USING "btree" ("submission_id");



CREATE INDEX "idx_seasonal_shift_student_subs_setting" ON "public"."seasonal_shift_student_submissions" USING "btree" ("setting_id", "submitted_at" DESC);



CREATE INDEX "idx_seasonal_shift_student_subs_student" ON "public"."seasonal_shift_student_submissions" USING "btree" ("student_id", "submitted_at" DESC);



CREATE INDEX "idx_seasonal_shift_submissions_edit_token" ON "public"."seasonal_shift_submissions" USING "btree" ("edit_token");



CREATE INDEX "idx_seasonal_shift_submissions_school_id" ON "public"."seasonal_shift_submissions" USING "btree" ("school_id");



CREATE INDEX "idx_seasonal_shift_submissions_setting_id" ON "public"."seasonal_shift_submissions" USING "btree" ("setting_id");



CREATE INDEX "idx_seasonal_shift_submissions_user_id" ON "public"."seasonal_shift_submissions" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_seasonal_shift_submissions_user_setting" ON "public"."seasonal_shift_submissions" USING "btree" ("setting_id", "user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_stock_txns_material" ON "public"."material_stock_transactions" USING "btree" ("material_id");



CREATE INDEX "idx_stock_txns_school" ON "public"."material_stock_transactions" USING "btree" ("school_id");



CREATE INDEX "idx_student_applications_item_id" ON "public"."student_applications" USING "btree" ("item_id");



CREATE INDEX "idx_student_applications_school_id" ON "public"."student_applications" USING "btree" ("school_id");



CREATE INDEX "idx_student_applications_student_id" ON "public"."student_applications" USING "btree" ("student_id");



CREATE INDEX "idx_student_billings_item" ON "public"."student_billings" USING "btree" ("billing_item_id");



CREATE INDEX "idx_student_billings_school" ON "public"."student_billings" USING "btree" ("school_id");



CREATE INDEX "idx_student_billings_student" ON "public"."student_billings" USING "btree" ("student_id");



CREATE INDEX "idx_student_interviews_date" ON "public"."student_interviews" USING "btree" ("interview_date" DESC);



CREATE INDEX "idx_student_interviews_school_id" ON "public"."student_interviews" USING "btree" ("school_id");



CREATE INDEX "idx_student_interviews_student_id" ON "public"."student_interviews" USING "btree" ("student_id");



CREATE INDEX "idx_student_logs_action" ON "public"."student_logs" USING "btree" ("action");



CREATE INDEX "idx_student_logs_created_at" ON "public"."student_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_student_logs_school_id" ON "public"."student_logs" USING "btree" ("school_id");



CREATE INDEX "idx_student_logs_student_id" ON "public"."student_logs" USING "btree" ("student_id");



CREATE INDEX "idx_student_logs_student_id_created_at" ON "public"."student_logs" USING "btree" ("student_id", "created_at" DESC);



CREATE INDEX "idx_student_progress_curriculum_item_id" ON "public"."student_progress" USING "btree" ("curriculum_item_id");



CREATE INDEX "idx_student_progress_group" ON "public"."student_progress" USING "btree" ("student_textbook_id", "group_number");



CREATE INDEX "idx_student_progress_lessons_student_progress_id" ON "public"."student_progress_lessons" USING "btree" ("student_progress_id");



CREATE INDEX "idx_student_progress_student_textbook_id" ON "public"."student_progress" USING "btree" ("student_textbook_id");



CREATE INDEX "idx_student_subjects_student_id" ON "public"."student_subjects" USING "btree" ("student_id");



CREATE INDEX "idx_student_subjects_subject_id" ON "public"."student_subjects" USING "btree" ("subject_id");



CREATE INDEX "idx_student_textbook_exam_ranges_exam_type" ON "public"."student_textbook_exam_ranges" USING "btree" ("exam_type_id");



CREATE INDEX "idx_student_textbook_exam_ranges_textbook" ON "public"."student_textbook_exam_ranges" USING "btree" ("student_textbook_id");



CREATE INDEX "idx_student_textbook_exams_exam_date" ON "public"."student_textbook_exams" USING "btree" ("exam_date");



CREATE INDEX "idx_student_textbook_exams_student_textbook_id" ON "public"."student_textbook_exams" USING "btree" ("student_textbook_id");



CREATE INDEX "idx_student_textbooks_is_draft" ON "public"."student_textbooks" USING "btree" ("is_draft");



CREATE INDEX "idx_student_textbooks_school_id" ON "public"."student_textbooks" USING "btree" ("school_id");



CREATE INDEX "idx_student_textbooks_season" ON "public"."student_textbooks" USING "btree" ("season") WHERE ("season" IS NOT NULL);



CREATE INDEX "idx_student_textbooks_sort_order" ON "public"."student_textbooks" USING "btree" ("student_id", "sort_order");



CREATE INDEX "idx_student_textbooks_student_id" ON "public"."student_textbooks" USING "btree" ("student_id", "is_active");



CREATE INDEX "idx_student_textbooks_textbook_id" ON "public"."student_textbooks" USING "btree" ("textbook_id");



CREATE INDEX "idx_students_grade" ON "public"."students" USING "btree" ("grade");



CREATE INDEX "idx_students_is_programming" ON "public"."students" USING "btree" ("is_programming") WHERE ("is_programming" = true);



CREATE INDEX "idx_students_kana" ON "public"."students" USING "btree" ("last_name_kana", "first_name_kana");



CREATE INDEX "idx_students_name" ON "public"."students" USING "btree" ("last_name", "first_name");



CREATE INDEX "idx_students_school_id_deleted_at" ON "public"."students" USING "btree" ("school_id", "deleted_at");



CREATE INDEX "idx_students_school_id_kana" ON "public"."students" USING "btree" ("school_id", "last_name_kana", "first_name_kana");



CREATE INDEX "idx_students_school_id_status_grade" ON "public"."students" USING "btree" ("school_id", "status", "grade");



CREATE INDEX "idx_students_status" ON "public"."students" USING "btree" ("status");



CREATE INDEX "idx_students_student_code" ON "public"."students" USING "btree" ("student_code");



CREATE INDEX "idx_subjects_grade_category" ON "public"."subjects" USING "btree" ("grade_category");



CREATE INDEX "idx_subjects_sort_order" ON "public"."subjects" USING "btree" ("grade_category", "sort_order");



CREATE INDEX "idx_system_settings_category" ON "public"."system_settings" USING "btree" ("category");



CREATE INDEX "idx_system_settings_key" ON "public"."system_settings" USING "btree" ("key");



CREATE INDEX "idx_teacher_badge_assignments_badge" ON "public"."teacher_badge_assignments" USING "btree" ("badge_id");



CREATE INDEX "idx_teacher_badge_assignments_teacher" ON "public"."teacher_badge_assignments" USING "btree" ("teacher_id");



CREATE INDEX "idx_teacher_badges_active" ON "public"."teacher_badges" USING "btree" ("is_active", "sort_order");



CREATE INDEX "idx_teacher_badges_category" ON "public"."teacher_badges" USING "btree" ("category");



CREATE INDEX "idx_teacher_trainings_attended_on" ON "public"."teacher_trainings" USING "btree" ("attended_on" DESC);



CREATE INDEX "idx_teacher_trainings_master" ON "public"."teacher_trainings" USING "btree" ("training_master_id");



CREATE INDEX "idx_teacher_trainings_teacher" ON "public"."teacher_trainings" USING "btree" ("teacher_id");



CREATE INDEX "idx_test_prep_proposal_subjects_proposal" ON "public"."test_prep_proposal_subjects" USING "btree" ("proposal_id");



CREATE INDEX "idx_test_prep_proposal_units_subject" ON "public"."test_prep_proposal_units" USING "btree" ("subject_id");



CREATE INDEX "idx_test_prep_proposals_school" ON "public"."test_prep_proposals" USING "btree" ("school_id");



CREATE INDEX "idx_test_prep_proposals_student" ON "public"."test_prep_proposals" USING "btree" ("student_id");



CREATE INDEX "idx_test_prep_proposals_token" ON "public"."test_prep_proposals" USING "btree" ("token");



CREATE INDEX "idx_textbooks_grade" ON "public"."textbooks" USING "btree" ("grade");



CREATE INDEX "idx_textbooks_grade_category" ON "public"."textbooks" USING "btree" ("grade_category") WHERE ("grade_category" IS NOT NULL);



CREATE INDEX "idx_textbooks_subject" ON "public"."textbooks" USING "btree" ("subject");



CREATE INDEX "idx_training_masters_active_sort" ON "public"."training_masters" USING "btree" ("is_active", "sort_order");



CREATE INDEX "idx_transfer_notifications_school_status" ON "public"."transfer_notifications" USING "btree" ("school_id", "delivery_status", "created_at" DESC);



CREATE INDEX "idx_transfer_notifications_student" ON "public"."transfer_notifications" USING "btree" ("student_id", "created_at" DESC);



CREATE INDEX "idx_user_invitations_email" ON "public"."user_invitations" USING "btree" ("email");



CREATE INDEX "idx_user_invitations_token" ON "public"."user_invitations" USING "btree" ("token");



CREATE INDEX "idx_user_profiles_email" ON "public"."user_profiles" USING "btree" ("email");



CREATE INDEX "idx_user_profiles_role" ON "public"."user_profiles" USING "btree" ("role");



CREATE INDEX "idx_user_schools_school" ON "public"."user_schools" USING "btree" ("school_id");



CREATE INDEX "idx_user_schools_user" ON "public"."user_schools" USING "btree" ("user_id");



CREATE INDEX "schedule_change_logs_entry_idx" ON "public"."schedule_change_logs" USING "btree" ("entry_id") WHERE ("entry_id" IS NOT NULL);



CREATE INDEX "schedule_change_logs_pattern_idx" ON "public"."schedule_change_logs" USING "btree" ("pattern_id") WHERE ("pattern_id" IS NOT NULL);



CREATE INDEX "schedule_change_logs_school_created_idx" ON "public"."schedule_change_logs" USING "btree" ("school_id", "created_at" DESC);



CREATE INDEX "schedule_change_logs_student_idx" ON "public"."schedule_change_logs" USING "btree" ("student_id") WHERE ("student_id" IS NOT NULL);



CREATE INDEX "teacher_absences_school_date_idx" ON "public"."teacher_absences" USING "btree" ("school_id", "absence_date");



CREATE INDEX "teacher_absences_user_idx" ON "public"."teacher_absences" USING "btree" ("user_id", "absence_date");



CREATE INDEX "teacher_availability_periods_school_idx" ON "public"."teacher_availability_periods" USING "btree" ("school_id", "effective_from" DESC);



CREATE UNIQUE INDEX "teacher_availability_periods_submission_unique_idx" ON "public"."teacher_availability_periods" USING "btree" ("source_submission_id") WHERE (("source" = 'regular_shift'::"text") AND ("source_submission_id" IS NOT NULL));



CREATE INDEX "teacher_availability_periods_user_school_idx" ON "public"."teacher_availability_periods" USING "btree" ("user_id", "school_id", "effective_from" DESC);



CREATE UNIQUE INDEX "uq_inquiries_school_hp_no" ON "public"."inquiries" USING "btree" ("school_id", "hp_inquiry_no") WHERE ("hp_inquiry_no" IS NOT NULL);



CREATE INDEX "user_textbook_favorites_user_id_idx" ON "public"."user_textbook_favorites" USING "btree" ("user_id");



-- NOTE(2026-07-14): この組み込みトリガー定義は、後続の
-- 20260714_form_notification_webhook_vault_trigger.sql で Vault 参照版
-- (public.trg_send_form_notification) に置き換えられる。ここに焼き込まれていた
-- service_role JWT はセキュリティ上リポジトリから除去し、プレースホルダー化した。
-- 実際の認証トークンは各環境の Vault(form_notification_auth_token)が唯一の入力源。
CREATE OR REPLACE TRIGGER "send-form-notification" AFTER INSERT ON "public"."form_responses" FOR EACH ROW EXECUTE FUNCTION "supabase_functions"."http_request"('https://bniistrbylypnwpfqszb.supabase.co/functions/v1/send-form-notification', 'POST', '{"Content-type":"application/json","Authorization":"Bearer REMOVED_USE_VAULT_SEE_MIGRATION_20260714"}', '{}', '5000');



CREATE OR REPLACE TRIGGER "set_updated_at_seasonal_proposals" BEFORE UPDATE ON "public"."seasonal_proposals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_updated_at_test_prep_proposals" BEFORE UPDATE ON "public"."test_prep_proposals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_teacher_availability_periods_updated_at" BEFORE UPDATE ON "public"."teacher_availability_periods" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at_teacher_availability_periods"();



CREATE OR REPLACE TRIGGER "trigger_update_google_calendar_tokens_updated_at" BEFORE UPDATE ON "public"."google_calendar_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."update_google_calendar_tokens_updated_at"();



CREATE OR REPLACE TRIGGER "update_action_goals_updated_at" BEFORE UPDATE ON "public"."action_goals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_application_items_updated_at" BEFORE UPDATE ON "public"."application_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_assessments_updated_at" BEFORE UPDATE ON "public"."assessments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_attendance_notes_updated_at" BEFORE UPDATE ON "public"."attendance_notes" FOR EACH ROW EXECUTE FUNCTION "public"."update_attendance_updated_at"();



CREATE OR REPLACE TRIGGER "update_attendance_records_updated_at" BEFORE UPDATE ON "public"."attendance_records" FOR EACH ROW EXECUTE FUNCTION "public"."update_attendance_updated_at"();



CREATE OR REPLACE TRIGGER "update_attendance_sheets_updated_at" BEFORE UPDATE ON "public"."attendance_sheets" FOR EACH ROW EXECUTE FUNCTION "public"."update_attendance_updated_at"();



CREATE OR REPLACE TRIGGER "update_attendance_types_updated_at" BEFORE UPDATE ON "public"."attendance_types" FOR EACH ROW EXECUTE FUNCTION "public"."update_attendance_updated_at"();



CREATE OR REPLACE TRIGGER "update_billing_items_updated_at" BEFORE UPDATE ON "public"."billing_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_billing_periods_updated_at" BEFORE UPDATE ON "public"."billing_periods" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_bulletin_labels_updated_at" BEFORE UPDATE ON "public"."bulletin_labels" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_bulletin_posts_updated_at" BEFORE UPDATE ON "public"."bulletin_posts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_class_reports_updated_at" BEFORE UPDATE ON "public"."class_reports" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_embed_tokens_updated_at" BEFORE UPDATE ON "public"."embed_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_exam_types_updated_at" BEFORE UPDATE ON "public"."exam_types" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_form_periods_updated_at" BEFORE UPDATE ON "public"."form_periods" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_form_responses_updated_at" BEFORE UPDATE ON "public"."form_responses" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_form_templates_updated_at" BEFORE UPDATE ON "public"."form_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_forms_updated_at" BEFORE UPDATE ON "public"."forms" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_inquiries_updated_at" BEFORE UPDATE ON "public"."inquiries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_inquiry_mail_templates_updated_at" BEFORE UPDATE ON "public"."inquiry_mail_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_inquiry_school_settings_updated_at" BEFORE UPDATE ON "public"."inquiry_school_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_lesson_report_units_updated_at" BEFORE UPDATE ON "public"."lesson_report_units" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_material_orders_updated_at" BEFORE UPDATE ON "public"."material_orders" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_materials_updated_at" BEFORE UPDATE ON "public"."materials" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_portal_menu_updated_at" BEFORE UPDATE ON "public"."portal_menu" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_progress_sessions_updated_at" BEFORE UPDATE ON "public"."progress_sessions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_regular_shift_settings_updated_at" BEFORE UPDATE ON "public"."regular_shift_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_regular_shift_submissions_updated_at" BEFORE UPDATE ON "public"."regular_shift_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_schedule_daily_booth_assignments_updated_at" BEFORE UPDATE ON "public"."schedule_daily_booth_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_schedule_entries_updated_at" BEFORE UPDATE ON "public"."schedule_entries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_schedule_match_batches_updated_at" BEFORE UPDATE ON "public"."schedule_match_batches" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_schedule_match_proposals_updated_at" BEFORE UPDATE ON "public"."schedule_match_proposals" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_schedule_regular_patterns_updated_at" BEFORE UPDATE ON "public"."schedule_regular_patterns" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_schedule_time_slots_updated_at" BEFORE UPDATE ON "public"."schedule_time_slots" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_school_class_capacity_updated_at" BEFORE UPDATE ON "public"."school_class_capacity" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_schools_updated_at" BEFORE UPDATE ON "public"."schools" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_seasonal_shift_settings_updated_at" BEFORE UPDATE ON "public"."seasonal_shift_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_seasonal_shift_student_subs_updated_at" BEFORE UPDATE ON "public"."seasonal_shift_student_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_seasonal_shift_submissions_updated_at" BEFORE UPDATE ON "public"."seasonal_shift_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_applications_updated_at" BEFORE UPDATE ON "public"."student_applications" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_billings_updated_at" BEFORE UPDATE ON "public"."student_billings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_progress_updated_at" BEFORE UPDATE ON "public"."student_progress" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_textbook_exam_ranges_updated_at" BEFORE UPDATE ON "public"."student_textbook_exam_ranges" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_textbook_exams_updated_at" BEFORE UPDATE ON "public"."student_textbook_exams" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_textbook_settings_updated_at" BEFORE UPDATE ON "public"."student_textbook_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_textbooks_updated_at" BEFORE UPDATE ON "public"."student_textbooks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_students_updated_at" BEFORE UPDATE ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_teacher_badges_updated_at" BEFORE UPDATE ON "public"."teacher_badges" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_textbooks_updated_at" BEFORE UPDATE ON "public"."textbooks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_transfer_notifications_updated_at" BEFORE UPDATE ON "public"."transfer_notifications" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_profiles_updated_at" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."action_goals"
    ADD CONSTRAINT "action_goals_student_textbook_exam_id_fkey" FOREIGN KEY ("student_textbook_exam_id") REFERENCES "public"."student_textbook_exams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."alert_dismissals"
    ADD CONSTRAINT "alert_dismissals_dismissed_by_fkey" FOREIGN KEY ("dismissed_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."alert_dismissals"
    ADD CONSTRAINT "alert_dismissals_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."alert_dismissals"
    ADD CONSTRAINT "alert_dismissals_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."alert_settings"
    ADD CONSTRAINT "alert_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."application_items"
    ADD CONSTRAINT "application_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."assessment_scores"
    ADD CONSTRAINT "assessment_scores_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assessment_subjects"
    ADD CONSTRAINT "assessment_subjects_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."attendance_notes"
    ADD CONSTRAINT "attendance_notes_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "public"."attendance_sheets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_attendance_type_id_fkey" FOREIGN KEY ("attendance_type_id") REFERENCES "public"."attendance_types"("id");



ALTER TABLE ONLY "public"."attendance_records"
    ADD CONSTRAINT "attendance_records_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "public"."attendance_sheets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance_sheets"
    ADD CONSTRAINT "attendance_sheets_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."attendance_sheets"
    ADD CONSTRAINT "attendance_sheets_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance_sheets"
    ADD CONSTRAINT "attendance_sheets_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance_types"
    ADD CONSTRAINT "attendance_types_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_items"
    ADD CONSTRAINT "billing_items_billing_period_id_fkey" FOREIGN KEY ("billing_period_id") REFERENCES "public"."billing_periods"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_items"
    ADD CONSTRAINT "billing_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."billing_items"
    ADD CONSTRAINT "billing_items_source_order_id_fkey" FOREIGN KEY ("source_order_id") REFERENCES "public"."material_orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."billing_periods"
    ADD CONSTRAINT "billing_periods_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bulletin_labels"
    ADD CONSTRAINT "bulletin_labels_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bulletin_posts"
    ADD CONSTRAINT "bulletin_posts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."bulletin_posts"
    ADD CONSTRAINT "bulletin_posts_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "public"."bulletin_labels"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bulletin_posts"
    ADD CONSTRAINT "bulletin_posts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bulletin_posts"
    ADD CONSTRAINT "bulletin_posts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."bulletin_reads"
    ADD CONSTRAINT "bulletin_reads_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."bulletin_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bulletin_reads"
    ADD CONSTRAINT "bulletin_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_reports"
    ADD CONSTRAINT "class_reports_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."class_reports"
    ADD CONSTRAINT "class_reports_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."class_reports"
    ADD CONSTRAINT "class_reports_schedule_entry_id_fkey" FOREIGN KEY ("schedule_entry_id") REFERENCES "public"."schedule_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_reports"
    ADD CONSTRAINT "class_reports_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_reports"
    ADD CONSTRAINT "class_reports_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_reports"
    ADD CONSTRAINT "class_reports_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."user_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."course_prep_periods"
    ADD CONSTRAINT "course_prep_periods_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_prep_progress_items"
    ADD CONSTRAINT "course_prep_progress_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_prep_schedule_markers"
    ADD CONSTRAINT "course_prep_schedule_markers_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."course_prep_schedule_tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_prep_schedule_tasks"
    ADD CONSTRAINT "course_prep_schedule_tasks_linked_progress_item_id_fkey" FOREIGN KEY ("linked_progress_item_id") REFERENCES "public"."course_prep_progress_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."course_prep_schedule_tasks"
    ADD CONSTRAINT "course_prep_schedule_tasks_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_prep_student_progress"
    ADD CONSTRAINT "course_prep_student_progress_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."course_prep_progress_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_prep_student_progress"
    ADD CONSTRAINT "course_prep_student_progress_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_prep_student_progress"
    ADD CONSTRAINT "course_prep_student_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."curriculum_items"
    ADD CONSTRAINT "curriculum_items_textbook_id_fkey" FOREIGN KEY ("textbook_id") REFERENCES "public"."textbooks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."embed_tokens"
    ADD CONSTRAINT "embed_tokens_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."embed_tokens"
    ADD CONSTRAINT "embed_tokens_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exam_types"
    ADD CONSTRAINT "exam_types_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."material_stock_transactions"
    ADD CONSTRAINT "fk_stock_txns_order" FOREIGN KEY ("related_order_id") REFERENCES "public"."material_orders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."form_fields"
    ADD CONSTRAINT "form_fields_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_periods"
    ADD CONSTRAINT "form_periods_linked_application_item_id_fkey" FOREIGN KEY ("linked_application_item_id") REFERENCES "public"."application_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."form_periods"
    ADD CONSTRAINT "form_periods_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."form_responses"
    ADD CONSTRAINT "form_responses_linked_student_id_fkey" FOREIGN KEY ("linked_student_id") REFERENCES "public"."students"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."form_responses"
    ADD CONSTRAINT "form_responses_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."form_template_fields"
    ADD CONSTRAINT "form_template_fields_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_templates"
    ADD CONSTRAINT "form_templates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."forms"
    ADD CONSTRAINT "forms_linked_application_item_id_fkey" FOREIGN KEY ("linked_application_item_id") REFERENCES "public"."application_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."forms"
    ADD CONSTRAINT "forms_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."forms"
    ADD CONSTRAINT "forms_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."google_calendar_tokens"
    ADD CONSTRAINT "google_calendar_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inquiries"
    ADD CONSTRAINT "inquiries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inquiries"
    ADD CONSTRAINT "inquiries_linked_student_id_fkey" FOREIGN KEY ("linked_student_id") REFERENCES "public"."students"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inquiries"
    ADD CONSTRAINT "inquiries_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inquiry_booking_tokens"
    ADD CONSTRAINT "inquiry_booking_tokens_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inquiry_booking_tokens"
    ADD CONSTRAINT "inquiry_booking_tokens_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inquiry_contacts"
    ADD CONSTRAINT "inquiry_contacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inquiry_contacts"
    ADD CONSTRAINT "inquiry_contacts_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inquiry_contacts"
    ADD CONSTRAINT "inquiry_contacts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inquiry_import_tokens"
    ADD CONSTRAINT "inquiry_import_tokens_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inquiry_mail_logs"
    ADD CONSTRAINT "inquiry_mail_logs_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inquiry_mail_logs"
    ADD CONSTRAINT "inquiry_mail_logs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inquiry_mail_logs"
    ADD CONSTRAINT "inquiry_mail_logs_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inquiry_mail_logs"
    ADD CONSTRAINT "inquiry_mail_logs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."inquiry_mail_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."inquiry_mail_templates"
    ADD CONSTRAINT "inquiry_mail_templates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inquiry_school_settings"
    ADD CONSTRAINT "inquiry_school_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."koushu_enrollments"
    ADD CONSTRAINT "koushu_enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."seasonal_courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."koushu_enrollments"
    ADD CONSTRAINT "koushu_enrollments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."koushu_enrollments"
    ADD CONSTRAINT "koushu_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lesson_report_units"
    ADD CONSTRAINT "lesson_report_units_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."class_reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lesson_report_units"
    ADD CONSTRAINT "lesson_report_units_student_textbook_id_fkey" FOREIGN KEY ("student_textbook_id") REFERENCES "public"."student_textbooks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_orders"
    ADD CONSTRAINT "material_orders_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."material_orders"
    ADD CONSTRAINT "material_orders_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_orders"
    ADD CONSTRAINT "material_orders_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_stock_transactions"
    ADD CONSTRAINT "material_stock_transactions_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."material_stock_transactions"
    ADD CONSTRAINT "material_stock_transactions_related_student_id_fkey" FOREIGN KEY ("related_student_id") REFERENCES "public"."students"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."material_stock_transactions"
    ADD CONSTRAINT "material_stock_transactions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."materials"
    ADD CONSTRAINT "materials_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."monthly_task_checks"
    ADD CONSTRAINT "monthly_task_checks_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."monthly_task_checks"
    ADD CONSTRAINT "monthly_task_checks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."monthly_tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."monthly_task_overrides"
    ADD CONSTRAINT "monthly_task_overrides_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."monthly_task_overrides"
    ADD CONSTRAINT "monthly_task_overrides_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."monthly_tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."monthly_tasks"
    ADD CONSTRAINT "monthly_tasks_linked_schedule_task_id_fkey" FOREIGN KEY ("linked_schedule_task_id") REFERENCES "public"."course_prep_schedule_tasks"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."monthly_tasks"
    ADD CONSTRAINT "monthly_tasks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."monthly_task_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notta_transcripts"
    ADD CONSTRAINT "notta_transcripts_linked_interview_id_fkey" FOREIGN KEY ("linked_interview_id") REFERENCES "public"."student_interviews"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notta_transcripts"
    ADD CONSTRAINT "notta_transcripts_linked_student_id_fkey" FOREIGN KEY ("linked_student_id") REFERENCES "public"."students"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notta_transcripts"
    ADD CONSTRAINT "notta_transcripts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."portal_menu"
    ADD CONSTRAINT "portal_menu_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."progress_sessions"
    ADD CONSTRAINT "progress_sessions_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."progress_sessions"
    ADD CONSTRAINT "progress_sessions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."class_reports"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."progress_sessions"
    ADD CONSTRAINT "progress_sessions_schedule_entry_id_fkey" FOREIGN KEY ("schedule_entry_id") REFERENCES "public"."schedule_entries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."progress_sessions"
    ADD CONSTRAINT "progress_sessions_student_textbook_id_fkey" FOREIGN KEY ("student_textbook_id") REFERENCES "public"."student_textbooks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."progress_sessions"
    ADD CONSTRAINT "progress_sessions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."regular_shift_settings"
    ADD CONSTRAINT "regular_shift_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."regular_shift_slot_settings"
    ADD CONSTRAINT "regular_shift_slot_settings_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "public"."regular_shift_settings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."regular_shift_submission_slots"
    ADD CONSTRAINT "regular_shift_submission_slots_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."regular_shift_submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."regular_shift_submissions"
    ADD CONSTRAINT "regular_shift_submissions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."regular_shift_submissions"
    ADD CONSTRAINT "regular_shift_submissions_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "public"."regular_shift_settings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."regular_shift_submissions"
    ADD CONSTRAINT "regular_shift_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_change_logs"
    ADD CONSTRAINT "schedule_change_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_change_logs"
    ADD CONSTRAINT "schedule_change_logs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_closed_days"
    ADD CONSTRAINT "schedule_closed_days_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_daily_booth_assignments"
    ADD CONSTRAINT "schedule_daily_booth_assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_daily_booth_assignments"
    ADD CONSTRAINT "schedule_daily_booth_assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_entries"
    ADD CONSTRAINT "schedule_entries_attendance_recorded_by_fkey" FOREIGN KEY ("attendance_recorded_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."schedule_entries"
    ADD CONSTRAINT "schedule_entries_regular_pattern_id_fkey" FOREIGN KEY ("regular_pattern_id") REFERENCES "public"."schedule_regular_patterns"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_entries"
    ADD CONSTRAINT "schedule_entries_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_entries"
    ADD CONSTRAINT "schedule_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_entries"
    ADD CONSTRAINT "schedule_entries_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."user_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."schedule_entries"
    ADD CONSTRAINT "schedule_entries_time_slot_id_fkey" FOREIGN KEY ("time_slot_id") REFERENCES "public"."schedule_time_slots"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."schedule_entries"
    ADD CONSTRAINT "schedule_entries_transfer_from_id_fkey" FOREIGN KEY ("transfer_from_id") REFERENCES "public"."schedule_entries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_entries"
    ADD CONSTRAINT "schedule_entries_transfer_to_id_fkey" FOREIGN KEY ("transfer_to_id") REFERENCES "public"."schedule_entries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_generation_logs"
    ADD CONSTRAINT "schedule_generation_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."schedule_generation_logs"
    ADD CONSTRAINT "schedule_generation_logs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_match_batches"
    ADD CONSTRAINT "schedule_match_batches_executed_by_fkey" FOREIGN KEY ("executed_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."schedule_match_batches"
    ADD CONSTRAINT "schedule_match_batches_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_match_batches"
    ADD CONSTRAINT "schedule_match_batches_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "public"."seasonal_shift_settings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_match_proposals"
    ADD CONSTRAINT "schedule_match_proposals_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."schedule_match_batches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_match_proposals"
    ADD CONSTRAINT "schedule_match_proposals_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."schedule_match_proposals"
    ADD CONSTRAINT "schedule_match_proposals_schedule_entry_id_fkey" FOREIGN KEY ("schedule_entry_id") REFERENCES "public"."schedule_entries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_match_proposals"
    ADD CONSTRAINT "schedule_match_proposals_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_match_proposals"
    ADD CONSTRAINT "schedule_match_proposals_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_match_proposals"
    ADD CONSTRAINT "schedule_match_proposals_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."user_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."schedule_match_proposals"
    ADD CONSTRAINT "schedule_match_proposals_time_slot_id_fkey" FOREIGN KEY ("time_slot_id") REFERENCES "public"."schedule_time_slots"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."schedule_regular_patterns"
    ADD CONSTRAINT "schedule_regular_patterns_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_regular_patterns"
    ADD CONSTRAINT "schedule_regular_patterns_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_regular_patterns"
    ADD CONSTRAINT "schedule_regular_patterns_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."user_profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."schedule_regular_patterns"
    ADD CONSTRAINT "schedule_regular_patterns_time_slot_id_fkey" FOREIGN KEY ("time_slot_id") REFERENCES "public"."schedule_time_slots"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."schedule_time_slots"
    ADD CONSTRAINT "schedule_time_slots_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."school_class_capacity"
    ADD CONSTRAINT "school_class_capacity_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."school_monthly_metrics"
    ADD CONSTRAINT "school_monthly_metrics_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_course_applications"
    ADD CONSTRAINT "seasonal_course_applications_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."seasonal_courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_course_applications"
    ADD CONSTRAINT "seasonal_course_applications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_course_curriculum"
    ADD CONSTRAINT "seasonal_course_curriculum_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."seasonal_courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_course_curriculum"
    ADD CONSTRAINT "seasonal_course_curriculum_curriculum_item_id_fkey" FOREIGN KEY ("curriculum_item_id") REFERENCES "public"."curriculum_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_course_curriculum"
    ADD CONSTRAINT "seasonal_course_curriculum_textbook_id_fkey" FOREIGN KEY ("textbook_id") REFERENCES "public"."textbooks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_course_textbooks"
    ADD CONSTRAINT "seasonal_course_textbooks_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."seasonal_courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_course_textbooks"
    ADD CONSTRAINT "seasonal_course_textbooks_textbook_id_fkey" FOREIGN KEY ("textbook_id") REFERENCES "public"."textbooks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_courses"
    ADD CONSTRAINT "seasonal_courses_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_proposal_units"
    ADD CONSTRAINT "seasonal_proposal_units_curriculum_item_id_fkey" FOREIGN KEY ("curriculum_item_id") REFERENCES "public"."curriculum_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_proposal_units"
    ADD CONSTRAINT "seasonal_proposal_units_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."seasonal_proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_proposals"
    ADD CONSTRAINT "seasonal_proposals_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id");



ALTER TABLE ONLY "public"."seasonal_proposals"
    ADD CONSTRAINT "seasonal_proposals_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_proposals"
    ADD CONSTRAINT "seasonal_proposals_student_textbook_id_fkey" FOREIGN KEY ("student_textbook_id") REFERENCES "public"."student_textbooks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_proposals"
    ADD CONSTRAINT "seasonal_proposals_textbook_id_fkey" FOREIGN KEY ("textbook_id") REFERENCES "public"."textbooks"("id");



ALTER TABLE ONLY "public"."seasonal_shift_settings"
    ADD CONSTRAINT "seasonal_shift_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_shift_slot_settings"
    ADD CONSTRAINT "seasonal_shift_slot_settings_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "public"."seasonal_shift_settings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_shift_student_submission_slots"
    ADD CONSTRAINT "seasonal_shift_student_submission_slots_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."seasonal_shift_student_submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_shift_student_submissions"
    ADD CONSTRAINT "seasonal_shift_student_submissions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_shift_student_submissions"
    ADD CONSTRAINT "seasonal_shift_student_submissions_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "public"."seasonal_shift_settings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_shift_student_submissions"
    ADD CONSTRAINT "seasonal_shift_student_submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_shift_submission_slots"
    ADD CONSTRAINT "seasonal_shift_submission_slots_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."seasonal_shift_submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_shift_submissions"
    ADD CONSTRAINT "seasonal_shift_submissions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_shift_submissions"
    ADD CONSTRAINT "seasonal_shift_submissions_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "public"."seasonal_shift_settings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_shift_submissions"
    ADD CONSTRAINT "seasonal_shift_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_applications"
    ADD CONSTRAINT "student_applications_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."application_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_applications"
    ADD CONSTRAINT "student_applications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_applications"
    ADD CONSTRAINT "student_applications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_billings"
    ADD CONSTRAINT "student_billings_billing_item_id_fkey" FOREIGN KEY ("billing_item_id") REFERENCES "public"."billing_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_billings"
    ADD CONSTRAINT "student_billings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_billings"
    ADD CONSTRAINT "student_billings_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_interviews"
    ADD CONSTRAINT "student_interviews_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id");



ALTER TABLE ONLY "public"."student_interviews"
    ADD CONSTRAINT "student_interviews_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_logs"
    ADD CONSTRAINT "student_logs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_logs"
    ADD CONSTRAINT "student_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_progress"
    ADD CONSTRAINT "student_progress_curriculum_item_id_fkey" FOREIGN KEY ("curriculum_item_id") REFERENCES "public"."curriculum_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_progress"
    ADD CONSTRAINT "student_progress_exam_range_exam_type_id_fkey" FOREIGN KEY ("exam_range_exam_type_id") REFERENCES "public"."exam_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_progress_lessons"
    ADD CONSTRAINT "student_progress_lessons_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."progress_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_progress_lessons"
    ADD CONSTRAINT "student_progress_lessons_student_progress_id_fkey" FOREIGN KEY ("student_progress_id") REFERENCES "public"."student_progress"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_progress"
    ADD CONSTRAINT "student_progress_student_textbook_id_fkey" FOREIGN KEY ("student_textbook_id") REFERENCES "public"."student_textbooks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_subjects"
    ADD CONSTRAINT "student_subjects_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_subjects"
    ADD CONSTRAINT "student_subjects_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_textbook_exam_ranges"
    ADD CONSTRAINT "student_textbook_exam_ranges_exam_type_id_fkey" FOREIGN KEY ("exam_type_id") REFERENCES "public"."exam_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_textbook_exam_ranges"
    ADD CONSTRAINT "student_textbook_exam_ranges_student_textbook_id_fkey" FOREIGN KEY ("student_textbook_id") REFERENCES "public"."student_textbooks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_textbook_exams"
    ADD CONSTRAINT "student_textbook_exams_exam_type_id_fkey" FOREIGN KEY ("exam_type_id") REFERENCES "public"."exam_types"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_textbook_exams"
    ADD CONSTRAINT "student_textbook_exams_student_textbook_id_fkey" FOREIGN KEY ("student_textbook_id") REFERENCES "public"."student_textbooks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_textbook_settings"
    ADD CONSTRAINT "student_textbook_settings_student_textbook_id_fkey" FOREIGN KEY ("student_textbook_id") REFERENCES "public"."student_textbooks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_textbooks"
    ADD CONSTRAINT "student_textbooks_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_textbooks"
    ADD CONSTRAINT "student_textbooks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_textbooks"
    ADD CONSTRAINT "student_textbooks_textbook_id_fkey" FOREIGN KEY ("textbook_id") REFERENCES "public"."textbooks"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."teacher_absences"
    ADD CONSTRAINT "teacher_absences_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."teacher_absences"
    ADD CONSTRAINT "teacher_absences_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_absences"
    ADD CONSTRAINT "teacher_absences_time_slot_id_fkey" FOREIGN KEY ("time_slot_id") REFERENCES "public"."schedule_time_slots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_absences"
    ADD CONSTRAINT "teacher_absences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_availability_periods"
    ADD CONSTRAINT "teacher_availability_periods_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_availability_periods"
    ADD CONSTRAINT "teacher_availability_periods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_badge_assignments"
    ADD CONSTRAINT "teacher_badge_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."teacher_badge_assignments"
    ADD CONSTRAINT "teacher_badge_assignments_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "public"."teacher_badges"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_badge_assignments"
    ADD CONSTRAINT "teacher_badge_assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_badges"
    ADD CONSTRAINT "teacher_badges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."teacher_trainings"
    ADD CONSTRAINT "teacher_trainings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."teacher_trainings"
    ADD CONSTRAINT "teacher_trainings_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."user_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_trainings"
    ADD CONSTRAINT "teacher_trainings_training_master_id_fkey" FOREIGN KEY ("training_master_id") REFERENCES "public"."training_masters"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."test_prep_proposal_subjects"
    ADD CONSTRAINT "test_prep_proposal_subjects_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."test_prep_proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."test_prep_proposal_units"
    ADD CONSTRAINT "test_prep_proposal_units_curriculum_item_id_fkey" FOREIGN KEY ("curriculum_item_id") REFERENCES "public"."curriculum_items"("id");



ALTER TABLE ONLY "public"."test_prep_proposal_units"
    ADD CONSTRAINT "test_prep_proposal_units_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."test_prep_proposal_subjects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."test_prep_proposals"
    ADD CONSTRAINT "test_prep_proposals_exam_type_id_fkey" FOREIGN KEY ("exam_type_id") REFERENCES "public"."exam_types"("id");



ALTER TABLE ONLY "public"."test_prep_proposals"
    ADD CONSTRAINT "test_prep_proposals_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id");



ALTER TABLE ONLY "public"."test_prep_proposals"
    ADD CONSTRAINT "test_prep_proposals_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id");



ALTER TABLE ONLY "public"."test_prep_proposals"
    ADD CONSTRAINT "test_prep_proposals_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."test_prep_proposals"
    ADD CONSTRAINT "test_prep_proposals_zoukoma_period_id_fkey" FOREIGN KEY ("zoukoma_period_id") REFERENCES "public"."form_periods"("id");



ALTER TABLE ONLY "public"."textbooks"
    ADD CONSTRAINT "textbooks_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_masters"
    ADD CONSTRAINT "training_masters_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."transfer_notifications"
    ADD CONSTRAINT "transfer_notifications_from_entry_id_fkey" FOREIGN KEY ("from_entry_id") REFERENCES "public"."schedule_entries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transfer_notifications"
    ADD CONSTRAINT "transfer_notifications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transfer_notifications"
    ADD CONSTRAINT "transfer_notifications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transfer_notifications"
    ADD CONSTRAINT "transfer_notifications_to_entry_id_fkey" FOREIGN KEY ("to_entry_id") REFERENCES "public"."schedule_entries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_invitations"
    ADD CONSTRAINT "user_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_default_school_id_fkey" FOREIGN KEY ("default_school_id") REFERENCES "public"."schools"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_schools"
    ADD CONSTRAINT "user_schools_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_schools"
    ADD CONSTRAINT "user_schools_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_textbook_favorites"
    ADD CONSTRAINT "user_textbook_favorites_textbook_id_fkey" FOREIGN KEY ("textbook_id") REFERENCES "public"."textbooks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_textbook_favorites"
    ADD CONSTRAINT "user_textbook_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can insert profiles" ON "public"."user_profiles" FOR INSERT WITH CHECK (("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_profiles" "user_profiles_1")))));



CREATE POLICY "Admins can manage invitations" ON "public"."user_invitations" USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "Admins can manage user_schools" ON "public"."user_schools" USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "Admins can update all profiles" ON "public"."user_profiles" FOR UPDATE USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "Admins can view all profiles" ON "public"."user_profiles" FOR SELECT USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "Allow all for authenticated users" ON "public"."subjects" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Anyone can view active teachers for attendance portal" ON "public"."user_profiles" FOR SELECT USING ((("role" = 'teacher'::"text") AND ("is_active" = true)));



CREATE POLICY "Users can delete own tokens" ON "public"."google_calendar_tokens" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own tokens" ON "public"."google_calendar_tokens" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."user_profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own tokens" ON "public"."google_calendar_tokens" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own profile" ON "public"."user_profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own schools" ON "public"."user_schools" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own tokens" ON "public"."google_calendar_tokens" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."action_goals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "action_goals_school_scope_auth" ON "public"."action_goals" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."student_textbook_exams" "e"
     JOIN "public"."student_textbooks" "st" ON (("st"."id" = "e"."student_textbook_id")))
  WHERE (("e"."id" = "action_goals"."student_textbook_exam_id") AND "public"."check_school_access"("st"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."student_textbook_exams" "e"
     JOIN "public"."student_textbooks" "st" ON (("st"."id" = "e"."student_textbook_id")))
  WHERE (("e"."id" = "action_goals"."student_textbook_exam_id") AND "public"."check_school_access"("st"."school_id")))));



ALTER TABLE "public"."admin_audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_audit_logs_manager_all" ON "public"."admin_audit_logs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]))))));



ALTER TABLE "public"."alert_dismissals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "alert_dismissals_school_scope_auth" ON "public"."alert_dismissals" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."alert_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "alert_settings_school_member_modify" ON "public"."alert_settings" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "alert_settings_school_member_select" ON "public"."alert_settings" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."application_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "application_items_school_scope_auth" ON "public"."application_items" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."assessment_scores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assessment_scores_school_scope_auth" ON "public"."assessment_scores" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assessments" "a"
  WHERE (("a"."id" = "assessment_scores"."assessment_id") AND "public"."check_school_access"("a"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assessments" "a"
  WHERE (("a"."id" = "assessment_scores"."assessment_id") AND "public"."check_school_access"("a"."school_id")))));



ALTER TABLE "public"."assessment_subjects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assessment_subjects_modify" ON "public"."assessment_subjects" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "assessment_subjects_select" ON "public"."assessment_subjects" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."assessments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assessments_school_scope_auth" ON "public"."assessments" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."attendance_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attendance_notes_manager_all" ON "public"."attendance_notes" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]))))));



CREATE POLICY "attendance_notes_school_restrict" ON "public"."attendance_notes" AS RESTRICTIVE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."attendance_sheets" "s"
  WHERE (("s"."id" = "attendance_notes"."sheet_id") AND "public"."check_school_access"("s"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."attendance_sheets" "s"
  WHERE (("s"."id" = "attendance_notes"."sheet_id") AND "public"."check_school_access"("s"."school_id")))));



CREATE POLICY "attendance_notes_teacher_own" ON "public"."attendance_notes" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."attendance_sheets" "s"
  WHERE (("s"."id" = "attendance_notes"."sheet_id") AND ("s"."teacher_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."attendance_sheets" "s"
  WHERE (("s"."id" = "attendance_notes"."sheet_id") AND ("s"."teacher_id" = "auth"."uid"())))));



ALTER TABLE "public"."attendance_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attendance_records_manager_all" ON "public"."attendance_records" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]))))));



CREATE POLICY "attendance_records_school_restrict" ON "public"."attendance_records" AS RESTRICTIVE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."attendance_sheets" "s"
  WHERE (("s"."id" = "attendance_records"."sheet_id") AND "public"."check_school_access"("s"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."attendance_sheets" "s"
  WHERE (("s"."id" = "attendance_records"."sheet_id") AND "public"."check_school_access"("s"."school_id")))));



CREATE POLICY "attendance_records_teacher_own" ON "public"."attendance_records" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."attendance_sheets" "s"
  WHERE (("s"."id" = "attendance_records"."sheet_id") AND ("s"."teacher_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."attendance_sheets" "s"
  WHERE (("s"."id" = "attendance_records"."sheet_id") AND ("s"."teacher_id" = "auth"."uid"())))));



ALTER TABLE "public"."attendance_sheets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attendance_sheets_manager_all" ON "public"."attendance_sheets" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]))))));



CREATE POLICY "attendance_sheets_school_restrict" ON "public"."attendance_sheets" AS RESTRICTIVE TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



CREATE POLICY "attendance_sheets_teacher_own" ON "public"."attendance_sheets" TO "authenticated" USING (("teacher_id" = "auth"."uid"())) WITH CHECK (("teacher_id" = "auth"."uid"()));



ALTER TABLE "public"."attendance_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attendance_types_school_scope_auth" ON "public"."attendance_types" TO "authenticated" USING ((("school_id" IS NULL) OR "public"."check_school_access"("school_id"))) WITH CHECK ((("school_id" IS NULL) OR "public"."check_school_access"("school_id")));



ALTER TABLE "public"."billing_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_items_school_scope_auth" ON "public"."billing_items" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."billing_periods" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_periods_school_scope_auth" ON "public"."billing_periods" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."bulletin_labels" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bulletin_labels_school_scope_auth" ON "public"."bulletin_labels" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."bulletin_posts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bulletin_posts_school_scope_auth" ON "public"."bulletin_posts" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."bulletin_reads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bulletin_reads_own" ON "public"."bulletin_reads" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."class_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "class_reports_school_scope_auth" ON "public"."class_reports" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."course_prep_periods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_prep_progress_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_prep_schedule_markers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_prep_schedule_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_prep_student_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_prep_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."curriculum_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "curriculum_items_allow_all_auth" ON "public"."curriculum_items" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."embed_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "embed_tokens_school_scope_auth" ON "public"."embed_tokens" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."exam_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "exam_types_school_scope_auth" ON "public"."exam_types" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."form_fields" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_fields_anon_select" ON "public"."form_fields" FOR SELECT TO "anon" USING (true);



CREATE POLICY "form_fields_school_scope_auth" ON "public"."form_fields" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."forms" "f"
  WHERE (("f"."id" = "form_fields"."form_id") AND "public"."check_school_access"("f"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."forms" "f"
  WHERE (("f"."id" = "form_fields"."form_id") AND "public"."check_school_access"("f"."school_id")))));



ALTER TABLE "public"."form_periods" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_periods_allow_select_anon" ON "public"."form_periods" FOR SELECT TO "anon" USING (((("is_archived" IS NULL) OR ("is_archived" = false)) AND (("publish_start" IS NULL) OR ("publish_start" <= "now"())) AND (("publish_end" IS NULL) OR ("publish_end" >= "now"()))));



CREATE POLICY "form_periods_school_scope_auth" ON "public"."form_periods" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."form_responses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_responses_school_scope_auth" ON "public"."form_responses" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."form_template_fields" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_template_fields_school_scope_auth" ON "public"."form_template_fields" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."form_templates" "t"
  WHERE (("t"."id" = "form_template_fields"."template_id") AND "public"."check_school_access"("t"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."form_templates" "t"
  WHERE (("t"."id" = "form_template_fields"."template_id") AND "public"."check_school_access"("t"."school_id")))));



ALTER TABLE "public"."form_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_templates_school_scope_auth" ON "public"."form_templates" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."forms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "forms_anon_select_published" ON "public"."forms" FOR SELECT TO "anon" USING ((("status" = 'published'::"text") AND ("is_archived" = false)));



CREATE POLICY "forms_school_scope_auth" ON "public"."forms" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."google_calendar_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inquiries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inquiries_school_scope_auth" ON "public"."inquiries" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."inquiry_booking_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inquiry_booking_tokens_school_scope_auth" ON "public"."inquiry_booking_tokens" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."inquiry_contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inquiry_contacts_school_scope_auth" ON "public"."inquiry_contacts" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."inquiry_import_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inquiry_mail_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inquiry_mail_logs_school_scope_auth" ON "public"."inquiry_mail_logs" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."inquiry_mail_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inquiry_mail_templates_scope_auth" ON "public"."inquiry_mail_templates" TO "authenticated" USING ((("school_id" IS NULL) OR "public"."check_school_access"("school_id"))) WITH CHECK ((("school_id" IS NULL) OR "public"."check_school_access"("school_id")));



ALTER TABLE "public"."inquiry_school_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inquiry_school_settings_school_scope_auth" ON "public"."inquiry_school_settings" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."koushu_enrollments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "koushu_enrollments_school_scope_auth" ON "public"."koushu_enrollments" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."lesson_report_units" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lesson_report_units_school_scope_auth" ON "public"."lesson_report_units" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."class_reports" "cr"
  WHERE (("cr"."id" = "lesson_report_units"."report_id") AND "public"."check_school_access"("cr"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."class_reports" "cr"
  WHERE (("cr"."id" = "lesson_report_units"."report_id") AND "public"."check_school_access"("cr"."school_id")))));



ALTER TABLE "public"."material_orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "material_orders_school_scope_auth" ON "public"."material_orders" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."material_stock_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "material_stock_txns_school_scope_auth" ON "public"."material_stock_transactions" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."materials" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "materials_school_scope_auth" ON "public"."materials" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."monthly_task_checks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monthly_task_checks_school_scope_auth" ON "public"."monthly_task_checks" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."monthly_task_overrides" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monthly_task_overrides_school_scope_auth" ON "public"."monthly_task_overrides" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."monthly_task_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."monthly_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monthly_tasks_delete" ON "public"."monthly_tasks" FOR DELETE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "monthly_tasks_insert" ON "public"."monthly_tasks" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "monthly_tasks_select" ON "public"."monthly_tasks" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "monthly_tasks_update" ON "public"."monthly_tasks" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "monthly_templates_delete" ON "public"."monthly_task_templates" FOR DELETE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "monthly_templates_insert" ON "public"."monthly_task_templates" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "monthly_templates_select" ON "public"."monthly_task_templates" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "monthly_templates_update" ON "public"."monthly_task_templates" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."notta_transcripts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notta_transcripts_school_scope_auth" ON "public"."notta_transcripts" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."portal_menu" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "portal_menu_anon_select" ON "public"."portal_menu" FOR SELECT TO "anon" USING (("is_visible" = true));



CREATE POLICY "portal_menu_school_scope_auth" ON "public"."portal_menu" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_items_delete" ON "public"."course_prep_progress_items" FOR DELETE USING ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_items_insert" ON "public"."course_prep_progress_items" FOR INSERT WITH CHECK ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_items_select" ON "public"."course_prep_progress_items" FOR SELECT USING ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_items_update" ON "public"."course_prep_progress_items" FOR UPDATE USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_markers_delete" ON "public"."course_prep_schedule_markers" FOR DELETE USING (("task_id" IN ( SELECT "t"."id"
   FROM "public"."course_prep_schedule_tasks" "t"
  WHERE "public"."check_school_access"("t"."school_id"))));



CREATE POLICY "prep_markers_insert" ON "public"."course_prep_schedule_markers" FOR INSERT WITH CHECK (("task_id" IN ( SELECT "t"."id"
   FROM "public"."course_prep_schedule_tasks" "t"
  WHERE "public"."check_school_access"("t"."school_id"))));



CREATE POLICY "prep_markers_select" ON "public"."course_prep_schedule_markers" FOR SELECT USING (("task_id" IN ( SELECT "t"."id"
   FROM "public"."course_prep_schedule_tasks" "t"
  WHERE "public"."check_school_access"("t"."school_id"))));



CREATE POLICY "prep_markers_update" ON "public"."course_prep_schedule_markers" FOR UPDATE USING (("task_id" IN ( SELECT "t"."id"
   FROM "public"."course_prep_schedule_tasks" "t"
  WHERE "public"."check_school_access"("t"."school_id")))) WITH CHECK (("task_id" IN ( SELECT "t"."id"
   FROM "public"."course_prep_schedule_tasks" "t"
  WHERE "public"."check_school_access"("t"."school_id"))));



CREATE POLICY "prep_periods_delete" ON "public"."course_prep_periods" FOR DELETE USING ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_periods_insert" ON "public"."course_prep_periods" FOR INSERT WITH CHECK ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_periods_select" ON "public"."course_prep_periods" FOR SELECT USING ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_periods_update" ON "public"."course_prep_periods" FOR UPDATE USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_student_delete" ON "public"."course_prep_student_progress" FOR DELETE USING ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_student_insert" ON "public"."course_prep_student_progress" FOR INSERT WITH CHECK ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_student_select" ON "public"."course_prep_student_progress" FOR SELECT USING ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_student_update" ON "public"."course_prep_student_progress" FOR UPDATE USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_tasks_delete" ON "public"."course_prep_schedule_tasks" FOR DELETE USING ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_tasks_insert" ON "public"."course_prep_schedule_tasks" FOR INSERT WITH CHECK ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_tasks_select" ON "public"."course_prep_schedule_tasks" FOR SELECT USING ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_tasks_update" ON "public"."course_prep_schedule_tasks" FOR UPDATE USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



CREATE POLICY "prep_templates_delete" ON "public"."course_prep_templates" FOR DELETE USING ((("school_id" IS NULL) OR "public"."check_school_access"("school_id")));



CREATE POLICY "prep_templates_insert" ON "public"."course_prep_templates" FOR INSERT WITH CHECK ((("school_id" IS NULL) OR "public"."check_school_access"("school_id")));



CREATE POLICY "prep_templates_select" ON "public"."course_prep_templates" FOR SELECT USING ((("school_id" IS NULL) OR "public"."check_school_access"("school_id")));



CREATE POLICY "prep_templates_update" ON "public"."course_prep_templates" FOR UPDATE USING ((("school_id" IS NULL) OR "public"."check_school_access"("school_id"))) WITH CHECK ((("school_id" IS NULL) OR "public"."check_school_access"("school_id")));



ALTER TABLE "public"."progress_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "progress_sessions_school_scope_auth" ON "public"."progress_sessions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."student_textbooks" "st"
  WHERE (("st"."id" = "progress_sessions"."student_textbook_id") AND "public"."check_school_access"("st"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."student_textbooks" "st"
  WHERE (("st"."id" = "progress_sessions"."student_textbook_id") AND "public"."check_school_access"("st"."school_id")))));



ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "push_subscriptions_self" ON "public"."push_subscriptions" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."regular_shift_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "regular_shift_settings_anon_select_published" ON "public"."regular_shift_settings" FOR SELECT TO "anon" USING (("status" = 'published'::"text"));



CREATE POLICY "regular_shift_settings_school_scope_auth" ON "public"."regular_shift_settings" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."regular_shift_slot_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "regular_shift_slot_settings_school_scope_auth" ON "public"."regular_shift_slot_settings" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."regular_shift_settings" "s"
  WHERE (("s"."id" = "regular_shift_slot_settings"."setting_id") AND "public"."check_school_access"("s"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."regular_shift_settings" "s"
  WHERE (("s"."id" = "regular_shift_slot_settings"."setting_id") AND "public"."check_school_access"("s"."school_id")))));



ALTER TABLE "public"."regular_shift_submission_slots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "regular_shift_submission_slots_school_scope_auth" ON "public"."regular_shift_submission_slots" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."regular_shift_submissions" "p"
  WHERE (("p"."id" = "regular_shift_submission_slots"."submission_id") AND "public"."check_school_access"("p"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."regular_shift_submissions" "p"
  WHERE (("p"."id" = "regular_shift_submission_slots"."submission_id") AND "public"."check_school_access"("p"."school_id")))));



ALTER TABLE "public"."regular_shift_submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "regular_shift_submissions_manager_all" ON "public"."regular_shift_submissions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles"
  WHERE (("user_profiles"."id" = "auth"."uid"()) AND ("user_profiles"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]))))));



CREATE POLICY "regular_shift_submissions_school_scope_auth" ON "public"."regular_shift_submissions" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



CREATE POLICY "regular_shift_submissions_teacher_own" ON "public"."regular_shift_submissions" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."schedule_change_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_change_logs_school_scope_auth" ON "public"."schedule_change_logs" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."schedule_closed_days" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_closed_days_school_scope_auth" ON "public"."schedule_closed_days" TO "authenticated" USING ((("school_id" IS NULL) OR "public"."check_school_access"("school_id"))) WITH CHECK ((("school_id" IS NULL) OR "public"."check_school_access"("school_id")));



ALTER TABLE "public"."schedule_daily_booth_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_daily_booth_assignments_school_scope_auth" ON "public"."schedule_daily_booth_assignments" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."schedule_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_entries_school_scope_auth" ON "public"."schedule_entries" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."schedule_generation_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_generation_logs_school_scope_auth" ON "public"."schedule_generation_logs" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."schedule_match_batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_match_batches_school_scope_auth" ON "public"."schedule_match_batches" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."schedule_match_proposals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_match_proposals_school_scope_auth" ON "public"."schedule_match_proposals" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."schedule_regular_patterns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_regular_patterns_school_scope_auth" ON "public"."schedule_regular_patterns" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."schedule_time_slots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_time_slots_anon_select" ON "public"."schedule_time_slots" FOR SELECT TO "anon" USING (("is_active" = true));



CREATE POLICY "schedule_time_slots_school_scope_auth" ON "public"."schedule_time_slots" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."school_class_capacity" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "school_class_capacity_school_scope_auth" ON "public"."school_class_capacity" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."school_monthly_metrics" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "school_monthly_metrics_school_scope_auth" ON "public"."school_monthly_metrics" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."schools" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schools_anon_select" ON "public"."schools" FOR SELECT TO "anon" USING (true);



CREATE POLICY "schools_school_scope_auth" ON "public"."schools" TO "authenticated" USING ("public"."check_school_access"("id")) WITH CHECK ("public"."check_school_access"("id"));



ALTER TABLE "public"."seasonal_course_applications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_course_applications_school_scope_auth" ON "public"."seasonal_course_applications" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."seasonal_courses" "c"
  WHERE (("c"."id" = "seasonal_course_applications"."course_id") AND "public"."check_school_access"("c"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."seasonal_courses" "c"
  WHERE (("c"."id" = "seasonal_course_applications"."course_id") AND "public"."check_school_access"("c"."school_id")))));



ALTER TABLE "public"."seasonal_course_curriculum" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_course_curriculum_school_scope_auth" ON "public"."seasonal_course_curriculum" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."seasonal_courses" "c"
  WHERE (("c"."id" = "seasonal_course_curriculum"."course_id") AND "public"."check_school_access"("c"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."seasonal_courses" "c"
  WHERE (("c"."id" = "seasonal_course_curriculum"."course_id") AND "public"."check_school_access"("c"."school_id")))));



ALTER TABLE "public"."seasonal_course_textbooks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_course_textbooks_school_scope_auth" ON "public"."seasonal_course_textbooks" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."seasonal_courses" "c"
  WHERE (("c"."id" = "seasonal_course_textbooks"."course_id") AND "public"."check_school_access"("c"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."seasonal_courses" "c"
  WHERE (("c"."id" = "seasonal_course_textbooks"."course_id") AND "public"."check_school_access"("c"."school_id")))));



ALTER TABLE "public"."seasonal_courses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_courses_school_scope_auth" ON "public"."seasonal_courses" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."seasonal_proposal_units" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_proposal_units_school_scope_auth" ON "public"."seasonal_proposal_units" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."seasonal_proposals" "p"
  WHERE (("p"."id" = "seasonal_proposal_units"."proposal_id") AND "public"."check_school_access"("p"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."seasonal_proposals" "p"
  WHERE (("p"."id" = "seasonal_proposal_units"."proposal_id") AND "public"."check_school_access"("p"."school_id")))));



ALTER TABLE "public"."seasonal_proposals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_proposals_school_scope_auth" ON "public"."seasonal_proposals" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."seasonal_shift_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_shift_settings_anon_select_published" ON "public"."seasonal_shift_settings" FOR SELECT TO "anon" USING (("status" = 'published'::"text"));



CREATE POLICY "seasonal_shift_settings_school_scope_auth" ON "public"."seasonal_shift_settings" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."seasonal_shift_slot_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_shift_slot_settings_school_scope_auth" ON "public"."seasonal_shift_slot_settings" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."seasonal_shift_settings" "s"
  WHERE (("s"."id" = "seasonal_shift_slot_settings"."setting_id") AND "public"."check_school_access"("s"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."seasonal_shift_settings" "s"
  WHERE (("s"."id" = "seasonal_shift_slot_settings"."setting_id") AND "public"."check_school_access"("s"."school_id")))));



ALTER TABLE "public"."seasonal_shift_student_submission_slots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_shift_student_submission_slots_school_scope_auth" ON "public"."seasonal_shift_student_submission_slots" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."seasonal_shift_student_submissions" "p"
  WHERE (("p"."id" = "seasonal_shift_student_submission_slots"."submission_id") AND "public"."check_school_access"("p"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."seasonal_shift_student_submissions" "p"
  WHERE (("p"."id" = "seasonal_shift_student_submission_slots"."submission_id") AND "public"."check_school_access"("p"."school_id")))));



ALTER TABLE "public"."seasonal_shift_student_submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_shift_student_submissions_school_scope_auth" ON "public"."seasonal_shift_student_submissions" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."seasonal_shift_submission_slots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_shift_submission_slots_school_scope_auth" ON "public"."seasonal_shift_submission_slots" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."seasonal_shift_submissions" "p"
  WHERE (("p"."id" = "seasonal_shift_submission_slots"."submission_id") AND "public"."check_school_access"("p"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."seasonal_shift_submissions" "p"
  WHERE (("p"."id" = "seasonal_shift_submission_slots"."submission_id") AND "public"."check_school_access"("p"."school_id")))));



ALTER TABLE "public"."seasonal_shift_submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_shift_submissions_manager_all" ON "public"."seasonal_shift_submissions" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]))))));



CREATE POLICY "seasonal_shift_submissions_school_restrict" ON "public"."seasonal_shift_submissions" AS RESTRICTIVE TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



CREATE POLICY "seasonal_shift_submissions_teacher_own" ON "public"."seasonal_shift_submissions" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."student_applications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_applications_school_scope_auth" ON "public"."student_applications" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."student_billings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_billings_school_scope_auth" ON "public"."student_billings" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."student_interviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_interviews_school_scope_auth" ON "public"."student_interviews" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."student_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_logs_school_scope_auth" ON "public"."student_logs" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."student_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_progress_lessons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_progress_lessons_school_scope_auth" ON "public"."student_progress_lessons" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."student_progress" "sp"
     JOIN "public"."student_textbooks" "st" ON (("st"."id" = "sp"."student_textbook_id")))
  WHERE (("sp"."id" = "student_progress_lessons"."student_progress_id") AND "public"."check_school_access"("st"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."student_progress" "sp"
     JOIN "public"."student_textbooks" "st" ON (("st"."id" = "sp"."student_textbook_id")))
  WHERE (("sp"."id" = "student_progress_lessons"."student_progress_id") AND "public"."check_school_access"("st"."school_id")))));



CREATE POLICY "student_progress_school_scope_auth" ON "public"."student_progress" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."student_textbooks" "st"
  WHERE (("st"."id" = "student_progress"."student_textbook_id") AND "public"."check_school_access"("st"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."student_textbooks" "st"
  WHERE (("st"."id" = "student_progress"."student_textbook_id") AND "public"."check_school_access"("st"."school_id")))));



ALTER TABLE "public"."student_subjects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_subjects_school_scope_auth" ON "public"."student_subjects" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."students" "s"
  WHERE (("s"."id" = "student_subjects"."student_id") AND "public"."check_school_access"("s"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."students" "s"
  WHERE (("s"."id" = "student_subjects"."student_id") AND "public"."check_school_access"("s"."school_id")))));



ALTER TABLE "public"."student_textbook_exam_ranges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_textbook_exam_ranges_school_scope_auth" ON "public"."student_textbook_exam_ranges" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."student_textbooks" "st"
  WHERE (("st"."id" = "student_textbook_exam_ranges"."student_textbook_id") AND "public"."check_school_access"("st"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."student_textbooks" "st"
  WHERE (("st"."id" = "student_textbook_exam_ranges"."student_textbook_id") AND "public"."check_school_access"("st"."school_id")))));



ALTER TABLE "public"."student_textbook_exams" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_textbook_exams_school_scope_auth" ON "public"."student_textbook_exams" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."student_textbooks" "st"
  WHERE (("st"."id" = "student_textbook_exams"."student_textbook_id") AND "public"."check_school_access"("st"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."student_textbooks" "st"
  WHERE (("st"."id" = "student_textbook_exams"."student_textbook_id") AND "public"."check_school_access"("st"."school_id")))));



ALTER TABLE "public"."student_textbook_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_textbook_settings_school_scope_auth" ON "public"."student_textbook_settings" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."student_textbooks" "st"
  WHERE (("st"."id" = "student_textbook_settings"."student_textbook_id") AND "public"."check_school_access"("st"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."student_textbooks" "st"
  WHERE (("st"."id" = "student_textbook_settings"."student_textbook_id") AND "public"."check_school_access"("st"."school_id")))));



ALTER TABLE "public"."student_textbooks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_textbooks_school_scope_auth" ON "public"."student_textbooks" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."students" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "students_school_scope_auth" ON "public"."students" TO "authenticated" USING ("public"."check_student_access"("school_id")) WITH CHECK ("public"."check_student_access"("school_id"));



ALTER TABLE "public"."subjects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subjects_allow_all_auth" ON "public"."subjects" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "subjects_anon_select" ON "public"."subjects" FOR SELECT TO "anon" USING (true);



ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_settings_select_auth" ON "public"."system_settings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "system_settings_write_manager" ON "public"."system_settings" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]))))));



ALTER TABLE "public"."teacher_absences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teacher_absences_manager_all" ON "public"."teacher_absences" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]))))));



CREATE POLICY "teacher_absences_own" ON "public"."teacher_absences" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "teacher_absences_school_restrict" ON "public"."teacher_absences" AS RESTRICTIVE TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."teacher_availability_periods" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teacher_availability_periods_manager_all" ON "public"."teacher_availability_periods" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]))))));



CREATE POLICY "teacher_availability_periods_own" ON "public"."teacher_availability_periods" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "teacher_availability_periods_school_restrict" ON "public"."teacher_availability_periods" AS RESTRICTIVE TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."teacher_badge_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teacher_badge_assignments_delete" ON "public"."teacher_badge_assignments" FOR DELETE TO "authenticated" USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "teacher_badge_assignments_manager_all" ON "public"."teacher_badge_assignments" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]))))));



CREATE POLICY "teacher_badge_assignments_own_read" ON "public"."teacher_badge_assignments" FOR SELECT TO "authenticated" USING (("teacher_id" = "auth"."uid"()));



CREATE POLICY "teacher_badge_assignments_update" ON "public"."teacher_badge_assignments" FOR UPDATE TO "authenticated" USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



ALTER TABLE "public"."teacher_badges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teacher_badges_delete" ON "public"."teacher_badges" FOR DELETE TO "authenticated" USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "teacher_badges_insert" ON "public"."teacher_badges" FOR INSERT TO "authenticated" WITH CHECK ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "teacher_badges_select" ON "public"."teacher_badges" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "teacher_badges_update" ON "public"."teacher_badges" FOR UPDATE TO "authenticated" USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



ALTER TABLE "public"."teacher_trainings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teacher_trainings_delete" ON "public"."teacher_trainings" FOR DELETE TO "authenticated" USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "teacher_trainings_manager_all" ON "public"."teacher_trainings" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_profiles" "up"
  WHERE (("up"."id" = "auth"."uid"()) AND ("up"."role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]))))));



CREATE POLICY "teacher_trainings_own_read" ON "public"."teacher_trainings" FOR SELECT TO "authenticated" USING (("teacher_id" = "auth"."uid"()));



CREATE POLICY "teacher_trainings_update" ON "public"."teacher_trainings" FOR UPDATE TO "authenticated" USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



ALTER TABLE "public"."test_prep_proposal_subjects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "test_prep_proposal_subjects_school_scope_auth" ON "public"."test_prep_proposal_subjects" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."test_prep_proposals" "p"
  WHERE (("p"."id" = "test_prep_proposal_subjects"."proposal_id") AND "public"."check_school_access"("p"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."test_prep_proposals" "p"
  WHERE (("p"."id" = "test_prep_proposal_subjects"."proposal_id") AND "public"."check_school_access"("p"."school_id")))));



ALTER TABLE "public"."test_prep_proposal_units" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "test_prep_proposal_units_school_scope_auth" ON "public"."test_prep_proposal_units" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."test_prep_proposal_subjects" "s"
     JOIN "public"."test_prep_proposals" "p" ON (("p"."id" = "s"."proposal_id")))
  WHERE (("s"."id" = "test_prep_proposal_units"."subject_id") AND "public"."check_school_access"("p"."school_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."test_prep_proposal_subjects" "s"
     JOIN "public"."test_prep_proposals" "p" ON (("p"."id" = "s"."proposal_id")))
  WHERE (("s"."id" = "test_prep_proposal_units"."subject_id") AND "public"."check_school_access"("p"."school_id")))));



ALTER TABLE "public"."test_prep_proposals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "test_prep_proposals_school_scope_auth" ON "public"."test_prep_proposals" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."textbooks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "textbooks_allow_all_auth" ON "public"."textbooks" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."training_masters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "training_masters_delete" ON "public"."training_masters" FOR DELETE TO "authenticated" USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "training_masters_insert" ON "public"."training_masters" FOR INSERT TO "authenticated" WITH CHECK ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "training_masters_select" ON "public"."training_masters" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "training_masters_update" ON "public"."training_masters" FOR UPDATE TO "authenticated" USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



ALTER TABLE "public"."transfer_notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transfer_notifications_school_scope_auth" ON "public"."transfer_notifications" TO "authenticated" USING ("public"."check_school_access"("school_id")) WITH CHECK ("public"."check_school_access"("school_id"));



ALTER TABLE "public"."user_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_schools" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_textbook_favorites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_textbook_favorites_self" ON "public"."user_textbook_favorites" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."check_school_access"("school_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_school_access"("school_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_school_access"("school_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_student_access"("student_school_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_student_access"("student_school_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_student_access"("student_school_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_user_role"("required_roles" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."check_user_role"("required_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_user_role"("required_roles" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reassign_slot_numbers"("p_school_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reassign_slot_numbers"("p_school_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reassign_slot_numbers"("p_school_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."reorder_time_slots"("p_school_id" "uuid", "p_ordered_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."reorder_time_slots"("p_school_id" "uuid", "p_ordered_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_time_slots"("p_school_id" "uuid", "p_ordered_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at_teacher_availability_periods"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at_teacher_availability_periods"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at_teacher_availability_periods"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_attendance_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_attendance_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_attendance_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_google_calendar_tokens_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_google_calendar_tokens_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_google_calendar_tokens_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_schools_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_schools_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_schools_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON TABLE "public"."action_goals" TO "anon";
GRANT ALL ON TABLE "public"."action_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."action_goals" TO "service_role";



GRANT ALL ON TABLE "public"."admin_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."admin_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."alert_dismissals" TO "anon";
GRANT ALL ON TABLE "public"."alert_dismissals" TO "authenticated";
GRANT ALL ON TABLE "public"."alert_dismissals" TO "service_role";



GRANT ALL ON TABLE "public"."alert_settings" TO "anon";
GRANT ALL ON TABLE "public"."alert_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."alert_settings" TO "service_role";



GRANT ALL ON TABLE "public"."application_items" TO "anon";
GRANT ALL ON TABLE "public"."application_items" TO "authenticated";
GRANT ALL ON TABLE "public"."application_items" TO "service_role";



GRANT ALL ON TABLE "public"."assessment_scores" TO "anon";
GRANT ALL ON TABLE "public"."assessment_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."assessment_scores" TO "service_role";



GRANT ALL ON TABLE "public"."assessment_subjects" TO "anon";
GRANT ALL ON TABLE "public"."assessment_subjects" TO "authenticated";
GRANT ALL ON TABLE "public"."assessment_subjects" TO "service_role";



GRANT ALL ON TABLE "public"."assessments" TO "anon";
GRANT ALL ON TABLE "public"."assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."assessments" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_notes" TO "anon";
GRANT ALL ON TABLE "public"."attendance_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_notes" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_records" TO "anon";
GRANT ALL ON TABLE "public"."attendance_records" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_records" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_sheets" TO "anon";
GRANT ALL ON TABLE "public"."attendance_sheets" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_sheets" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_types" TO "anon";
GRANT ALL ON TABLE "public"."attendance_types" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_types" TO "service_role";



GRANT ALL ON TABLE "public"."billing_items" TO "anon";
GRANT ALL ON TABLE "public"."billing_items" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_items" TO "service_role";



GRANT ALL ON TABLE "public"."billing_periods" TO "anon";
GRANT ALL ON TABLE "public"."billing_periods" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_periods" TO "service_role";



GRANT ALL ON TABLE "public"."bulletin_labels" TO "anon";
GRANT ALL ON TABLE "public"."bulletin_labels" TO "authenticated";
GRANT ALL ON TABLE "public"."bulletin_labels" TO "service_role";



GRANT ALL ON TABLE "public"."bulletin_posts" TO "anon";
GRANT ALL ON TABLE "public"."bulletin_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."bulletin_posts" TO "service_role";



GRANT ALL ON TABLE "public"."bulletin_reads" TO "anon";
GRANT ALL ON TABLE "public"."bulletin_reads" TO "authenticated";
GRANT ALL ON TABLE "public"."bulletin_reads" TO "service_role";



GRANT ALL ON TABLE "public"."class_reports" TO "anon";
GRANT ALL ON TABLE "public"."class_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."class_reports" TO "service_role";



GRANT ALL ON TABLE "public"."course_prep_periods" TO "anon";
GRANT ALL ON TABLE "public"."course_prep_periods" TO "authenticated";
GRANT ALL ON TABLE "public"."course_prep_periods" TO "service_role";



GRANT ALL ON TABLE "public"."course_prep_progress_items" TO "anon";
GRANT ALL ON TABLE "public"."course_prep_progress_items" TO "authenticated";
GRANT ALL ON TABLE "public"."course_prep_progress_items" TO "service_role";



GRANT ALL ON TABLE "public"."course_prep_schedule_markers" TO "anon";
GRANT ALL ON TABLE "public"."course_prep_schedule_markers" TO "authenticated";
GRANT ALL ON TABLE "public"."course_prep_schedule_markers" TO "service_role";



GRANT ALL ON TABLE "public"."course_prep_schedule_tasks" TO "anon";
GRANT ALL ON TABLE "public"."course_prep_schedule_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."course_prep_schedule_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."course_prep_student_progress" TO "anon";
GRANT ALL ON TABLE "public"."course_prep_student_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."course_prep_student_progress" TO "service_role";



GRANT ALL ON TABLE "public"."course_prep_templates" TO "anon";
GRANT ALL ON TABLE "public"."course_prep_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."course_prep_templates" TO "service_role";



GRANT ALL ON TABLE "public"."curriculum_items" TO "anon";
GRANT ALL ON TABLE "public"."curriculum_items" TO "authenticated";
GRANT ALL ON TABLE "public"."curriculum_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."curriculum_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."curriculum_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."curriculum_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."embed_tokens" TO "anon";
GRANT ALL ON TABLE "public"."embed_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."embed_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."exam_types" TO "anon";
GRANT ALL ON TABLE "public"."exam_types" TO "authenticated";
GRANT ALL ON TABLE "public"."exam_types" TO "service_role";



GRANT ALL ON TABLE "public"."form_fields" TO "anon";
GRANT ALL ON TABLE "public"."form_fields" TO "authenticated";
GRANT ALL ON TABLE "public"."form_fields" TO "service_role";



GRANT ALL ON TABLE "public"."form_periods" TO "anon";
GRANT ALL ON TABLE "public"."form_periods" TO "authenticated";
GRANT ALL ON TABLE "public"."form_periods" TO "service_role";



GRANT ALL ON TABLE "public"."form_responses" TO "anon";
GRANT ALL ON TABLE "public"."form_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."form_responses" TO "service_role";



GRANT ALL ON TABLE "public"."form_template_fields" TO "anon";
GRANT ALL ON TABLE "public"."form_template_fields" TO "authenticated";
GRANT ALL ON TABLE "public"."form_template_fields" TO "service_role";



GRANT ALL ON TABLE "public"."form_templates" TO "anon";
GRANT ALL ON TABLE "public"."form_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."form_templates" TO "service_role";



GRANT ALL ON TABLE "public"."forms" TO "anon";
GRANT ALL ON TABLE "public"."forms" TO "authenticated";
GRANT ALL ON TABLE "public"."forms" TO "service_role";



GRANT ALL ON TABLE "public"."google_calendar_tokens" TO "anon";
GRANT ALL ON TABLE "public"."google_calendar_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."google_calendar_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."inquiries" TO "anon";
GRANT ALL ON TABLE "public"."inquiries" TO "authenticated";
GRANT ALL ON TABLE "public"."inquiries" TO "service_role";



GRANT ALL ON TABLE "public"."inquiry_booking_tokens" TO "anon";
GRANT ALL ON TABLE "public"."inquiry_booking_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."inquiry_booking_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."inquiry_contacts" TO "anon";
GRANT ALL ON TABLE "public"."inquiry_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."inquiry_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."inquiry_import_tokens" TO "anon";
GRANT ALL ON TABLE "public"."inquiry_import_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."inquiry_import_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."inquiry_mail_logs" TO "anon";
GRANT ALL ON TABLE "public"."inquiry_mail_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."inquiry_mail_logs" TO "service_role";



GRANT ALL ON TABLE "public"."inquiry_mail_templates" TO "anon";
GRANT ALL ON TABLE "public"."inquiry_mail_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."inquiry_mail_templates" TO "service_role";



GRANT ALL ON TABLE "public"."inquiry_school_settings" TO "anon";
GRANT ALL ON TABLE "public"."inquiry_school_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."inquiry_school_settings" TO "service_role";



GRANT ALL ON TABLE "public"."koushu_enrollments" TO "anon";
GRANT ALL ON TABLE "public"."koushu_enrollments" TO "authenticated";
GRANT ALL ON TABLE "public"."koushu_enrollments" TO "service_role";



GRANT ALL ON TABLE "public"."lesson_report_units" TO "anon";
GRANT ALL ON TABLE "public"."lesson_report_units" TO "authenticated";
GRANT ALL ON TABLE "public"."lesson_report_units" TO "service_role";



GRANT ALL ON TABLE "public"."material_orders" TO "anon";
GRANT ALL ON TABLE "public"."material_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."material_orders" TO "service_role";



GRANT ALL ON TABLE "public"."material_stock_transactions" TO "anon";
GRANT ALL ON TABLE "public"."material_stock_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."material_stock_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."materials" TO "anon";
GRANT ALL ON TABLE "public"."materials" TO "authenticated";
GRANT ALL ON TABLE "public"."materials" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_task_checks" TO "anon";
GRANT ALL ON TABLE "public"."monthly_task_checks" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_task_checks" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_task_overrides" TO "anon";
GRANT ALL ON TABLE "public"."monthly_task_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_task_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_task_templates" TO "anon";
GRANT ALL ON TABLE "public"."monthly_task_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_task_templates" TO "service_role";



GRANT ALL ON TABLE "public"."monthly_tasks" TO "anon";
GRANT ALL ON TABLE "public"."monthly_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."monthly_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."notta_transcripts" TO "anon";
GRANT ALL ON TABLE "public"."notta_transcripts" TO "authenticated";
GRANT ALL ON TABLE "public"."notta_transcripts" TO "service_role";



GRANT ALL ON TABLE "public"."portal_menu" TO "anon";
GRANT ALL ON TABLE "public"."portal_menu" TO "authenticated";
GRANT ALL ON TABLE "public"."portal_menu" TO "service_role";



GRANT ALL ON TABLE "public"."progress_sessions" TO "anon";
GRANT ALL ON TABLE "public"."progress_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."progress_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."regular_shift_settings" TO "anon";
GRANT ALL ON TABLE "public"."regular_shift_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."regular_shift_settings" TO "service_role";



GRANT ALL ON TABLE "public"."regular_shift_slot_settings" TO "anon";
GRANT ALL ON TABLE "public"."regular_shift_slot_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."regular_shift_slot_settings" TO "service_role";



GRANT ALL ON TABLE "public"."regular_shift_submission_slots" TO "anon";
GRANT ALL ON TABLE "public"."regular_shift_submission_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."regular_shift_submission_slots" TO "service_role";



GRANT ALL ON TABLE "public"."regular_shift_submissions" TO "anon";
GRANT ALL ON TABLE "public"."regular_shift_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."regular_shift_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_change_logs" TO "anon";
GRANT ALL ON TABLE "public"."schedule_change_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_change_logs" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_closed_days" TO "anon";
GRANT ALL ON TABLE "public"."schedule_closed_days" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_closed_days" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_daily_booth_assignments" TO "anon";
GRANT ALL ON TABLE "public"."schedule_daily_booth_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_daily_booth_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_entries" TO "anon";
GRANT ALL ON TABLE "public"."schedule_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_entries" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_generation_logs" TO "anon";
GRANT ALL ON TABLE "public"."schedule_generation_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_generation_logs" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_match_batches" TO "anon";
GRANT ALL ON TABLE "public"."schedule_match_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_match_batches" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_match_proposals" TO "anon";
GRANT ALL ON TABLE "public"."schedule_match_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_match_proposals" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_regular_patterns" TO "anon";
GRANT ALL ON TABLE "public"."schedule_regular_patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_regular_patterns" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_time_slots" TO "anon";
GRANT ALL ON TABLE "public"."schedule_time_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_time_slots" TO "service_role";



GRANT ALL ON TABLE "public"."school_class_capacity" TO "anon";
GRANT ALL ON TABLE "public"."school_class_capacity" TO "authenticated";
GRANT ALL ON TABLE "public"."school_class_capacity" TO "service_role";



GRANT ALL ON TABLE "public"."school_monthly_metrics" TO "anon";
GRANT ALL ON TABLE "public"."school_monthly_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."school_monthly_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."schools" TO "anon";
GRANT ALL ON TABLE "public"."schools" TO "authenticated";
GRANT ALL ON TABLE "public"."schools" TO "service_role";



GRANT ALL ON TABLE "public"."seasonal_course_applications" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_course_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_course_applications" TO "service_role";



GRANT ALL ON TABLE "public"."seasonal_course_curriculum" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_course_curriculum" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_course_curriculum" TO "service_role";



GRANT ALL ON TABLE "public"."seasonal_course_textbooks" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_course_textbooks" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_course_textbooks" TO "service_role";



GRANT ALL ON TABLE "public"."seasonal_courses" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_courses" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_courses" TO "service_role";



GRANT ALL ON TABLE "public"."seasonal_proposal_units" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_proposal_units" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_proposal_units" TO "service_role";



GRANT ALL ON TABLE "public"."seasonal_proposals" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_proposals" TO "service_role";



GRANT ALL ON TABLE "public"."seasonal_shift_settings" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_shift_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_shift_settings" TO "service_role";



GRANT ALL ON TABLE "public"."seasonal_shift_slot_settings" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_shift_slot_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_shift_slot_settings" TO "service_role";



GRANT ALL ON TABLE "public"."seasonal_shift_student_submission_slots" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_shift_student_submission_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_shift_student_submission_slots" TO "service_role";



GRANT ALL ON TABLE "public"."seasonal_shift_student_submissions" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_shift_student_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_shift_student_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."seasonal_shift_submission_slots" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_shift_submission_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_shift_submission_slots" TO "service_role";



GRANT ALL ON TABLE "public"."seasonal_shift_submissions" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_shift_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_shift_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."student_applications" TO "anon";
GRANT ALL ON TABLE "public"."student_applications" TO "authenticated";
GRANT ALL ON TABLE "public"."student_applications" TO "service_role";



GRANT ALL ON TABLE "public"."student_billings" TO "anon";
GRANT ALL ON TABLE "public"."student_billings" TO "authenticated";
GRANT ALL ON TABLE "public"."student_billings" TO "service_role";



GRANT ALL ON TABLE "public"."student_interviews" TO "anon";
GRANT ALL ON TABLE "public"."student_interviews" TO "authenticated";
GRANT ALL ON TABLE "public"."student_interviews" TO "service_role";



GRANT ALL ON TABLE "public"."student_logs" TO "anon";
GRANT ALL ON TABLE "public"."student_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."student_logs" TO "service_role";



GRANT ALL ON TABLE "public"."student_progress" TO "anon";
GRANT ALL ON TABLE "public"."student_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."student_progress" TO "service_role";



GRANT ALL ON TABLE "public"."student_progress_lessons" TO "anon";
GRANT ALL ON TABLE "public"."student_progress_lessons" TO "authenticated";
GRANT ALL ON TABLE "public"."student_progress_lessons" TO "service_role";



GRANT ALL ON TABLE "public"."student_subjects" TO "anon";
GRANT ALL ON TABLE "public"."student_subjects" TO "authenticated";
GRANT ALL ON TABLE "public"."student_subjects" TO "service_role";



GRANT ALL ON TABLE "public"."student_textbook_exam_ranges" TO "anon";
GRANT ALL ON TABLE "public"."student_textbook_exam_ranges" TO "authenticated";
GRANT ALL ON TABLE "public"."student_textbook_exam_ranges" TO "service_role";



GRANT ALL ON TABLE "public"."student_textbook_exams" TO "anon";
GRANT ALL ON TABLE "public"."student_textbook_exams" TO "authenticated";
GRANT ALL ON TABLE "public"."student_textbook_exams" TO "service_role";



GRANT ALL ON TABLE "public"."student_textbook_settings" TO "anon";
GRANT ALL ON TABLE "public"."student_textbook_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."student_textbook_settings" TO "service_role";



GRANT ALL ON TABLE "public"."student_textbooks" TO "anon";
GRANT ALL ON TABLE "public"."student_textbooks" TO "authenticated";
GRANT ALL ON TABLE "public"."student_textbooks" TO "service_role";



GRANT ALL ON TABLE "public"."students" TO "anon";
GRANT ALL ON TABLE "public"."students" TO "authenticated";
GRANT ALL ON TABLE "public"."students" TO "service_role";



GRANT ALL ON TABLE "public"."subjects" TO "anon";
GRANT ALL ON TABLE "public"."subjects" TO "authenticated";
GRANT ALL ON TABLE "public"."subjects" TO "service_role";



GRANT ALL ON TABLE "public"."system_settings" TO "anon";
GRANT ALL ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_absences" TO "anon";
GRANT ALL ON TABLE "public"."teacher_absences" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_absences" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_availability_periods" TO "anon";
GRANT ALL ON TABLE "public"."teacher_availability_periods" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_availability_periods" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_badge_assignments" TO "anon";
GRANT ALL ON TABLE "public"."teacher_badge_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_badge_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_badges" TO "anon";
GRANT ALL ON TABLE "public"."teacher_badges" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_badges" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_trainings" TO "anon";
GRANT ALL ON TABLE "public"."teacher_trainings" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_trainings" TO "service_role";



GRANT ALL ON TABLE "public"."test_prep_proposal_subjects" TO "anon";
GRANT ALL ON TABLE "public"."test_prep_proposal_subjects" TO "authenticated";
GRANT ALL ON TABLE "public"."test_prep_proposal_subjects" TO "service_role";



GRANT ALL ON TABLE "public"."test_prep_proposal_units" TO "anon";
GRANT ALL ON TABLE "public"."test_prep_proposal_units" TO "authenticated";
GRANT ALL ON TABLE "public"."test_prep_proposal_units" TO "service_role";



GRANT ALL ON TABLE "public"."test_prep_proposals" TO "anon";
GRANT ALL ON TABLE "public"."test_prep_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."test_prep_proposals" TO "service_role";



GRANT ALL ON TABLE "public"."textbooks" TO "anon";
GRANT ALL ON TABLE "public"."textbooks" TO "authenticated";
GRANT ALL ON TABLE "public"."textbooks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."textbooks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."textbooks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."textbooks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."training_masters" TO "anon";
GRANT ALL ON TABLE "public"."training_masters" TO "authenticated";
GRANT ALL ON TABLE "public"."training_masters" TO "service_role";



GRANT ALL ON TABLE "public"."transfer_notifications" TO "anon";
GRANT ALL ON TABLE "public"."transfer_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."transfer_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."user_invitations" TO "anon";
GRANT ALL ON TABLE "public"."user_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."user_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."user_schools" TO "anon";
GRANT ALL ON TABLE "public"."user_schools" TO "authenticated";
GRANT ALL ON TABLE "public"."user_schools" TO "service_role";



GRANT ALL ON TABLE "public"."user_textbook_favorites" TO "anon";
GRANT ALL ON TABLE "public"."user_textbook_favorites" TO "authenticated";
GRANT ALL ON TABLE "public"."user_textbook_favorites" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







