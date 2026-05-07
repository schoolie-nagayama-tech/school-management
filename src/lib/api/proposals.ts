import { supabase } from '@/lib/supabase';
import type {
  SeasonalProposal,
  SeasonalProposalInsert,
  SeasonalProposalUpdate,
  SeasonalProposalUnit,
  SeasonalProposalUnitInsert,
  SeasonalProposalWithDetails,
  SeasonType,
  CurriculumItem,
  StudentProgress,
} from '@/types/database';

// seasonal_proposals / seasonal_proposal_units は Supabase 生成型に未登録
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromProposals = () => supabase.from('seasonal_proposals' as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromProposalUnits = () => supabase.from('seasonal_proposal_units' as any);

// ============================================
// 提案書 CRUD
// ============================================

/**
 * 提案書を作成
 */
export async function createProposal(
  data: SeasonalProposalInsert
): Promise<SeasonalProposal> {
  const { data: row, error } = await fromProposals()
    .insert(data)
    .select()
    .single();

  if (error) {
    throw new Error(`提案書の作成に失敗しました: ${error.message}`);
  }
  return row as unknown as SeasonalProposal;
}

/**
 * 提案書を更新
 */
export async function updateProposal(
  id: string,
  patch: SeasonalProposalUpdate
): Promise<SeasonalProposal> {
  const { data: row, error } = await fromProposals()
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`提案書の更新に失敗しました: ${error.message}`);
  }
  return row as unknown as SeasonalProposal;
}

/**
 * 提案書を削除
 */
export async function deleteProposal(id: string): Promise<void> {
  const { error } = await fromProposals()
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`提案書の削除に失敗しました: ${error.message}`);
  }
}

// ============================================
// 提案書取得
// ============================================

/**
 * 提案書を詳細付きで取得
 */
export async function getProposal(
  id: string
): Promise<SeasonalProposalWithDetails | null> {
  const { data, error } = await fromProposals()
    .select(`
      *,
      student_textbook:student_textbooks(
        *,
        textbook:textbooks(*),
        student:students(*)
      )
    `)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`提案書の取得に失敗しました: ${error.message}`);
  }
  if (!data) return null;

  // 単元明細を取得
  const { data: units, error: uErr } = await fromProposalUnits()
    .select(`
      *,
      curriculum_item:curriculum_items(*)
    `)
    .eq('proposal_id', id)
    .order('sort_order', { ascending: true });

  if (uErr) {
    throw new Error(`提案単元の取得に失敗しました: ${uErr.message}`);
  }

  const row = data as unknown as Record<string, unknown>;
  return {
    ...(row as unknown as SeasonalProposal),
    student_textbook: row.student_textbook as SeasonalProposalWithDetails['student_textbook'],
    units: (units ?? []) as unknown as SeasonalProposalUnit[],
  };
}

/**
 * 生徒テキストの提案書一覧を取得
 */
export async function getProposalsByStudentTextbook(
  studentTextbookId: string
): Promise<SeasonalProposal[]> {
  const { data, error } = await fromProposals()
    .select('*')
    .eq('student_textbook_id', studentTextbookId)
    .order('year', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`提案書一覧の取得に失敗しました: ${error.message}`);
  }
  return (data ?? []) as unknown as SeasonalProposal[];
}

/**
 * 教室の提案書一覧（教室長フィード用）
 */
export async function getProposalsBySchool(
  schoolIds: string[],
  season?: SeasonType,
  year?: number
): Promise<SeasonalProposalWithDetails[]> {
  if (schoolIds.length === 0) return [];

  // 対象 student_textbooks を特定
  const { data: stList } = await supabase
    .from('student_textbooks')
    .select('id')
    .in('school_id', schoolIds)
    .eq('is_active', true);

  if (!stList || stList.length === 0) return [];
  const stIds = (stList as { id: string }[]).map((st) => st.id);

  let query = fromProposals()
    .select(`
      *,
      student_textbook:student_textbooks(
        *,
        textbook:textbooks(*),
        student:students(*)
      )
    `)
    .in('student_textbook_id', stIds)
    .order('updated_at', { ascending: false });

  if (season) query = query.eq('season', season);
  if (year) query = query.eq('year', year);

  const { data, error } = await query;
  if (error) {
    throw new Error(`教室の提案書取得に失敗しました: ${error.message}`);
  }

  // 各提案の単元を一括取得
  const proposalIds = ((data ?? []) as unknown as { id: string }[]).map((d) => d.id);
  const { data: allUnits } = await fromProposalUnits()
    .select('*')
    .in('proposal_id', proposalIds);

  const unitsByProposal = new Map<string, SeasonalProposalUnit[]>();
  for (const u of (allUnits ?? []) as unknown as SeasonalProposalUnit[]) {
    const list = unitsByProposal.get(u.proposal_id) ?? [];
    list.push(u);
    unitsByProposal.set(u.proposal_id, list);
  }

  return ((data ?? []) as unknown as (SeasonalProposal & Record<string, unknown>)[]).map((d) => ({
    ...d,
    student_textbook: d.student_textbook as SeasonalProposalWithDetails['student_textbook'],
    units: unitsByProposal.get(d.id) ?? [],
  })) as SeasonalProposalWithDetails[];
}

