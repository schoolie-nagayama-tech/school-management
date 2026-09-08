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
  isCoursePrepOutOfScope,
  resolvePeriodLastEndDate,
  resolveStudentTrack,
  resolveTrackWindow,
  trackShortLabel,
  computeCourseSessionsForStudent,
} from '@/lib/coursePrepKpis';
import type {
  CourseProgressItem,
  StudentCourseProgress,
  Student,
  CoursePrepTrack,
} from '@/types/database';
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
/** 区分。既定値（短縮名なし・開始日は共通・既定学年なし）を埋めて読みやすくする */
const track = (partial: Partial<CoursePrepTrack>): CoursePrepTrack =>
  ({
    short_name: null,
    schedule_start_date: null,
    default_grades: [],
    sort_order: 0,
    ...partial,
  }) as unknown as CoursePrepTrack;

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

/**
 * 進路調査（中3限定項目）の「対象外」判定のテスト。
 * 進捗表・期日超過KPI・アラートがこの1つの判定を共有しており、片方だけ実装が漏れると
 * 「表では対象外なのにアラートに残る」食い違いになるため、ここで定義を固定する。
 */
describe('isCoursePrepOutOfScope（進路調査は中3のみ対象）', () => {
  const shinro = { name: '進路調査回収', column_type: 'check' };

  it('非中3で入力が無ければ対象外', () => {
    expect(isCoursePrepOutOfScope(shinro, 8, false)).toBe(true);
    expect(isCoursePrepOutOfScope(shinro, null, false)).toBe(true);
  });

  it('中3は常に対象', () => {
    expect(isCoursePrepOutOfScope(shinro, 9, false)).toBe(false);
  });

  it('非中3でも明示的な入力があれば対象（手動の上書きを尊重）', () => {
    expect(isCoursePrepOutOfScope(shinro, 8, true)).toBe(false);
  });

  it('進路調査以外の項目・チェック列以外には効かない', () => {
    expect(isCoursePrepOutOfScope({ name: '生徒面談実施', column_type: 'check' }, 8, false)).toBe(
      false
    );
    expect(isCoursePrepOutOfScope({ name: '進路調査回収', column_type: 'number' }, 8, false)).toBe(
      false
    );
  });
});

describe('期日超過の集計で進路調査の対象外セルを数えない', () => {
  const items = [
    item({ id: 'sh', name: '進路調査回収', column_type: 'check', deadline: '2026-05-22' }),
    item({ id: 'si', name: '生徒面談実施', column_type: 'check', deadline: '2026-05-22' }),
  ];
  // 中2(s1)・中3(s2)
  const students = [student({ id: 's1', grade: 8 }), student({ id: 's2', grade: 9 })];
  const today = '2026-07-14'; // 期日を過ぎている

  it('進路調査は中3(s2)のみ超過。面談は両名超過 → 計3件', () => {
    const k = computeSchoolKpis(students, items, [], auto({}), null, today);
    expect(k.overdueCount).toBe(3);
    const a = computeDashboardAggregates(students, items, [], auto({}), null, today);
    expect(a.overdueList).toHaveLength(3);
    expect(a.overdueList.some((o) => o.item.id === 'sh' && o.student.id === 's1')).toBe(false);
  });

  it('中2でも進路調査に明示的な入力(pending)があれば超過として数える', () => {
    const progressData = [progress({ student_id: 's1', item_id: 'sh', status: 'pending' })];
    const k = computeSchoolKpis(students, items, progressData, auto({}), null, today);
    expect(k.overdueCount).toBe(4);
  });
});

/**
 * 講習期間の区分（Phase 8）まわり。
 * 冬期は生徒によって講習期間が違うので、「期が終わったか」の判定と通常回数の数え方が
 * 共通の終了日だけを見ていると実績が壊れる（自動確定が早すぎる／増コマが水増しされる）。
 * 学年で割れない（同じ小6でも受験する子としない子がいる）ため、期ごとの区分で表す。
 */
