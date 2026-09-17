/**
 * 増コマ申込（form_responses, form_type='zoukoma'）の状況を返す API。
 *
 * テスト対策提案書の一覧で「誰が増コマを申し込み、誰が未申込か」を出すために使う。
 * 提案書と増コマ申込を直接つなぐ列はDBに無いため、ここでは「その期に、その生徒の
 * 増コマ回答があるか」だけを返し、提案書との突き合わせは呼び出し側（一覧画面）で行う。
 */

import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';

/** 増コマ申込1件（一覧画面の判定に使う最小限のフィールドだけ） */
export interface ZoukomaApplication {
  /** 生徒に紐付いていない回答は null。判定に入れられないので画面側で件数だけ出す */
  linkedStudentId: string | null;
  /** フォームに書かれた氏名。提案書の無い申込を名前で出すために使う */
  studentName: string | null;
  koma: number;
}

type ZoukomaPeriodRow = { form_period: string };

type ZoukomaApplicationRow = {
  linked_student_id: string | null;
  student_name: string | null;
  response_data: Record<string, unknown> | null;
};

/**
 * その教室群にある増コマ申込の期（form_period）を新しい順で返す。
 *
 * schoolIds で絞るのは、ヘッダーの教室切替スコープに必ず従うため（呼び出し側の
 * TestPrepProposalsList と同じ理由）。全教室で引くと、システム管理者や掛け持ちの
 * 教室長の一覧に他教室の期が混ざってしまう。
 */
export async function getZoukomaPeriods(schoolIds: string[]): Promise<string[]> {
  if (schoolIds.length === 0) return [];

  // 増コマ回答は教室×期でスケールし、1000件を超えうる。PostgREST は未ページングの
  // .select() を1000行で静かに切り捨てるため、必ず fetchAllPaged で全件取得する。
  // 安定ページングのため id を第2ソートキーに入れる（form_period だけだと同値が並び順が保証されない）。
  const rows = await fetchAllPaged<ZoukomaPeriodRow>((from, to) =>
    supabase
      .from('form_responses')
      .select('form_period')
      .in('school_id', schoolIds)
      .eq('form_type', 'zoukoma')
      // is_archived は NULL がありうる（未設定＝アーカイブされていない扱い）ため、
      // eq だけだと NULL 行を取りこぼす。is.null と eq.false の両方を拾う。
      .or('is_archived.is.null,is_archived.eq.false')
      .order('id', { ascending: true })
      .range(from, to)
  );

  // 重複排除して文字列の降順（'2026-09' > '2026-06'）にソート。期のキーは "YYYY-MM" 形式で
  // 文字列比較がそのまま新しい順になる。スプレッドは target=ES5 罠を踏むので使わない。
  return Array.from(new Set(rows.map((r) => r.form_period))).sort((a, b) => {
    if (a === b) return 0;
    return a > b ? -1 : 1;
  });
}

/**
 * 指定した期の増コマ申込を全件返す。
 *
 * schoolIds で絞る理由・fetchAllPaged を使う理由は {@link getZoukomaPeriods} と同じ
 * （教室切替スコープの遵守／PostgREST の1000行上限で静かに切り捨てられるのを防ぐ）。
 */
export async function getZoukomaApplications(
  schoolIds: string[],
  periodKey: string
): Promise<ZoukomaApplication[]> {
  if (schoolIds.length === 0) return [];

  const rows = await fetchAllPaged<ZoukomaApplicationRow>((from, to) =>
    supabase
      .from('form_responses')
      .select('linked_student_id, student_name, response_data')
      .in('school_id', schoolIds)
      .eq('form_type', 'zoukoma')
      .eq('form_period', periodKey)
      .or('is_archived.is.null,is_archived.eq.false')
      .order('id', { ascending: true })
      .range(from, to)
  );

  return rows.map((r) => {
    // total_koma は数値のことも数値文字列のこともある（フォーム側の保存経路の違い）ため
    // Number() で正規化する。欠損・不正値は NaN になるので 0 に丸める。
    const koma = Number(r.response_data?.total_koma);
    return {
      linkedStudentId: r.linked_student_id,
      studentName: r.student_name,
      koma: Number.isNaN(koma) ? 0 : koma,
    };
  });
}
