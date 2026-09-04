import { describe, it, expect } from 'vitest';
import {
  applyHomeworkCompletionPct,
  applyHomeworkMark,
  type HomeworkMarkState,
} from '@/lib/lesson-reports/homeworkMark';

const state = (homeworkNotDone: boolean, completionPct: number | null): HomeworkMarkState => ({
  homeworkNotDone,
  completionPct,
});

describe('applyHomeworkMark（マークを押したとき）', () => {
  it('マークONで実施率は0%になる', () => {
    expect(applyHomeworkMark(state(false, 80), true)).toEqual({
      homeworkNotDone: true,
      completionPct: 0,
    });
  });

  it('実施率が未入力でもマークONなら0%を入れる', () => {
    expect(applyHomeworkMark(state(false, null), true)).toEqual({
      homeworkNotDone: true,
      completionPct: 0,
    });
  });

  it('マークOFFに戻すと、マークが書いた0%は未入力に戻る', () => {
    expect(applyHomeworkMark(state(true, 0), false)).toEqual({
      homeworkNotDone: false,
      completionPct: null,
    });
  });

  it('マークOFFでも、講師が自分で入れた0%以外の値は触らない', () => {
    expect(applyHomeworkMark(state(true, 40), false)).toEqual({
      homeworkNotDone: false,
      completionPct: 40,
    });
    expect(applyHomeworkMark(state(true, null), false)).toEqual({
      homeworkNotDone: false,
      completionPct: null,
    });
  });
});

describe('applyHomeworkCompletionPct（スライダーを動かしたとき）', () => {
  it('0%にするとマークONになる', () => {
    expect(applyHomeworkCompletionPct(state(false, 60), 0)).toEqual({
      homeworkNotDone: true,
      completionPct: 0,
    });
  });

  it('0%より大きくするとマークOFFになる', () => {
    expect(applyHomeworkCompletionPct(state(true, 0), 5)).toEqual({
      homeworkNotDone: false,
      completionPct: 5,
    });
    expect(applyHomeworkCompletionPct(state(true, 0), 100)).toEqual({
      homeworkNotDone: false,
      completionPct: 100,
    });
  });

  it('未入力（null）にしたときはマークを触らない', () => {
    expect(applyHomeworkCompletionPct(state(true, 0), null)).toEqual({
      homeworkNotDone: true,
      completionPct: null,
    });
    expect(applyHomeworkCompletionPct(state(false, 70), null)).toEqual({
      homeworkNotDone: false,
      completionPct: null,
    });
  });

  it('同じ値を入れ直しても状態が振動しない（冪等）', () => {
    const once = applyHomeworkCompletionPct(state(false, null), 0);
    expect(applyHomeworkCompletionPct(once, 0)).toEqual(once);
  });
});
