/**
 * 講習（個別）自動配置 — 下書き提案の生成（本番配線）
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md 第1部 §5（アルゴリズム）・§11（実行パネル）。
 *
 * 役割: 講習期間の申込を、生徒の通塾可能表・講師の講習シフト・席数・実行時設定に従って
 *       期間内の (日付 × 個別コマ) に配置し、schedule_match_proposals に下書きとして保存する。
 *       対象は個別のみ（小集団・特別講座は固定開催なので手動配置。決定2・41）。
 *
 * 構成（責務を分けてある）:
 *   1. realDataAdapter  — DBを読んで AllocatorInput を組み立てる（読み取り専用）
 *   2. allocateKoushu   — 純粋関数の配置ロジック（DB非依存・テスト可能）
 *   3. このファイル      — 1と2をつなぎ、結果を下書き提案として保存する
 *
 * ★ 旧 generateKoushuIndividualProposals は削除した（Q5）。
 *   あれは生徒の通塾可能表を見ておらず（settingId が未配線）、席数も単純な人数比較で
 *   1対1の排他・45分の半コマを数えられていなかった。同じ画面から呼べる状態で
 *   残しておくと「通えない日に置く」古い経路が生き続けるため、フォールバックは用意しない。
 *   講師選択の加点（固定50/過去30/科目20/性別10/出勤5）は allocate.ts の ALLOC_WEIGHTS へ移した。
 */

import type { KoushuPeriodInfo } from '@/lib/api/koushu-period';
import { createMatchBatch, dismissKoushuDraftsInPeriod } from '@/lib/api/schedule-match';
import type { MatchBatchMode } from '@/types/schedule-match';
import { allocateKoushu } from '@/lib/koushu-allocator/allocate';
import { loadRealAllocatorInput, type RealDataNotes } from '@/lib/koushu-allocator/realDataAdapter';
import {
  UNASSIGNED_REASON_LABELS,
  type AllocatorSettings,
  type UnassignedReason,
} from '@/lib/koushu-allocator/types';
// 講習の自動配置は個別レーンのみ対象（ユーザー定義形態は対象外）
import { INDIVIDUAL_FORMATION } from '@/types/schedule';

// ============================================================
// 本番配線（Q5・§11）— アロケータを下書き生成に接続する
// ============================================================

/**
 * 再実行モード（§5-5）。
 *  - 'discard': この期間の既存下書きを破棄してから組み直す。公開済み・手動配置には触れない
 *  - 'diff':   既存下書きも占有として尊重し、埋まっていないコマだけ足す
 */
export type KoushuRerunMode = 'discard' | 'diff';

export interface RunKoushuAllocationInput {
  schoolId: string;
  period: KoushuPeriodInfo;
  executedBy: string;
  settings: AllocatorSettings;
  /** 対象学年（決定21）。空/未指定＝全学年 */
  gradeFilter?: number[] | null;
  /** 学年別の講習終了日（決定44）。course_prep_periods.schedule_end_by_grade をそのまま渡す */
  scheduleEndByGrade?: Record<string, string> | null;
  rerunMode: KoushuRerunMode;
}

/** 未割当を理由別にまとめたもの（画面表示用） */
export interface UnassignedGroup {
  reason: UnassignedReason;
  label: string;
  koma: number;
  students: Array<{ studentId: string; studentName: string; koma: number }>;
}

export interface RunKoushuAllocationResult {
  batchId: string | null;
  proposalsCreated: number;
  /** 破棄モードで不採用にした既存下書きの件数 */
  dismissedDrafts: number;
  requestedKoma: number;
  assignedKoma: number;
  repairedKoma: number;
  /** 科目が期間全体に散っているか（0〜1。1に近いほど均等） */
  evenness: number;
  unassignedGroups: UnassignedGroup[];
  /** 実データの取得元・欠損の情報（画面に注意書きを出すため） */
  notes: RealDataNotes;
}

/**
 * 講習（個別）の自動配置を実行し、下書き提案として保存する。
 *
 * 旧 generateKoushuIndividualProposals との違い（§11・仕様書第1部 §5）:
 *  - 生徒の可能表を**正典として使う**（旧実装は未配線で、通える日を無視して置いていた）
 *  - 講師の出勤は講習シフト提出が正典（旧実装は通年の曜日別出勤可能）
 *  - 席の判定は seatOccupancy.ts に一本化（1対1の排他・45分の前半/後半を正しく数える）
 *  - ratio / duration_minutes / half_position を提案に載せる
 *  - 未割当を5分類の理由付きで返す
 *  - 実行時設定（1日上限・連続優先・同日同科目・均等分散）と学年絞り込みを受ける
 *
 * ★ 破棄/差分のどちらでも公開済みエントリと手動配置には触れない。
 */
