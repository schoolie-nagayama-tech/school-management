/**
 * 模試の志望校を生徒の志望校に反映する計画（mockTargetPlan.ts）と、枠ごとのマスタの絞り込み。
 */
import { describe, expect, it } from 'vitest';
import {
  planTargetSchoolsFromMock,
  type CurrentTargetRow,
  type MockTargetPick,
} from '@/lib/scores/mockTargetPlan';
import {
  mastersForSlot,
  matchMockSchoolName,
  schoolNameKey,
  type HighSchoolKeyRow,
} from '@/lib/scores/mockSchools';

const cur = (
  rank: number,
  schoolName: string,
  over: Partial<CurrentTargetRow> = {}
): CurrentTargetRow => ({
  rank,
  schoolName,
  highSchoolId: null,
  reason: null,
  isHeigan: false,
  sourceAssessmentId: 'old-mock',
  updatedAt: '2026-09-01T00:00:00Z',
  ...over,
});
const pick = (
  slot: number,
  schoolName: string,
  highSchoolId: string | null = null
): MockTargetPick => ({
  slot,
  schoolName,
  highSchoolId,
});

describe('planTargetSchoolsFromMock', () => {
  it('志望校が空なら新規。公立も私立も枠の順に詰めて第1〜第5志望にする', () => {
    const plan = planTargetSchoolsFromMock(
      [],
      [pick(5, '明星'), pick(1, '狛江'), pick(4, '桜美林'), pick(2, '神代')],
      '2026-10'
    );
    expect(plan.kind).toBe('new');
    expect(plan.defaultApply).toBe(true);
    expect(plan.rows.map((r) => [r.rank, r.schoolName, r.isHeigan])).toEqual([
      [1, '狛江', false],
      [2, '神代', false],
      [3, '桜美林', false],
      [4, '明星', false],
    ]);
  });

  it('違えば差し替え。残る学校の併願の印と理由は引き継ぎ、行ごとの前後を出す', () => {
    const plan = planTargetSchoolsFromMock(
      [
        cur(1, '狛江', { highSchoolId: 'h-komae' }),
        cur(2, '桜美林', { isHeigan: true, reason: '部活' }),
        cur(3, '国立'),
      ],
      [pick(1, '神代'), pick(2, '狛江', 'h-komae'), pick(4, '桜美林')],
      '2026-10'
    );
    expect(plan.kind).toBe('change');
    expect(plan.defaultApply).toBe(true);
    expect(plan.rows[2]).toMatchObject({ schoolName: '桜美林', isHeigan: true, reason: '部活' });
    expect(plan.lines).toEqual([
      { rank: 1, before: '狛江', after: '神代', changed: true },
      { rank: 2, before: '桜美林', after: '狛江', changed: true },
      { rank: 3, before: '国立', after: '桜美林', changed: true },
    ]);
  });

  it('模試より少なければ、はみ出した行は空欄にする', () => {
    const plan = planTargetSchoolsFromMock(
      [cur(1, '狛江'), cur(2, '神代')],
      [pick(1, '狛江')],
      '2026-10'
    );
    expect(plan.kind).toBe('change');
    expect(plan.lines[1]).toEqual({ rank: 2, before: '神代', after: null, changed: true });
  });

  it('同じなら「同じ」で反映しない', () => {
    const plan = planTargetSchoolsFromMock(
      [cur(1, '狛江', { highSchoolId: 'h1' })],
      [pick(1, '狛江', 'h1')],
      '2026-10'
    );
    expect(plan.kind).toBe('same');
    expect(plan.defaultApply).toBe(false);
  });

  it('模試の月より後に手で入れた行があれば、差し替えの既定を外す', () => {
    const manual = cur(1, '調布北', {
      sourceAssessmentId: null,
      updatedAt: '2026-10-20T03:00:00Z',
    });
    const plan = planTargetSchoolsFromMock([manual], [pick(1, '国立')], '2026-10');
    expect(plan.manualAfterMock).toBe(true);
    expect(plan.defaultApply).toBe(false);

    // 模試から入った行は、後で併願や理由を直して更新日時が新しくても手入力に数えない
    const fromMock = cur(1, '調布北', { updatedAt: '2026-10-20T03:00:00Z' });
    expect(planTargetSchoolsFromMock([fromMock], [pick(1, '国立')], '2026-10').defaultApply).toBe(
      true
    );
    // 模試の月より前に手で入れた行も、差し替えてよい
    const before = cur(1, '調布北', {
      sourceAssessmentId: null,
      updatedAt: '2026-09-10T00:00:00Z',
    });
    expect(planTargetSchoolsFromMock([before], [pick(1, '国立')], '2026-10').defaultApply).toBe(
      true
    );
  });

  it('模試に志望校が無ければ触らない', () => {
    const plan = planTargetSchoolsFromMock([cur(1, '狛江')], [], '2026-10');
    expect(plan.kind).toBe('none');
    expect(plan.defaultApply).toBe(false);
  });
});

