-- ============================================================
-- BASE SCHEMA (本番DBからdump - ローカル開発/テスト用)
-- ============================================================
-- supabase db dump --linked --schema public で生成。
-- 本番環境には push しないこと（本番に既に適用済み）。
-- 再生成: supabase db dump --linked --schema public -f <ここ>
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
  -- セキュリティ定義関数内ではRLSをバイパスして直接取得
  SELECT role INTO user_role
  FROM user_profiles
  WHERE id = auth.uid();
  
  -- adminは全アクセス可
  IF user_role = 'admin' THEN
    RETURN TRUE;
  END IF;
  
  -- それ以外は自分の教室の生徒のみ
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


CREATE OR REPLACE FUNCTION "public"."update_attendance_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_attendance_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_google_calendar_tokens_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_google_calendar_tokens_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_schools_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_schools_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


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
    CONSTRAINT "attendance_sheets_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'submitted'::character varying, 'approved'::character varying, 'rejected'::character varying])::"text"[])))
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
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."bulletin_posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bulletin_reads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "read_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."bulletin_reads" OWNER TO "postgres";


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
    CONSTRAINT "course_prep_progress_items_auto_source_check" CHECK (("auto_source" = ANY (ARRAY['regular_weekly'::"text", 'course_sessions'::"text", 'proposed_extra'::"text", 'subject_proposal'::"text"]))),
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


CREATE TABLE IF NOT EXISTS "public"."koushu_enrollments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "koma_count" integer DEFAULT 0 NOT NULL,
    "subject_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."koushu_enrollments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."material_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "material_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'unconfirmed'::"text" NOT NULL,
    "ordered_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "distributed_at" timestamp with time zone,
    "notes" "text",
    "created_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
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
    CONSTRAINT "regular_shift_settings_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."regular_shift_settings" OWNER TO "postgres";


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
    "seat_chart_entered" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."regular_shift_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedule_closed_days" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid",
    "closed_date" "date" NOT NULL,
    "reason" "text",
    "is_global" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."schedule_closed_days" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedule_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "entry_date" "date" NOT NULL,
    "time_slot_id" "uuid" NOT NULL,
    "teacher_id" "uuid" NOT NULL,
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
    CONSTRAINT "schedule_entries_attendance_status_check" CHECK ((("attendance_status" IS NULL) OR ("attendance_status" = ANY (ARRAY['present'::"text", 'absent'::"text", 'late'::"text"])))),
    CONSTRAINT "schedule_entries_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'completed'::"text", 'cancelled'::"text", 'transferred_out'::"text", 'transferred_in'::"text"])))
);


ALTER TABLE "public"."schedule_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedule_generation_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "school_id" "uuid" NOT NULL,
    "week_start_date" "date" NOT NULL,
    "entries_created" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."schedule_generation_logs" OWNER TO "postgres";


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
    CONSTRAINT "schedule_regular_patterns_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6))),
    CONSTRAINT "schedule_regular_patterns_period_type_check" CHECK (("period_type" = ANY (ARRAY['regular'::"text", 'spring'::"text", 'summer'::"text", 'winter'::"text"])))
);


ALTER TABLE "public"."schedule_regular_patterns" OWNER TO "postgres";


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
    CONSTRAINT "schedule_time_slots_slot_number_check" CHECK ((("slot_number" >= 1) AND ("slot_number" <= 7)))
);


ALTER TABLE "public"."schedule_time_slots" OWNER TO "postgres";


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
    "slack_mention_id" "text"
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
    "seat_chart_entered" boolean DEFAULT false NOT NULL
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
    "teacher_name" "text"
);


ALTER TABLE "public"."student_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_progress_lessons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_progress_id" "uuid" NOT NULL,
    "lesson_number" integer NOT NULL,
    "lesson_date" "date",
    "teacher_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
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
    CONSTRAINT "students_grade_check" CHECK ((("grade" >= 1) AND ("grade" <= 13))),
    CONSTRAINT "students_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'inactive'::character varying, 'withdrawn'::character varying])::"text"[])))
);


ALTER TABLE "public"."students" OWNER TO "postgres";


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
    CONSTRAINT "user_profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text", 'teacher'::"text", 'parent'::"text"])))
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_profiles"."teachable_subject_ids" IS '指導可能な科目IDの配列（空の場合は全科目可）';



COMMENT ON COLUMN "public"."user_profiles"."available_days_of_week" IS '出勤可能曜日 0=日,1=月,...,6=土（空の場合は全曜日）';



COMMENT ON COLUMN "public"."user_profiles"."default_school_id" IS '複数教室権限があるときのデフォルト教室（ログイン時の初期選択）';



COMMENT ON COLUMN "public"."user_profiles"."available_slot_numbers_by_day" IS '曜日ごとの出勤可能コマ番号。キー "0"〜"6"、値は 1〜7 の配列。空または未設定は全コマ可';



CREATE TABLE IF NOT EXISTS "public"."user_schools" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "school_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_schools" OWNER TO "postgres";


