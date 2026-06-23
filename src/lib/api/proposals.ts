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
import {
  createSeasonalCourse,
  addTextbookToCourse,
  saveBulkCourseCurriculum,
} from './seasonalCourses';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromProposals = () => supabase.from('seasonal_proposals' as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromProposalUnits = () => supabase.from('seasonal_proposal_units' as any);

/**
 * proposal_ids に紐づくユニットを全件取得する。
 * PostgREST のデフォルト 1000 行上限に当たらないよう、proposal_id を小バッチで
 * チャンクして取得する。.range() ベースのページネーションは ORDER BY 無しだと
 * ページ間で同じ行が重複するケースがあるため使わない。
 * 1 提案書あたりの最大ユニット数は実データで 55 程度なので、15 提案書/バッチで
 * 1 クエリあたり 825 行以下に抑え、安全マージンを確保する。
 * 重複防止のため id ベースで dedup する（バッチ境界での意図せぬ重複を保険として除外）。
 */
async function fetchAllUnitsByProposalIds(proposalIds: string[]): Promise<SeasonalProposalUnit[]> {
  if (proposalIds.length === 0) return [];
  const BATCH = 15;
  const all: SeasonalProposalUnit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < proposalIds.length; i += BATCH) {
    const batch = proposalIds.slice(i, i + BATCH);
    const { data, error } = await fromProposalUnits().select('*').in('proposal_id', batch);
    if (error) {
      // 失敗時は取得済み分で打ち切り（一覧表示が完全に止まるよりは良い）
      break;
    }
    const page = (data ?? []) as unknown as (SeasonalProposalUnit & { id?: string })[];
    for (const u of page) {
      if (u.id) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
      }
      all.push(u);
    }
  }
  return all;
}

// ============================================
// 提案書 CRUD
// ============================================

export async function createProposal(data: SeasonalProposalInsert): Promise<SeasonalProposal> {
  const { data: row, error } = await fromProposals().insert(data).select().single();

  if (error) {
    throw new Error(`提案書の作成に失敗しました: ${error.message}`);
  }
  return row as unknown as SeasonalProposal;
}

export async function updateProposal(
  id: string,
  patch: SeasonalProposalUpdate
): Promise<SeasonalProposal> {
  const { data: row, error } = await fromProposals().update(patch).eq('id', id).select().single();

  if (error) {
    throw new Error(`提案書の更新に失敗しました: ${error.message}`);
  }
  return row as unknown as SeasonalProposal;
}

export async function deleteProposal(id: string): Promise<void> {
  const { error } = await fromProposals().delete().eq('id', id);

  if (error) {
    throw new Error(`提案書の削除に失敗しました: ${error.message}`);
  }
}

// ============================================
// 提案書取得
// ============================================

