import 'server-only';
import { getPortalServiceClient } from './serviceClient';
import { GRADE_NAME_TO_NUMBER } from '@/types/forms/mogi';
import {
  GUIDANCE_FORM_TYPES,
  type GuidanceFormType,
  type GuidancePush,
  type GuidanceItem,
  type FormGuidance,
} from '@/types/mypage-schedule';

// 型・定数はクライアントと共有するため @/types/mypage-schedule が正。呼び出し元の
// 利便のためここから再輸出する。
export { GUIDANCE_FORM_TYPES };
export type { GuidanceFormType, GuidancePush, GuidanceItem, FormGuidance };

/**
 * 手続きハブ（申し込み・通塾の変更・相談）のデータ導出（Stage 3）。
 *
 * 正典: docs/portal-v2-requirements.md §7-3「申し込みプッシュ」。
 *
 * ここの目的は「受付中の羅列」で終わらせず、**その生徒が申し込むべきもの**を
 * 理由付きで前に出すこと（＝プッシュ）。初期スコープの導出は2つ:
 *   1. テスト対策 増コマ: その生徒宛の提案書が sent/published で、対応する増コマ申込が未提出。
 *   2. 模試(moshi/mogi): 公開中の期間の対象学年に該当し、未申込。
 *
 * ★ 判定を純関数に切り出している理由:
 *   「公開中か」「対象学年か」は境界（publish_start/end のちょうど・学年未設定）で
 *   間違えやすく、間違えると「出すべきでない人にプッシュする」実害になる。DBアクセスから
 *   切り離して単体テストで固定する。
 */

/** 判定に必要な form_periods の最小形。 */
export interface PeriodRow {
  id: string;
  school_id: string;
  form_type: string;
  period_key: string;
  title: string;
  settings: Record<string, unknown> | null;
  publish_start: string | null;
  publish_end: string | null;
  is_active: boolean;
  is_archived: boolean | null;
}

/**
 * 期間の公開状態。
 *   - 'open'     : 受付中（申込可能・プッシュ対象になりうる）
 *   - 'ended'    : 受付終了（一覧には出すが申込不可）
 *   - 'upcoming' : 公開前（保護者にはまだ見せない）
 *   - 'inactive' : 無効・アーカイブ済み（見せない）
 */
export type PeriodStatus = 'open' | 'ended' | 'upcoming' | 'inactive';

/**
 * 期間の公開状態を判定する（純関数）。
 *
 * 境界（テストで固定）:
 *   - publish_start / publish_end が null なら、その側の制限なし。
 *   - publish_start ちょうど → open（「その時刻から公開」）。
 *   - publish_end ちょうど   → open（「その時刻まで受付」）。end を過ぎて初めて ended。
 *   - is_active=false / is_archived=true は他に優先して inactive。
 */
export function periodStatus(period: PeriodRow, now: Date = new Date()): PeriodStatus {
  if (!period.is_active || period.is_archived === true) return 'inactive';
  const t = now.getTime();
  if (period.publish_start && new Date(period.publish_start).getTime() > t) return 'upcoming';
  if (period.publish_end && new Date(period.publish_end).getTime() < t) return 'ended';
  return 'open';
}

/**
 * 模試(moshi/mogi)の「対象学年」に生徒が該当するかを判定する（純関数）。
 *
 * ★ どのキーを見るか: `form_periods.settings.grades`。
 *   MoshiSettings.grades / MogiSettings.grades（src/types/forms/moshi.ts, mogi.ts）が
 *   学年名の配列（例 ["小4","中1"]）を持つのが唯一の学年指定。students.grade は数値なので
 *   GRADE_NAME_TO_NUMBER（mogi.ts。moshi の名前を包含する上位集合）で写像して比較する。
 *
 * 挙動:
 *   - grades が無い/空 → 学年フィルタなし＝全員対象（true）。
 *   - grades があるのに生徒の grade が未設定(null) → false。
 *     ★ 安全側に倒す理由: 対象学年の指定があるのに生徒の学年が分からない状態で
 *       プッシュすると「対象でない人に申し込みを促す」誤案内になる。プッシュしない方の害が小さい。
 *   - 認識できない学年名は無視する（表記ゆれで全員対象に化けないよう、写像できたものだけで判定）。
 */