ALTER TABLE ONLY "public"."curriculum_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."curriculum_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."textbooks" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."textbooks_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alert_dismissals"
    ADD CONSTRAINT "alert_dismissals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alert_dismissals"
    ADD CONSTRAINT "alert_dismissals_school_id_student_id_alert_type_alert_key_key" UNIQUE ("school_id", "student_id", "alert_type", "alert_key");



ALTER TABLE ONLY "public"."application_items"
    ADD CONSTRAINT "application_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assessment_scores"
    ADD CONSTRAINT "assessment_scores_assessment_id_subject_key" UNIQUE ("assessment_id", "subject");



ALTER TABLE ONLY "public"."assessment_scores"
    ADD CONSTRAINT "assessment_scores_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."koushu_enrollments"
    ADD CONSTRAINT "koushu_enrollments_course_id_student_id_key" UNIQUE ("course_id", "student_id");



ALTER TABLE ONLY "public"."koushu_enrollments"
    ADD CONSTRAINT "koushu_enrollments_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."portal_menu"
    ADD CONSTRAINT "portal_menu_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portal_menu"
    ADD CONSTRAINT "portal_menu_school_id_menu_key_key" UNIQUE ("school_id", "menu_key");



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



ALTER TABLE ONLY "public"."schedule_closed_days"
    ADD CONSTRAINT "schedule_closed_days_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_entries"
    ADD CONSTRAINT "schedule_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_entries"
    ADD CONSTRAINT "schedule_entries_school_id_entry_date_time_slot_id_teacher__key" UNIQUE ("school_id", "entry_date", "time_slot_id", "teacher_id", "student_id");



ALTER TABLE ONLY "public"."schedule_generation_logs"
    ADD CONSTRAINT "schedule_generation_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_regular_patterns"
    ADD CONSTRAINT "schedule_regular_patterns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_time_slots"
    ADD CONSTRAINT "schedule_time_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_time_slots"
    ADD CONSTRAINT "schedule_time_slots_school_id_slot_number_key" UNIQUE ("school_id", "slot_number");



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



ALTER TABLE ONLY "public"."seasonal_shift_settings"
    ADD CONSTRAINT "seasonal_shift_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_shift_slot_settings"
    ADD CONSTRAINT "seasonal_shift_slot_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seasonal_shift_slot_settings"
    ADD CONSTRAINT "seasonal_shift_slot_settings_setting_id_slot_date_time_slot_key" UNIQUE ("setting_id", "slot_date", "time_slot");



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



ALTER TABLE ONLY "public"."textbooks"
    ADD CONSTRAINT "textbooks_pkey" PRIMARY KEY ("id");



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



CREATE INDEX "idx_admin_audit_logs_action" ON "public"."admin_audit_logs" USING "btree" ("action", "created_at" DESC);



CREATE INDEX "idx_admin_audit_logs_actor" ON "public"."admin_audit_logs" USING "btree" ("actor_id", "created_at" DESC);



CREATE INDEX "idx_admin_audit_logs_target" ON "public"."admin_audit_logs" USING "btree" ("target_id", "created_at" DESC);



CREATE INDEX "idx_alert_dismissals_school_student" ON "public"."alert_dismissals" USING "btree" ("school_id", "student_id");



CREATE INDEX "idx_application_items_is_hidden" ON "public"."application_items" USING "btree" ("is_hidden");



CREATE INDEX "idx_application_items_school_id" ON "public"."application_items" USING "btree" ("school_id", "is_active", "sort_order");



CREATE INDEX "idx_assessment_scores_assessment_id" ON "public"."assessment_scores" USING "btree" ("assessment_id");



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



CREATE INDEX "idx_koushu_enrollments_course" ON "public"."koushu_enrollments" USING "btree" ("course_id");



CREATE INDEX "idx_koushu_enrollments_student" ON "public"."koushu_enrollments" USING "btree" ("student_id");



CREATE INDEX "idx_materials_school_active" ON "public"."materials" USING "btree" ("school_id", "is_active");



CREATE INDEX "idx_materials_school_id" ON "public"."materials" USING "btree" ("school_id");



CREATE INDEX "idx_monthly_task_checks_school" ON "public"."monthly_task_checks" USING "btree" ("school_id");



CREATE INDEX "idx_monthly_task_checks_task" ON "public"."monthly_task_checks" USING "btree" ("task_id");



CREATE INDEX "idx_monthly_tasks_linked" ON "public"."monthly_tasks" USING "btree" ("linked_schedule_task_id") WHERE ("linked_schedule_task_id" IS NOT NULL);



CREATE INDEX "idx_monthly_tasks_period" ON "public"."monthly_tasks" USING "btree" ("year", "month", "task_date", "sort_order");



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



CREATE INDEX "idx_regular_shift_settings_school_id" ON "public"."regular_shift_settings" USING "btree" ("school_id");



CREATE INDEX "idx_regular_shift_settings_status" ON "public"."regular_shift_settings" USING "btree" ("status");



CREATE INDEX "idx_regular_shift_slot_settings_setting" ON "public"."regular_shift_slot_settings" USING "btree" ("setting_id");



CREATE INDEX "idx_regular_shift_slots_submission_id" ON "public"."regular_shift_submission_slots" USING "btree" ("submission_id");



