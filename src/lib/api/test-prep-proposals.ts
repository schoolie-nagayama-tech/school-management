/**
 * テスト対策提案書 API
 * CRUD + 公開トークン取得
 * テーブルは DB 型定義未追加のため (supabase as any) でアクセス
 */

import { supabase } from '@/lib/supabase';
import type {
  TestPrepProposal,
  TestPrepProposalInsert,
  TestPrepProposalSubject,
  TestPrepProposalUnit,
  TestPrepProposalWithDetails,
} from '@/types/test-prep';

const db = () => supabase as any;

// ========== Proposals ==========

/** 教室の提案書一覧 */
export async function getTestPrepProposals(schoolId: string): Promise<TestPrepProposal[]> {
  const { data, error } = await db()
    .from('test_prep_proposals')
    .select('*')
    .eq('school_id', schoolId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Failed to get test prep proposals: ${error.message}`);
  return (data || []) as TestPrepProposal[];
}

/** 教室の提案書一覧（生徒名・試験名付き） */
export async function getTestPrepProposalsWithStudent(
  schoolId: string | string[]
): Promise<(TestPrepProposal & { student: { last_name: string; first_name: string; grade: number } | null; exam_type: { name: string } | null })[]> {
  const query = db()
    .from('test_prep_proposals')
    .select('*, student:students(last_name, first_name, grade), exam_type:exam_types(name)')
    .order('updated_at', { ascending: false });

  if (Array.isArray(schoolId)) {
    query.in('school_id', schoolId);
  } else {
    query.eq('school_id', schoolId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to get test prep proposals: ${error.message}`);
  return (data || []) as any;
}

/** 生徒の提案書一覧 */
export async function getTestPrepProposalsByStudent(studentId: string): Promise<TestPrepProposal[]> {
  const { data, error } = await db()
    .from('test_prep_proposals')
    .select('*')
    .eq('student_id', studentId)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Failed to get proposals: ${error.message}`);
  return (data || []) as TestPrepProposal[];
}

/** 提案書を科目・単元付きで取得 */
export async function getTestPrepProposalWithDetails(
  proposalId: string
): Promise<TestPrepProposalWithDetails | null> {
  const { data, error } = await db()
    .from('test_prep_proposals')
    .select(`
      *,
      student:students(*),
      exam_type:exam_types(id, name)
    `)
    .eq('id', proposalId)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get proposal: ${error.message}`);
  }

  const { data: subjects, error: subError } = await db()
    .from('test_prep_proposal_subjects')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('sort_order');
  if (subError) throw new Error(`Failed to get subjects: ${subError.message}`);

  const subjectIds = (subjects || []).map((s: TestPrepProposalSubject) => s.id);
  let units: TestPrepProposalUnit[] = [];
  if (subjectIds.length > 0) {
    const { data: unitData, error: unitError } = await db()
      .from('test_prep_proposal_units')
      .select('*')
      .in('subject_id', subjectIds)
      .order('sort_order');
    if (unitError) throw new Error(`Failed to get units: ${unitError.message}`);
    units = (unitData || []) as TestPrepProposalUnit[];
  }

  const subjectsWithUnits = (subjects || []).map((s: TestPrepProposalSubject) => ({
    ...s,
    units: units.filter((u: TestPrepProposalUnit) => u.subject_id === s.id),
  }));

  let teacher: { display_name: string | null; email: string | null } | undefined;
  if (data.teacher_user_id) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, email')
      .eq('id', data.teacher_user_id)
      .single();
    if (profile) teacher = profile;
  }

  return {
    ...(data as TestPrepProposal),
    subjects: subjectsWithUnits,
    student: data.student ?? undefined,
    exam_type: data.exam_type ?? undefined,
    teacher,
  } as TestPrepProposalWithDetails;
}

/** 提案書の科目・単元入力データ型 */
type TestPrepSubjectInput = {
  subject_name: string;
  target_score?: number | null;
  sort_order: number;
  units: Array<{
    curriculum_item_id?: number | null;
    unit_name: string;
    self_assessment?: string | null;
    koma_count: number;
    group_id?: string | null;
    sort_order: number;
  }>;
};

