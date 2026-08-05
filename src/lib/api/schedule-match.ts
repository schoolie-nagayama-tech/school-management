/**
 * マッチング提案 API
 *
 * 設計：
 *  - バッチ生成 (createMatchBatch) はアルゴリズム本体（P4）が呼ぶ想定。今は仕組みだけ用意。
 *  - 提案の取得 / 公開 / 不採用 / 修正は室長UI（P4-3）が呼ぶ。
 *  - 公開時に schedule_entries に INSERT し、proposal.schedule_entry_id を紐付ける。
 *  - 不採用 (dismiss) は schedule_entries に書かず status='dismissed' のままにする。
 */

import { supabase } from '@/lib/supabase';
import type {
  ScheduleMatchBatch,
  ScheduleMatchProposal,
  MatchBatchInput,
  MatchProposalStatus,
} from '@/types/schedule-match';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * マッチング実行バッチを記録 + 提案を一括 INSERT。
 * mode='overwrite' の場合は同一 setting の過去 draft 提案をまとめて dismiss にする運用も考えられるが、
 * MVP では純粋に新規 batch + insert のみとする（過去提案の扱いは将来検討）。
 */
export async function createMatchBatch(input: MatchBatchInput): Promise<ScheduleMatchBatch> {
  // 1. batch 行を作成
  const { data: batchRow, error: batchErr } = await db
    .from('schedule_match_batches')
    .insert({
      school_id: input.school_id,
      setting_id: input.setting_id,
      executed_by: input.executed_by,
      mode: input.mode,
      notes: input.notes || null,
    })
    .select()
    .single();

  if (batchErr || !batchRow) {
    console.error('Error creating match batch:', batchErr);
    throw new Error('マッチングバッチの作成に失敗しました');
  }
  const batch = batchRow as ScheduleMatchBatch;

  // 2. proposals を bulk insert
  if (input.proposals.length > 0) {
    const rows = input.proposals.map((p) => ({
      batch_id: batch.id,
      school_id: input.school_id,
      student_id: p.student_id,
      teacher_id: p.teacher_id,
      proposal_date: p.proposal_date,
      time_slot_id: p.time_slot_id,
      subject_ids: p.subject_ids,
      formation: p.formation,
      kind: p.kind,
      match_meta: p.match_meta ?? null,
    }));
    const { error: insErr } = await db.from('schedule_match_proposals').insert(rows);
    if (insErr) {
      console.error('Error inserting proposals:', insErr);
      // batch も削除してロールバック
      await db.from('schedule_match_batches').delete().eq('id', batch.id);
      throw new Error('マッチング提案の保存に失敗しました');
    }
  }

  return batch;
}

/** バッチの提案一覧（draft 優先） */
export async function getProposalsByBatch(batchId: string): Promise<ScheduleMatchProposal[]> {
  const { data, error } = await db
    .from('schedule_match_proposals')
    .select(
      '*, student:students(id, last_name, first_name, grade), teacher:user_profiles!schedule_match_proposals_teacher_id_fkey(id, display_name, email), time_slot:schedule_time_slots(id, slot_number, start_time, end_time)'
    )
    .eq('batch_id', batchId)
    .order('proposal_date', { ascending: true })
    .order('time_slot_id', { ascending: true });

  if (error) {
    console.error('Error fetching proposals:', error);
    throw new Error('マッチング提案の取得に失敗しました');
  }
  return (data || []) as ScheduleMatchProposal[];
}

/** 学校で最新の draft 提案を持つバッチ一覧 */
export async function getRecentBatches(
  schoolId: string,
  limit = 10
): Promise<ScheduleMatchBatch[]> {
  const { data, error } = await db
    .from('schedule_match_batches')
    .select('*')
    .eq('school_id', schoolId)
    .order('executed_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('Error fetching recent batches:', error);
    throw new Error('バッチ履歴の取得に失敗しました');
  }
  return (data || []) as ScheduleMatchBatch[];
}

/**
 * 提案を「公開」する：schedule_entries に INSERT し、proposal.status='published' + schedule_entry_id を更新。
 * 同時刻重複や同生徒重複が起きないよう、呼び出し側で先にバリデーションする想定。
 * （createScheduleEntry 内のチェックでも検出されるので、エラーが返れば status は変えずに throw）
 */
