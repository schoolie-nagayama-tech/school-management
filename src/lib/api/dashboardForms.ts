import { supabase } from '../supabase';
import { GRADE_LABELS } from '@/types/database';

/**
 * 教室長ダッシュボード用：フォーム参加率（模試/Vもぎ/増コマ）の集計。
 * - 分母 = フォームの対象学年(form_periods.settings.grades)に該当する在籍生徒数
 * - 分子 = その回の回答のうち「受験/取得」した紐付き済み生徒数（重複排除）
 * 紐付けされていない回答は数えない（紐付け運用が進むほど精度が上がる）。
 * デモ校の除外は呼び出し側の schoolIds（getSelectedSchoolIds）で吸収する。
 */

// "中3" などの学年名 → 数値(GRADE_LABELS の逆引き)
const NAME_TO_GRADE: Record<string, number> = Object.fromEntries(
  Object.entries(GRADE_LABELS).map(([num, label]) => [label as string, Number(num)]),
);

export type ParticipationFormType = 'moshi' | 'mogi' | 'zoukoma';

export interface FormParticipation {
  formType: ParticipationFormType;
  label: string; // 表示名（模試/Vもぎ/増コマ）
  periodTitle: string; // 集計対象の回（直近 active）
  targetGrades: number[]; // 対象学年(数値)
  denominator: number; // 対象学年の在籍数
  numerator: number; // 受験/取得した紐付き生徒数
  rate: number; // % （分母0なら0）
}

// 回答が「受験/取得」とみなせるか（フォーム種別ごとの判定）
function isParticipated(formType: ParticipationFormType, data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (formType === 'moshi') return d.exam_type === 'regular' || d.exam_type === 'furikae';
  if (formType === 'mogi') {
    if (Array.isArray(d.selections)) return d.selections.length > 0;
    return typeof d.selection_count === 'number' && d.selection_count > 0;
  }
  // zoukoma
  return typeof d.total_koma === 'number' && d.total_koma > 0;
}

const FORM_DEFS: { ft: ParticipationFormType; label: string }[] = [
  { ft: 'moshi', label: '模試' },
  { ft: 'mogi', label: 'Vもぎ' },
  { ft: 'zoukoma', label: '増コマ' },
];

/**
 * 各フォームの「直近の active 期間」の参加率を集計して返す。
 * テーブル未取得・期間なしのフォームは結果に含めない。
 */
export async function getFormParticipation(schoolIds: string[]): Promise<FormParticipation[]> {
  if (schoolIds.length === 0) return [];

  const results: FormParticipation[] = [];

  for (const { ft, label } of FORM_DEFS) {
    // 直近の active 期間を1つ選ぶ（school 混在は created_at 最新で代表させる）
    const { data: periods, error: pErr } = await supabase
      .from('form_periods')
      .select('period_key, title, settings, created_at')
      .in('school_id', schoolIds)
      .eq('form_type', ft)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1);
    if (pErr || !periods || periods.length === 0) continue;

    const period = periods[0];
    const settings = (period.settings ?? {}) as { grades?: string[] };
    const targetGrades = (settings.grades ?? [])
      .map((name) => NAME_TO_GRADE[name])
      .filter((g): g is number => typeof g === 'number');

    // 紐付き済みの受験/取得者（生徒単位で重複排除）
    const { data: responses } = await supabase
      .from('form_responses')
      .select('linked_student_id, response_data')
      .in('school_id', schoolIds)
      .eq('form_type', ft)
      .eq('form_period', period.period_key)
      .not('linked_student_id', 'is', null);

    const examinees = new Set<string>();
    for (const r of responses ?? []) {
      if (r.linked_student_id && isParticipated(ft, r.response_data)) {
        examinees.add(r.linked_student_id);
      }
    }

    // 分母：対象学年の在籍数（count のみ取得）
    let denominator = 0;
    if (targetGrades.length > 0) {
      const { count } = await supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .in('school_id', schoolIds)
        .eq('status', 'active')
        .in('grade', targetGrades);
      denominator = count ?? 0;
    }

    const numerator = examinees.size;
    results.push({
      formType: ft,
      label,
      periodTitle: period.title ?? '',
      targetGrades,
      denominator,
      numerator,
      rate: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0,
    });
  }

  return results;
}
