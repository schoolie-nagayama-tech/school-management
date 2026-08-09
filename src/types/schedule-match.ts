/**
 * マッチング提案 (schedule_match_proposals) と
 * 実行バッチ (schedule_match_batches) の型定義
 */

import type { HalfPosition } from '@/types/schedule';

export type MatchBatchMode = 'overwrite' | 'diff' | 'partial';
export type MatchProposalStatus = 'draft' | 'published' | 'dismissed';

export interface ScheduleMatchBatch {
  id: string;
  school_id: string;
  setting_id: string | null;
  executed_by: string | null;
  executed_at: string;
  mode: MatchBatchMode;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** match_meta の中身。アルゴリズムが採点理由をここに JSON で詰める */
export interface MatchProposalMeta {
  score?: number; // 0-1 の総合スコア
  reasons?: string[]; // 採用理由ラベル
  conflicts?: string[]; // 採用しなかった代替案や warning
  [key: string]: unknown;
}

export interface ScheduleMatchProposal {
  id: string;
  batch_id: string;
  school_id: string;
  student_id: string;
  teacher_id: string;
  proposal_date: string;
  time_slot_id: string;
  subject_ids: string[];
  // Phase A: 形態の動的マスタ化に伴い union → string へ緩和（値は schedule_formations が管理）。
  formation: string;
  kind: 'regular' | 'koushu';
  // Phase R（§3-2・§9-4）: schedule_entries と同じ3列。既定は DB 側 DEFAULT（ratio=2 / duration_minutes,
  // half_position=NULL）に委ねるため任意項目にする（マッチングアルゴリズムが未指定で作る提案もあるため）。
  /** 指導比率。1=1対1 / 2=1対2（既定）。 */
  ratio?: 1 | 2;
  /** 授業時間(分)。45 or 90。NULL=全コマ(90分)扱い。 */
  duration_minutes?: number | null;
  /** 45分授業の占有半コマ。'first'=前半 / 'second'=後半 / NULL=全コマ。 */
  half_position?: HalfPosition;
  status: MatchProposalStatus;
  schedule_entry_id: string | null;
  published_at: string | null;
  published_by: string | null;
  match_meta: MatchProposalMeta | null;
  created_at: string;
  updated_at: string;
  // join
  student?: { id: string; last_name: string; first_name: string; grade: number };
  teacher?: { id: string; display_name: string | null; email: string | null };
  time_slot?: { id: string; slot_number: number; start_time: string; end_time: string };
}

/** バッチ作成用ペイロード */
export interface MatchBatchInput {
  school_id: string;
  setting_id: string | null;
  executed_by: string;
  mode: MatchBatchMode;
  notes?: string;
  proposals: Array<
    Omit<
      ScheduleMatchProposal,
      | 'id'
      | 'batch_id'
      | 'school_id'
      | 'status'
      | 'schedule_entry_id'
      | 'published_at'
      | 'published_by'
      | 'created_at'
      | 'updated_at'
      | 'student'
      | 'teacher'
      | 'time_slot'
    >
  >;
}