export async function publishProposal(
  proposalId: string,
  publishedBy: string
): Promise<ScheduleMatchProposal> {
  // ratio/duration_minutes/half_position は '*' に含まれるが、公開時に必ず継承すべき列であることを
  // 明示するため select にも書き出す（§9-4: 欠落していたバグの是正）。
  const { data: prop, error: getErr } = await db
    .from('schedule_match_proposals')
    .select('*, ratio, duration_minutes, half_position')
    .eq('id', proposalId)
    .single();
  if (getErr || !prop) {
    throw new Error('提案が見つかりません');
  }
  const proposal = prop as ScheduleMatchProposal;
  if (proposal.status !== 'draft') {
    throw new Error('下書き状態の提案のみ公開できます');
  }

  // schedule_entries に INSERT。
  // §9-4: ratio/duration_minutes/half_position は proposal 側から必ずスナップショット継承する
  // （従来はここで欠落しており、公開のたびに DB 既定値（ratio=2/duration=NULL/half=NULL）で
  //   上書きされてしまう既存バグだった。proposal 側も現状は既定値のみのため挙動は変わらないが、
  //   今後 proposal に値が入るようになれば正しく引き継がれる）。
  const { data: entryRow, error: insErr } = await db
    .from('schedule_entries')
    .insert({
      school_id: proposal.school_id,
      entry_date: proposal.proposal_date,
      time_slot_id: proposal.time_slot_id,
      teacher_id: proposal.teacher_id,
      student_id: proposal.student_id,
      subject_ids: proposal.subject_ids,
      kind: proposal.kind,
      formation: proposal.formation,
      ratio: proposal.ratio,
      duration_minutes: proposal.duration_minutes,
      half_position: proposal.half_position,
      status: 'scheduled',
    })
    .select('id')
    .single();
  if (insErr || !entryRow) {
    console.error('Error inserting schedule_entry from proposal:', insErr);
    throw new Error('スケジュールへの反映に失敗しました');
  }

  const { data: updated, error: updErr } = await db
    .from('schedule_match_proposals')
    .update({
      status: 'published' as MatchProposalStatus,
      schedule_entry_id: (entryRow as { id: string }).id,
      published_at: new Date().toISOString(),
      published_by: publishedBy,
    })
    .eq('id', proposalId)
    .select()
    .single();
  if (updErr || !updated) {
    console.error('Error marking proposal published:', updErr);
    throw new Error('提案ステータスの更新に失敗しました');
  }
  return updated as ScheduleMatchProposal;
}

/** バッチ内の draft 提案を一括公開 */
export async function publishAllDraftsInBatch(
  batchId: string,
  publishedBy: string
): Promise<{ published: number; failed: number; errors: string[] }> {
  const proposals = await getProposalsByBatch(batchId);
  const drafts = proposals.filter((p) => p.status === 'draft');
  let published = 0;
  let failed = 0;
  const errors: string[] = [];

  // 1件ずつ直列で公開（重複チェックを順次効かせるため）
  for (const p of drafts) {
    try {
      await publishProposal(p.id, publishedBy);
      published += 1;
    } catch (e) {
      failed += 1;
      errors.push(`${p.id}: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }
  return { published, failed, errors };
}

/** 提案を不採用にする（公開せず破棄） */
export async function dismissProposal(proposalId: string): Promise<void> {
  const { error } = await db
    .from('schedule_match_proposals')
    .update({ status: 'dismissed' as MatchProposalStatus })
    .eq('id', proposalId);
  if (error) {
    console.error('Error dismissing proposal:', error);
    throw new Error('提案の不採用処理に失敗しました');
  }
}

/** 提案を編集（公開前に室長が手動調整する想定） */
export async function updateDraftProposal(
  proposalId: string,
  patch: Partial<
    Pick<
      ScheduleMatchProposal,
      'teacher_id' | 'proposal_date' | 'time_slot_id' | 'subject_ids' | 'formation' | 'kind'
    >
  >
): Promise<ScheduleMatchProposal> {
  const { data, error } = await db
    .from('schedule_match_proposals')
    .update(patch)
    .eq('id', proposalId)
    .eq('status', 'draft') // draft のみ編集可能
    .select()
    .single();
  if (error || !data) {
    console.error('Error updating draft proposal:', error);
    throw new Error('提案の編集に失敗しました');
  }
  return data as ScheduleMatchProposal;
}

export type { ScheduleMatchBatch, ScheduleMatchProposal };
