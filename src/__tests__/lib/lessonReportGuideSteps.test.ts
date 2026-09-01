import { describe, it, expect } from 'vitest';
import {
  computeGuideSteps,
  nextPendingStep,
  type GuideStepInput,
} from '@/lib/lesson-reports/guideSteps';
import { validateForSubmit } from '@/lib/lesson-reports/submitValidation';

/** 何も書いていない状態（開いた直後）。ここから1つずつ埋めて挙動を確かめる。 */
const empty = (patch: Partial<GuideStepInput> = {}): GuideStepInput => ({
  tardy: false,
  homeworkNotDone: false,
  hasTextbooks: true,
  selectedUnitCount: 0,
  extraMaterials: '',
  homeworkAchievementAvailable: true,
  homeworkAchievementFilled: false,
  checkTestScoreFilled: false,
  schoolProgressFilled: false,
  goal: '',
  nextPlanFilled: false,
  homeworkRowsAvailable: true,
  homeworkRowsFilled: false,
  handover: '',
  review: '',
  ...patch,
});

/** 全問が自動で done になる状態。 */
const filled = (patch: Partial<GuideStepInput> = {}): GuideStepInput =>
  empty({
    tardy: true,
    selectedUnitCount: 1,
    homeworkAchievementFilled: true,
    checkTestScoreFilled: true,
    schoolProgressFilled: true,
    goal: '不定詞の名詞用法を5問訳せる',
    nextPlanFilled: true,
    homeworkRowsFilled: true,
    handover: '次回は分数係数から',
    review: '一次関数の変化の割合を確認しました。',
    ...patch,
  });

const none = new Set<string>();
const statusOf = (input: GuideStepInput, id: string, manualDone: ReadonlySet<string> = none) =>
  computeGuideSteps(input, manualDone).find((s) => s.id === id)?.status;

describe('computeGuideSteps（ガイドの質問一覧）', () => {
  it('設計書§4の10問を時系列の順に返す', () => {
    expect(computeGuideSteps(empty(), none).map((s) => s.id)).toEqual([
      'mood',
      'taught',
      'homework-check',
      'check-test',
      'school-progress',
      'goal',
      'next-plan',
      'homework-assign',
      'handover',
      'review',
    ]);
  });

  it('全部空なら最初の未完了は mood', () => {
    const next = nextPendingStep(computeGuideSteps(empty(), none));
    expect(next?.id).toBe('mood');
    expect(next?.question).toBe('今日の様子で当てはまるものは？');
  });

  it('全問埋まれば nextPendingStep は null（＝あとは提出だけ）', () => {
    expect(nextPendingStep(computeGuideSteps(filled(), none))).toBeNull();
  });
});

describe('今日の様子（mood）', () => {
  it('遅刻を押せば自動で done', () => {
    expect(statusOf(empty({ tardy: true }), 'mood')).toBe('done');
  });

  it('宿題未実施を押しても自動で done', () => {
    expect(statusOf(empty({ homeworkNotDone: true }), 'mood')).toBe('done');
  });

  it('どちらも押されていなければ pending（「該当なし」で進める）', () => {
    const step = computeGuideSteps(empty(), none)[0];
    expect(step.status).toBe('pending');
    expect(step.manualDoneLabel).toBe('該当なし');
  });
});

describe('手動の「済」（manualDone）', () => {
  it('自動判定より優先して done にする', () => {
    expect(statusOf(empty(), 'check-test')).toBe('pending');
    expect(statusOf(empty(), 'check-test', new Set(['check-test']))).toBe('done');
  });

  it('済にした質問は次の案内から外れる', () => {
    const steps = computeGuideSteps(empty(), new Set(['mood']));
    expect(nextPendingStep(steps)?.id).toBe('taught');
  });
});

describe('スキップ（答える対象が無い質問）', () => {
  it('達成度スライダーが無ければ homework-check は skipped で、案内も飛ばす', () => {
    const input = empty({ homeworkAchievementAvailable: false, tardy: true, selectedUnitCount: 1 });
    const steps = computeGuideSteps(input, none);
    expect(statusOf(input, 'homework-check')).toBe('skipped');
    // skipped は分母から除外＝未完了として案内しない
    expect(steps.filter((s) => s.status === 'skipped')).toHaveLength(1);
    expect(nextPendingStep(steps)?.id).toBe('check-test');
  });

  it('宿題の日割り行が無ければ homework-assign は skipped', () => {
    expect(statusOf(empty({ homeworkRowsAvailable: false }), 'homework-assign')).toBe('skipped');
  });

  it('行があって中身が入っていれば done', () => {
    expect(statusOf(empty({ homeworkRowsFilled: true }), 'homework-assign')).toBe('done');
  });
});

describe('提出前チェックとの一致（意味をズラさない）', () => {
  const isTaughtDone = (input: GuideStepInput) => statusOf(input, 'taught') === 'done';
  const hasNoTaughtIssue = (input: GuideStepInput) =>
    validateForSubmit({
      hasTextbooks: input.hasTextbooks,
      selectedUnitCount: input.selectedUnitCount,
      extraMaterials: input.extraMaterials,
      handover: input.handover,
      reviewComment: input.review,
    }).every((issue) => issue.field !== 'taught-range');

  it('教材がある生徒は単元の選択が要る（自由記述では代替できない）', () => {
    const input = empty({ hasTextbooks: true, extraMaterials: 'プリント10問' });
    expect(isTaughtDone(input)).toBe(false);
    expect(hasNoTaughtIssue(input)).toBe(false);

    const selected = empty({ hasTextbooks: true, selectedUnitCount: 1 });
    expect(isTaughtDone(selected)).toBe(true);
    expect(hasNoTaughtIssue(selected)).toBe(true);
  });

  it('教材が無い生徒は自由記述だけで done になる', () => {
    const input = empty({ hasTextbooks: false, extraMaterials: 'プリント10問' });
    expect(isTaughtDone(input)).toBe(true);
    expect(hasNoTaughtIssue(input)).toBe(true);

    const blank = empty({ hasTextbooks: false, extraMaterials: '   ' });
    expect(isTaughtDone(blank)).toBe(false);
    expect(hasNoTaughtIssue(blank)).toBe(false);
  });

  it('引継ぎ・講評は空白だけなら未完了（trim 込みで提出前チェックと同義）', () => {
    expect(statusOf(empty({ handover: '   ' }), 'handover')).toBe('pending');
    expect(statusOf(empty({ review: '\n ' }), 'review')).toBe('pending');
    expect(statusOf(empty({ handover: '引継ぎ' }), 'handover')).toBe('done');
    expect(statusOf(empty({ review: '講評' }), 'review')).toBe('done');
  });
});
