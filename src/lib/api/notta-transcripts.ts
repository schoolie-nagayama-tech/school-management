import { supabase } from '../supabase';
import { createInterview } from './interviews';
import type {
  NottaTranscript,
  NottaTranscriptWithStudent,
  InterviewType,
} from '@/types/database';

/**
 * 教室配下の文字起こし一覧を取得（新しい順）
 */
export async function getTranscripts(
  schoolIds: string[],
  options: {
    linkedFilter?: 'all' | 'linked' | 'unlinked';
    includeArchived?: boolean;
    limit?: number;
  } = {}
): Promise<NottaTranscriptWithStudent[]> {
  if (schoolIds.length === 0) return [];
  const { linkedFilter = 'all', includeArchived = false, limit = 200 } = options;

  let query = supabase
    .from('notta_transcripts')
    .select(
      `
      *,
      student:students(id, last_name, first_name, grade)
    `
    )
    .in('school_id', schoolIds)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!includeArchived) query = query.eq('is_archived', false);
  if (linkedFilter === 'linked') query = query.not('linked_student_id', 'is', null);
  if (linkedFilter === 'unlinked') query = query.is('linked_student_id', null);

  const { data, error } = await query;
  if (error) {
    throw new Error(`文字起こしの取得に失敗しました: ${error.message}`);
  }
  return (data || []) as NottaTranscriptWithStudent[];
}

/**
 * 未リンクの最新文字起こしを取得（ダッシュボード通知用）
 */
export async function getRecentUnlinkedTranscripts(
  schoolIds: string[],
  limit: number = 10
): Promise<NottaTranscript[]> {
  if (schoolIds.length === 0) return [];
  const { data, error } = await supabase
    .from('notta_transcripts')
    .select('*')
    .in('school_id', schoolIds)
    .is('linked_student_id', null)
    .eq('is_archived', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`未処理の文字起こし取得に失敗しました: ${error.message}`);
  }
  return (data || []) as NottaTranscript[];
}

/**
 * 文字起こしを生徒（面談記録）に紐付ける。
 * 1. student_interviews にレコードを作成（content = 文字起こし本文 + メタ情報）
 * 2. notta_transcripts の linked_student_id / linked_interview_id / linked_at を更新
 */
export async function linkTranscriptToStudent(
  transcript: NottaTranscript,
  studentId: string,
  options: { interviewType?: InterviewType; interviewDate?: string } = {}
): Promise<void> {
  const interviewType = options.interviewType || 'other';
  const interviewDate =
    options.interviewDate ||
    (transcript.recorded_at ? transcript.recorded_at.slice(0, 10) : new Date().toISOString().slice(0, 10));

  const header = [
    transcript.title ? `【タイトル】${transcript.title}` : null,
    transcript.recorded_at ? `【録音日時】${transcript.recorded_at}` : null,
    transcript.audio_url ? `【音声URL】${transcript.audio_url}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const content = [header, '--- Notta 文字起こし ---', transcript.transcript]
    .filter(Boolean)
    .join('\n\n');

  const interview = await createInterview(transcript.school_id, studentId, {
    interview_date: interviewDate,
    interview_type: interviewType,
    content,
  });

  const { error } = await supabase
    .from('notta_transcripts')
    .update({
      linked_student_id: studentId,
      linked_interview_id: interview.id,
      linked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', transcript.id);

  if (error) {
    throw new Error(`紐付けに失敗しました: ${error.message}`);
  }
}

/**
 * 紐付け解除（student_interviews のレコードは残す）
 */
export async function unlinkTranscript(id: string): Promise<void> {
  const { error } = await supabase
    .from('notta_transcripts')
    .update({
      linked_student_id: null,
      linked_interview_id: null,
      linked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(`紐付け解除に失敗しました: ${error.message}`);
}

export async function archiveTranscript(id: string): Promise<void> {
  const { error } = await supabase
    .from('notta_transcripts')
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(`アーカイブに失敗しました: ${error.message}`);
}

export async function unarchiveTranscript(id: string): Promise<void> {
  const { error } = await supabase
    .from('notta_transcripts')
    .update({
      is_archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(`アーカイブ解除に失敗しました: ${error.message}`);
}

export async function deleteTranscript(id: string): Promise<void> {
  const { error } = await supabase.from('notta_transcripts').delete().eq('id', id);
  if (error) throw new Error(`削除に失敗しました: ${error.message}`);
}