export async function getProposal(id: string): Promise<SeasonalProposalWithDetails | null> {
  const { data, error } = await fromProposals()
    .select(
      `
      *,
      student:students(*),
      textbook:textbooks(*),
      student_textbook:student_textbooks(
        *,
        textbook:textbooks(*),
        student:students(*)
      )
    `
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`提案書の取得に失敗しました: ${error.message}`);
  }
  if (!data) return null;

  const { data: units, error: uErr } = await fromProposalUnits()
    .select(
      `
      *,
      curriculum_item:curriculum_items(*)
    `
    )
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
    .select(
      `
      *,
      student:students(*),
      textbook:textbooks(*)
    `
    )
    .eq('student_id', studentId)
    .order('year', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`提案書一覧の取得に失敗しました: ${error.message}`);
  }

  const proposals = (data ?? []) as unknown as (SeasonalProposal & Record<string, unknown>)[];
  if (proposals.length === 0) return [];

  const proposalIds = proposals.map((d) => d.id);
  const allUnits = await fetchAllUnitsByProposalIds(proposalIds);

  const unitsByProposal = new Map<string, SeasonalProposalUnit[]>();
  for (const u of allUnits) {
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

  // 提案書は (生徒数 × 年度 × 科目) でスケールし、複数教室選択時に 1000 行を超えうる。
  // PostgREST のデフォルト上限で静かに切り捨てられると一覧から提案書が欠落するため、
  // .range() で 1000 件ずつ全件ページング取得する。updated_at は一意でなくページ境界で
  // 行が重複/欠落しうるので、安定化のため id を第2ソートキーに加える。
  const PAGE_SIZE = 1000;
  const data: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = fromProposals()
      .select(
        `
        *,
        student:students(*),
        textbook:textbooks(*)
      `
      )
      .in('school_id', schoolIds)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (season) query = query.eq('season', season);
    if (year) query = query.eq('year', year);

    const { data: page, error } = await query;
    if (error) {
      throw new Error(`教室の提案書取得に失敗しました: ${error.message}`);
    }
    const rows = (page ?? []) as unknown[];
    data.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  const proposalIds = (data as { id: string }[]).map((d) => d.id);
  if (proposalIds.length === 0) return [];

  const allUnits = await fetchAllUnitsByProposalIds(proposalIds);

  const unitsByProposal = new Map<string, SeasonalProposalUnit[]>();
  for (const u of allUnits) {
    const list = unitsByProposal.get(u.proposal_id) ?? [];
    list.push(u);
    unitsByProposal.set(u.proposal_id, list);
  }

  return (data as unknown as (SeasonalProposal & Record<string, unknown>)[]).map((d) => ({
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
  // 申込専用の結合グループ（提案グループ group_id とは独立）
  applied_group_id: number;
  intent_tag: string | null;
}

export async function saveProposalUnits(
  proposalId: string,
  units: ProposalUnitInput[]
): Promise<SeasonalProposalUnit[]> {
  const { error: delErr } = await fromProposalUnits().delete().eq('proposal_id', proposalId);

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
    applied_group_id: u.applied_group_id,
    intent_tag: u.intent_tag,
    sort_order: i,
  }));

  const { data, error } = await fromProposalUnits().insert(inserts).select();

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
  schoolId?: string | null;
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
    schoolId,
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
      school_id: schoolId ?? null,
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

  // 既に紐付け済みの場合でも track_progress を有効化（テンプレ適用で作った下書きは false のままなので公開時にONにする）
  if (stbId) {
    await supabase.from('student_textbooks').update({ track_progress: true }).eq('id', stbId);
  }

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
      await supabase.from('student_textbooks').update({ track_progress: true }).eq('id', stbId);
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

  // 提案結合(group_id)を進行表へ転記する。
  // 進行表は「グループの先頭行に合計・他は0」を表示する作り（旧UIはセル結合 / 新UIは先頭行のみ表示）なので、
  // group_id ごとに先頭行(units は sort_order 昇順)へ合計コマを集約し、他の行は 0 にする。
  // 先頭の koma_count がそのグループの合計（calcTotalKoma が先頭1件で計上するのと整合）。
  const propGroupHead = new Map<number, number>(); // group_id -> 先頭 curriculum_item_id
  const propGroupTotal = new Map<number, number>(); // group_id -> 合計コマ（先頭の koma_count）
  const propGroupCount = new Map<number, number>(); // group_id -> 構成単元数
  for (const u of proposal.units) {
    if (u.group_id > 0) {
      if (!propGroupHead.has(u.group_id)) {
        propGroupHead.set(u.group_id, u.curriculum_item_id);
        propGroupTotal.set(u.group_id, u.koma_count);
      }
      propGroupCount.set(u.group_id, (propGroupCount.get(u.group_id) ?? 0) + 1);
    }
  }

  // student_progress を一括 upsert
  // 旧実装は curriculum_item ごとに select→update/insert していた（40〜50件で80〜100クエリ）。
  // 複合ユニーク制約 (student_textbook_id, curriculum_item_id) を使い1回の upsert にまとめる。
  // upsert はペイロードの列のみ更新するため、既存行の application_count 等は保持される。
  if (proposal.units.length > 0) {
    const payload = proposal.units.map((u) => {
      // 2件以上で実際に結合されているグループのみまとめ表示の対象にする（単独はそのまま個別）。
      const grouped = u.group_id > 0 && (propGroupCount.get(u.group_id) ?? 0) >= 2;
      const isHead = grouped && propGroupHead.get(u.group_id) === u.curriculum_item_id;
      return {
        student_textbook_id: stbId,
        curriculum_item_id: u.curriculum_item_id,
        // 結合: 先頭行に合計・他は0 / 非結合: 単元の koma_count
        proposal_count: grouped
          ? isHead
            ? (propGroupTotal.get(u.group_id) ?? u.koma_count)
            : 0
          : u.koma_count,
        // 再公開時に結合解除を反映できるよう、非結合は明示的に null を書く
        group_number: grouped ? u.group_id : null,
      };
    });
    const { error: upsertError } = await supabase
      .from('student_progress')
      .upsert(payload, { onConflict: 'student_textbook_id,curriculum_item_id' });
    if (upsertError) throw new Error(`進行表への反映に失敗しました: ${upsertError.message}`);
  }

  return { studentTextbookId: stbId!, textbookCreated };
}

