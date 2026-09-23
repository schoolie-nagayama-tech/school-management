/**
 * 面談ワークスペース「申込から見えること」（2026-09-23）のテスト。
 *
 * ★守りたいのは次の点:
 *  - テスト対策の結果は「その試験・その学年」の定期テストだけと突き合わせる（去年の2学期中間を拾わない）
 *  - 「前回」は年度内の順番で引く（listAssessments の並びは name_code の文字順になることがある）
 *  - 結果が無ければ聞く。ただし目標の達成度が同じ試験を聞いていれば重ねない
 *  - 週回数変更は、変更月が来ていれば「報告」、来ていなければ席の有無で「伝える／確定を聞く」
 *  - 模試は受験から7日たって結果が無いときだけ聞く。入っていれば何も出さない
 *  - AIへ渡す行は決まった書き出しで始まり、画面では外れる／サーバーはその書き出ししか通さない
 *
 * フィクスチャは本番の形に合わせてある（2026-09-23 の本番確認: 永山校 中3 の2学期中間の提案書、
 * 週回数変更 週2→週3（2026-09〜・席確定）、Vもぎ date_id「2026-09-13__toritsu_v」）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildMissingRecordAskLines,
  buildMockReturnLines,
  buildShukaisuLines,
  buildTellSections,
  buildTestPrepLines,
  resolveTestPrepZoukoma,
  stripTargetSchoolFactLines,
  type TestPrepProposalForInterview,
} from '@/app/interview/interview.shared';
import {
  sanitizeLessonNotes,
  isLessonNoteLine,
  SHUKAISU_AI_PREFIX,
  TEST_PREP_AI_PREFIX,
} from '@/lib/ai/interviewBrief';
import type { AssessmentWithScores } from '@/types/database';

/** 2026-09-23（火）の昼。面談の当日 */
const TODAY = new Date(2026, 8, 23, 12, 0, 0);

function assessment(
  // ★scores は Partial<AssessmentWithScores> 側（行の全列）と交差させると型が合わなくなるので外す
  over: Omit<Partial<AssessmentWithScores>, 'scores'> & {
    scores?: { subject: string; value: number }[];
  }
): AssessmentWithScores {
  return {
    id: `a-${over.name_code}-${over.grade}`,
    school_id: 's1',
    student_id: 'st1',
    category: 'regular_test',
    title: null,
    exam_date: null,
    exam_month: null,
    grade: 9,
    term: null,
    name_code: 'term1_final',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...over,
    scores: (over.scores ?? []).map((s, i) => ({
      id: `sc${i}`,
      assessment_id: 'x',
      subject: s.subject,
      value: s.value,
      created_at: '',
      updated_at: '',
    })),
  } as unknown as AssessmentWithScores;
}

/**
 * 永山校 中3・2学期中間の提案書（本番の形）。単元にはテスト範囲がまるごと載り、
 * コマが付いているのは理科・社会の一部の単元だけ（英語・数学は単元があっても0コマ）
 */
function proposal(over: Partial<TestPrepProposalForInterview> = {}): TestPrepProposalForInterview {
  return {
    id: 'p1',
    examName: '2学期中間',
    title: '2学期中間 テスト対策',
    createdAt: '2026-09-11T03:00:00Z',
    subjects: [
      { name: '英語', koma: 0, units: [{ name: '4-1～3', koma: 0 }] },
      {
        name: '数学',
        koma: 0,
        units: [
          { name: '２次方程式とその解', koma: 0 },
          { name: '関数 y＝ax²', koma: 0 },
        ],
      },
      {
        name: '理科',
        koma: 3,
        units: [
          { name: '化学変化とイオン', koma: 1 },
          { name: '酸・アルカリと中和', koma: 1 },
          { name: '電池のしくみ', koma: 1 },
          { name: '力の合成と分解', koma: 0 },
        ],
      },
      // 科目にコマはあるが単元にコマが無い（単元の割り当てを省いた）ときは、単元をすべて出す
      { name: '社会', koma: 1, units: [{ name: '日本国憲法の基本原理', koma: 0 }] },
    ],
    zoukoma: { status: 'applied', koma: 2 },
    ...over,
  };
}