/**
 * 科目とその単元を一括挿入する。
 * 旧実装は科目ごとに「科目INSERT→単元INSERT」を逐次 await していた（科目数×2クエリ）。
 * 科目を1クエリでまとめて挿入して subject_id を取得し、全科目の単元を1クエリで挿入する（計2クエリ）。
 * PostgREST の一括 INSERT は入力順で行を返すため、index で subject_id を対応付ける。
 */
async function insertTestPrepSubjectsWithUnits(
  proposalId: string,
  subjects: TestPrepSubjectInput[]
): Promise<void> {
  if (subjects.length === 0) return;

  const subjectRows = subjects.map((subj, i) => ({
    proposal_id: proposalId,
    subject_name: subj.subject_name,
    target_score: subj.target_score ?? null,
    proposed_koma: subj.units.reduce((sum, u) => sum + u.koma_count, 0),
    sort_order: subj.sort_order ?? i,
  }));

  const { data: insertedSubjects, error: subjError } = await db()
    .from('test_prep_proposal_subjects')
    .insert(subjectRows)
    .select('id');
  if (subjError) throw new Error(`Failed to create subjects: ${subjError.message}`);

  const subjIds = (insertedSubjects || []) as Array<{ id: string }>;
  if (subjIds.length !== subjects.length) {
    throw new Error('科目の作成結果が入力と一致しません');
  }

  const allUnitRows = subjects.flatMap((subj, i) =>
    subj.units.map((u, ui) => ({
      subject_id: subjIds[i].id,
      curriculum_item_id: u.curriculum_item_id ?? null,
      unit_name: u.unit_name,
      self_assessment: u.self_assessment ?? null,
      koma_count: u.koma_count,
      group_id: u.group_id ?? null,
      sort_order: u.sort_order ?? ui,
    }))
  );

  if (allUnitRows.length > 0) {
    const { error: unitError } = await db()
      .from('test_prep_proposal_units')
      .insert(allUnitRows);
    if (unitError) throw new Error(`Failed to create units: ${unitError.message}`);
  }
}

/** 提案書を作成（科目・単元も一括保存） */
export async function createTestPrepProposal(
  proposal: TestPrepProposalInsert,
  subjects: TestPrepSubjectInput[]
): Promise<TestPrepProposal> {
  const { data, error } = await db()
    .from('test_prep_proposals')
    .insert(proposal)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create proposal: ${error.message}`);
  const created = data as TestPrepProposal;

  await insertTestPrepSubjectsWithUnits(created.id, subjects);

  return created;
}

/** 提案書メタデータを更新 */
export async function updateTestPrepProposal(
  id: string,
  patch: Partial<Pick<TestPrepProposal, 'title' | 'status' | 'notes' | 'exam_type_id' | 'zoukoma_period_id'>>
): Promise<TestPrepProposal> {
  const { data, error } = await db()
    .from('test_prep_proposals')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to update proposal: ${error.message}`);
  return data as TestPrepProposal;
}

/** 提案書を削除（CASCADE で科目・単元も削除） */
export async function deleteTestPrepProposal(id: string): Promise<void> {
  const { error } = await db()
    .from('test_prep_proposals')
    .delete()
    .eq('id', id);
  if (error) throw new Error(`Failed to delete proposal: ${error.message}`);
}

// ========== Subjects ==========

/** 科目を全置き換え（既存削除→再作成） */
export async function replaceTestPrepSubjects(
  proposalId: string,
  subjects: TestPrepSubjectInput[]
): Promise<void> {
  const { error: delError } = await db()
    .from('test_prep_proposal_subjects')
    .delete()
    .eq('proposal_id', proposalId);
  if (delError) throw new Error(`Failed to delete subjects: ${delError.message}`);

  await insertTestPrepSubjectsWithUnits(proposalId, subjects);
}

// ========== 公開取得（service role 経由） ==========

/** token で公開提案書を取得（公開ページ用、/api/test-prep/public 経由） */
export async function getTestPrepProposalByToken(
  token: string
): Promise<TestPrepProposalWithDetails | null> {
  const res = await fetch(`/api/test-prep/public?token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error('Failed to fetch proposal');
  }
  return res.json();
}
