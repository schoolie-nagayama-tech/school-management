import { supabase } from '../supabase';
import { createInterview } from './interviews';
import type { NottaTranscript, NottaTranscriptWithStudent, InterviewType } from '@/types/database';

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
 * Notta の AI Notes 既知セクション見出し（行頭一致で判定）。
 * 並び順は表示順を兼ねるが、本文に出てきた順をそのまま尊重する。
 */
const NOTTA_SECTION_HEADERS = [
  '前回の確認',
  '塾からの報告',
  '保護者からの要望',
  '生徒からの要望',
  '相談事項',
  '今後の方針',
  '総合メモ',
  'メモ',
] as const;

/**
 * Notta の生 transcript を講師が読みやすい本文に整形する。
 *
 * Notta が吐く transcript は同じ内容を 2 度持っているケースがある：
 *   1) 上半分: AI 要約のインライン版（改行なしの塊、読みにくい）
 *   2) 下半分: "タイトル: ... 日時: ... URL ... AI Notes" の後に構造化版
 * 構造化版（AI Notes 以降）の方が改行付きで読みやすいので、それが存在すれば
 * そちらだけを採用し、インライン要約とメタ情報の重複は破棄する。
 * 重ねて行頭のセクション見出しを強調し、本文を箇条書きに変換する。
 */
export function formatNottaTranscript(raw: string): string {
  if (!raw) return '';

  // 不可視文字（左→右マーク等）を除去
  const sanitized = raw.replace(/[‎‏]/g, '');

  // "AI Notes" マーカーがあれば、そこから後ろの構造化部分のみ採用。
  // 無ければ全体を対象にする（旧フォーマット互換）。
  const aiNotesMatch = sanitized.match(/(?:^|\n)\s*AI\s*Notes\s*\n/);
  const body = aiNotesMatch
    ? sanitized.slice(aiNotesMatch.index! + aiNotesMatch[0].length)
    : sanitized;

  const lines = body.split('\n').map((l) => l.trim());
  const headerSet = new Set<string>(NOTTA_SECTION_HEADERS);
  const out: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (!line) continue;
    if (headerSet.has(line)) {
      if (out.length > 0) out.push(''); // セクション間に空行
      out.push(`■ ${line}`);
      inSection = true;
      continue;
    }
    // 既存の bullet マーカー（• や ・）を除去してから揃える
    const stripped = line.replace(/^[•・\-*]\s*/, '').trim();
    if (!stripped) continue;
    out.push(inSection ? `・${stripped}` : stripped);
  }

  return out.join('\n');
}

/**
 * 文字起こしを生徒（面談記録）に紐付ける。
 * 1. student_interviews にレコードを作成（content = 整形済み本文 + メタ情報）
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
    (transcript.recorded_at
      ? transcript.recorded_at.slice(0, 10)
      : new Date().toISOString().slice(0, 10));

  // 録音日時は JST 表記に整形（DB は UTC 保存）
  const recordedAtJst = transcript.recorded_at
    ? new Date(transcript.recorded_at).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const header = [
    transcript.title ? `【タイトル】${transcript.title}` : null,
    recordedAtJst ? `【録音日時】${recordedAtJst}` : null,
    transcript.audio_url ? `【音声URL】${transcript.audio_url}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const formattedBody = formatNottaTranscript(transcript.transcript);

  const content = [header, '--- Notta 要約 ---', formattedBody].filter(Boolean).join('\n\n');

  // 面談記録は「生徒の所属教室」に紐付ける必要がある。
  // transcript.school_id（アップロード時の教室）と student.school_id が違う場合
  // （管理者が他教室の生徒に紐付けるなど）、アラート集計は生徒の教室で行われるため
  // transcript.school_id を使うと新しい面談記録がアラート側で見えず "未更新" が消えない。
  const { data: studentRow, error: studentErr } = await supabase
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .maybeSingle();
  if (studentErr || !studentRow) {
    throw new Error(`生徒情報の取得に失敗しました: ${studentErr?.message ?? '見つかりません'}`);
  }
  const interviewSchoolId = studentRow.school_id as string;

  const interview = await createInterview(interviewSchoolId, studentId, {
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