// ============================================
// 提案単元の一括保存
// ============================================

export interface ProposalUnitInput {
  curriculum_item_id: number;
  koma_count: number;
  reason: string;
}

/**
 * 提案単元を一括保存（既存を全て差し替え）
 */
export async function saveProposalUnits(
  proposalId: string,
  units: ProposalUnitInput[]
): Promise<SeasonalProposalUnit[]> {
  // 既存を削除
  const { error: delErr } = await fromProposalUnits()
    .delete()
    .eq('proposal_id', proposalId);

  if (delErr) {
    throw new Error(`既存単元の削除に失敗しました: ${delErr.message}`);
  }

  if (units.length === 0) return [];

  // 新規挿入
  const inserts: SeasonalProposalUnitInsert[] = units.map((u, i) => ({
    proposal_id: proposalId,
    curriculum_item_id: u.curriculum_item_id,
    koma_count: u.koma_count,
    reason: u.reason,
    sort_order: i,
  }));

  const { data, error } = await fromProposalUnits()
    .insert(inserts)
    .select();

  if (error) {
    throw new Error(`提案単元の保存に失敗しました: ${error.message}`);
  }
  return (data ?? []) as unknown as SeasonalProposalUnit[];
}

// ============================================
// 提案書 作成/更新 ワンショット
// ============================================

/**
 * 提案書の作成 or 更新をまとめて行う
 */
export async function upsertProposal(params: {
  id?: string;
  studentTextbookId: string;
  season: SeasonType;
  year: number;
  theme: string;
  status?: SeasonalProposal['status'];
  notes?: string | null;
  units: ProposalUnitInput[];
}): Promise<SeasonalProposalWithDetails> {
  const {
    id,
    studentTextbookId,
    season,
    year,
    theme,
    status,
    notes,
    units,
  } = params;

  let proposal: SeasonalProposal;

  if (id) {
    // 更新
    proposal = await updateProposal(id, {
      theme,
      status,
      notes,
    });
  } else {
    // 新規作成
    proposal = await createProposal({
      student_textbook_id: studentTextbookId,
      season,
      year,
      theme,
      status: status ?? 'draft',
      notes,
    });
  }

  // 単元を保存
  await saveProposalUnits(proposal.id, units);

  // 詳細を返す
  const full = await getProposal(proposal.id);
  return full!;
}

// ============================================
// テキスト全単元 + 進捗情報の取得
// ============================================

/**
 * テキストの全カリキュラム項目と生徒の進捗を取得
 * 提案書作成画面で使う
 */
export async function getTextbookUnitsWithProgress(
  studentTextbookId: string,
  textbookId: number
): Promise<{
  items: CurriculumItem[];
  progressMap: Map<number, StudentProgress>;
}> {
  // カリキュラム項目
  const { data: items, error: iErr } = await supabase
    .from('curriculum_items')
    .select('*')
    .eq('textbook_id', textbookId)
    .order('sort_order', { ascending: true });

  if (iErr) {
    throw new Error(`カリキュラム取得に失敗しました: ${iErr.message}`);
  }

  // 生徒の進捗
  const { data: progress, error: pErr } = await supabase
    .from('student_progress')
    .select('*')
    .eq('student_textbook_id', studentTextbookId);

  if (pErr) {
    throw new Error(`進捗取得に失敗しました: ${pErr.message}`);
  }

  const progressMap = new Map<number, StudentProgress>();
  for (const p of (progress ?? []) as unknown as StudentProgress[]) {
    progressMap.set(p.curriculum_item_id, p);
  }

  return {
    items: (items ?? []) as CurriculumItem[],
    progressMap,
  };
}
