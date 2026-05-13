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
  Textbook,
  Student,
} from '@/types/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromProposals = () => supabase.from('seasonal_proposals' as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromProposalUnits = () => supabase.from('seasonal_proposal_units' as any);

// ============================================
// 提案書 CRUD
// ============================================

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

export async function getProposal(
  id: string
): Promise<SeasonalProposalWithDetails | null> {
  const { data, error } = await fromProposals()
    .select(`
      *,
      student:students(*),
      textbook:textbooks(*),
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
    student: row.student as Student | undefined,
    textbook: row.textbook as Textbook | undefined,
    student_textbook: row.student_textbook as SeasonalProposalWithDetails['student_textbook'],
    units: (units ?? []) as unknown as SeasonalProposalUnit[],
  };
}

/**
 * 生徒の提案書一覧を取得
 */
export async function getProposalsByStudent(
  studentId: string
): Promise<SeasonalProposalWithDetails[]> {
  const { data, error } = await fromProposals()
    .select(`
      *,
      student:students(*),
      textbook:textbooks(*)
    `)
    .eq('student_id', studentId)
    .order('year', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`提案書一覧の取得に失敗しました: ${error.message}`);
  }

  const proposals = (data ?? []) as unknown as (SeasonalProposal & Record<string, unknown>)[];
  if (proposals.length === 0) return [];

  const proposalIds = proposals.map((d) => d.id);
  const { data: allUnits } = await fromProposalUnits()
    .select('*')
    .in('proposal_id', proposalIds);

  const unitsByProposal = new Map<string, SeasonalProposalUnit[]>();
  for (const u of (allUnits ?? []) as unknown as SeasonalProposalUnit[]) {
    const list = unitsByProposal.get(u.proposal_id) ?? [];
    list.push(u);
    unitsByProposal.set(u.proposal_id, list);
  }

  return proposals.map((d) => ({
    ...d,
    student: d.student as Student | undefined,
    textbook: d.textbook as Textbook | undefined,
    units: unitsByProposal.get(d.id) ?? [],
  })) as SeasonalProposalWithDetails[];
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

  // 対象生徒を特定
  const { data: studentList } = await supabase
    .from('students')
    .select('id')
    .in('school_id', schoolIds)
    .eq('status', 'active');

  if (!studentList || studentList.length === 0) return [];
  const studentIds = (studentList as { id: string }[]).map((s) => s.id);

  let query = fromProposals()
    .select(`
      *,
      student:students(*),
      textbook:textbooks(*)
    `)
    .in('student_id', studentIds)
    .order('updated_at', { ascending: false });

  if (season) query = query.eq('season', season);
  if (year) query = query.eq('year', year);

  const { data, error } = await query;
  if (error) {
    throw new Error(`教室の提案書取得に失敗しました: ${error.message}`);
  }

  const proposalIds = ((data ?? []) as unknown as { id: string }[]).map((d) => d.id);
  if (proposalIds.length === 0) return [];

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
    student: d.student as Student | undefined,
    textbook: d.textbook as Textbook | undefined,
    units: unitsByProposal.get(d.id) ?? [],
  })) as SeasonalProposalWithDetails[];
}

// ============================================
// 提案単元の一括保存
// ============================================

export interface ProposalUnitInput {
  curriculum_item_id: number;
  koma_count: number;
  applied_koma: number | null;
  reason: string;
  group_id: number;
  intent_tag: string | null;
}

export async function saveProposalUnits(
  proposalId: string,
  units: ProposalUnitInput[]
): Promise<SeasonalProposalUnit[]> {
  const { error: delErr } = await fromProposalUnits()
    .delete()
    .eq('proposal_id', proposalId);

  if (delErr) {
    throw new Error(`既存単元の削除に失敗しました: ${delErr.message}`);
  }

  if (units.length === 0) return [];

  const inserts: SeasonalProposalUnitInsert[] = units.map((u, i) => ({
    proposal_id: proposalId,
    curriculum_item_id: u.curriculum_item_id,
    koma_count: u.koma_count,
    applied_koma: u.applied_koma,
    reason: u.reason,
    group_id: u.group_id,
    intent_tag: u.intent_tag,
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

export async function upsertProposal(params: {
  id?: string;
  studentId: string;
  textbookId: number;
  studentTextbookId?: string | null;
  season: SeasonType;
  year: number;
  theme: string;
  status?: SeasonalProposal['status'];
  notes?: string | null;
  units: ProposalUnitInput[];
}): Promise<SeasonalProposalWithDetails> {
  const {
    id,
    studentId,
    textbookId,
    studentTextbookId,
    season,
    year,
    theme,
    status,
    notes,
    units,
  } = params;

  const appliedKoma = calcTotalAppliedKoma(units);

  let proposal: SeasonalProposal;

  if (id) {
    proposal = await updateProposal(id, {
      theme,
      status,
      applied_koma: appliedKoma,
      notes,
    });
  } else {
    proposal = await createProposal({
      student_id: studentId,
      textbook_id: textbookId,
      student_textbook_id: studentTextbookId ?? null,
      season,
      year,
      theme,
      status: status ?? 'draft',
      applied_koma: appliedKoma,
      notes,
    });
  }

  await saveProposalUnits(proposal.id, units);

  const full = await getProposal(proposal.id);
  return full!;
}

// ============================================
// テキスト全単元 + 進捗情報の取得
// ============================================

/**
 * テキストのカリキュラムと進捗を取得
 * studentTextbookId が null の場合は進捗なしでカリキュラムのみ返す
 */
export async function getTextbookUnitsWithProgress(
  studentTextbookId: string | null,
  textbookId: number
): Promise<{
  items: CurriculumItem[];
  progressMap: Map<number, StudentProgress>;
}> {
  const { data: items, error: iErr } = await supabase
    .from('curriculum_items')
    .select('*')
    .eq('textbook_id', textbookId)
    .order('sort_order', { ascending: true });

  if (iErr) {
    throw new Error(`カリキュラム取得に失敗しました: ${iErr.message}`);
  }

  const progressMap = new Map<number, StudentProgress>();

  if (studentTextbookId) {
    const { data: progress, error: pErr } = await supabase
      .from('student_progress')
      .select('*')
      .eq('student_textbook_id', studentTextbookId);

    if (pErr) {
      throw new Error(`進捗取得に失敗しました: ${pErr.message}`);
    }

    for (const p of (progress ?? []) as unknown as StudentProgress[]) {
      progressMap.set(p.curriculum_item_id, p);
    }
  }

  return {
    items: (items ?? []) as CurriculumItem[],
    progressMap,
  };
}

// ============================================
// 進行表連携
// ============================================

/**
 * 提案書の単元を進行表 (student_progress.proposal_count) に一括反映
 * student_textbook が未作成の場合は先に作成する
 */
export async function syncProposalToProgress(
  proposalId: string
): Promise<{ studentTextbookId: string; textbookCreated: boolean }> {
  const proposal = await getProposal(proposalId);
  if (!proposal) throw new Error('提案書が見つかりません');

  let stbId = proposal.student_textbook_id;
  let textbookCreated = false;

  // student_textbook が未紐付けの場合は作成
  if (!stbId) {
    // 既存の student_textbook を探す
    const { data: existing } = await supabase
      .from('student_textbooks')
      .select('id')
      .eq('student_id', proposal.student_id)
      .eq('textbook_id', proposal.textbook_id)
      .maybeSingle();

    if (existing) {
      stbId = (existing as { id: string }).id;
      // 既存テキストの track_progress を有効化
      await supabase
        .from('student_textbooks')
        .update({ track_progress: true })
        .eq('id', stbId);
    } else {
      // 生徒の school_id を取得
      const { data: student } = await supabase
        .from('students')
        .select('school_id')
        .eq('id', proposal.student_id)
        .single();

      if (!student) throw new Error('生徒情報が取得できません');

      const { data: newStb, error: stbErr } = await supabase
        .from('student_textbooks')
        .insert({
          school_id: (student as { school_id: string }).school_id,
          student_id: proposal.student_id,
          textbook_id: proposal.textbook_id,
          is_active: true,
          is_draft: true,
          track_progress: true,
          season: proposal.season,
        })
        .select('id')
        .single();

      if (stbErr) throw new Error(`テキスト登録に失敗しました: ${stbErr.message}`);
      stbId = (newStb as { id: string }).id;
      textbookCreated = true;
    }

    // 提案書に student_textbook_id を紐付け
    await updateProposal(proposalId, { student_textbook_id: stbId });
  }

  // group_id ごとのコマ数を集計（group_id=0 は未グループ＝個別カウント）
  const groupKoma = new Map<number, number>();
  for (const u of proposal.units) {
    if (u.group_id > 0 && !groupKoma.has(u.group_id)) {
      groupKoma.set(u.group_id, u.koma_count);
    }
  }

  const unitKomaMap = new Map<number, number>();
  for (const u of proposal.units) {
    if (u.group_id > 0) {
      unitKomaMap.set(u.curriculum_item_id, groupKoma.get(u.group_id) ?? u.koma_count);
    } else {
      unitKomaMap.set(u.curriculum_item_id, u.koma_count);
    }
  }

  // student_progress を upsert
  const entries = Array.from(unitKomaMap.entries());
  for (const [ciId, komaCount] of entries) {
    const { data: existing } = await supabase
      .from('student_progress')
      .select('id')
      .eq('student_textbook_id', stbId)
      .eq('curriculum_item_id', ciId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('student_progress')
        .update({ proposal_count: komaCount })
        .eq('id', (existing as { id: string }).id);
    } else {
      await supabase
        .from('student_progress')
        .insert({
          student_textbook_id: stbId,
          curriculum_item_id: ciId,
          proposal_count: komaCount,
        });
    }
  }

  return { studentTextbookId: stbId!, textbookCreated };
}

/**
 * 申し込みコマ数を進行表の application_count に反映
 */
export async function syncApplicationToProgress(
  proposalId: string
): Promise<void> {
  const proposal = await getProposal(proposalId);
  if (!proposal || !proposal.student_textbook_id) {
    throw new Error('提案書またはテキスト紐付けがありません');
  }

  for (const u of proposal.units) {
    const count = u.applied_koma ?? u.koma_count;
    await supabase
      .from('student_progress')
      .update({ application_count: count })
      .eq('student_textbook_id', proposal.student_textbook_id)
      .eq('curriculum_item_id', u.curriculum_item_id);
  }
}

// ============================================
// 公開（approved）ワンショット
// ============================================

/**
 * 提案書を「公開」にする
 * 1. 進行表に未反映なら反映（syncProposalToProgress）
 * 2. 申込コマ数を進行表に転記（syncApplicationToProgress）
 * 3. student_textbook の is_draft を false に（講師に公開）
 * 4. ステータスを approved に更新
 */
export async function publishProposal(proposalId: string): Promise<void> {
  // 進行表に反映（未反映の場合のみ内部で作成）
  const { studentTextbookId } = await syncProposalToProgress(proposalId);

  // 申込コマ数を転記
  await syncApplicationToProgress(proposalId);

  // 講師に公開
  await supabase
    .from('student_textbooks')
    .update({ is_draft: false })
    .eq('id', studentTextbookId);

  // ステータス更新
  await updateProposal(proposalId, { status: 'approved' });
}

/**
 * 複数の提案書を一括公開
 */
export async function bulkPublishProposals(proposalIds: string[]): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  for (const id of proposalIds) {
    try {
      await publishProposal(id);
      success++;
    } catch (e) {
      console.error(`提案書 ${id} の公開に失敗:`, e);
      failed++;
    }
  }
  return { success, failed };
}

// ============================================
// コマ数集計ヘルパー
// ============================================

/**
 * group_id ベースで実質コマ数を計算
 * 同一 group_id の単元は1コマとしてカウント
 */
export function calcTotalKoma(units: { group_id: number; koma_count: number }[]): number {
  let total = 0;
  const seen = new Set<number>();
  for (const u of units) {
    if (u.group_id === 0) {
      total += u.koma_count;
    } else if (!seen.has(u.group_id)) {
      seen.add(u.group_id);
      total += u.koma_count;
    }
  }
  return total;
}

export function calcTotalAppliedKoma(units: { group_id: number; applied_koma: number | null }[]): number | null {
  const withApplied = units.filter((u) => u.applied_koma != null && u.applied_koma > 0);
  if (withApplied.length === 0) return null;
  let total = 0;
  const seen = new Set<number>();
  for (const u of withApplied) {
    if (u.group_id === 0) {
      total += u.applied_koma!;
    } else if (!seen.has(u.group_id)) {
      seen.add(u.group_id);
      total += u.applied_koma!;
    }
  }
  return total;
}