/**
 * 申し込みコマ数を進行表の application_count に反映
 */
export async function syncApplicationToProgress(proposalId: string): Promise<void> {
  const proposal = await getProposal(proposalId);
  if (!proposal || !proposal.student_textbook_id) {
    throw new Error('提案書またはテキスト紐付けがありません');
  }

  // 申込結合(applied_group_id)を進行表へ転記する。
  // 提案結合と同様に「グループの先頭行に合計・他は0」で持たせ、進行表でまとめ表示できるようにする。
  // 申込結合は提案結合(group_id)とは別グループになりうるため、applied_group_number 列に独立して持つ。
  // 申込コマ>0 の単元のみを結合対象とする（提案書エディタの appliedGroupMap と同じ判定）。
  const appliedHead = new Map<number, number>(); // applied_group_id -> 先頭 curriculum_item_id
  const appliedTotal = new Map<number, number>(); // applied_group_id -> 合計（先頭の applied_koma）
  const appliedCount = new Map<number, number>(); // applied_group_id -> 申込>0 の構成単元数
  for (const u of proposal.units) {
    const ak = u.applied_koma ?? 0;
    if (u.applied_group_id > 0 && ak > 0) {
      if (!appliedHead.has(u.applied_group_id)) {
        appliedHead.set(u.applied_group_id, u.curriculum_item_id);
        appliedTotal.set(u.applied_group_id, ak);
      }
      appliedCount.set(u.applied_group_id, (appliedCount.get(u.applied_group_id) ?? 0) + 1);
    }
  }

  // 各単元の application_count と applied_group_number を決める。
  // クエリ数を抑えるため (申込コマ値, 申込グループ番号) の組ごとに1回の UPDATE にまとめる。
  const byKey = new Map<string, number[]>();
  const keyMeta = new Map<string, { count: number; group: number | null }>();
  for (const u of proposal.units) {
    const grouped =
      u.applied_group_id > 0 &&
      (u.applied_koma ?? 0) > 0 &&
      (appliedCount.get(u.applied_group_id) ?? 0) >= 2;
    const isHead = grouped && appliedHead.get(u.applied_group_id) === u.curriculum_item_id;
    // 結合: 先頭行に合計・他は0 / 非結合: 申込コマ（未入力なら提案コマ）
    const count = grouped
      ? isHead
        ? (appliedTotal.get(u.applied_group_id) ?? 0)
        : 0
      : (u.applied_koma ?? u.koma_count);
    const group = grouped ? u.applied_group_id : null;
    const key = `${count}|${group ?? 'null'}`;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      keyMeta.set(key, { count, group });
    }
    byKey.get(key)!.push(u.curriculum_item_id);
  }

  await Promise.all(
    Array.from(byKey.entries()).map(([key, ids]) => {
      const meta = keyMeta.get(key)!;
      return supabase
        .from('student_progress')
        .update({ application_count: meta.count, applied_group_number: meta.group })
        .eq('student_textbook_id', proposal.student_textbook_id!)
        .in('curriculum_item_id', ids);
    })
  );
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
  await supabase.from('student_textbooks').update({ is_draft: false }).eq('id', studentTextbookId);

  // ステータス更新
  await updateProposal(proposalId, { status: 'approved' });
}

/**
 * 複数の提案書を一括公開
 */
