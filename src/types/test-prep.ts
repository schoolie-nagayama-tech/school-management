// テスト対策提案書の型定義

import type { Student, Textbook, CurriculumItem } from '@/types/database';

// 提案書ステータス
export type TestPrepStatus = 'draft' | 'sent' | 'published';

export const TEST_PREP_STATUS_LABELS: Record<TestPrepStatus, string> = {
  draft: '下書き',
  sent: '提案済',
  published: '公開中',
};

// 自己評価マーク
export const SELF_ASSESSMENTS = ['◎', '○', '△', '×'] as const;
export type SelfAssessment = (typeof SELF_ASSESSMENTS)[number];

export const SELF_ASSESSMENT_LABELS: Record<SelfAssessment, string> = {
  '◎': 'よくできる',
  '○': 'できる',
  '△': 'やや不安',
  '×': '苦手',
};

// 学年別デフォルト科目テンプレート
export const GRADE_SUBJECT_TEMPLATES: Record<string, string[]> = {
  middle: ['英語', '数学', '国語', '理科', '社会'],
  // 高校は生徒の教科書マスタから動的に取得
};

// --- DB Row 型 ---

export interface TestPrepProposal {
  id: string;
  school_id: string;
  student_id: string;
  exam_type_id: string | null;
  teacher_user_id: string | null;
  title: string;
  status: TestPrepStatus;
  token: string;
  zoukoma_period_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TestPrepProposalSubject {
  id: string;
  proposal_id: string;
  subject_name: string;
  target_score: number | null;
  proposed_koma: number;
  sort_order: number;
  // JOIN
  units?: TestPrepProposalUnit[];
}

export interface TestPrepProposalUnit {
  id: string;
  subject_id: string;
  curriculum_item_id: number | null;
  unit_name: string;
  self_assessment: SelfAssessment | null;
  koma_count: number;
  sort_order: number;
  // JOIN
  curriculum_item?: CurriculumItem;
}

// --- Insert 型 ---

export interface TestPrepProposalInsert {
  id?: string;
  school_id: string;
  student_id: string;
  exam_type_id?: string | null;
  teacher_user_id?: string | null;
  title: string;
  status?: TestPrepStatus;
  zoukoma_period_id?: string | null;
  notes?: string | null;
}

export interface TestPrepProposalSubjectInsert {
  id?: string;
  proposal_id: string;
  subject_name: string;
  target_score?: number | null;
  proposed_koma?: number;
  sort_order?: number;
}

export interface TestPrepProposalUnitInsert {
  id?: string;
  subject_id: string;
  curriculum_item_id?: number | null;
  unit_name: string;
  self_assessment?: SelfAssessment | null;
  koma_count?: number;
  sort_order?: number;
}

// --- 詳細付きの結合型 ---

export interface TestPrepProposalWithDetails extends TestPrepProposal {
  subjects: TestPrepProposalSubject[];
  student?: Student;
  exam_type?: { id: string; name: string };
  teacher?: { display_name: string | null; email: string | null };
}
