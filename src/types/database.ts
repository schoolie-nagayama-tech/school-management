// Supabaseのデータベース型定義
export type Database = {
  public: {
    Tables: {
      schools: {
        Row: {
          id: string;
          name: string;
          code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          code?: string | null;
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

// 科目と生徒の関連を含む拡張型
export type StudentWithSubjects = Student & {
  subjects: (Subject & { student_subject_id: string })[];
};

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
  inactive: '休塾中',
  withdrawn: '退塾',
};

// 在籍状況の色マッピング
export const STATUS_COLORS: Record<Student['status'], string> = {
  active: 'bg-[#ff8e3c]/20 text-[#0d0d0d] border border-[#0d0d0d]',
  inactive: 'bg-[#eff0f3] text-[#2a2a2a] border border-[#0d0d0d]',
  withdrawn: 'bg-[#eff0f3] text-[#2a2a2a]/60 border border-[#0d0d0d]',
};
