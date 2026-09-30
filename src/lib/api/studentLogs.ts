import { supabase } from '@/lib/supabase';
import type { StudentLog } from '@/types/database';
import { buildChangeSummary } from './notifications';

/** 生徒ハブの変更履歴に出す1行（日時と出来事だけ。理由・操作者は出さない＝2026-09 ユーザー決定） */
export interface StudentLogEvent {
  id: string;
  createdAt: string;
  summary: string;
}

/**
 * 生徒1人の student_logs を新しい順に取る（生徒ハブの「変更履歴」用）。
 *
 * ★生徒（student_id）だけで絞り、教室では絞らない。教室移動のときは student_logs.school_id も
 *   移動先へ書き換えている（moveStudentsToSchool）ので、教室で絞る必要がない。
 * ★件数を必ず限る。更新のたびに1行増えるテーブルで、上限なしだと古い生徒ほど重くなる。
 */
export async function getStudentLogs(studentId: string, limit = 20): Promise<StudentLog[]> {
  const { data, error } = await supabase
    .from('student_logs')
    .select('id, student_id, school_id, action, actor, diff, created_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`変更履歴の取得に失敗しました: ${error.message}`);
  }
  return (data || []) as StudentLog[];
}

/**
 * ログを「日時・出来事」の行にする。出来事の文言は通知フィード（buildChangeSummary）と同じ。
 * 表示する変更が無い行（科目だけ変えた更新・更新日時だけの差分など）は落とす。
 * 通知フィードも同じ行を出していない（hasMeaningfulChanges）。
 */
export function toStudentLogEvents(logs: StudentLog[], max = 20): StudentLogEvent[] {
  const events: StudentLogEvent[] = [];
  for (const log of logs) {
    const summary = buildChangeSummary(
      log.action,
      log.diff as Record<string, { old: unknown; new: unknown }> | null
    );
    if (!summary) continue;
    events.push({ id: log.id, createdAt: log.created_at, summary });
    if (events.length >= max) break;
  }
  return events;
}
