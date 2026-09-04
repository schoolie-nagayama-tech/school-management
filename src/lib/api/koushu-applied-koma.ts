/**
 * 進行表の「申込回数」から科目別のコマ数を取り出す（申込管理の自動取り込み用）
 *
 * ★ 提案回数ではなく申込回数を初期値にする理由:
 *   提案は教室が出した案、申込は保護者が実際に取った数。申込管理に登録したいのは後者。
 *   提案書の公開時に `syncAppliedToProgress`（lib/api/proposals.ts）が
 *   `student_progress.application_count` へ転記しているので、そこが申込の正典になる。
 *
 * ★ 素直に合計してよい（読み出し側で重複排除しないこと）:
 *   結合グループ（applied_group_number）の合計は **書き込み時に先頭行へ寄せて** あり、
 *   同じグループの他の行には 0 が入っている。読み出し側でグループごとにまとめ直すと
 *   二重に潰れてコマ数が過少になる。座席表の集計（utils/koushuKoma.ts の
 *   computeKoushuKoma）も同じく素の合計を取っており、そちらと数を揃える必要がある。
 *   （提案書側の集計は逆に group_id での重複排除が要る。両者の規約が違う点に注意）
 */

import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** PostgREST の embed は関係の解釈でオブジェクト/配列どちらでも返り得るため両対応する。 */
type Embedded<T> = T | T[] | null;

function firstOf<T>(value: Embedded<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * 生徒の申込回数を科目別に合計する。申込が無ければ空を返す（エラーにしない）。
 */
export async function getAppliedKomaBySubject(studentId: string): Promise<Record<string, number>> {
  // 申込回数は教材ごとの進行表に乗っているので、所持教材 → 教材 → 科目 を先に引く
  const { data: stbRows, error: stbErr } = await db
    .from('student_textbooks')
    .select('id, textbook:textbooks(subject_id)')
    .eq('student_id', studentId);
  if (stbErr) {
    console.error('[koushu-applied-koma] 所持教材の取得に失敗:', stbErr);
    throw new Error('申込回数の取得に失敗しました');
  }

  const subjectByTextbook = new Map<string, string>();
  for (const r of (stbRows ?? []) as Array<{
    id: string;
    textbook: Embedded<{ subject_id: string | null }>;
  }>) {
    const subjectId = firstOf(r.textbook)?.subject_id;
    if (subjectId) subjectByTextbook.set(r.id, subjectId);
  }
  const studentTextbookIds = Array.from(subjectByTextbook.keys());
  if (studentTextbookIds.length === 0) return {};

  const { data: progressRows, error: progressErr } = await db
    .from('student_progress')
    .select('student_textbook_id, application_count')
    .in('student_textbook_id', studentTextbookIds);
  if (progressErr) {
    console.error('[koushu-applied-koma] 進行表の取得に失敗:', progressErr);
    throw new Error('申込回数の取得に失敗しました');
  }

  const result: Record<string, number> = {};
  for (const r of (progressRows ?? []) as Array<{
    student_textbook_id: string;
    application_count: number | null;
  }>) {
    const subjectId = subjectByTextbook.get(r.student_textbook_id);
    if (!subjectId) continue;
    const koma = r.application_count || 0;
    if (koma <= 0) continue;
    result[subjectId] = (result[subjectId] ?? 0) + koma;
  }
  return result;
}