describe('resolveTestPrepZoukoma', () => {
  const responses = [
    { formPeriod: '2026-09', createdAt: '2026-09-05T00:00:00Z', responseData: { total_koma: 2 } },
    { formPeriod: '2026-09', createdAt: '2026-09-10T00:00:00Z', responseData: { total_koma: 3 } },
    { formPeriod: '2026-06', createdAt: '2026-06-01T00:00:00Z', responseData: { total_koma: 5 } },
  ];
  it('同じ期の回答はいちばん新しい1件を採る（出し直しを足し算しない）', () => {
    expect(resolveTestPrepZoukoma('2026-09', responses)).toEqual({ status: 'applied', koma: 3 });
  });
  it('期が分かって回答が無ければ申込なし', () => {
    expect(resolveTestPrepZoukoma('2026-12', responses)).toEqual({ status: 'none' });
  });
  it('提案書に期が付いていなければ決めつけない', () => {
    expect(resolveTestPrepZoukoma(null, responses)).toEqual({ status: 'unknown' });
  });
});

describe('buildTestPrepLines', () => {
  it('結果がまだ無ければ、見出し・単元を出して結果を聞く', () => {
    const r = buildTestPrepLines([proposal()], [], 9, TODAY);
    expect(r.facts).toEqual([
      'テスト対策（2学期中間）理科 3コマ・社会 1コマ（増コマ申込 2コマ）',
      '対策した単元：化学変化とイオン・酸・アルカリと中和・電池のしくみ（ほか1）',
    ]);
    expect(r.ask).toEqual(['2学期中間の結果を聞いて入れる']);
    expect(r.aiLines).toHaveLength(1);
    expect(r.aiLines[0].startsWith(TEST_PREP_AI_PREFIX)).toBe(true);
    expect(r.aiLines[0]).toContain('結果まだ');
  });

  it('去年（中2）の2学期中間は結果として拾わない', () => {
    const lastYear = assessment({
      name_code: 'term2_mid',
      grade: 8,
      scores: [{ subject: 'science', value: 55 }],
    });
    const r = buildTestPrepLines([proposal()], [lastYear], 9, TODAY);
    expect(r.facts.some((f) => f.startsWith('→ 結果'))).toBe(false);
    expect(r.ask).toEqual(['2学期中間の結果を聞いて入れる']);
  });

  it('結果があれば、対策した科目の前回→今回を出す（前回は年度内の順番で引く）', () => {
    // listAssessments は exam_month が空だと name_code の文字順（term1_final → term1_mid）で返す
    const assessments = [
      assessment({
        name_code: 'term2_mid',
        grade: 9,
        scores: [
          { subject: 'science', value: 70 },
          { subject: 'social', value: 58 },
        ],
      }),
      assessment({
        name_code: 'term1_final',
        grade: 9,
        scores: [
          { subject: 'science', value: 64 },
          { subject: 'social', value: 61 },
        ],
      }),
      assessment({
        name_code: 'term1_mid',
        grade: 9,
        scores: [{ subject: 'science', value: 40 }],
      }),
    ];
    const r = buildTestPrepLines([proposal()], assessments, 9, TODAY);
    expect(r.facts).toContain('→ 結果 理科 64→70（+6）／社会 61→58（-3）');
    expect(r.ask).toEqual([]);
    expect(r.aiLines[0]).toContain('結果 理科 64→70（+6）');
  });

  it('前回が無い科目は今回の点だけ', () => {
    const assessments = [
      assessment({ name_code: 'term2_mid', grade: 9, scores: [{ subject: 'science', value: 70 }] }),
    ];
    const r = buildTestPrepLines([proposal()], assessments, 9, TODAY);
    expect(r.facts).toContain('→ 結果 理科 70');
  });

  it('目標の達成度が同じ試験を聞いているときは重ねない', () => {
    const r = buildTestPrepLines([proposal()], [], 9, TODAY, [
      '理科 2学期中間 目標70点。結果を聞いて入れる',
    ]);
    expect(r.ask).toEqual([]);
  });

  it('増コマの申込なし／期が不明の書き分け', () => {
    const none = buildTestPrepLines([proposal({ zoukoma: { status: 'none' } })], [], 9, TODAY);
    expect(none.facts[0]).toBe('テスト対策（2学期中間）理科 3コマ・社会 1コマ（増コマ申込なし）');
    const unknown = buildTestPrepLines(
      [proposal({ zoukoma: { status: 'unknown' } })],
      [],
      9,
      TODAY
    );
    expect(unknown.facts[0]).toBe('テスト対策（2学期中間）理科 3コマ・社会 1コマ');
  });

  it('試験の種類が無い提案書は結果を聞かない（何の結果か分からない）', () => {
    const r = buildTestPrepLines(
      [proposal({ examName: null, title: '夏明けテスト対策' })],
      [],
      9,
      TODAY
    );
    expect(r.facts[0]).toContain('テスト対策（夏明けテスト対策）');
    expect(r.ask).toEqual([]);
  });

  it('コマも単元も無い提案書は飛ばし、新しい順に最大2件', () => {
    const empty = proposal({
      id: 'empty',
      createdAt: '2026-09-20T00:00:00Z',
      subjects: [{ name: '英語', koma: 0, units: [] }],
    });
    const older = proposal({ id: 'old', examName: '1学期期末', createdAt: '2026-06-01T00:00:00Z' });
    const oldest = proposal({ id: 'x', examName: '1学期中間', createdAt: '2026-04-20T00:00:00Z' });
    const r = buildTestPrepLines([older, empty, proposal(), oldest], [], 9, TODAY);
    expect(r.aiLines).toHaveLength(2);
    expect(r.facts[0]).toContain('2学期中間');
    expect(r.facts.some((f) => f.includes('1学期期末'))).toBe(true);
    expect(r.facts.some((f) => f.includes('1学期中間'))).toBe(false);
  });

  it('コマが0でも単元があれば科目名で出す', () => {
    const r = buildTestPrepLines(
      [
        proposal({
          subjects: [{ name: '国語', koma: 0, units: [{ name: '古文の読解', koma: 0 }] }],
          zoukoma: { status: 'unknown' },
        }),
      ],
      [],
      9,
      TODAY
    );
    expect(r.facts[0]).toBe('テスト対策（2学期中間）国語');
  });
});