CREATE UNIQUE INDEX "idx_regular_shift_slots_unique" ON "public"."regular_shift_submission_slots" USING "btree" ("submission_id", "day_of_week", "time_slot");



CREATE INDEX "idx_regular_shift_submissions_edit_token" ON "public"."regular_shift_submissions" USING "btree" ("edit_token");



CREATE INDEX "idx_regular_shift_submissions_school_id" ON "public"."regular_shift_submissions" USING "btree" ("school_id");



CREATE INDEX "idx_regular_shift_submissions_setting_id" ON "public"."regular_shift_submissions" USING "btree" ("setting_id");



CREATE INDEX "idx_schedule_closed_days_date" ON "public"."schedule_closed_days" USING "btree" ("closed_date");



CREATE UNIQUE INDEX "idx_schedule_closed_days_global_date" ON "public"."schedule_closed_days" USING "btree" ("closed_date") WHERE ("school_id" IS NULL);



CREATE INDEX "idx_schedule_closed_days_school" ON "public"."schedule_closed_days" USING "btree" ("school_id");



CREATE UNIQUE INDEX "idx_schedule_closed_days_school_date" ON "public"."schedule_closed_days" USING "btree" ("school_id", "closed_date") WHERE ("school_id" IS NOT NULL);



CREATE INDEX "idx_schedule_entries_school_date" ON "public"."schedule_entries" USING "btree" ("school_id", "entry_date");



CREATE INDEX "idx_schedule_entries_status" ON "public"."schedule_entries" USING "btree" ("school_id", "entry_date", "status");



CREATE INDEX "idx_schedule_entries_teacher" ON "public"."schedule_entries" USING "btree" ("teacher_id", "entry_date");



CREATE INDEX "idx_schedule_entries_transfer" ON "public"."schedule_entries" USING "btree" ("transfer_from_id") WHERE ("transfer_from_id" IS NOT NULL);



CREATE INDEX "idx_schedule_generation_logs_school" ON "public"."schedule_generation_logs" USING "btree" ("school_id", "week_start_date");



CREATE INDEX "idx_schedule_regular_patterns_day_slot" ON "public"."schedule_regular_patterns" USING "btree" ("school_id", "day_of_week", "time_slot_id", "is_active");



CREATE INDEX "idx_schedule_regular_patterns_school" ON "public"."schedule_regular_patterns" USING "btree" ("school_id");



CREATE INDEX "idx_schedule_regular_patterns_student" ON "public"."schedule_regular_patterns" USING "btree" ("student_id");



CREATE INDEX "idx_schedule_regular_patterns_teacher" ON "public"."schedule_regular_patterns" USING "btree" ("teacher_id");



CREATE INDEX "idx_schedule_time_slots_school" ON "public"."schedule_time_slots" USING "btree" ("school_id", "is_active", "display_order");



CREATE INDEX "idx_seasonal_course_applications_course" ON "public"."seasonal_course_applications" USING "btree" ("course_id");



CREATE INDEX "idx_seasonal_course_applications_student" ON "public"."seasonal_course_applications" USING "btree" ("student_id");



CREATE INDEX "idx_seasonal_course_curriculum_course" ON "public"."seasonal_course_curriculum" USING "btree" ("course_id");



CREATE INDEX "idx_seasonal_course_textbooks_course" ON "public"."seasonal_course_textbooks" USING "btree" ("course_id");



CREATE INDEX "idx_seasonal_courses_school" ON "public"."seasonal_courses" USING "btree" ("school_id");



CREATE INDEX "idx_seasonal_courses_season" ON "public"."seasonal_courses" USING "btree" ("season");



CREATE INDEX "idx_seasonal_shift_settings_school_id" ON "public"."seasonal_shift_settings" USING "btree" ("school_id");



CREATE INDEX "idx_seasonal_shift_settings_status" ON "public"."seasonal_shift_settings" USING "btree" ("status");



CREATE INDEX "idx_seasonal_shift_slot_settings_setting" ON "public"."seasonal_shift_slot_settings" USING "btree" ("setting_id");



CREATE INDEX "idx_seasonal_shift_slots_submission_id" ON "public"."seasonal_shift_submission_slots" USING "btree" ("submission_id");



CREATE UNIQUE INDEX "idx_seasonal_shift_slots_unique" ON "public"."seasonal_shift_submission_slots" USING "btree" ("submission_id", "shift_date", "time_slot");



CREATE INDEX "idx_seasonal_shift_submissions_edit_token" ON "public"."seasonal_shift_submissions" USING "btree" ("edit_token");



CREATE INDEX "idx_seasonal_shift_submissions_school_id" ON "public"."seasonal_shift_submissions" USING "btree" ("school_id");



CREATE INDEX "idx_seasonal_shift_submissions_setting_id" ON "public"."seasonal_shift_submissions" USING "btree" ("setting_id");



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



CREATE INDEX "idx_student_textbook_exams_exam_date" ON "public"."student_textbook_exams" USING "btree" ("exam_date");