export async function runKoushuAllocation(
  input: RunKoushuAllocationInput
): Promise<RunKoushuAllocationResult> {
  const { schoolId, period, executedBy, settings, rerunMode } = input;

  // 1. 破棄モードなら先に既存下書きを不採用にする。
  //    ここで先に消しておかないと、下書きが occupancy に残っていない前提で組み直した提案と
  //    古い下書きが座席表に二重で★表示される。
  let dismissedDrafts = 0;
  if (rerunMode === 'discard') {
    dismissedDrafts = await dismissKoushuDraftsInPeriod({
      schoolId,
      formation: INDIVIDUAL_FORMATION,
      startDate: period.schedule_start_date,
      endDate: period.schedule_end_date,
    });
  }

  // 2. 実データを読んでアロケータ入力を組み立てる（読み取り専用）
  const { input: allocInput, notes } = await loadRealAllocatorInput({
    schoolId,
    period: {
      schedule_start_date: period.schedule_start_date,
      schedule_end_date: period.schedule_end_date,
      season: period.season,
      year: period.year,
    },
    settings,
    gradeFilter: input.gradeFilter ?? null,
    scheduleEndByGrade: input.scheduleEndByGrade ?? null,
    // 差分モードのときだけ既存下書きを占有として積む（破棄モードは上で消した）
    includeDrafts: rerunMode === 'diff',
  });

  // 3. 配置
  const result = allocateKoushu(allocInput);

  // 4. 未割当を理由別にまとめる（室長が「何が足りないのか」を1目で見るための集計）
  const unassignedGroups = groupUnassignedByReason(
    result.unassigned,
    new Map(allocInput.students.map((s) => [s.id, s.name]))
  );

  // 5. 提案が0件なら batch を作らない（空バッチで履歴を汚さない）
  if (result.assignments.length === 0) {
    return {
      batchId: null,
      proposalsCreated: 0,
      dismissedDrafts,
      requestedKoma: result.stats.requestedKoma,
      assignedKoma: 0,
      repairedKoma: 0,
      evenness: result.stats.subjectBalance.evenness,
      unassignedGroups,
      notes,
    };
  }

  // 6. 下書きとして保存。ratio/duration_minutes/half_position を必ず載せる（§9-4）。
  const slotNumberById = new Map(allocInput.slots.map((s) => [s.id, s.slot_number]));
  const batch = await createMatchBatch({
    school_id: schoolId,
    setting_id: null,
    executed_by: executedBy,
    // schedule_match_batches.mode は既存の3値（overwrite/diff/partial）。
    // 破棄モードは「この期間の下書きを作り直す」なので overwrite に対応させる。
    mode: (rerunMode === 'discard' ? 'overwrite' : 'diff') as MatchBatchMode,
    notes: buildBatchNotes(period, input.gradeFilter ?? null, rerunMode),
    proposals: result.assignments.map((a) => ({
      student_id: a.studentId,
      teacher_id: a.teacherId,
      proposal_date: a.date,
      time_slot_id: a.slotId,
      subject_ids: [a.subjectId],
      formation: INDIVIDUAL_FORMATION,
      kind: 'koushu' as const,
      ratio: a.ratio,
      // 90分（全コマ）は NULL で保存する（schedule_entries と同じ規約）
      duration_minutes: a.duration === 45 ? 45 : null,
      half_position: a.halfPosition,
      match_meta: {
        score: a.score,
        reasons: [],
        conflicts: [],
        slotNumber: slotNumberById.get(a.slotId) ?? null,
      },
    })),
  });

  return {
    batchId: batch.id,
    proposalsCreated: result.assignments.length,
    dismissedDrafts,
    requestedKoma: result.stats.requestedKoma,
    assignedKoma: result.stats.assignedKoma,
    repairedKoma: result.stats.repairedKoma,
    evenness: result.stats.subjectBalance.evenness,
    unassignedGroups,
    notes,
  };
}

/**
 * 未割当タスクを理由別にまとめる（純関数・テスト対象）。
 *
 * まとめ方の意図:
 *  - 理由（5分類）ごとにコマ数を合算し、コマ数の多い理由を先に出す＝対処の優先順になる
 *  - 同じ生徒の複数科目は1行に合算する（画面が縦に伸びるのを防ぐ）
 *  - 生徒名が引けないときはIDの先頭8文字で代替する（空欄にして「誰？」にしない）
 */
export function groupUnassignedByReason(
  unassigned: Array<{
    studentId: string;
    subjectId: string;
    koma: number;
    reason: UnassignedReason;
  }>,
  studentNameById: Map<string, string>
): UnassignedGroup[] {
  const byReason = new Map<UnassignedReason, UnassignedGroup>();
  for (const u of unassigned) {
    if (u.koma <= 0) continue;
    let g = byReason.get(u.reason);
    if (!g) {
      g = { reason: u.reason, label: UNASSIGNED_REASON_LABELS[u.reason], koma: 0, students: [] };
      byReason.set(u.reason, g);
    }
    g.koma += u.koma;
    const row = g.students.find((s) => s.studentId === u.studentId);
    if (row) {
      row.koma += u.koma;
    } else {
      g.students.push({
        studentId: u.studentId,
        studentName: studentNameById.get(u.studentId) ?? u.studentId.slice(0, 8),
        koma: u.koma,
      });
    }
  }
  const groups = Array.from(byReason.values()).sort(
    (a, b) => b.koma - a.koma || a.reason.localeCompare(b.reason)
  );
  for (const g of groups) {
    g.students.sort((a, b) => b.koma - a.koma || a.studentName.localeCompare(b.studentName, 'ja'));
  }
  return groups;
}

/** バッチの notes（後から履歴を見て「何の条件で回したか」が分かるようにする） */
function buildBatchNotes(
  period: KoushuPeriodInfo,
  gradeFilter: number[] | null,
  rerunMode: KoushuRerunMode
): string {
  const parts = [`講習個別 自動配置 ${period.label}`];
  parts.push(rerunMode === 'discard' ? '破棄モード' : '差分モード');
  if (gradeFilter && gradeFilter.length > 0) {
    parts.push(`対象学年: ${gradeFilter.join(',')}`);
  } else {
    parts.push('全学年');
  }
  return parts.join(' / ');
}