export async function bulkPublishProposals(
  proposalIds: string[]
): Promise<{ success: number; failed: number }> {
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

/**
 * 提案書を「提案済み(sent)」にする。
 * ProposalEditor の sent 遷移と同じロジック:
 * - applied_koma を提案コマ(koma_count)で初期化（申込コマの入力起点をつくる）
 * - 申込結合(applied_group_id)が未設定なら提案結合(group_id)に合わせる（申込合計の二重計上防止）
 * - 進行表へは反映しない（反映は公開=approved 時のみ）
 * draft からの遷移を想定。すでに申込を手入力した sent を上書きしないよう、呼び出し側で draft に限定すること。
 */
export async function markProposalSent(proposalId: string): Promise<void> {
  const proposal = await getProposal(proposalId);
  if (!proposal) throw new Error('提案書が見つかりません');

  const unitInputs: ProposalUnitInput[] = (proposal.units ?? [])
    .filter((u) => u.koma_count > 0 || (u.applied_koma ?? 0) > 0)
    .map((u) => ({
      curriculum_item_id: u.curriculum_item_id,
      koma_count: u.koma_count,
      // 提案コマがあれば申込はそれで初期化。提案0・申込ありの単元は申込値を維持。
      applied_koma:
        u.koma_count > 0 ? u.koma_count : (u.applied_koma ?? 0) > 0 ? u.applied_koma : null,
      reason: u.reason,
      group_id: u.group_id,
      applied_group_id: u.applied_group_id > 0 ? u.applied_group_id : u.group_id,
      intent_tag: u.intent_tag,
    }));

  await saveProposalUnits(proposalId, unitInputs);
  const totalApplied = calcTotalAppliedKoma(unitInputs);
  await updateProposal(proposalId, { status: 'sent', applied_koma: totalApplied });
}

/**
 * 複数の提案書を一括で「提案済み」にする（draft → sent）。
 */
export async function bulkMarkProposalsSent(
  proposalIds: string[]
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  for (const id of proposalIds) {
    try {
      await markProposalSent(id);
      success++;
    } catch (e) {
      console.error(`提案書 ${id} の提案済み化に失敗:`, e);
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

// 申込コマ合計。申込結合(applied_group_id)が同じ単元は1コマとしてまとめてカウントする。
// 提案結合(group_id)とは別グループなので、申込側の結合だけで dedup する。
export function calcTotalAppliedKoma(
  units: { applied_group_id: number; applied_koma: number | null }[]
): number | null {
  const withApplied = units.filter((u) => u.applied_koma != null && u.applied_koma > 0);
  if (withApplied.length === 0) return null;
  let total = 0;
  const seen = new Set<number>();
  for (const u of withApplied) {
    if (u.applied_group_id === 0) {
      total += u.applied_koma!;
    } else if (!seen.has(u.applied_group_id)) {
      seen.add(u.applied_group_id);
      total += u.applied_koma!;
    }
  }
  return total;
}

// ============================================
// 提案書 → コースカタログへの昇格
// ============================================

export async function promoteProposalToCourse(
  proposalId: string
): Promise<{ courseId: string; courseName: string }> {
  const proposal = await getProposal(proposalId);
  if (!proposal) throw new Error('提案書が見つかりません');

  const { data: student } = await supabase
    .from('students')
    .select('grade, school_id')
    .eq('id', proposal.student_id)
    .single();
  if (!student) throw new Error('生徒情報が取得できません');

  const schoolId = proposal.school_id ?? (student as { school_id: string }).school_id;
  if (!schoolId) throw new Error('教室IDが特定できません');

  const courseName = proposal.theme || `${proposal.textbook?.name ?? ''} ${proposal.season}講習`;
  const grade = (student as { grade: number }).grade;

  const { data: existing } = await supabase
    .from('seasonal_courses')
    .select('id')
    .eq('school_id', schoolId)
    .eq('name', courseName)
    .eq('season', proposal.season)
    .eq('is_active', true)
    .maybeSingle();

  if (existing) throw new Error('同名の講習が既に存在します');

  const units = (proposal.units ?? []).filter((u) => u.koma_count > 0);
  const totalKoma = calcTotalKoma(
    units.map((u) => ({ group_id: u.group_id, koma_count: u.koma_count }))
  );

  const course = await createSeasonalCourse(schoolId, {
    name: courseName,
    season: proposal.season,
    target_grades: [grade],
    total_koma: totalKoma,
    comment: proposal.notes ?? undefined,
  });

  if (proposal.textbook_id) {
    await addTextbookToCourse(course.id, proposal.textbook_id);
  }

  if (units.length > 0 && proposal.textbook_id) {
    await saveBulkCourseCurriculum(
      course.id,
      proposal.textbook_id,
      units.map((u) => ({
        curriculum_item_id: u.curriculum_item_id,
        proposal_count: u.koma_count,
        group_number: u.group_id > 0 ? u.group_id : null,
      }))
    );
  }

  return { courseId: course.id, courseName: course.name };
}