export function matchesGrade(grades: unknown, studentGrade: number | null): boolean {
  if (!Array.isArray(grades) || grades.length === 0) return true; // 指定なし＝全員対象
  if (studentGrade == null) return false; // 指定ありなのに学年不明 → 安全側（プッシュしない）
  const nums = grades
    .filter((g): g is string => typeof g === 'string')
    .map((g) => GRADE_NAME_TO_NUMBER[g])
    .filter((n): n is number => typeof n === 'number');
  if (nums.length === 0) return true; // 認識できる指定が1つも無い＝実質フィルタなし
  return nums.includes(studentGrade);
}

/** 「その生徒がこの期間に申し込み済みか」を判定する（純関数）。 */
export function hasApplied(appliedKeys: Set<string>, formType: string, periodKey: string): boolean {
  return appliedKeys.has(appliedKey(formType, periodKey));
}

/** 申込済み判定のキー（form_type × period_key）。 */
export function appliedKey(formType: string, periodKey: string): string {
  return `${formType}::${periodKey}`;
}

/**
 * 'YYYY-MM-DD...' or ISO 文字列 → 'M/D'（理由文の日付表示）。
 */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return `${Number(m[2])}/${Number(m[3])}`;
}

/**
 * v1 フォームの URL を組み立てる。
 *
 * TODO(§8 未決事項): 当面は v1 の公開フォームへ素で送る。v1 側は schoolCode から
 *   「公開中の期間」を自分で解決するため、period_key を渡す口が今は無い。
 *   生徒の紐づけ・回答のスコープ化（linked_student_id の自動付与）と
 *   プリフィルは v1 フォーム本体の改修が要るので別段で行う（このタスクでは繋ぐだけ）。
 */
export function buildFormHref(schoolCode: string, formType: GuidanceFormType): string {
  return `/portal/${encodeURIComponent(schoolCode)}/${formType}`;
}

/**
 * 手続きハブのデータを導出する（service role・サーバー専用）。
 *
 * ★ 呼び出し側は必ず「そのアカウントの紐づけ生徒か」を先に検証すること
 *   （service role で RLS をバイパスするため、この関数は認可を行わない）。
 *
 * @param studentIds 対象生徒（兄弟ぶん）。在籍中の紐づけ生徒のみを渡すこと。
 */