describe('resolvePeriodLastEndDate（最後の区分が終わる日）', () => {
  it('区分が無ければ共通の終了日', () => {
    expect(resolvePeriodLastEndDate({ schedule_end_date: '2027-01-05' }, [])).toBe('2027-01-05');
    expect(resolvePeriodLastEndDate({ schedule_end_date: '2027-01-05' })).toBe('2027-01-05');
  });

  it('区分が共通より後ならそちらを返す（受験生が入試直前まで続く冬期）', () => {
    expect(
      resolvePeriodLastEndDate({ schedule_end_date: '2027-01-05' }, [
        track({ id: 't1', name: '中学受験', schedule_end_date: '2027-01-31' }),
        track({ id: 't2', name: '高校受験', schedule_end_date: '2027-02-20' }),
      ])
    ).toBe('2027-02-20');
  });

  it('区分が共通より前なら共通のまま（早く終わる区分に引きずられない）', () => {
    expect(
      resolvePeriodLastEndDate({ schedule_end_date: '2027-01-05' }, [
        track({ id: 't1', name: '早じまい', schedule_end_date: '2026-12-28' }),
      ])
    ).toBe('2027-01-05');
  });

  it('共通も区分も無ければ null', () => {
    expect(resolvePeriodLastEndDate({ schedule_end_date: null }, [])).toBeNull();
    expect(resolvePeriodLastEndDate(null)).toBeNull();
    expect(resolvePeriodLastEndDate(undefined)).toBeNull();
  });

  it('YYYY-MM-DD でない値は無視する', () => {
    expect(
      resolvePeriodLastEndDate({ schedule_end_date: '2027-01-05' }, [
        track({ id: 't1', name: '壊れ', schedule_end_date: '2027/02/10' }),
      ])
    ).toBe('2027-01-05');
    // 共通側が壊れていて区分だけが正しい場合も、正しい方だけを採用する
    expect(
      resolvePeriodLastEndDate({ schedule_end_date: 'unknown' }, [
        track({ id: 't1', name: '高校受験', schedule_end_date: '2027-02-10' }),
      ])
    ).toBe('2027-02-10');
    expect(resolvePeriodLastEndDate({ schedule_end_date: 'unknown' }, [])).toBeNull();
  });
});

describe('resolveStudentTrack（生徒に効く区分の解決）', () => {
  const juken = track({
    id: 't-chu',
    name: '中学受験',
    schedule_end_date: '2027-01-31',
    default_grades: [],
    sort_order: 0,
  });
  const koukou = track({
    id: 't-kou',
    name: '高校受験',
    schedule_end_date: '2027-02-20',
    default_grades: [9],
    sort_order: 1,
  });
  const tracks = [juken, koukou];

  it('当てはめが最優先（既定の学年より強い）', () => {
    const assignments = new Map<string, string | null>([['s1', 't-chu']]);
    // 中3なので既定なら高校受験だが、個別の当てはめが勝つ
    expect(resolveStudentTrack(tracks, assignments, 's1', 9)?.id).toBe('t-chu');
  });

  it('当てはめが null なら共通（既定の学年を打ち消す明示指定）', () => {
    const assignments = new Map<string, string | null>([['s1', null]]);
    expect(resolveStudentTrack(tracks, assignments, 's1', 9)).toBeNull();
  });

  it('行が無ければ既定の学年で当てはまる', () => {
    expect(resolveStudentTrack(tracks, new Map(), 's1', 9)?.id).toBe('t-kou');
    // 既定に無い学年は共通
    expect(resolveStudentTrack(tracks, new Map(), 's2', 6)).toBeNull();
  });

  it('既定の学年が複数の区分で重なったら sort_order の若い方', () => {
    const early = track({
      id: 't-early',
      name: 'あとから作った区分',
      schedule_end_date: '2027-01-20',
      default_grades: [9],
      sort_order: 0,
    });
    expect(resolveStudentTrack([koukou, early], new Map(), 's1', 9)?.id).toBe('t-early');
    // 渡す順番が違っても結果は変わらない（sort_order で決まる）
    expect(resolveStudentTrack([early, koukou], new Map(), 's1', 9)?.id).toBe('t-early');
  });

  it('学年が不明なら既定では当てはめない（当てはめ行があればそれは効く）', () => {
    expect(resolveStudentTrack(tracks, new Map(), 's1', null)).toBeNull();
    const assignments = new Map<string, string | null>([['s1', 't-kou']]);
    expect(resolveStudentTrack(tracks, assignments, 's1', null)?.id).toBe('t-kou');
  });

  it('当てはめ先の区分が消えていたら共通に倒す', () => {
    const assignments = new Map<string, string | null>([['s1', '消えたID']]);
    expect(resolveStudentTrack(tracks, assignments, 's1', 9)).toBeNull();
  });
});