describe('mastersForSlot', () => {
  const master: HighSchoolKeyRow[] = [
    { id: 'pub', prefecture: '東京都', school_name: '八王子', course: '', establishment: '公立' },
    { id: 'pri', prefecture: '東京都', school_name: '八王子', course: '', establishment: '私立' },
    { id: 'old', prefecture: '東京都', school_name: '狛江', course: '' },
  ];

  it('1〜3枠は公立だけ、4〜5枠は私立・国立だけに当てる', () => {
    expect(matchMockSchoolName('八王子', mastersForSlot(master, true)).highSchoolId).toBe('pub');
    expect(matchMockSchoolName('八王子', mastersForSlot(master, false)).highSchoolId).toBe('pri');
    // 設置区分の無い行は公立扱い
    expect(mastersForSlot(master, true).map((r) => r.id)).toEqual(['pub', 'old']);
  });
});

describe('学校名の表記ゆれ（schoolNameKey）', () => {
  // ★本番のマスタに実際にある書き方の組
  it.each([
    ['専修大付属', '専修大附属'],
    ['専修大学附属', '専修大附属'],
    ['慶應義塾女子', '慶応義塾女子'],
    ['國學院大久我山', '国学院大久我山'],
    ['日本体育大荏原', '日体大荏原'],
    ['日本大学第三', '日大第三'],
    ['日大第3', '日大第三'],
    ['明治大学付属中野', '明大付属中野'],
    ['明大付属世田谷', '明大付属世田谷（日本学園）'],
  ])('%s と %s を同じ学校にする', (a, b) => {
    expect(schoolNameKey(a)).toBe(schoolNameKey(b));
  });

  it('学園・女子など、外すと別の学校になる語は触らない', () => {
    expect(schoolNameKey('昭和第一')).not.toBe(schoolNameKey('昭和第一学園'));
    expect(schoolNameKey('日大豊山')).not.toBe(schoolNameKey('日大豊山女子'));
  });

  it('完全一致で当たらなければ、ならした名前とコースで当てる', () => {
    const master: HighSchoolKeyRow[] = [
      {
        id: 'a',
        prefecture: '東京都',
        school_name: '専修大附属',
        course: '',
        establishment: '私立',
      },
      {
        id: 'b',
        prefecture: '東京都',
        school_name: '駒沢学園女子',
        course: '特進',
        establishment: '私立',
      },
      {
        id: 'c',
        prefecture: '東京都',
        school_name: '駒沢学園女子',
        course: '進学',
        establishment: '私立',
      },
    ];
    expect(matchMockSchoolName('専修大学付属', master)).toMatchObject({
      highSchoolId: 'a',
      schoolName: '専修大附属',
    });
    expect(matchMockSchoolName('駒沢学園女子－特進コース', master).highSchoolId).toBe('b');
    // コースを書いていない・複数コースがある学校は当てない（どのコースのめやすか分からない）
    expect(matchMockSchoolName('駒沢学園女子', master).highSchoolId).toBeNull();
  });
});
