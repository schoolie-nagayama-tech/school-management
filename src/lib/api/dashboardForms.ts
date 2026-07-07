import { supabase } from '../supabase';
import { GRADE_LABELS } from '@/types/database';
import { getTestPrepProposalsWithStudent } from './test-prep-proposals';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';

/**
 * 教室長ダッシュボード用：フォーム参加率（模試/Vもぎ/増コマ）の集計。
 * - 分母 = フォームの対象学年(form_periods.settings.grades)に該当する在籍生徒数
 * - 分子 = その回の回答のうち「受験/取得」した紐付き済み生徒数（重複排除）
 * 紐付けされていない回答は数えない（紐付け運用が進むほど精度が上がる）。
 * デモ校の除外は呼び出し側の schoolIds（getSelectedSchoolIds）で吸収する。
 */

// "中3" などの学年名 → 数値(GRADE_LABELS の逆引き)
const NAME_TO_GRADE: Record<string, number> = Object.fromEntries(
  Object.entries(GRADE_LABELS).map(([num, label]) => [label as string, Number(num)])
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
    // form_responses は教室×期間でスケールし1000行を超えうるため全件ページング取得
    // （切り捨てると分子=参加者数が過小になり参加率が誤る）。id 昇順で安定ページング。
    const responses = await fetchAllPaged<{
      linked_student_id: string | null;
      response_data: unknown;
    }>((from, to) =>
      supabase
        .from('form_responses')
        .select('linked_student_id, response_data')
        .in('school_id', schoolIds)
        .eq('form_type', ft)
        .eq('form_period', period.period_key)
        .not('linked_student_id', 'is', null)
        .order('id', { ascending: true })
        .range(from, to)
    );

    const examinees = new Set<string>();
    for (const r of responses) {
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

/* ============================================================
 * テスト対策 提案→取得ファネル（7月運用開始予定）
 * 提案(test_prep_proposals, status=sent/published)を起点に、
 * 提案を受けた生徒が増コマ(zoukoma)を取得したかを突合して取得率を出す。
 * 取得判定: 提案の zoukoma_period_id に対応する period で、その生徒の
 *           zoukoma 回答が total_koma>0 か。学年別にも集計する。
 * ========================================================== */

export interface ProposalGradeStat {
  grade: number;
  proposed: number; // 提案を受けた生徒数
  acquired: number; // 増コマ取得した生徒数
  rate: number; // %
}

export interface ProposalFunnel {
  proposalCount: number; // 提案件数(1生徒×1試験で複数あり得る)
  proposedStudents: number; // 提案を受けた生徒数(重複排除)
  acquiredStudents: number; // 増コマ取得した生徒数
  rate: number; // 取得率(生徒ベース) %
  proposedSubjects: number; // 提案した科目数(生徒×科目, proposed_koma>0)
  acquiredSubjects: number; // 提案科目のうち実際に取得された科目数
  subjectRate: number; // 科目取得率 %
  byGrade: ProposalGradeStat[];
}

const EMPTY_FUNNEL: ProposalFunnel = {
  proposalCount: 0,
  proposedStudents: 0,
  acquiredStudents: 0,
  rate: 0,
  proposedSubjects: 0,
  acquiredSubjects: 0,
  subjectRate: 0,
  byGrade: [],
};

export async function getProposalFunnel(schoolIds: string[]): Promise<ProposalFunnel> {
  if (schoolIds.length === 0) return EMPTY_FUNNEL;

  // 提案中/公開中のみ（下書きは除外）
  const proposals = (await getTestPrepProposalsWithStudent(schoolIds)).filter(
    (p) => p.status === 'sent' || p.status === 'published'
  );
  if (proposals.length === 0) return EMPTY_FUNNEL;

  // zoukoma_period_id → period_key の対応
  const periodIds = Array.from(
    new Set(proposals.map((p) => p.zoukoma_period_id).filter(Boolean))
  ) as string[];
  const periodKeyById = new Map<string, string>();
  if (periodIds.length > 0) {
    const { data: periods } = await supabase
      .from('form_periods')
      .select('id, period_key')
      .in('id', periodIds);
    for (const p of periods ?? []) periodKeyById.set(p.id, p.period_key);
  }

  // 増コマ取得集合: `${student_id}|${period_key}`（total_koma>0 の紐付き回答）
  // form_responses は教室横断・全期間でスケールし1000行を超えうるため全件ページング取得
  // （切り捨てると取得者集合が欠けてファネルの取得率が誤る）。id 昇順で安定ページング。
  const responses = await fetchAllPaged<{
    linked_student_id: string | null;
    form_period: string | null;
    response_data: unknown;
  }>((from, to) =>
    supabase
      .from('form_responses')
      .select('linked_student_id, form_period, response_data')
      .in('school_id', schoolIds)
      .eq('form_type', 'zoukoma')
      .not('linked_student_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)
  );
  const acquiredSet = new Set<string>(); // `${student}|${period_key}`（増コマ取得した生徒×期間）
  const acquiredSubjectSet = new Set<string>(); // `${student}|${period_key}|${科目名}`（取得した科目）
  for (const r of responses) {
    const rd = (r.response_data as Record<string, unknown> | null) ?? {};
    const koma = rd.total_koma;
    if (r.linked_student_id && typeof koma === 'number' && koma > 0) {
      acquiredSet.add(`${r.linked_student_id}|${r.form_period}`);
    }
    const subs = rd.subjects;
    if (r.linked_student_id && subs && typeof subs === 'object') {
      for (const [name, k] of Object.entries(subs as Record<string, unknown>)) {
        if (typeof k === 'number' && k > 0) {
          acquiredSubjectSet.add(`${r.linked_student_id}|${r.form_period}|${name}`);
        }
      }
    }
  }

  // 提案を生徒単位に畳む（同一生徒の複数提案はどれか取得で「取得」とみなす）
  const byStudent = new Map<string, { grade: number; acquired: boolean }>();
  for (const p of proposals) {
    const sid = p.student_id;
    if (!sid) continue;
    const grade = p.student?.grade ?? 0;
    const pk = p.zoukoma_period_id ? periodKeyById.get(p.zoukoma_period_id) : undefined;
    const acquired = pk ? acquiredSet.has(`${sid}|${pk}`) : false;
    const cur = byStudent.get(sid);
    if (!cur) byStudent.set(sid, { grade, acquired });
    else cur.acquired = cur.acquired || acquired;
  }

  const proposedStudents = byStudent.size;
  const acquiredStudents = Array.from(byStudent.values()).filter((v) => v.acquired).length;

  // 学年別
  const gradeMap = new Map<number, { proposed: number; acquired: number }>();
  for (const v of Array.from(byStudent.values())) {
    const g = gradeMap.get(v.grade) ?? { proposed: 0, acquired: 0 };
    g.proposed += 1;
    if (v.acquired) g.acquired += 1;
    gradeMap.set(v.grade, g);
  }
  const byGrade: ProposalGradeStat[] = Array.from(gradeMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([grade, g]) => ({
      grade,
      proposed: g.proposed,
      acquired: g.acquired,
      rate: g.proposed > 0 ? Math.round((g.acquired / g.proposed) * 1000) / 10 : 0,
    }));

  // 科目ベース: 提案科目(test_prep_proposal_subjects, proposed_koma>0) のうち取得された科目
  const proposalInfo = new Map<string, { student: string; pk: string | undefined }>();
  for (const p of proposals) {
    proposalInfo.set(p.id, {
      student: p.student_id,
      pk: p.zoukoma_period_id ? periodKeyById.get(p.zoukoma_period_id) : undefined,
    });
  }
  let proposedSubjects = 0;
  let acquiredSubjects = 0;
  const proposalIds = proposals.map((p) => p.id);
  if (proposalIds.length > 0) {
    // test_prep_proposal_subjects は DB 型未登録のため any 経由でアクセス
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: subjectRows } = await (supabase as any)
      .from('test_prep_proposal_subjects')
      .select('proposal_id, subject_name, proposed_koma')
      .in('proposal_id', proposalIds);
    const rows = (subjectRows ?? []) as {
      proposal_id: string;
      subject_name: string;
      proposed_koma: number | null;
    }[];
    for (const s of rows) {
      if (!s.proposed_koma || s.proposed_koma <= 0) continue;
      const info = proposalInfo.get(s.proposal_id);
      if (!info) continue;
      proposedSubjects += 1;
      if (info.pk && acquiredSubjectSet.has(`${info.student}|${info.pk}|${s.subject_name}`)) {
        acquiredSubjects += 1;
      }
    }
  }
  const subjectRate =
    proposedSubjects > 0 ? Math.round((acquiredSubjects / proposedSubjects) * 1000) / 10 : 0;

  return {
    proposalCount: proposals.length,
    proposedStudents,
    acquiredStudents,
    rate: proposedStudents > 0 ? Math.round((acquiredStudents / proposedStudents) * 1000) / 10 : 0,
    proposedSubjects,
    acquiredSubjects,
    subjectRate,
    byGrade,
  };
}