CREATE INDEX "idx_student_textbook_exams_student_textbook_id" ON "public"."student_textbook_exams" USING "btree" ("student_textbook_id");



CREATE INDEX "idx_student_textbooks_is_draft" ON "public"."student_textbooks" USING "btree" ("is_draft");



CREATE INDEX "idx_student_textbooks_school_id" ON "public"."student_textbooks" USING "btree" ("school_id");



CREATE INDEX "idx_student_textbooks_season" ON "public"."student_textbooks" USING "btree" ("season") WHERE ("season" IS NOT NULL);



CREATE INDEX "idx_student_textbooks_sort_order" ON "public"."student_textbooks" USING "btree" ("student_id", "sort_order");



CREATE INDEX "idx_student_textbooks_student_id" ON "public"."student_textbooks" USING "btree" ("student_id", "is_active");



CREATE INDEX "idx_student_textbooks_textbook_id" ON "public"."student_textbooks" USING "btree" ("textbook_id");



CREATE INDEX "idx_students_grade" ON "public"."students" USING "btree" ("grade");



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



CREATE INDEX "idx_textbooks_grade" ON "public"."textbooks" USING "btree" ("grade");



CREATE INDEX "idx_textbooks_grade_category" ON "public"."textbooks" USING "btree" ("grade_category") WHERE ("grade_category" IS NOT NULL);



CREATE INDEX "idx_textbooks_subject" ON "public"."textbooks" USING "btree" ("subject");



CREATE INDEX "idx_user_invitations_email" ON "public"."user_invitations" USING "btree" ("email");



CREATE INDEX "idx_user_invitations_token" ON "public"."user_invitations" USING "btree" ("token");



CREATE INDEX "idx_user_profiles_email" ON "public"."user_profiles" USING "btree" ("email");



CREATE INDEX "idx_user_profiles_role" ON "public"."user_profiles" USING "btree" ("role");



CREATE INDEX "idx_user_schools_school" ON "public"."user_schools" USING "btree" ("school_id");



CREATE INDEX "idx_user_schools_user" ON "public"."user_schools" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "send-form-notification" AFTER INSERT ON "public"."form_responses" FOR EACH ROW EXECUTE FUNCTION "supabase_functions"."http_request"('https://mzxysqkuuxcfffwlfsvj.supabase.co/functions/v1/send-form-notification', 'POST', '{"Content-type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16eHlzcWt1dXhjZmZmd2xmc3ZqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Nzc4NDkwMiwiZXhwIjoyMDgzMzYwOTAyfQ.n46O2j60kj475qyh55WDmPFcx0mygIbKSvzYa2fFoAE"}', '{}', '5000');



CREATE OR REPLACE TRIGGER "trigger_update_google_calendar_tokens_updated_at" BEFORE UPDATE ON "public"."google_calendar_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."update_google_calendar_tokens_updated_at"();



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



CREATE OR REPLACE TRIGGER "update_embed_tokens_updated_at" BEFORE UPDATE ON "public"."embed_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_exam_types_updated_at" BEFORE UPDATE ON "public"."exam_types" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_form_periods_updated_at" BEFORE UPDATE ON "public"."form_periods" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_form_responses_updated_at" BEFORE UPDATE ON "public"."form_responses" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_form_templates_updated_at" BEFORE UPDATE ON "public"."form_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_forms_updated_at" BEFORE UPDATE ON "public"."forms" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_material_orders_updated_at" BEFORE UPDATE ON "public"."material_orders" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_materials_updated_at" BEFORE UPDATE ON "public"."materials" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_portal_menu_updated_at" BEFORE UPDATE ON "public"."portal_menu" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_regular_shift_settings_updated_at" BEFORE UPDATE ON "public"."regular_shift_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_regular_shift_submissions_updated_at" BEFORE UPDATE ON "public"."regular_shift_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_schedule_entries_updated_at" BEFORE UPDATE ON "public"."schedule_entries" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_schedule_regular_patterns_updated_at" BEFORE UPDATE ON "public"."schedule_regular_patterns" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_schedule_time_slots_updated_at" BEFORE UPDATE ON "public"."schedule_time_slots" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_schools_updated_at" BEFORE UPDATE ON "public"."schools" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_seasonal_shift_settings_updated_at" BEFORE UPDATE ON "public"."seasonal_shift_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_seasonal_shift_submissions_updated_at" BEFORE UPDATE ON "public"."seasonal_shift_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_applications_updated_at" BEFORE UPDATE ON "public"."student_applications" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_billings_updated_at" BEFORE UPDATE ON "public"."student_billings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_progress_updated_at" BEFORE UPDATE ON "public"."student_progress" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_textbook_exams_updated_at" BEFORE UPDATE ON "public"."student_textbook_exams" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_textbook_settings_updated_at" BEFORE UPDATE ON "public"."student_textbook_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_student_textbooks_updated_at" BEFORE UPDATE ON "public"."student_textbooks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_students_updated_at" BEFORE UPDATE ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_textbooks_updated_at" BEFORE UPDATE ON "public"."textbooks" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_profiles_updated_at" BEFORE UPDATE ON "public"."user_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."alert_dismissals"
    ADD CONSTRAINT "alert_dismissals_dismissed_by_fkey" FOREIGN KEY ("dismissed_by") REFERENCES "public"."user_profiles"("id");



