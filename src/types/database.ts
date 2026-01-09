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
  inactive: '休塾中',
  withdrawn: '退塾',
};

// 在籍状況の色マッピング
export const STATUS_COLORS: Record<Student['status'], string> = {
  active: 'bg-[#ff8e3c]/20 text-[#0d0d0d] border border-[#0d0d0d]',
  inactive: 'bg-[#eff0f3] text-[#2a2a2a] border border-[#0d0d0d]',
  withdrawn: 'bg-[#eff0f3] text-[#2a2a2a]/60 border border-[#0d0d0d]',
};
