/**
 * computeDecidedKomaByStudent のテスト。
 *
 * これは講習の「取得（決定）増コマ数」の定義そのもので、講習進捗ダッシュボードと
 * 請求同期（syncCourseExtraToBilling の total）が共有する。金額の元になるため、
 * 2つの算出経路（applied_extra 自動列 / 手入力の number 列）と列特定ロジックを固定する。
 */
import { describe, it, expect } from 'vitest';
import {
  computeDecidedKomaByStudent,
  computeDashboardAggregates,
  computeSchoolKpis,
} from '@/lib/coursePrepKpis';
import type { CourseProgressItem, StudentCourseProgress, Student } from '@/types/database';
import type { AutoValues } from '@/lib/api/courseProgress';

// 関数が読むフィールドだけを持つ最小オブジェクトを作る（型はキャストで満たす）
const item = (partial: Partial<CourseProgressItem>): CourseProgressItem =>
  partial as unknown as CourseProgressItem;
const progress = (partial: Partial<StudentCourseProgress>): StudentCourseProgress =>
  partial as unknown as StudentCourseProgress;
const auto = (
  v: Record<string, { applied_total?: number; course_sessions?: number }>
): AutoValues => v as unknown as AutoValues;
const student = (partial: Partial<Student>): Student => partial as unknown as Student;

describe('computeDecidedKomaByStudent（取得増コマの算出）', () => {
  it('applied_extra 自動列: max(0, applied_total - course_sessions)', () => {
    const items = [
      item({ id: 'd', name: '決定増コマ', column_type: 'number', auto_source: 'applied_extra' }),
    ];
    const result = computeDecidedKomaByStudent(
      [{ id: 's1' }, { id: 's2' }],
      items,
      [],
      auto({
        s1: { applied_total: 8, course_sessions: 5 }, // 3
        s2: { applied_total: 3, course_sessions: 5 }, // max(0, -2) = 0
      })
    );
    expect(result).toEqual({ s1: 3, s2: 0 });
  });

  it('applied_extra: autoValues 欠損は 0 として扱う', () => {
    const items = [
      item({ id: 'd', auto_source: 'applied_extra', column_type: 'number', name: 'x' }),
    ];
    const result = computeDecidedKomaByStudent([{ id: 's1' }], items, [], auto({}));
    expect(result).toEqual({ s1: 0 });
  });

  it('手入力の number 列: progressData の number_value を採用（未入力は0）', () => {
    const items = [
      item({ id: 'm', name: '増コマ回数決定', column_type: 'number', auto_source: null }),
    ];
    const result = computeDecidedKomaByStudent(
      [{ id: 's1' }, { id: 's2' }],
      items,
      [progress({ student_id: 's1', item_id: 'm', number_value: 4 })],
      auto({})
    );
    // s1 は記録あり=4、s2 は記録なし=0
    expect(result).toEqual({ s1: 4, s2: 0 });
  });

  it('決定増コマ列が見つからない場合は全生徒0', () => {
    const items = [item({ id: 'x', name: '無関係な列', column_type: 'number', auto_source: null })];
    const result = computeDecidedKomaByStudent([{ id: 's1' }], items, [], auto({}));
    expect(result).toEqual({ s1: 0 });
  });

  it('提案増コマ列(proposed_extra)を決定列として誤選択しない', () => {
    // proposed_extra しか無いとき、決定列は見つからず0（提案列を取得列に流用しない）
    const items = [
      item({ id: 'p', name: '提案増コマ', column_type: 'number', auto_source: 'proposed_extra' }),
    ];
    const result = computeDecidedKomaByStudent([{ id: 's1' }], items, [], auto({}));
    expect(result).toEqual({ s1: 0 });
  });

  it('提案列と決定列が併存する場合、決定列(applied_extra)を提案列と別に選ぶ', () => {
    const items = [
      item({ id: 'p', name: '提案増コマ', column_type: 'number', auto_source: 'proposed_extra' }),
      item({ id: 'd', name: '決定増コマ', column_type: 'number', auto_source: 'applied_extra' }),
    ];
    const result = computeDecidedKomaByStudent(
      [{ id: 's1' }],
      items,
      [],
      auto({ s1: { applied_total: 6, course_sessions: 4 } })
    );
    expect(result).toEqual({ s1: 2 });
  });
});

/**
 * computeDashboardAggregates のテスト。A3レポートと画面ダッシュボードが共有する集計で、
 * 提案/取得コマ・取得率・面談件数・学校種別分析・教科別 提案vs取得を固定する。
 * 共有指標（提案/取得/取得率/件数）は computeSchoolKpis と一致することも確認し、
 * レポートとダッシュボードで数字がブレないことを保証する。
 */