describe('buildShukaisuLines', () => {
  const sessions = [
    { session_date: '2026-09-02', homework_not_done: false, tardy: false },
    { session_date: '2026-09-04', homework_not_done: true, tardy: false },
    { session_date: '2026-09-09', homework_not_done: false, tardy: true },
    // 変更前の月は数えない
    { session_date: '2026-08-20', homework_not_done: true, tardy: true },
  ];

  it('変更月が来ていれば報告を立て、変更後の月の宿題・遅刻を根拠に出す', () => {
    const r = buildShukaisuLines(
      {
        createdAt: '2026-08-24T10:00:00Z',
        currentWeekly: 2,
        requestedWeekly: 3,
        changeFrom: '2026-09',
        seated: true,
      },
      sessions,
      TODAY
    );
    expect(r.facts).toEqual([
      '週回数変更 週2→週3（9月から）実施中',
      '変更後 2026年9月（授業3日）: 宿題未提出 1回／遅刻 1回',
    ]);
    expect(r.talk).toEqual({ kind: 'say', text: '報告 ―― 週3にしてからの様子を伝える' });
    expect(r.aiLine?.startsWith(SHUKAISU_AI_PREFIX)).toBe(true);
    expect(r.aiLine).toContain('変更後 2026年9月 授業3日・宿題未提出1回');
  });

  it('変更前で席を用意済みなら伝える', () => {
    const r = buildShukaisuLines(
      {
        createdAt: '2026-09-10T00:00:00Z',
        currentWeekly: 2,
        requestedWeekly: 3,
        changeFrom: '2026-10',
        seated: true,
      },
      sessions,
      TODAY
    );
    expect(r.facts).toEqual(['週回数変更 週2→週3（10月から）席確定']);
    expect(r.talk).toEqual({ kind: 'say', text: '10月から週3で席を用意しています' });
  });

  it('変更前で席が未確定なら確定してよいかを聞く', () => {
    const r = buildShukaisuLines(
      {
        createdAt: '2026-09-17T00:00:00Z',
        currentWeekly: 4,
        requestedWeekly: 3,
        changeFrom: '2026-11',
        seated: false,
      },
      [],
      TODAY
    );
    expect(r.facts).toEqual(['週回数変更 週4→週3（11月から）受付済み']);
    expect(r.talk).toEqual({ kind: 'ask', text: '11月から週3で確定してよいか確認する' });
  });

  it('週回数が同じ（曜日・科目だけの変更）なら「週2→週2」と書かない', () => {
    const r = buildShukaisuLines(
      {
        createdAt: '2026-09-10T00:00:00Z',
        currentWeekly: 2,
        requestedWeekly: 2,
        changeFrom: '2026-10',
        seated: false,
      },
      [],
      TODAY
    );
    expect(r.facts[0]).toBe('週回数変更 週2のまま・曜日/科目の変更（10月から）受付済み');
    expect(r.talk?.text).toBe('10月から新しい曜日・科目で確定してよいか確認する');
  });

  it('年をまたぐ変更は年を添える', () => {
    const r = buildShukaisuLines(
      {
        createdAt: '2026-09-10T00:00:00Z',
        currentWeekly: 1,
        requestedWeekly: 2,
        changeFrom: '2027-01',
        seated: false,
      },
      [],
      TODAY
    );
    expect(r.facts[0]).toBe('週回数変更 週1→週2（2027年1月から）受付済み');
  });

  it('半年より前の申込・変更月が読めない申込は出さない', () => {
    const old = buildShukaisuLines(
      {
        createdAt: '2026-02-01T00:00:00Z',
        currentWeekly: 1,
        requestedWeekly: 2,
        changeFrom: '2026-03',
        seated: true,
      },
      [],
      TODAY
    );
    expect(old).toEqual({ facts: [], talk: null, aiLine: null });
    expect(buildShukaisuLines(null, [], TODAY).facts).toEqual([]);
    expect(
      buildShukaisuLines(
        {
          createdAt: '2026-09-10T00:00:00Z',
          currentWeekly: 1,
          requestedWeekly: 2,
          changeFrom: null,
          seated: false,
        },
        [],
        TODAY
      ).facts
    ).toEqual([]);
  });
});