ALTER TABLE ONLY "public"."alert_dismissals"
    ADD CONSTRAINT "alert_dismissals_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."alert_dismissals"
    ADD CONSTRAINT "alert_dismissals_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."application_items"
    ADD CONSTRAINT "application_items_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."assessment_scores"
    ADD CONSTRAINT "assessment_scores_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."koushu_enrollments"
    ADD CONSTRAINT "koushu_enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."seasonal_courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."koushu_enrollments"
    ADD CONSTRAINT "koushu_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."portal_menu"
    ADD CONSTRAINT "portal_menu_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."schedule_closed_days"
    ADD CONSTRAINT "schedule_closed_days_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."seasonal_shift_settings"
    ADD CONSTRAINT "seasonal_shift_settings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_shift_slot_settings"
    ADD CONSTRAINT "seasonal_shift_slot_settings_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "public"."seasonal_shift_settings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_shift_submission_slots"
    ADD CONSTRAINT "seasonal_shift_submission_slots_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."seasonal_shift_submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_shift_submissions"
    ADD CONSTRAINT "seasonal_shift_submissions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seasonal_shift_submissions"
    ADD CONSTRAINT "seasonal_shift_submissions_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "public"."seasonal_shift_settings"("id") ON DELETE CASCADE;



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
    ADD CONSTRAINT "student_progress_lessons_student_progress_id_fkey" FOREIGN KEY ("student_progress_id") REFERENCES "public"."student_progress"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_progress"
    ADD CONSTRAINT "student_progress_student_textbook_id_fkey" FOREIGN KEY ("student_textbook_id") REFERENCES "public"."student_textbooks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_subjects"
    ADD CONSTRAINT "student_subjects_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_subjects"
    ADD CONSTRAINT "student_subjects_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE CASCADE;



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