describe('computeDashboardAggregates（レポート/ダッシュボード共通集計）', () => {
  // 提案=proposed_extra 自動列 / 取得=applied_extra 自動列 / 面談チェック2列
  const items = [
    item({ id: 'p', name: '提示増コマ', column_type: 'number', auto_source: 'proposed_extra' }),
    item({ id: 'd', name: '増コマ回数決定', column_type: 'number', auto_source: 'applied_extra' }),
    item({ id: 'si', name: '生徒面談実施', column_type: 'check', auto_source: null }),
    item({ id: 'pi', name: '父母面談実施', column_type: 'check', auto_source: null }),
  ];
  // 中1(s1)・中2(s2)・高1(s3)
  const students = [
    student({ id: 's1', grade: 7, last_name: '田中' }),
    student({ id: 's2', grade: 8, last_name: '佐藤' }),
    student({ id: 's3', grade: 10, last_name: '鈴木' }),
  ];
  const av = {
    // 提案 = proposal_total - course_sessions / 取得 = applied_total - course_sessions
    s1: {
      proposal_total: 10,
      applied_total: 8,
      course_sessions: 4,
      subject_proposals: { 数学: 4, 英語: 2 },
      subject_applied: { 数学: 3, 英語: 1 },
    },
    s2: {
      proposal_total: 6,
      applied_total: 6,
      course_sessions: 2,
      subject_proposals: { 数学: 4 },
      subject_applied: { 数学: 4 },
    },
    s3: {
      proposal_total: 5,
      applied_total: 0,
      course_sessions: 3,
      subject_proposals: { 英語: 2 },
      subject_applied: {},
    },
  } as unknown as AutoValues;
  // 生徒面談: s1,s2 実施 / 父母面談: s1 実施
  const progressData = [
    progress({ student_id: 's1', item_id: 'si', status: 'completed' }),
    progress({ student_id: 's2', item_id: 'si', status: 'completed' }),
    progress({ student_id: 's1', item_id: 'pi', status: 'completed' }),
  ];
  const period = {
    target_koma: 8,
    budget_koma: 10,
    expected_rate: 50,
  } as unknown as Parameters<typeof computeDashboardAggregates>[4];
  const today = '2026-07-14';

  it('提案/取得コマ・取得率・想定/目標/予算の各指標', () => {
    const a = computeDashboardAggregates(students, items, progressData, av, period, today);
    // 提案: s1=6, s2=4, s3=2 → 12 / 取得: s1=4, s2=4, s3=0 → 8
    expect(a.totalProposed).toBe(12);
    expect(a.totalDecided).toBe(8);
    expect(a.actualRatePct).toBe(67); // 8/12
    expect(a.proposedStudentCount).toBe(3); // 全員 提案>0
    expect(a.decidedStudentCount).toBe(2); // s1,s2 は取得>0、s3 は0（自動列なので未計上）
    expect(a.expectedKoma).toBe(6); // 12 * 50%
    expect(a.targetRate).toBeCloseTo(8 / 8);
    expect(a.budgetRate).toBeCloseTo(8 / 10);
    expect(a.studentInterviewCount).toBe(2);
    expect(a.parentInterviewCount).toBe(1);
  });

  it('共有指標は computeSchoolKpis と一致する（レポートと横断サマリーで定義がブレない）', () => {
    const a = computeDashboardAggregates(students, items, progressData, av, period, today);
    const k = computeSchoolKpis(students, items, progressData, av, period, today);
    expect(a.totalProposed).toBe(k.totalProposed);
    expect(a.totalDecided).toBe(k.totalDecided);
    expect(a.proposedStudentCount).toBe(k.proposedStudentCount);
    expect(a.decidedStudentCount).toBe(k.decidedStudentCount);
    expect(Math.round(a.actualRate * 100)).toBe(Math.round(k.acquisitionRate * 100));
  });

  it('学校種別分析: 中学生(s1,s2)と高校生(s3)に分かれ、取得率も算出される', () => {
    const a = computeDashboardAggregates(students, items, progressData, av, period, today);
    const middle = a.categoryAnalysis.find((c) => c.category === 'middle');
    const high = a.categoryAnalysis.find((c) => c.category === 'high');
    expect(middle?.studentCount).toBe(2);
    expect(middle?.totalProposed).toBe(10); // 6+4
    expect(middle?.totalDecided).toBe(8); // 4+4
    expect(Math.round((middle?.acquisitionRate ?? 0) * 100)).toBe(80);
    expect(high?.totalProposed).toBe(2);
    expect(high?.totalDecided).toBe(0);
  });

  it('教科別 提案vs取得: 全生徒合算・既知順（数学→英語）で並ぶ', () => {
    const a = computeDashboardAggregates(students, items, progressData, av, period, today);
    expect(a.subjectAnalysis.overall.map((r) => r.subject)).toEqual(['数学', '英語']);
    const math = a.subjectAnalysis.overall.find((r) => r.subject === '数学');
    expect(math).toMatchObject({ proposed: 8, applied: 7 }); // s1:4/3 + s2:4/4
    const eng = a.subjectAnalysis.overall.find((r) => r.subject === '英語');
    expect(eng).toMatchObject({ proposed: 4, applied: 1 }); // s1:2/1 + s3:2/0
  });
});