export async function getFormGuidance(
  studentIds: string[],
  now: Date = new Date()
): Promise<FormGuidance> {
  if (studentIds.length === 0) return { pushes: [], items: [] };

  const svc = getPortalServiceClient();

  // ── 生徒（学年・所属校・氏名）と教室コード ──
  const { data: studentsRaw } = await svc
    .from('students')
    .select('id, last_name, first_name, grade, school_id, schools(code)')
    .in('id', studentIds);

  interface StudentRow {
    id: string;
    last_name: string;
    first_name: string;
    grade: number | null;
    school_id: string;
    schools: { code: string } | null;
  }
  const students = (studentsRaw ?? []) as unknown as StudentRow[];
  if (students.length === 0) return { pushes: [], items: [] };

  const schoolIds = Array.from(new Set(students.map((s) => s.school_id)));

  // ── 対象教室の form_periods（ポータルに出す種別のみ） ──
  const { data: periodsRaw } = await svc
    .from('form_periods')
    .select(
      'id, school_id, form_type, period_key, title, settings, publish_start, publish_end, is_active, is_archived'
    )
    .in('school_id', schoolIds)
    .in('form_type', GUIDANCE_FORM_TYPES as unknown as string[]);
  const periods = (periodsRaw ?? []) as unknown as PeriodRow[];

  // ── 申込済み（未申込判定の材料）──
  // linked_student_id で生徒に紐づいた回答のみを「申込済み」とみなす（§7-3）。
  const { data: responsesRaw } = await svc
    .from('form_responses')
    .select('form_type, form_period, linked_student_id')
    .in('linked_student_id', studentIds)
    .eq('is_archived', false);
  interface ResponseRow {
    form_type: string;
    form_period: string;
    linked_student_id: string;
  }
  const responses = (responsesRaw ?? []) as unknown as ResponseRow[];

  // 生徒ごとの申込済みキー集合。
  const appliedByStudent = new Map<string, Set<string>>();
  for (const s of students) appliedByStudent.set(s.id, new Set());
  for (const r of responses) {
    appliedByStudent.get(r.linked_student_id)?.add(appliedKey(r.form_type, r.form_period));
  }

  // ── テスト対策の提案書（プッシュ理由1）──
  // status が sent/published かつ増コマ期間に直結しているものだけがプッシュ候補。
  const { data: proposalsRaw } = await svc
    .from('test_prep_proposals')
    .select('id, student_id, zoukoma_period_id, status, created_at, updated_at')
    .in('student_id', studentIds)
    .in('status', ['sent', 'published'])
    .not('zoukoma_period_id', 'is', null);
  interface ProposalRow {
    id: string;
    student_id: string;
    zoukoma_period_id: string;
    status: string;
    created_at: string;
    updated_at: string;
  }
  const proposals = (proposalsRaw ?? []) as unknown as ProposalRow[];

  const periodById = new Map(periods.map((p) => [p.id, p]));

  const pushes: GuidancePush[] = [];
  const items: GuidanceItem[] = [];

  for (const s of students) {
    const name = `${s.last_name} ${s.first_name}`;
    const schoolCode = s.schools?.code ?? '';
    const applied = appliedByStudent.get(s.id) ?? new Set<string>();
    const schoolPeriods = periods.filter((p) => p.school_id === s.school_id);

    // 既にプッシュした (form_type, period_key) は通常一覧に重複させない。
    const pushedKeys = new Set<string>();

    // ── プッシュ1: テスト対策 増コマ ──
    for (const pr of proposals.filter((p) => p.student_id === s.id)) {
      const period = periodById.get(pr.zoukoma_period_id);
      if (!period) continue;
      // 提案書が生徒の所属校の期間に紐づいていること（教室横断の取り違え防止）。
      if (period.school_id !== s.school_id) continue;
      if (periodStatus(period, now) !== 'open') continue;
      if (hasApplied(applied, period.form_type, period.period_key)) continue;

      // 理由文の日付は「教室が提案した日」。sent 相当の最終更新を優先し、無ければ作成日。
      const proposedAt = formatShortDate(pr.updated_at ?? pr.created_at);
      pushes.push({
        studentId: s.id,
        studentName: name,
        formType: 'zoukoma',
        periodKey: period.period_key,
        title: period.title,
        reason: proposedAt
          ? `${proposedAt} に教室からテスト対策のご提案があります`
          : '教室からテスト対策のご提案があります',
        href: buildFormHref(schoolCode, 'zoukoma'),
      });
      pushedKeys.add(appliedKey(period.form_type, period.period_key));
    }

    // ── プッシュ2: 模試（moshi/mogi）──
    for (const period of schoolPeriods) {
      if (period.form_type !== 'moshi' && period.form_type !== 'mogi') continue;
      if (periodStatus(period, now) !== 'open') continue;
      if (hasApplied(applied, period.form_type, period.period_key)) continue;
      const grades = (period.settings ?? {}).grades;
      if (!matchesGrade(grades, s.grade)) continue;

      const key = appliedKey(period.form_type, period.period_key);
      if (pushedKeys.has(key)) continue;
      pushes.push({
        studentId: s.id,
        studentName: name,
        formType: period.form_type as GuidanceFormType,
        periodKey: period.period_key,
        title: period.title,
        // 学年指定があれば「対象学年です」、無指定なら一般案内の文言にする。
        reason: Array.isArray(grades) && grades.length > 0 ? '対象学年です' : '受付中です',
        href: buildFormHref(schoolCode, period.form_type as GuidanceFormType),
      });
      pushedKeys.add(key);
    }

    // ── 通常一覧（受付中／受付終了）──
    for (const period of schoolPeriods) {
      const st = periodStatus(period, now);
      if (st !== 'open' && st !== 'ended') continue; // upcoming/inactive は見せない
      const key = appliedKey(period.form_type, period.period_key);
      if (pushedKeys.has(key)) continue; // プッシュ済みは上のセクションにあるので重複させない
      items.push({
        studentId: s.id,
        studentName: name,
        formType: period.form_type as GuidanceFormType,
        periodKey: period.period_key,
        title: period.title,
        status: st,
        href: buildFormHref(schoolCode, period.form_type as GuidanceFormType),
      });
    }
  }

  return { pushes, items };
}