describe('resolveTrackWindow（生徒の講習期間）', () => {
  it('区分が無ければ共通の期間', () => {
    expect(resolveTrackWindow(null, '2026-12-22', '2027-01-07')).toEqual({
      start: '2026-12-22',
      end: '2027-01-07',
    });
  });

  it('区分の開始日が空なら共通の開始日・終了日は区分のもの', () => {
    const t = track({ id: 't1', name: '中学受験', schedule_end_date: '2027-01-31' });
    expect(resolveTrackWindow(t, '2026-12-22', '2027-01-07')).toEqual({
      start: '2026-12-22',
      end: '2027-01-31',
    });
  });

  it('区分に開始日があればそれを使う（共通より早く始まる大学受験など）', () => {
    const t = track({
      id: 't1',
      name: '大学受験',
      schedule_start_date: '2026-12-15',
      schedule_end_date: '2027-02-25',
    });
    expect(resolveTrackWindow(t, '2026-12-22', '2027-01-07')).toEqual({
      start: '2026-12-15',
      end: '2027-02-25',
    });
  });
});

describe('trackShortLabel（表に出す短縮名）', () => {
  it('short_name があればそれを使う', () => {
    expect(trackShortLabel(track({ id: 't1', name: '中学受験', short_name: '中受' }))).toBe('中受');
  });

  it('short_name が無ければ name の先頭2文字', () => {
    expect(trackShortLabel(track({ id: 't1', name: '中学受験' }))).toBe('中学');
    expect(trackShortLabel(track({ id: 't1', name: '英' }))).toBe('英');
  });

  it('空白だけの short_name は無いものとして扱う', () => {
    expect(trackShortLabel(track({ id: 't1', name: '高校受験', short_name: '  ' }))).toBe('高校');
  });
});

describe('computeCourseSessionsForStudent（通常回数の数え方）', () => {
  // 月曜が5回・水曜が4回ある期間を想定
  const dayCounts = { 0: 0, 1: 5, 2: 0, 3: 4, 4: 0, 5: 0, 6: 0 };

  it('曜日ごとのコマ数 × その曜日の出現回数の合計', () => {
    expect(computeCourseSessionsForStudent({ 1: 1, 3: 2 }, dayCounts)).toBe(5 + 8);
  });

  it('期間日付が無い（dayCounts=null）ときはパターン本数の合計にフォールバック', () => {
    expect(computeCourseSessionsForStudent({ 1: 1, 3: 2 }, null)).toBe(3);
  });

  it('通塾パターンが無い生徒は0', () => {
    expect(computeCourseSessionsForStudent(undefined, dayCounts)).toBe(0);
    expect(computeCourseSessionsForStudent({}, null)).toBe(0);
  });

  it('終了日が長い学年ほど通常回数が多く出る（増コマの水増しを防ぐ根拠）', () => {
    const longer = { 0: 0, 1: 9, 2: 0, 3: 8, 4: 0, 5: 0, 6: 0 };
    expect(computeCourseSessionsForStudent({ 1: 1, 3: 1 }, longer)).toBeGreaterThan(
      computeCourseSessionsForStudent({ 1: 1, 3: 1 }, dayCounts)
    );
  });
});