CREATE POLICY "Admins can insert profiles" ON "public"."user_profiles" FOR INSERT WITH CHECK (("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."user_profiles" "user_profiles_1")))));



CREATE POLICY "Admins can manage invitations" ON "public"."user_invitations" USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "Admins can manage user_schools" ON "public"."user_schools" USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "Admins can update all profiles" ON "public"."user_profiles" FOR UPDATE USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "Admins can view all profiles" ON "public"."user_profiles" FOR SELECT USING ("public"."check_user_role"(ARRAY['admin'::"text", 'owner'::"text", 'manager'::"text"]));



CREATE POLICY "Allow all for anon" ON "public"."assessment_scores" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."assessments" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."schools" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."student_logs" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."student_subjects" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."students" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for anon" ON "public"."subjects" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for attendance_notes" ON "public"."attendance_notes" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for attendance_records" ON "public"."attendance_records" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for attendance_sheets" ON "public"."attendance_sheets" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for attendance_types" ON "public"."attendance_types" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated users" ON "public"."assessment_scores" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated users" ON "public"."assessments" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated users" ON "public"."schools" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated users" ON "public"."student_logs" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated users" ON "public"."student_subjects" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated users" ON "public"."students" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow all for authenticated users" ON "public"."subjects" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Anyone can view active teachers for attendance portal" ON "public"."user_profiles" FOR SELECT USING ((("role" = 'teacher'::"text") AND ("is_active" = true)));



CREATE POLICY "Anyone can view invitations by token" ON "public"."user_invitations" FOR SELECT USING (true);



CREATE POLICY "Anyone can view user_schools for attendance portal" ON "public"."user_schools" FOR SELECT USING (true);



CREATE POLICY "Enable all access for all users" ON "public"."student_interviews" USING (true) WITH CHECK (true);



CREATE POLICY "Enable all for seasonal_course_applications" ON "public"."seasonal_course_applications" USING (true);



CREATE POLICY "Enable all for seasonal_course_curriculum" ON "public"."seasonal_course_curriculum" USING (true);



CREATE POLICY "Enable all for seasonal_course_textbooks" ON "public"."seasonal_course_textbooks" USING (true);



CREATE POLICY "Enable all for seasonal_courses" ON "public"."seasonal_courses" USING (true);



CREATE POLICY "Users can access students in their schools" ON "public"."students" USING ("public"."check_student_access"("school_id"));



CREATE POLICY "Users can access their schools" ON "public"."schools" USING ("public"."check_school_access"("id"));



CREATE POLICY "Users can delete own tokens" ON "public"."google_calendar_tokens" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own tokens" ON "public"."google_calendar_tokens" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."user_profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own tokens" ON "public"."google_calendar_tokens" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own profile" ON "public"."user_profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own schools" ON "public"."user_schools" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own tokens" ON "public"."google_calendar_tokens" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."admin_audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_audit_logs_auth_insert" ON "public"."admin_audit_logs" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "admin_audit_logs_auth_select" ON "public"."admin_audit_logs" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."alert_dismissals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "alert_dismissals_allow_all_auth" ON "public"."alert_dismissals" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "allow_anon_select" ON "public"."curriculum_items" FOR SELECT TO "anon" USING (true);



CREATE POLICY "allow_anon_select" ON "public"."textbooks" FOR SELECT TO "anon" USING (true);



ALTER TABLE "public"."application_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "application_items_allow_all_auth" ON "public"."application_items" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."assessment_scores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assessment_scores_allow_all_auth" ON "public"."assessment_scores" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."assessments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assessments_allow_all_auth" ON "public"."assessments" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."attendance_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attendance_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attendance_sheets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attendance_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "authenticated users can manage koushu_enrollments" ON "public"."koushu_enrollments" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated users can manage overrides" ON "public"."monthly_task_overrides" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."billing_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_items_allow_all_auth" ON "public"."billing_items" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."billing_periods" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_periods_allow_all_auth" ON "public"."billing_periods" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."bulletin_labels" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bulletin_labels_allow_all_auth" ON "public"."bulletin_labels" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."bulletin_posts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bulletin_posts_allow_all_auth" ON "public"."bulletin_posts" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."bulletin_reads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bulletin_reads_allow_all_auth" ON "public"."bulletin_reads" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."course_prep_periods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_prep_progress_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_prep_schedule_markers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_prep_schedule_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_prep_student_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_prep_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."curriculum_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "curriculum_items_allow_all_auth" ON "public"."curriculum_items" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."embed_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "embed_tokens_delete" ON "public"."embed_tokens" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "embed_tokens_insert" ON "public"."embed_tokens" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "embed_tokens_select" ON "public"."embed_tokens" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "embed_tokens_update" ON "public"."embed_tokens" FOR UPDATE TO "authenticated" USING (true);



ALTER TABLE "public"."exam_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "exam_types_allow_all_auth" ON "public"."exam_types" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."form_fields" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_fields_allow_all_anon" ON "public"."form_fields" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "form_fields_allow_all_auth" ON "public"."form_fields" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."form_periods" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_periods_allow_all_auth" ON "public"."form_periods" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "form_periods_allow_select_anon" ON "public"."form_periods" FOR SELECT TO "anon" USING (((("is_archived" IS NULL) OR ("is_archived" = false)) AND (("publish_start" IS NULL) OR ("publish_start" <= "now"())) AND (("publish_end" IS NULL) OR ("publish_end" >= "now"()))));



ALTER TABLE "public"."form_responses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_responses_allow_all_auth" ON "public"."form_responses" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."form_template_fields" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_template_fields_allow_all_anon" ON "public"."form_template_fields" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "form_template_fields_allow_all_auth" ON "public"."form_template_fields" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."form_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_templates_allow_all_anon" ON "public"."form_templates" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "form_templates_allow_all_auth" ON "public"."form_templates" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."forms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "forms_allow_all_anon" ON "public"."forms" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "forms_allow_all_auth" ON "public"."forms" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."google_calendar_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."koushu_enrollments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."material_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."material_stock_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."materials" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "materials_allow_all_auth" ON "public"."materials" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."monthly_task_checks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "monthly_task_checks_delete" ON "public"."monthly_task_checks" FOR DELETE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "monthly_task_checks_insert" ON "public"."monthly_task_checks" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "monthly_task_checks_select" ON "public"."monthly_task_checks" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "monthly_task_checks_update" ON "public"."monthly_task_checks" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."monthly_task_overrides" ENABLE ROW LEVEL SECURITY;


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



CREATE POLICY "orders_allow_all_auth" ON "public"."material_orders" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."portal_menu" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "portal_menu_allow_all_auth" ON "public"."portal_menu" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "portal_menu_anon_select" ON "public"."portal_menu" FOR SELECT TO "anon" USING (("is_visible" = true));



CREATE POLICY "prep_items_delete" ON "public"."course_prep_progress_items" FOR DELETE USING (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_items_insert" ON "public"."course_prep_progress_items" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_items_select" ON "public"."course_prep_progress_items" FOR SELECT USING (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_items_update" ON "public"."course_prep_progress_items" FOR UPDATE USING (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_markers_delete" ON "public"."course_prep_schedule_markers" FOR DELETE USING (("task_id" IN ( SELECT "course_prep_schedule_tasks"."id"
   FROM "public"."course_prep_schedule_tasks"
  WHERE ("course_prep_schedule_tasks"."school_id" IN ( SELECT "user_schools"."school_id"
           FROM "public"."user_schools"
          WHERE ("user_schools"."user_id" = "auth"."uid"()))))));



CREATE POLICY "prep_markers_insert" ON "public"."course_prep_schedule_markers" FOR INSERT WITH CHECK (("task_id" IN ( SELECT "course_prep_schedule_tasks"."id"
   FROM "public"."course_prep_schedule_tasks"
  WHERE ("course_prep_schedule_tasks"."school_id" IN ( SELECT "user_schools"."school_id"
           FROM "public"."user_schools"
          WHERE ("user_schools"."user_id" = "auth"."uid"()))))));



CREATE POLICY "prep_markers_select" ON "public"."course_prep_schedule_markers" FOR SELECT USING (("task_id" IN ( SELECT "course_prep_schedule_tasks"."id"
   FROM "public"."course_prep_schedule_tasks"
  WHERE ("course_prep_schedule_tasks"."school_id" IN ( SELECT "user_schools"."school_id"
           FROM "public"."user_schools"
          WHERE ("user_schools"."user_id" = "auth"."uid"()))))));



CREATE POLICY "prep_markers_update" ON "public"."course_prep_schedule_markers" FOR UPDATE USING (("task_id" IN ( SELECT "course_prep_schedule_tasks"."id"
   FROM "public"."course_prep_schedule_tasks"
  WHERE ("course_prep_schedule_tasks"."school_id" IN ( SELECT "user_schools"."school_id"
           FROM "public"."user_schools"
          WHERE ("user_schools"."user_id" = "auth"."uid"()))))));



CREATE POLICY "prep_periods_delete" ON "public"."course_prep_periods" FOR DELETE USING (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_periods_insert" ON "public"."course_prep_periods" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_periods_select" ON "public"."course_prep_periods" FOR SELECT USING (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_periods_update" ON "public"."course_prep_periods" FOR UPDATE USING (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_student_delete" ON "public"."course_prep_student_progress" FOR DELETE USING (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_student_insert" ON "public"."course_prep_student_progress" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_student_select" ON "public"."course_prep_student_progress" FOR SELECT USING (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_student_update" ON "public"."course_prep_student_progress" FOR UPDATE USING (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_tasks_delete" ON "public"."course_prep_schedule_tasks" FOR DELETE USING (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_tasks_insert" ON "public"."course_prep_schedule_tasks" FOR INSERT WITH CHECK (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_tasks_select" ON "public"."course_prep_schedule_tasks" FOR SELECT USING (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_tasks_update" ON "public"."course_prep_schedule_tasks" FOR UPDATE USING (("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"()))));



CREATE POLICY "prep_templates_delete" ON "public"."course_prep_templates" FOR DELETE USING ((("school_id" IS NULL) OR ("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"())))));



CREATE POLICY "prep_templates_insert" ON "public"."course_prep_templates" FOR INSERT WITH CHECK ((("school_id" IS NULL) OR ("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"())))));



CREATE POLICY "prep_templates_select" ON "public"."course_prep_templates" FOR SELECT USING ((("school_id" IS NULL) OR ("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"())))));



CREATE POLICY "prep_templates_update" ON "public"."course_prep_templates" FOR UPDATE USING ((("school_id" IS NULL) OR ("school_id" IN ( SELECT "user_schools"."school_id"
   FROM "public"."user_schools"
  WHERE ("user_schools"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."regular_shift_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "regular_shift_settings_anon_select_published" ON "public"."regular_shift_settings" FOR SELECT TO "anon" USING (("status" = 'published'::"text"));



CREATE POLICY "regular_shift_settings_auth" ON "public"."regular_shift_settings" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."regular_shift_slot_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "regular_shift_slot_settings_anon_select" ON "public"."regular_shift_slot_settings" FOR SELECT TO "anon" USING (true);



CREATE POLICY "regular_shift_slot_settings_auth" ON "public"."regular_shift_slot_settings" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "regular_shift_slots_anon_delete" ON "public"."regular_shift_submission_slots" FOR DELETE TO "anon" USING (true);



CREATE POLICY "regular_shift_slots_anon_insert" ON "public"."regular_shift_submission_slots" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "regular_shift_slots_anon_select" ON "public"."regular_shift_submission_slots" FOR SELECT TO "anon" USING (true);



CREATE POLICY "regular_shift_slots_anon_update" ON "public"."regular_shift_submission_slots" FOR UPDATE TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "regular_shift_slots_auth" ON "public"."regular_shift_submission_slots" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."regular_shift_submission_slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."regular_shift_submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "regular_shift_submissions_anon_insert" ON "public"."regular_shift_submissions" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "regular_shift_submissions_anon_select" ON "public"."regular_shift_submissions" FOR SELECT TO "anon" USING (true);



CREATE POLICY "regular_shift_submissions_anon_update" ON "public"."regular_shift_submissions" FOR UPDATE TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "regular_shift_submissions_auth" ON "public"."regular_shift_submissions" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."schedule_closed_days" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_closed_days_allow_all_auth" ON "public"."schedule_closed_days" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."schedule_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_entries_allow_all_auth" ON "public"."schedule_entries" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."schedule_generation_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_generation_logs_allow_all_auth" ON "public"."schedule_generation_logs" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."schedule_regular_patterns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_regular_patterns_allow_all_auth" ON "public"."schedule_regular_patterns" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."schedule_time_slots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_time_slots_allow_all_auth" ON "public"."schedule_time_slots" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."schools" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schools_allow_all_auth" ON "public"."schools" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "schools_anon_select" ON "public"."schools" FOR SELECT TO "anon" USING (true);



ALTER TABLE "public"."seasonal_course_applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seasonal_course_curriculum" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seasonal_course_textbooks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seasonal_courses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seasonal_shift_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_shift_settings_anon_select_published" ON "public"."seasonal_shift_settings" FOR SELECT TO "anon" USING (("status" = 'published'::"text"));



CREATE POLICY "seasonal_shift_settings_auth" ON "public"."seasonal_shift_settings" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."seasonal_shift_slot_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_shift_slot_settings_anon_select" ON "public"."seasonal_shift_slot_settings" FOR SELECT TO "anon" USING (true);



CREATE POLICY "seasonal_shift_slot_settings_auth" ON "public"."seasonal_shift_slot_settings" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "seasonal_shift_slots_auth" ON "public"."seasonal_shift_submission_slots" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."seasonal_shift_submission_slots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seasonal_shift_submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasonal_shift_submissions_auth" ON "public"."seasonal_shift_submissions" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "stock_txns_allow_all_auth" ON "public"."material_stock_transactions" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."student_applications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_applications_allow_all_auth" ON "public"."student_applications" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."student_billings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_billings_allow_all_auth" ON "public"."student_billings" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."student_interviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_logs_allow_all_auth" ON "public"."student_logs" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "student_logs_insert_authenticated" ON "public"."student_logs" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "student_logs_select_authenticated" ON "public"."student_logs" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."student_progress" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_progress_allow_all_auth" ON "public"."student_progress" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."student_progress_lessons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_progress_lessons_allow_all_auth" ON "public"."student_progress_lessons" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."student_subjects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_subjects_allow_all_auth" ON "public"."student_subjects" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."student_textbook_exams" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_textbook_exams_allow_all_auth" ON "public"."student_textbook_exams" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."student_textbook_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_textbook_settings_allow_all_auth" ON "public"."student_textbook_settings" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."student_textbooks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_textbooks_allow_all_auth" ON "public"."student_textbooks" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."students" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "students_allow_all_auth" ON "public"."students" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."subjects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subjects_allow_all_auth" ON "public"."subjects" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "subjects_anon_select" ON "public"."subjects" FOR SELECT TO "anon" USING (true);



ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_settings_allow_all_anon" ON "public"."system_settings" TO "anon" USING (true) WITH CHECK (true);



CREATE POLICY "system_settings_allow_all_auth" ON "public"."system_settings" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "system_settings_anon_select" ON "public"."system_settings" FOR SELECT TO "anon" USING (true);



ALTER TABLE "public"."textbooks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "textbooks_allow_all_auth" ON "public"."textbooks" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."user_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_schools" ENABLE ROW LEVEL SECURITY;


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



GRANT ALL ON TABLE "public"."admin_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."admin_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."alert_dismissals" TO "anon";
GRANT ALL ON TABLE "public"."alert_dismissals" TO "authenticated";
GRANT ALL ON TABLE "public"."alert_dismissals" TO "service_role";



GRANT ALL ON TABLE "public"."application_items" TO "anon";
GRANT ALL ON TABLE "public"."application_items" TO "authenticated";
GRANT ALL ON TABLE "public"."application_items" TO "service_role";



GRANT ALL ON TABLE "public"."assessment_scores" TO "anon";
GRANT ALL ON TABLE "public"."assessment_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."assessment_scores" TO "service_role";



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



GRANT ALL ON TABLE "public"."koushu_enrollments" TO "anon";
GRANT ALL ON TABLE "public"."koushu_enrollments" TO "authenticated";
GRANT ALL ON TABLE "public"."koushu_enrollments" TO "service_role";



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



GRANT ALL ON TABLE "public"."portal_menu" TO "anon";
GRANT ALL ON TABLE "public"."portal_menu" TO "authenticated";
GRANT ALL ON TABLE "public"."portal_menu" TO "service_role";



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



GRANT ALL ON TABLE "public"."schedule_closed_days" TO "anon";
GRANT ALL ON TABLE "public"."schedule_closed_days" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_closed_days" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_entries" TO "anon";
GRANT ALL ON TABLE "public"."schedule_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_entries" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_generation_logs" TO "anon";
GRANT ALL ON TABLE "public"."schedule_generation_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_generation_logs" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_regular_patterns" TO "anon";
GRANT ALL ON TABLE "public"."schedule_regular_patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_regular_patterns" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_time_slots" TO "anon";
GRANT ALL ON TABLE "public"."schedule_time_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_time_slots" TO "service_role";



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



GRANT ALL ON TABLE "public"."seasonal_shift_settings" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_shift_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_shift_settings" TO "service_role";



GRANT ALL ON TABLE "public"."seasonal_shift_slot_settings" TO "anon";
GRANT ALL ON TABLE "public"."seasonal_shift_slot_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."seasonal_shift_slot_settings" TO "service_role";



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



GRANT ALL ON TABLE "public"."textbooks" TO "anon";
GRANT ALL ON TABLE "public"."textbooks" TO "authenticated";
GRANT ALL ON TABLE "public"."textbooks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."textbooks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."textbooks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."textbooks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_invitations" TO "anon";
GRANT ALL ON TABLE "public"."user_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."user_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."user_schools" TO "anon";
GRANT ALL ON TABLE "public"."user_schools" TO "authenticated";
GRANT ALL ON TABLE "public"."user_schools" TO "service_role";



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







