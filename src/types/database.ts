// Supabaseのデータベース型定義
export type Database = {
  public: {
    Tables: {
      schools: {
        Row: {
          id: string;
          name: string;
          code: string | null;
          notification_email: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          code?: string | null;
          notification_email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          code?: string | null;
          notification_email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      students: {
        Row: {
          id: string;
          school_id: string;
          student_code: string | null;
          last_name: string;
          first_name: string;
          last_name_kana: string;
          first_name_kana: string;
          grade: number;
          status: 'active' | 'inactive' | 'withdrawn';
          school_name: string | null;
          class_name: string | null;
          club: string | null;
          subject_other: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          school_id: string;
          student_code?: string | null;
          last_name: string;
          first_name: string;
          last_name_kana: string;
          first_name_kana: string;
          grade: number;
          status?: 'active' | 'inactive' | 'withdrawn';
          school_name?: string | null;
          class_name?: string | null;
          club?: string | null;
          subject_other?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          school_id?: string;
          student_code?: string | null;
          last_name?: string;
          first_name?: string;
          last_name_kana?: string;
          first_name_kana?: string;
          grade?: number;
          status?: 'active' | 'inactive' | 'withdrawn';
          school_name?: string | null;
          class_name?: string | null;
          club?: string | null;
          subject_other?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'students_school_id_fkey';
            columns: ['school_id'];
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
        ];
      };
      student_logs: {
        Row: {
          id: string;
          student_id: string;
          school_id: string;
          action: 'created' | 'updated' | 'soft_deleted' | 'restored' | 'status_changed';
          actor: string | null;
          diff: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          school_id: string;
          action: 'created' | 'updated' | 'soft_deleted' | 'restored' | 'status_changed';
          actor?: string | null;
          diff?: Record<string, unknown> | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          school_id?: string;
          action?: 'created' | 'updated' | 'soft_deleted' | 'restored' | 'status_changed';
          actor?: string | null;
          diff?: Record<string, unknown> | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'student_logs_student_id_fkey';
            columns: ['student_id'];
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'student_logs_school_id_fkey';
            columns: ['school_id'];
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
        ];
      };
      subjects: {
        Row: {
          id: string;
          name: string;
          grade_category: 'elementary' | 'middle' | 'high';
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          grade_category: 'elementary' | 'middle' | 'high';
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          grade_category?: 'elementary' | 'middle' | 'high';
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      assessments: {
        Row: {
          id: string;
          school_id: string;
          student_id: string;
          category: 'regular_test' | 'report_card' | 'mock';
          title: string | null;
          name_code: string;
          exam_date: string | null;
          exam_month: string | null;
          grade: number;
          term: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          school_id: string;
          student_id: string;
          category: 'regular_test' | 'report_card' | 'mock';
          title?: string | null;
          name_code: string;
          exam_date?: string | null;
          exam_month?: string | null;
          grade: number;
          term?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          school_id?: string;
          student_id?: string;
          category?: 'regular_test' | 'report_card' | 'mock';
          title?: string | null;
          name_code?: string;
          exam_date?: string | null;
          exam_month?: string | null;
          grade?: number;
          term?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'assessments_school_id_fkey';
            columns: ['school_id'];
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'assessments_student_id_fkey';
            columns: ['student_id'];
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
        ];
      };
      assessment_scores: {
        Row: {
          id: string;
          assessment_id: string;
          subject: string;
          value: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          assessment_id: string;
          subject: string;
          value?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          assessment_id?: string;
          subject?: string;
          value?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'assessment_scores_assessment_id_fkey';
            columns: ['assessment_id'];
            referencedRelation: 'assessments';
            referencedColumns: ['id'];
          },
        ];
      };
      application_items: {
        Row: {
          id: string;
          school_id: string;
          name: string;
          sort_order: number;
          is_active: boolean;
          column_type?: 'check' | 'number' | 'date';
          due_date?: string | null;
          teacher_editable?: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          school_id: string;
          name: string;
          sort_order?: number;
          is_active?: boolean;
          column_type?: 'check' | 'number' | 'date';
          due_date?: string | null;
          teacher_editable?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          school_id?: string;
          name?: string;
          sort_order?: number;
          is_active?: boolean;
          column_type?: 'check' | 'number' | 'date';
          due_date?: string | null;
          teacher_editable?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'application_items_school_id_fkey';
            columns: ['school_id'];
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
        ];
      };
      student_applications: {
        Row: {
          id: string;
          school_id: string;
          student_id: string;
          item_id: string;
          status?: 'pending' | 'completed' | 'not_applicable' | null;
          number_value?: number | null;
          date_value?: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          school_id: string;
          student_id: string;
          item_id: string;
          status?: 'pending' | 'completed' | 'not_applicable' | null;
          number_value?: number | null;
          date_value?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          school_id?: string;
          student_id?: string;
          item_id?: string;
          status?: 'pending' | 'completed' | 'not_applicable' | null;
          number_value?: number | null;
          date_value?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'student_applications_school_id_fkey';
            columns: ['school_id'];
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'student_applications_student_id_fkey';
            columns: ['student_id'];
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'student_applications_item_id_fkey';
            columns: ['item_id'];
            referencedRelation: 'application_items';
            referencedColumns: ['id'];
          },
        ];
      };
      student_subjects: {
        Row: {
          id: string;
          student_id: string;
          subject_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          subject_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          subject_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'student_subjects_student_id_fkey';
            columns: ['student_id'];
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'student_subjects_subject_id_fkey';
            columns: ['subject_id'];
            referencedRelation: 'subjects';
            referencedColumns: ['id'];
          },
        ];
      };
      // テキスト進行管理関連
      exam_types: {
        Row: {
          id: string;
          school_id: string;
          name: string;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          school_id: string;
          name: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          school_id?: string;
          name?: string;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'exam_types_school_id_fkey';
            columns: ['school_id'];
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
        ];
      };
      textbooks: {
        Row: {
          id: number;
          name: string;
          publisher: string | null;
          school_type: string | null;
          grade: string | null;
          subject: string | null;
          revision_date: string | null;
          sheet_gid: string | null;
          grade_category: 'elementary' | 'middle' | 'high' | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: number;
          name: string;
          publisher?: string | null;
          school_type?: string | null;
          grade?: string | null;
          subject?: string | null;
          revision_date?: string | null;
          sheet_gid?: string | null;
          grade_category?: 'elementary' | 'middle' | 'high' | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: number;
          name?: string;
          publisher?: string | null;
          school_type?: string | null;
          grade?: string | null;
          subject?: string | null;
          revision_date?: string | null;
          sheet_gid?: string | null;
          grade_category?: 'elementary' | 'middle' | 'high' | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      curriculum_items: {
        Row: {
          id: number;
          textbook_id: number;
          title: string;
          item_number: number | null;
          item_type: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          textbook_id: number;
          title: string;
          item_number?: number | null;
          item_type?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: number;
          textbook_id?: number;
          title?: string;
          item_number?: number | null;
          item_type?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'curriculum_items_textbook_id_fkey';
            columns: ['textbook_id'];
            referencedRelation: 'textbooks';
            referencedColumns: ['id'];
          },
        ];
      };
      student_textbooks: {
        Row: {
          id: string;
          school_id: string;
          student_id: string;
          textbook_id: number;
          is_active: boolean;
          is_draft: boolean;
          season: 'spring' | 'summer' | 'winter' | null;
          sort_order: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          school_id: string;
          student_id: string;
          textbook_id: number;
          is_active?: boolean;
          is_draft?: boolean;
          season?: 'spring' | 'summer' | 'winter' | null;
          sort_order?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          school_id?: string;
          student_id?: string;
          textbook_id?: number;
          is_active?: boolean;
          is_draft?: boolean;
          season?: 'spring' | 'summer' | 'winter' | null;
          sort_order?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'student_textbooks_school_id_fkey';
            columns: ['school_id'];
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'student_textbooks_student_id_fkey';
            columns: ['student_id'];
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'student_textbooks_textbook_id_fkey';
            columns: ['textbook_id'];
            referencedRelation: 'textbooks';
            referencedColumns: ['id'];
          },
        ];
      };
      student_textbook_settings: {
        Row: {
          id: string;
          student_textbook_id: string;
          goal_period: string | null;
          goal_score: number | null;
          approach: string | null;
          homework_style: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_textbook_id: string;
          goal_period?: string | null;
          goal_score?: number | null;
          approach?: string | null;
          homework_style?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_textbook_id?: string;
          goal_period?: string | null;
          goal_score?: number | null;
          approach?: string | null;
          homework_style?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'student_textbook_settings_student_textbook_id_fkey';
            columns: ['student_textbook_id'];
            referencedRelation: 'student_textbooks';
            referencedColumns: ['id'];
          },
        ];
      };
      student_textbook_exams: {
        Row: {
          id: string;
          student_textbook_id: string;
          exam_type_id: string | null;
          custom_exam_name: string | null;
          exam_date: string;
          target_score: number | null;
          exam_range: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_textbook_id: string;
          exam_type_id?: string | null;
          custom_exam_name?: string | null;
          exam_date: string;
          target_score?: number | null;
          exam_range?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_textbook_id?: string;
          exam_type_id?: string | null;
          custom_exam_name?: string | null;
          exam_date?: string;
          target_score?: number | null;
          exam_range?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'student_textbook_exams_student_textbook_id_fkey';
            columns: ['student_textbook_id'];
            referencedRelation: 'student_textbooks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'student_textbook_exams_exam_type_id_fkey';
            columns: ['exam_type_id'];
            referencedRelation: 'exam_types';
            referencedColumns: ['id'];
          },
        ];
      };
      student_progress: {
        Row: {
          id: string;
          student_textbook_id: string;
          curriculum_item_id: number;
          proposal_count: number;
          application_count: number;
          exam_range_exam_type_id: string | null;
          school_progress_date: string | null;
          handover: string | null;
          teacher_name: string | null;
          group_number: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_textbook_id: string;
          curriculum_item_id: number;
          proposal_count?: number;
          application_count?: number;
          exam_range_exam_type_id?: string | null;
          school_progress_date?: string | null;
          handover?: string | null;
          teacher_name?: string | null;
          group_number?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_textbook_id?: string;
          curriculum_item_id?: number;
          proposal_count?: number;
          application_count?: number;
          exam_range_exam_type_id?: string | null;
          school_progress_date?: string | null;
          handover?: string | null;
          teacher_name?: string | null;
          group_number?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'student_progress_student_textbook_id_fkey';
            columns: ['student_textbook_id'];
            referencedRelation: 'student_textbooks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'student_progress_curriculum_item_id_fkey';
            columns: ['curriculum_item_id'];
            referencedRelation: 'curriculum_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'student_progress_exam_range_exam_type_id_fkey';
            columns: ['exam_range_exam_type_id'];
            referencedRelation: 'exam_types';
            referencedColumns: ['id'];
          },
        ];
      };
      student_progress_lessons: {
        Row: {
          id: string;
          student_progress_id: string;
          lesson_number: number;
          lesson_date: string | null;
          teacher_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_progress_id: string;
          lesson_number: number;
          lesson_date?: string | null;
          teacher_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          student_progress_id?: string;
          lesson_number?: number;
          lesson_date?: string | null;
          teacher_name?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'student_progress_lessons_student_progress_id_fkey';
            columns: ['student_progress_id'];
            referencedRelation: 'student_progress';
            referencedColumns: ['id'];
          },
        ];
      };
      user_profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          role: string;
          is_active: boolean;
          invited_by: string | null;
          invited_at: string | null;
          last_login_at: string | null;
          created_at: string;
          updated_at: string;
          teachable_subject_ids?: string[] | null;
          available_days_of_week?: number[] | null;
          available_slot_numbers_by_day?: Record<string, number[]> | null;
          default_school_id?: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          display_name?: string | null;
          role?: string;
          is_active?: boolean;
          invited_by?: string | null;
          invited_at?: string | null;
          last_login_at?: string | null;
          created_at?: string;
          updated_at?: string;
          teachable_subject_ids?: string[] | null;
          available_days_of_week?: number[] | null;
          available_slot_numbers_by_day?: Record<string, number[]> | null;
          default_school_id?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          role?: string;
          is_active?: boolean;
          invited_by?: string | null;
          invited_at?: string | null;
          last_login_at?: string | null;
          created_at?: string;
          updated_at?: string;
          teachable_subject_ids?: string[] | null;
          available_days_of_week?: number[] | null;
          available_slot_numbers_by_day?: Record<string, number[]> | null;
          default_school_id?: string | null;
        };
        Relationships: [];
      };
      alert_dismissals: {
        Row: {
          id: string;
          school_id: string;
          student_id: string;
          alert_type: string;
          alert_key: string;
          dismissed_by: string | null;
          dismissed_at: string;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          school_id: string;
          student_id: string;
          alert_type: string;
          alert_key: string;
          dismissed_by?: string | null;
          dismissed_at?: string;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          school_id?: string;
          student_id?: string;
          alert_type?: string;
          alert_key?: string;
          dismissed_by?: string | null;
          dismissed_at?: string;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      portal_menu: {
        Row: {
          id: string;
          school_id: string;
          menu_key: string;
          title: string;
          description: string | null;
          is_visible: boolean;
          link_type: 'internal' | 'external';
          link_url: string | null;
          link_urls: Array<{ url: string; label: string }> | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          school_id: string;
          menu_key: string;
          title: string;
          description?: string | null;
          is_visible?: boolean;
          link_type?: 'internal' | 'external';
          link_url?: string | null;
          link_urls?: Array<{ url: string; label: string }> | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          school_id?: string;
          menu_key?: string;
          title?: string;
          description?: string | null;
          is_visible?: boolean;
          link_type?: 'internal' | 'external';
          link_url?: string | null;
          link_urls?: Array<{ url: string; label: string }> | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [{ foreignKeyName: 'portal_menu_school_id_fkey'; columns: ['school_id']; referencedRelation: 'schools'; referencedColumns: ['id'] }];
      };
      form_periods: {
        Row: {
          id: string;
          school_id: string;
          form_type: string;
          period_key: string;
          title: string;
          settings: Record<string, unknown>;
          publish_start: string | null;
          publish_end: string | null;
          is_active: boolean;
          linked_application_item_id: string | null;
          is_archived: boolean;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          school_id: string;
          form_type: string;
          period_key: string;
          title: string;
          settings?: Record<string, unknown>;
          publish_start?: string | null;
          publish_end?: string | null;
          is_active?: boolean;
          linked_application_item_id?: string | null;
          is_archived?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          school_id?: string;
          form_type?: string;
          period_key?: string;
          title?: string;
          settings?: Record<string, unknown>;
          publish_start?: string | null;
          publish_end?: string | null;
          is_active?: boolean;
          linked_application_item_id?: string | null;
          is_archived?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      form_responses: {
        Row: {
          id: string;
          school_id: string;
          form_id: string | null;
          form_type: string;
          form_period: string;
          student_name: string;
          grade: number;
          email: string;
          response_data: Record<string, unknown>;
          linked_student_id: string | null;
          linked_at: string | null;
          status_checks: Record<string, unknown>;
          is_archived: boolean;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          school_id: string;
          form_id?: string | null;
          form_type: string;
          form_period: string;
          student_name: string;
          grade: number;
          email: string;
          response_data?: Record<string, unknown>;
          linked_student_id?: string | null;
          linked_at?: string | null;
          status_checks?: Record<string, unknown>;
          is_archived?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          school_id?: string;
          form_type?: string;
          form_period?: string;
          student_name?: string;
          grade?: number;
          email?: string;
          response_data?: Record<string, unknown>;
          linked_student_id?: string | null;
          linked_at?: string | null;
          status_checks?: Record<string, unknown>;
          is_archived?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      attendance_types: {
        Row: {
          id: string;
          school_id: string;
          name: string;
          unit: 'count' | 'hours';
          unit_price: number;
          display_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          school_id: string;
          name: string;
          unit: 'count' | 'hours';
          unit_price: number;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          school_id?: string;
          name?: string;
          unit?: 'count' | 'hours';
          unit_price?: number;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      attendance_sheets: {
        Row: {
          id: string;
          teacher_id: string;
          school_id: string;
          year_month: string;
          status: 'draft' | 'submitted' | 'approved' | 'rejected';
          submitted_at: string | null;
          approved_at: string | null;
          approved_by: string | null;
          rejection_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          teacher_id: string;
          school_id: string;
          year_month: string;
          status?: 'draft' | 'submitted' | 'approved' | 'rejected';
          submitted_at?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          teacher_id?: string;
          school_id?: string;
          year_month?: string;
          status?: 'draft' | 'submitted' | 'approved' | 'rejected';
          submitted_at?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      attendance_records: {
        Row: {
          id: string;
          sheet_id: string;
          date: string;
          attendance_type_id: string;
          value: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sheet_id: string;
          date: string;
          attendance_type_id: string;
          value: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sheet_id?: string;
          date?: string;
          attendance_type_id?: string;
          value?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      attendance_notes: {
        Row: {
          id: string;
          sheet_id: string;
          date: string;
          late_early: string | null;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sheet_id: string;
          date: string;
          late_early?: string | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sheet_id?: string;
          date?: string;
          late_early?: string | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_schools: {
        Row: {
          id: string;
          user_id: string;
          school_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          school_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          school_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      schedule_time_slots: {
        Row: {
          id: string;
          school_id: string;
          slot_number: number;
          start_time: string;
          end_time: string;
          is_active: boolean;
          display_order: number;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          school_id: string;
          slot_number: number;
          start_time: string;
          end_time: string;
          is_active?: boolean;
          display_order?: number;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          school_id?: string;
          slot_number?: number;
          start_time?: string;
          end_time?: string;
          is_active?: boolean;
          display_order?: number;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      schedule_closed_days: {
        Row: {
          id: string;
          school_id: string | null;
          closed_date: string;
          reason: string | null;
          is_global: boolean;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          school_id?: string | null;
          closed_date: string;
          reason?: string | null;
          is_global?: boolean;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          school_id?: string | null;
          closed_date?: string;
          reason?: string | null;
          is_global?: boolean;
          created_at?: string | null;
        };
        Relationships: [];
      };
      schedule_regular_patterns: {
        Row: {
          id: string;
          school_id: string;
          student_id: string;
          day_of_week: number;
          time_slot_id: string;
          teacher_id: string;
          subject_ids: string[];
          seat_label: string | null;
          period_type: string;
          is_active: boolean;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          school_id: string;
          student_id: string;
          day_of_week: number;
          time_slot_id: string;
          teacher_id: string;
          subject_ids?: string[];
          seat_label?: string | null;
          period_type?: string;
          is_active?: boolean;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          school_id?: string;
          student_id?: string;
          day_of_week?: number;
          time_slot_id?: string;
          teacher_id?: string;
          subject_ids?: string[];
          seat_label?: string | null;
          period_type?: string;
          is_active?: boolean;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      schedule_entries: {
        Row: {
          id: string;
          school_id: string;
          entry_date: string;
          time_slot_id: string;
          teacher_id: string;
          student_id: string;
          subject_ids: string[];
          seat_label: string | null;
          regular_pattern_id: string | null;
          status: 'scheduled' | 'completed' | 'cancelled' | 'transferred_out' | 'transferred_in';
          attendance_status: string | null;
          attendance_recorded_at: string | null;
          attendance_recorded_by: string | null;
          note: string | null;
          transfer_from_id: string | null;
          transfer_to_id: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          school_id: string;
          entry_date: string;
          time_slot_id: string;
          teacher_id: string;
          student_id: string;
          subject_ids?: string[];
          seat_label?: string | null;
          regular_pattern_id?: string | null;
          status?: 'scheduled' | 'completed' | 'cancelled' | 'transferred_out' | 'transferred_in';
          attendance_status?: string | null;
          attendance_recorded_at?: string | null;
          attendance_recorded_by?: string | null;
          note?: string | null;
          transfer_from_id?: string | null;
          transfer_to_id?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          school_id?: string;
          entry_date?: string;
          time_slot_id?: string;
          teacher_id?: string;
          student_id?: string;
          subject_ids?: string[];
          seat_label?: string | null;
          regular_pattern_id?: string | null;
          status?: 'scheduled' | 'completed' | 'cancelled' | 'transferred_out' | 'transferred_in';
          attendance_status?: string | null;
          attendance_recorded_at?: string | null;
          attendance_recorded_by?: string | null;
          note?: string | null;
          transfer_from_id?: string | null;
          transfer_to_id?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      schedule_generation_logs: {
        Row: {
          id: string;
          school_id: string;
          week_start_date: string;
          entries_created: number;
          created_by: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          school_id: string;
          week_start_date: string;
          entries_created?: number;
          created_by?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          school_id?: string;
          week_start_date?: string;
          entries_created?: number;
          created_by?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      bulletin_labels: {
        Row: {
          id: string;
          school_id: string;
          name: string;
          color: string;
          is_system: boolean;
          sort_order: number;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          school_id: string;
          name: string;
          color?: string;
          is_system?: boolean;
          sort_order?: number;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          school_id?: string;
          name?: string;
          color?: string;
          is_system?: boolean;
          sort_order?: number;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      bulletin_posts: {
        Row: {
          id: string;
          school_id: string;
          label_id: string | null;
          title: string;
          content: string;
          is_pinned: boolean;
          is_archived: boolean;
          archived_at: string | null;
          created_by: string | null;
          updated_by: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          school_id: string;
          label_id?: string | null;
          title: string;
          content: string;
          is_pinned?: boolean;
          is_archived?: boolean;
          archived_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          school_id?: string;
          label_id?: string | null;
          title?: string;
          content?: string;
          is_pinned?: boolean;
          is_archived?: boolean;
          archived_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      bulletin_reads: {
        Row: {
          id: string;
          post_id: string;
          user_id: string;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          post_id: string;
          user_id: string;
          read_at?: string | null;
        };
        Update: {
          id?: string;
          post_id?: string;
          user_id?: string;
          read_at?: string | null;
        };
        Relationships: [];
      };
      form_templates: {
        Row: {
          id: string;
          school_id: string;
          name: string;
          description: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          school_id: string;
          name: string;
          description?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          school_id?: string;
          name?: string;
          description?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      form_template_fields: {
        Row: {
          id: string;
          template_id: string;
          field_type: string;
          label: string;
          placeholder: string | null;
          options: Record<string, unknown> | string[] | null;
          is_required: boolean;
          sort_order: number;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          template_id: string;
          field_type: string;
          label: string;
          placeholder?: string | null;
          options?: Record<string, unknown> | string[] | null;
          is_required?: boolean;
          sort_order?: number;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          template_id?: string;
          field_type?: string;
          label?: string;
          placeholder?: string | null;
          options?: Record<string, unknown> | string[] | null;
          is_required?: boolean;
          sort_order?: number;
          created_at?: string | null;
        };
        Relationships: [];
      };
      forms: {
        Row: {
          id: string;
          school_id: string;
          template_id: string | null;
          title: string;
          description: string | null;
          slug: string;
          status: string;
          publish_start: string | null;
          publish_end: string | null;
          completion_message: string | null;
          linked_application_item_id: string | null;
          is_archived: boolean;
          archived_at: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          school_id: string;
          template_id?: string | null;
          title: string;
          description?: string | null;
          slug: string;
          status?: string;
          publish_start?: string | null;
          publish_end?: string | null;
          completion_message?: string | null;
          linked_application_item_id?: string | null;
          is_archived?: boolean;
          archived_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          school_id?: string;
          template_id?: string | null;
          title?: string;
          description?: string | null;
          slug?: string;
          status?: string;
          publish_start?: string | null;
          publish_end?: string | null;
          completion_message?: string | null;
          linked_application_item_id?: string | null;
          is_archived?: boolean;
          archived_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      form_fields: {
        Row: {
          id: string;
          form_id: string;
          field_type: string;
          label: string;
          placeholder: string | null;
          options: Record<string, unknown> | string[] | null;
          is_required: boolean;
          sort_order: number;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          form_id: string;
          field_type: string;
          label: string;
          placeholder?: string | null;
          options?: Record<string, unknown> | string[] | null;
          is_required?: boolean;
          sort_order?: number;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          form_id?: string;
          field_type?: string;
          label?: string;
          placeholder?: string | null;
          options?: Record<string, unknown> | string[] | null;
          is_required?: boolean;
          sort_order?: number;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      student_interviews: {
        Row: {
          id: string;
          school_id: string;
          student_id: string;
          interview_date: string;
          interview_type: string;
          content: string;
          is_completed: boolean;
          completed_at: string | null;
          created_by: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          school_id: string;
          student_id: string;
          interview_date: string;
          interview_type: string;
          content: string;
          is_completed?: boolean;
          completed_at?: string | null;
          created_by?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          school_id?: string;
          student_id?: string;
          interview_date?: string;
          interview_type?: string;
          content?: string;
          is_completed?: boolean;
          completed_at?: string | null;
          created_by?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      user_invitations: {
        Row: {
          id: string;
          email: string;
          role: string;
          school_ids: string[];
          token: string;
          invited_by: string;
          expires_at: string;
          accepted_at: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          role: string;
          school_ids: string[];
          token: string;
          invited_by: string;
          expires_at: string;
          accepted_at?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          role?: string;
          school_ids?: string[];
          token?: string;
          invited_by?: string;
          expires_at?: string;
          accepted_at?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};

// 便利な型エイリアス
export type School = Database['public']['Tables']['schools']['Row'];
export type SchoolInsert = Database['public']['Tables']['schools']['Insert'];
export type SchoolUpdate = Database['public']['Tables']['schools']['Update'];

export type Student = Database['public']['Tables']['students']['Row'];
export type StudentInsert = Database['public']['Tables']['students']['Insert'];
export type StudentUpdate = Database['public']['Tables']['students']['Update'];

export type StudentLog = Database['public']['Tables']['student_logs']['Row'];
export type StudentLogInsert = Database['public']['Tables']['student_logs']['Insert'];

export type Subject = Database['public']['Tables']['subjects']['Row'];
export type SubjectInsert = Database['public']['Tables']['subjects']['Insert'];
export type SubjectUpdate = Database['public']['Tables']['subjects']['Update'];

export type StudentSubject = Database['public']['Tables']['student_subjects']['Row'];
export type StudentSubjectInsert = Database['public']['Tables']['student_subjects']['Insert'];

export type Assessment = Database['public']['Tables']['assessments']['Row'];
export type AssessmentInsert = Database['public']['Tables']['assessments']['Insert'];
export type AssessmentUpdate = Database['public']['Tables']['assessments']['Update'];

export type AssessmentScore = Database['public']['Tables']['assessment_scores']['Row'];
export type AssessmentScoreInsert = Database['public']['Tables']['assessment_scores']['Insert'];
export type AssessmentScoreUpdate = Database['public']['Tables']['assessment_scores']['Update'];

// 科目と生徒の関連を含む拡張型
export type StudentWithSubjects = Student & {
  subjects: (Subject & { student_subject_id: string })[];
};

// 成績とスコアを含む拡張型
export type AssessmentWithScores = Assessment & {
  scores: AssessmentScore[];
};

// 科目コードの定義
export const SUBJECT_CODES = {
  // 共通9科
  ENGLISH: 'english',
  MATH: 'math',
  JAPANESE: 'japanese',
  SOCIAL: 'social',
  SCIENCE: 'science',
  MUSIC: 'music',
  ART: 'art',
  TECH_HOME: 'tech_home',
  PE: 'pe',
  // mock用の換算内申
  CONV_5: 'conv_5',
  CONV_4: 'conv_4',
  CONV_TOTAL: 'conv_total',
} as const;

export const SUBJECT_LABELS: Record<string, string> = {
  [SUBJECT_CODES.ENGLISH]: '英語',
  [SUBJECT_CODES.MATH]: '数学',
  [SUBJECT_CODES.JAPANESE]: '国語',
  [SUBJECT_CODES.SOCIAL]: '社会',
  [SUBJECT_CODES.SCIENCE]: '理科',
  [SUBJECT_CODES.MUSIC]: '音楽',
  [SUBJECT_CODES.ART]: '美術',
  [SUBJECT_CODES.TECH_HOME]: '技術・家庭',
  [SUBJECT_CODES.PE]: '保健体育',
  [SUBJECT_CODES.CONV_5]: '換算内申(5科)',
  [SUBJECT_CODES.CONV_4]: '換算内申(4科)',
  [SUBJECT_CODES.CONV_TOTAL]: '換算内申(合計)',
};

// 成績カテゴリの表示用マッピング
export const ASSESSMENT_CATEGORY_LABELS: Record<Assessment['category'], string> = {
  regular_test: '学校定期テスト',
  report_card: '学校内申',
  mock: 'COM・模試',
};

// 成績名コードの定義とラベルマッピング
export const ASSESSMENT_NAME_CODES = {
  // 定期テスト
  REGULAR_TEST: {
    TERM1_MID: 'term1_mid',
    TERM1_FINAL: 'term1_final',
    TERM2_MID: 'term2_mid',
    TERM2_FINAL: 'term2_final',
    YEAR_END: 'year_end',
    FIRST_MID: 'first_mid',
    FIRST_FINAL: 'first_final',
    SECOND_MID: 'second_mid',
    SECOND_FINAL: 'second_final',
  },
  // 内申
  REPORT_CARD: {
    TERM1: 'term1',
    TERM2: 'term2',
    YEAR_END: 'year_end',
    FIRST: 'first',
    SECOND: 'second',
  },
  // 模試
  MOCK: {
    VENUE: 'venue',
    CLASSROOM: 'classroom',
  },
} as const;

export const ASSESSMENT_NAME_LABELS: Record<string, string> = {
  // 定期テスト
  [ASSESSMENT_NAME_CODES.REGULAR_TEST.TERM1_MID]: '1学期中間',
  [ASSESSMENT_NAME_CODES.REGULAR_TEST.TERM1_FINAL]: '1学期期末',
  [ASSESSMENT_NAME_CODES.REGULAR_TEST.TERM2_MID]: '2学期中間',
  [ASSESSMENT_NAME_CODES.REGULAR_TEST.TERM2_FINAL]: '2学期期末',
  [ASSESSMENT_NAME_CODES.REGULAR_TEST.YEAR_END]: '学年末',
  [ASSESSMENT_NAME_CODES.REGULAR_TEST.FIRST_MID]: '前期中間',
  [ASSESSMENT_NAME_CODES.REGULAR_TEST.FIRST_FINAL]: '前期期末',
  [ASSESSMENT_NAME_CODES.REGULAR_TEST.SECOND_MID]: '後期中間',
  [ASSESSMENT_NAME_CODES.REGULAR_TEST.SECOND_FINAL]: '後期期末',
  // 内申
  [ASSESSMENT_NAME_CODES.REPORT_CARD.TERM1]: '1学期',
  [ASSESSMENT_NAME_CODES.REPORT_CARD.TERM2]: '2学期',
  [ASSESSMENT_NAME_CODES.REPORT_CARD.YEAR_END]: '学年末',
  [ASSESSMENT_NAME_CODES.REPORT_CARD.FIRST]: '前期',
  [ASSESSMENT_NAME_CODES.REPORT_CARD.SECOND]: '後期',
  // 模試
  [ASSESSMENT_NAME_CODES.MOCK.VENUE]: '会場模試',
  [ASSESSMENT_NAME_CODES.MOCK.CLASSROOM]: '教室模試',
  // 移行用
  legacy: '（旧データ）',
};

// カテゴリごとの選択肢配列
export const ASSESSMENT_NAME_OPTIONS = {
  regular_test: [
    { code: ASSESSMENT_NAME_CODES.REGULAR_TEST.TERM1_MID, label: '1学期中間' },
    { code: ASSESSMENT_NAME_CODES.REGULAR_TEST.TERM1_FINAL, label: '1学期期末' },
    { code: ASSESSMENT_NAME_CODES.REGULAR_TEST.TERM2_MID, label: '2学期中間' },
    { code: ASSESSMENT_NAME_CODES.REGULAR_TEST.TERM2_FINAL, label: '2学期期末' },
    { code: ASSESSMENT_NAME_CODES.REGULAR_TEST.YEAR_END, label: '学年末' },
    { code: ASSESSMENT_NAME_CODES.REGULAR_TEST.FIRST_MID, label: '前期中間' },
    { code: ASSESSMENT_NAME_CODES.REGULAR_TEST.FIRST_FINAL, label: '前期期末' },
    { code: ASSESSMENT_NAME_CODES.REGULAR_TEST.SECOND_MID, label: '後期中間' },
    { code: ASSESSMENT_NAME_CODES.REGULAR_TEST.SECOND_FINAL, label: '後期期末' },
  ],
  report_card: [
    { code: ASSESSMENT_NAME_CODES.REPORT_CARD.TERM1, label: '1学期' },
    { code: ASSESSMENT_NAME_CODES.REPORT_CARD.TERM2, label: '2学期' },
    { code: ASSESSMENT_NAME_CODES.REPORT_CARD.YEAR_END, label: '学年末' },
    { code: ASSESSMENT_NAME_CODES.REPORT_CARD.FIRST, label: '前期' },
    { code: ASSESSMENT_NAME_CODES.REPORT_CARD.SECOND, label: '後期' },
  ],
  mock: [
    { code: ASSESSMENT_NAME_CODES.MOCK.VENUE, label: '会場模試' },
    { code: ASSESSMENT_NAME_CODES.MOCK.CLASSROOM, label: '教室模試' },
  ],
} as const;

// 学年カテゴリの表示用マッピング
export const GRADE_CATEGORY_LABELS: Record<'elementary' | 'middle' | 'high', string> = {
  elementary: '小学生',
  middle: '中学生',
  high: '高校生',
};

// 学年の表示用マッピング
export const GRADE_LABELS: Record<number, string> = {
  1: '小1',
  2: '小2',
  3: '小3',
  4: '小4',
  5: '小5',
  6: '小6',
  7: '中1',
  8: '中2',
  9: '中3',
  10: '高1',
  11: '高2',
  12: '高3',
  13: '既卒',
};

// 在籍状況の表示用マッピング
export const STATUS_LABELS: Record<Student['status'], string> = {
  active: '在籍中',
  inactive: '休会',
  withdrawn: '退会',
};

// 在籍状況の色マッピング
export const STATUS_COLORS: Record<Student['status'], string> = {
  active: 'bg-[#3b82f6]/20 text-[#1f2937] border border-[#e5e7eb]',
  inactive: 'bg-[#f3f4f6] text-[#4b5563] border border-[#e5e7eb]',
  withdrawn: 'bg-[#f3f4f6] text-[#4b5563]/60 border border-[#e5e7eb]',
};

// 列タイプ
export type ApplicationColumnType = 'check' | 'number' | 'date';

// 列タイプ表示名
export const APPLICATION_COLUMN_TYPE_LABELS: Record<ApplicationColumnType, string> = {
  check: 'チェック',
  number: '数値',
  date: '日付',
};

// 申込状況管理の型定義
export type ApplicationItem = Database['public']['Tables']['application_items']['Row'] & {
  is_hidden?: boolean;
  ended_at?: string | null;
  column_type: ApplicationColumnType;
  due_date: string | null;
  teacher_editable?: boolean;
};
export type ApplicationItemInsert = Database['public']['Tables']['application_items']['Insert'];
export type ApplicationItemUpdate = Database['public']['Tables']['application_items']['Update'];

// フィルター用の型
export interface ApplicationFilters {
  search?: string;        // 生徒名・フォーム名検索
  grade?: number | null;  // 学年
  itemId?: string | null; // 申込項目ID
  dateFrom?: string;      // 日付From
  dateTo?: string;        // 日付To
  showHidden?: boolean;   // 非表示も含めるか
}

export type StudentApplication = Database['public']['Tables']['student_applications']['Row'];
export type StudentApplicationInsert = Database['public']['Tables']['student_applications']['Insert'];
export type StudentApplicationUpdate = Database['public']['Tables']['student_applications']['Update'];

// 申込状況のステータス
export type ApplicationStatus = 'pending' | 'completed' | 'not_applicable';

// 申込状況の表示用マッピング
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: '未申込',
  completed: '申込済',
  not_applicable: '対象外',
};

// 申込状況の表示記号
export const APPLICATION_STATUS_SYMBOLS: Record<ApplicationStatus | 'empty', string> = {
  empty: '',
  pending: '×',
  completed: '✓',
  not_applicable: '-',
};

// ============================================
// ポータルメニュー関連
// ============================================

export type PortalMenu = {
  id: string;
  school_id: string;
  menu_key: string;
  title: string;
  description: string | null;
  is_visible: boolean;
  link_type: 'internal' | 'external';
  link_url: string | null;
  link_urls: Array<{ url: string; label: string }> | null; // 複数外部リンク（面談申し込みなど）
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type PortalMenuInsert = Partial<Pick<PortalMenu, 'link_urls'>> & Omit<PortalMenu, 'id' | 'created_at' | 'updated_at' | 'link_urls'>;

export type PortalMenuUpdate = Partial<Omit<PortalMenu, 'id' | 'school_id' | 'menu_key' | 'created_at' | 'updated_at'>>;

// ============================================
// フォーム回答関連
// ============================================

export type FormType = 'zoukoma' | 'moshi' | 'mogi' | 'shukaisu' | 'youbi' | 'kyozai' | 'soudan';

export type FormResponse = {
  id: string;
  school_id: string;
  form_type: FormType;
  form_period: string;
  student_name: string;
  grade: number;
  email: string;
  response_data: Record<string, unknown>;
  linked_student_id: string | null;
  linked_at: string | null;
  status_checks: Record<string, boolean>;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FormResponseInsert = Omit<FormResponse, 'id' | 'created_at' | 'updated_at' | 'linked_student_id' | 'linked_at' | 'is_archived' | 'archived_at'>;

export type FormResponseUpdate = Partial<Omit<FormResponse, 'id' | 'school_id' | 'form_type' | 'form_period' | 'created_at' | 'updated_at'>>;

export type FormPeriod = {
  id: string;
  school_id: string;
  form_type: FormType;
  period_key: string;
  title: string;
  settings: Record<string, unknown>;
  publish_start: string | null;
  publish_end: string | null;
  is_active: boolean;
  linked_application_item_id: string | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FormPeriodInsert = Omit<FormPeriod, 'id' | 'created_at' | 'updated_at' | 'is_archived' | 'archived_at'>;

export type FormPeriodUpdate = Partial<Omit<FormPeriod, 'id' | 'school_id' | 'form_type' | 'period_key' | 'created_at' | 'updated_at'>>;

// フォーム種別のラベル
export const FORM_TYPE_LABELS: Record<FormType, string> = {
  zoukoma: '増コマ申込',
  moshi: '模試申込',
  mogi: 'Vもぎ申込',
  shukaisu: '週回数変更',
  youbi: '曜日変更',
  kyozai: '教材販売',
  soudan: 'お客様相談',
};

// フォームフィールドタイプ（既存のフォーム機能用）
export type FormFieldType = 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date' | 'number';

export const FORM_FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'テキスト',
  textarea: 'テキストエリア',
  select: 'セレクト',
  radio: 'ラジオボタン',
  checkbox: 'チェックボックス',
  date: '日付',
  number: '数値',
};

// フォームステータス（既存のフォーム機能用）
export type FormStatus = 'draft' | 'published' | 'closed';

export const FORM_STATUS_LABELS: Record<FormStatus, string> = {
  draft: '下書き',
  published: '公開中',
  closed: '終了',
};

// フォームテンプレート関連（既存のフォーム機能用）
export type FormTemplate = {
  id: string;
  school_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type FormTemplateInsert = Omit<FormTemplate, 'id' | 'created_at' | 'updated_at'>;
export type FormTemplateUpdate = Partial<Omit<FormTemplate, 'id' | 'school_id' | 'created_at' | 'updated_at'>>;

export type FormTemplateField = {
  id: string;
  template_id: string;
  label: string;
  field_type: FormFieldType;
  placeholder?: string | null;
  options: string[] | null;
  is_required: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type FormTemplateFieldInsert = Omit<FormTemplateField, 'id' | 'created_at' | 'updated_at'>;
export type FormTemplateFieldUpdate = Partial<Omit<FormTemplateField, 'id' | 'template_id' | 'created_at' | 'updated_at'>>;

export type FormTemplateWithFields = FormTemplate & {
  fields: FormTemplateField[];
};

// フォーム関連（既存のフォーム機能用）
export type Form = {
  id: string;
  school_id: string;
  template_id: string | null;
  title: string;
  description: string | null;
  slug: string;
  status: FormStatus;
  publish_start: string | null;
  publish_end: string | null;
  completion_message: string | null;
  linked_application_item_id: string | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FormInsert = Omit<Form, 'id' | 'created_at' | 'updated_at' | 'is_archived' | 'archived_at'>;
export type FormUpdate = Partial<Omit<Form, 'id' | 'school_id' | 'created_at' | 'updated_at'>>;

export type FormField = {
  id: string;
  form_id: string;
  label: string;
  field_type: FormFieldType;
  options: string[] | null;
  is_required: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type FormFieldInsert = Omit<FormField, 'id' | 'created_at' | 'updated_at'>;
export type FormFieldUpdate = Partial<Omit<FormField, 'id' | 'form_id' | 'created_at' | 'updated_at'>>;

export type FormWithFields = Form & {
  fields: FormField[];
};

// ============================================
// 面談記録関連
// ============================================

export type InterviewType = 
  | 'parent_interview' 
  | 'phone' 
  | 'student_interview' 
  | 'casual' 
  | 'enrollment' 
  | 'other'
  | 'task';

export interface StudentInterview {
  id: string;
  school_id: string;
  student_id: string;
  interview_date: string;      // YYYY-MM-DD
  interview_type: InterviewType;
  content: string;
  is_completed: boolean;       // タスク用
  completed_at: string | null; // タスク用
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentInterviewInput {
  interview_date: string;
  interview_type: InterviewType;
  content: string;
}

// 面談種別のラベルマッピング
export const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
  parent_interview: '保護者面談',
  phone: '電話',
  student_interview: '生徒面談',
  casual: '雑談',
  enrollment: '入会面談',
  other: 'その他',
  task: 'タスク',
};

// 面談種別の色マッピング（バッジ用）
export const INTERVIEW_TYPE_COLORS: Record<InterviewType, string> = {
  parent_interview: 'bg-blue-100 text-blue-800',
  phone: 'bg-green-100 text-green-800',
  student_interview: 'bg-purple-100 text-purple-800',
  casual: 'bg-gray-100 text-gray-800',
  enrollment: 'bg-orange-100 text-orange-800',
  other: 'bg-gray-100 text-gray-600',
  task: 'bg-red-100 text-red-800',
};

// ============================================
// テキスト進行管理関連
// ============================================

export type ExamType = Database['public']['Tables']['exam_types']['Row'];
export type ExamTypeInsert = Database['public']['Tables']['exam_types']['Insert'];
export type ExamTypeUpdate = Database['public']['Tables']['exam_types']['Update'];

export type Textbook = Database['public']['Tables']['textbooks']['Row'];
export type TextbookInsert = Database['public']['Tables']['textbooks']['Insert'];
export type TextbookUpdate = Database['public']['Tables']['textbooks']['Update'];

export type CurriculumItem = Database['public']['Tables']['curriculum_items']['Row'];
export type CurriculumItemInsert = Database['public']['Tables']['curriculum_items']['Insert'];
export type CurriculumItemUpdate = Database['public']['Tables']['curriculum_items']['Update'];

export type StudentTextbook = Database['public']['Tables']['student_textbooks']['Row'];
export type StudentTextbookInsert = Database['public']['Tables']['student_textbooks']['Insert'];
export type StudentTextbookUpdate = Database['public']['Tables']['student_textbooks']['Update'];

export type StudentTextbookSetting = Database['public']['Tables']['student_textbook_settings']['Row'];
export type StudentTextbookSettingInsert = Database['public']['Tables']['student_textbook_settings']['Insert'];
export type StudentTextbookSettingUpdate = Database['public']['Tables']['student_textbook_settings']['Update'];

export type StudentTextbookExam = Database['public']['Tables']['student_textbook_exams']['Row'];
export type StudentTextbookExamInsert = Database['public']['Tables']['student_textbook_exams']['Insert'];
export type StudentTextbookExamUpdate = Database['public']['Tables']['student_textbook_exams']['Update'];

export type StudentProgress = Database['public']['Tables']['student_progress']['Row'];
export type StudentProgressInsert = Database['public']['Tables']['student_progress']['Insert'];
export type StudentProgressUpdate = Database['public']['Tables']['student_progress']['Update'];

export type StudentProgressLesson = Database['public']['Tables']['student_progress_lessons']['Row'];
export type StudentProgressLessonInsert = Database['public']['Tables']['student_progress_lessons']['Insert'];
export type StudentProgressLessonUpdate = Database['public']['Tables']['student_progress_lessons']['Update'];

// 拡張型（関連データを含む）
export type StudentTextbookWithDetails = StudentTextbook & {
  textbook: Textbook;
  settings?: StudentTextbookSetting | null;
  exams?: StudentTextbookExam[];
};

export type StudentProgressWithDetails = StudentProgress & {
  curriculum_item: CurriculumItem;
  exam_range_exam_type?: ExamType | null;
  lessons?: StudentProgressLesson[];
};

export type CurriculumItemWithProgress = CurriculumItem & {
  progress?: StudentProgressWithDetails | null;
};

// グループ化された行の表示用型
export interface ProgressRowDisplay {
  curriculumItem: CurriculumItem;
  progress: StudentProgressWithDetails | null;
  // グループ表示用
  isGroupStart: boolean;      // グループの先頭行か
  groupRowSpan: number;       // rowspanの値（先頭行のみ1以上）
  groupProposalCount: number; // グループ全体の提案回数
  groupApplicationCount: number; // グループ全体の申込回数
}

// =====================================================
// 講習管理 型定義
// =====================================================

// 季節タイプ
export type SeasonType = 'spring' | 'summer' | 'winter';

// 季節ラベル
export const SEASON_LABELS: Record<SeasonType, string> = {
  spring: '春期',
  summer: '夏期',
  winter: '冬期',
};

// 講習コース
export interface SeasonalCourse {
  id: string;
  school_id: string;
  name: string;
  season: SeasonType;
  target_grades: number[];
  total_koma: number;
  comment: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// コースとテキストの紐付け
export interface SeasonalCourseTextbook {
  id: string;
  course_id: string;
  textbook_id: number;
  sort_order: number;
  created_at: string;
  // JOIN時
  textbook?: Textbook;
}

// コースカリキュラム設定
export interface SeasonalCourseCurriculum {
  id: string;
  course_id: string;
  textbook_id: number;
  curriculum_item_id: number;
  proposal_count: number;
  group_number: number | null;
  created_at: string;
  updated_at: string;
  // JOIN時
  curriculum_item?: CurriculumItem;
}

// コース適用履歴
export interface SeasonalCourseApplication {
  id: string;
  course_id: string;
  student_id: string;
  applied_at: string;
  applied_mode: 'overwrite' | 'add';
  created_at: string;
  // JOIN時
  student?: Student;
  course?: SeasonalCourse;
}

// コース詳細（JOIN済み）
export interface SeasonalCourseWithDetails extends SeasonalCourse {
  textbooks: SeasonalCourseTextbook[];
  curriculum: SeasonalCourseCurriculum[];
  application_count?: number;
}

// カリキュラム表示用（進行表風）
export interface CourseCurriculumRow {
  curriculumItem: CurriculumItem;
  setting: SeasonalCourseCurriculum | null;
  isGroupStart: boolean;
  groupRowSpan: number;
  groupProposalCount: number;
}

// =====================================================
// 認証・権限管理 型定義
// =====================================================

// ユーザーロール
export type UserRole = 'admin' | 'owner' | 'manager' | 'teacher' | 'parent';

// ロール表示名
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'システム管理者',
  owner: 'エリアマネージャー',
  manager: '教室長',
  teacher: '講師',
  parent: '保護者',
};

// ロールの階層（数値が大きいほど権限が高い）
export const USER_ROLE_LEVELS: Record<UserRole, number> = {
  parent: 1,
  teacher: 2,
  manager: 3,
  owner: 4,
  admin: 5,
};

// ユーザープロファイル
export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  is_active: boolean;
  invited_by: string | null;
  invited_at: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  /** 講師の指導可能科目ID（空または未設定の場合は全科目可） */
  teachable_subject_ids?: string[] | null;
  /** 出勤可能曜日 0=日,1=月,...,6=土（空または未設定の場合は全曜日） */
  available_days_of_week?: number[] | null;
  /** 曜日ごとの出勤可能コマ。キー "0"〜"6"、値は 1〜7 限の配列。空または未設定は全コマ可 */
  available_slot_numbers_by_day?: Record<string, number[]> | null;
  /** 複数教室権限があるときのデフォルト教室ID（ログイン時の初期選択） */
  default_school_id?: string | null;
}

// ユーザーと教室の紐付け
export interface UserSchool {
  id: string;
  user_id: string;
  school_id: string;
  created_at: string;
  // JOIN時
  school?: School;
}

// 招待
export interface UserInvitation {
  id: string;
  email: string;
  role: UserRole;
  school_ids: string[];
  token: string;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

// ユーザー詳細（JOIN済み）
export interface UserWithDetails extends UserProfile {
  schools: UserSchool[];
}

// 権限チェック用の型
export interface Permission {
  // ページアクセス
  canAccessStudents: boolean;
  canAccessProgress: boolean;
  canAccessScores: boolean;
  canAccessInterviews: boolean;
  canAccessApplications: boolean;
  canAccessCourses: boolean;
  canAccessSettings: boolean;
  canAccessUsers: boolean;
  canAccessPortal: boolean;
  
  // 編集権限
  canEditStudentInfo: boolean;
  canEditProposalCount: boolean;
  canEditApplicationCount: boolean;
  canEditLessonDate: boolean;
  canEditHandover: boolean;
  canEditGrouping: boolean;
  canEditScores: boolean;
  canEditInterviews: boolean;
  canEditApplications: boolean;
}

// 権限定義
export const ROLE_PERMISSIONS: Record<UserRole, Permission> = {
  admin: {
    canAccessStudents: true,
    canAccessProgress: true,
    canAccessScores: true,
    canAccessInterviews: true,
    canAccessApplications: true,
    canAccessCourses: true,
    canAccessSettings: true,
    canAccessUsers: true,
    canAccessPortal: true,
    canEditStudentInfo: true,
    canEditProposalCount: true,
    canEditApplicationCount: true,
    canEditLessonDate: true,
    canEditHandover: true,
    canEditGrouping: true,
    canEditScores: true,
    canEditInterviews: true,
    canEditApplications: true,
  },
  owner: {
    canAccessStudents: true,
    canAccessProgress: true,
    canAccessScores: true,
    canAccessInterviews: true,
    canAccessApplications: true,
    canAccessCourses: true,
    canAccessSettings: true,
    canAccessUsers: true,
    canAccessPortal: true,
    canEditStudentInfo: true,
    canEditProposalCount: true,
    canEditApplicationCount: true,
    canEditLessonDate: true,
    canEditHandover: true,
    canEditGrouping: true,
    canEditScores: true,
    canEditInterviews: true,
    canEditApplications: true,
  },
  manager: {
    canAccessStudents: true,
    canAccessProgress: true,
    canAccessScores: true,
    canAccessInterviews: true,
    canAccessApplications: true,
    canAccessCourses: true,
    canAccessSettings: true,
    canAccessUsers: true,
    canAccessPortal: true,
    canEditStudentInfo: true,
    canEditProposalCount: true,
    canEditApplicationCount: true,
    canEditLessonDate: true,
    canEditHandover: true,
    canEditGrouping: true,
    canEditScores: true,
    canEditInterviews: true,
    canEditApplications: true,
  },
  teacher: {
    canAccessStudents: true,
    canAccessProgress: true,
    canAccessScores: true,
    canAccessInterviews: true,
    canAccessApplications: true,
    canAccessCourses: false,
    canAccessSettings: false,
    canAccessUsers: false,
    canAccessPortal: false,
    canEditStudentInfo: false,
    canEditProposalCount: true,
    canEditApplicationCount: false,
    canEditLessonDate: true,
    canEditHandover: true,
    canEditGrouping: false,
    canEditScores: true,
    canEditInterviews: false,
    canEditApplications: true,
  },
  parent: {
    canAccessStudents: false,
    canAccessProgress: false,
    canAccessScores: false,
    canAccessInterviews: false,
    canAccessApplications: false,
    canAccessCourses: false,
    canAccessSettings: false,
    canAccessUsers: false,
    canAccessPortal: true,
    canEditStudentInfo: false,
    canEditProposalCount: false,
    canEditApplicationCount: false,
    canEditLessonDate: false,
    canEditHandover: false,
    canEditGrouping: false,
    canEditScores: false,
    canEditInterviews: false,
    canEditApplications: false,
  },
};

// 権限を取得する関数
export function getPermissions(role: UserRole): Permission {
  return ROLE_PERMISSIONS[role];
}

// 権限レベルを比較する関数
export function hasHigherOrEqualRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return USER_ROLE_LEVELS[userRole] >= USER_ROLE_LEVELS[requiredRole];
}