describe('buildMockReturnLines', () => {
  const vmogi = { name: '都立Vもぎ', examDate: '2026-09-13' };

  it('受験から7日たって、その月以降の模試の成績が無ければ聞く', () => {
    const r = buildMockReturnLines([vmogi], [], TODAY);
    expect(r.facts).toEqual(['模試の申込 ―― 都立Vもぎ 9月（9/13受験）の結果が未入力']);
    expect(r.ask).toEqual(['都立Vもぎ 9月の結果がまだ入っていない（返却を確認）']);
  });

  it('その月以降の模試の成績が入っていれば何も出さない', () => {
    const mock = assessment({ category: 'mock', name_code: 'venue', exam_date: '2026-09-01' });
    expect(buildMockReturnLines([vmogi], [mock], TODAY)).toEqual({ facts: [], ask: [] });
  });

  it('前の月の成績しか無ければ聞く', () => {
    const mock = assessment({ category: 'mock', name_code: 'venue', exam_date: '2026-08-01' });
    expect(buildMockReturnLines([vmogi], [mock], TODAY).ask).toHaveLength(1);
  });

  it('受験から7日たっていない・まだ先・90日より前は出さない', () => {
    const r = buildMockReturnLines(
      [
        { name: '9月度オープン模試', examDate: '2026-09-20' },
        { name: '都立Vもぎ', examDate: '2026-11-15' },
        { name: '4月度オープン模試', examDate: '2026-04-18' },
      ],
      [],
      TODAY
    );
    expect(r).toEqual({ facts: [], ask: [] });
  });

  it('名前にもう月が入っていれば足さない・同じ模試は1回だけ', () => {
    const r = buildMockReturnLines(
      [
        { name: '9月度オープン模試', examDate: '2026-09-05' },
        { name: '9月度オープン模試', examDate: '2026-09-07' },
      ],
      [],
      TODAY
    );
    expect(r.ask).toEqual(['9月度オープン模試の結果がまだ入っていない（返却を確認）']);
  });
});

describe('buildMissingRecordAskLines と申込', () => {
  it('テスト対策の結果を聞く・模試を申し込んでいるときは重ねない', () => {
    expect(buildMissingRecordAskLines([], 9)).toEqual([
      '定期テストの結果を聞いて入れる',
      '模試を受けているか聞く',
    ]);
    expect(
      buildMissingRecordAskLines([], 9, { hasTestPrepAsk: true, hasMockApplication: true })
    ).toEqual([]);
  });
});

describe('AIへ渡す行', () => {
  it('テスト対策の行は score に混ぜて送り、表示側では外れる', () => {
    const lines = buildTestPrepLines([proposal()], [], 9, TODAY).aiLines;
    const sections = buildTellSections({
      assessments: [],
      interviews: [],
      textbookData: [],
      disciplineSessions: [],
      koushuEnrollments: [],
      testPrepAiLines: lines,
    });
    const score = sections.find((s) => s.key === 'score');
    expect(score?.current).toEqual(lines);
    expect(stripTargetSchoolFactLines(score?.current ?? [])).toEqual([]);
  });

  it('lessonNotes は「週回数変更:」で始まる行しか通さない', () => {
    expect(
      sanitizeLessonNotes([
        '週回数変更: 週2→週3（9月から・実施中）',
        '2026/09/17 内山: 捏造した引継ぎ',
        42,
        '週回数変更: 週2→週3（9月から・実施中）',
        '週回数変更: 2件目',
        '週回数変更: 3件目',
      ])
    ).toEqual(['週回数変更: 週2→週3（9月から・実施中）', '週回数変更: 2件目']);
    expect(sanitizeLessonNotes('週回数変更: 文字列')).toEqual([]);
    expect(isLessonNoteLine('週回数変更: x')).toBe(true);
    expect(isLessonNoteLine('2026/09/17 内山: x')).toBe(false);
  });
});
