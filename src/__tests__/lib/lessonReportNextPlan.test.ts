import { describe, it, expect } from 'vitest';
import {
  computeAutoNextPlan,
  resolveNextPlan,
  toNextPlanRows,
  toggleNextPlanUnit,
  type NextPlanRow,
} from '@/lib/lesson-reports/nextLessonPlan';

/**
 * 行の作成ヘルパー。filled は「何回目まで指導日が入っているか」（0＝未着手・3＝終了）。
 * 実データの並び（カリキュラム順）を配列の順序で表す。
 */
const row = (curriculumItemId: number, filled: 0 | 1 | 2 | 3): NextPlanRow => ({
  curriculumItemId,
  lessonFilled: [filled >= 1, filled >= 2, filled >= 3] as const,
});

describe('computeAutoNextPlan（進行表通りの次回の予定）', () => {
  it('今日やった単元の次で、まだ終わっていない先頭の1単元を返す', () => {
    const rows = [row(1, 3), row(2, 1), row(3, 0), row(4, 0)];
    expect(computeAutoNextPlan(rows, [2])).toEqual([3]);
  });

  it('今日の選択が空なら、まだ終わっていない先頭の単元を返す', () => {
    const rows = [row(1, 3), row(2, 3), row(3, 1), row(4, 0)];
    expect(computeAutoNextPlan(rows, [])).toEqual([3]);
  });

  it('今日複数の単元をやったときは、カリキュラム順で一番後ろの次から探す', () => {
    const rows = [row(1, 1), row(2, 1), row(3, 1), row(4, 0)];
    // 1と3をやった → 3の次（＝4）から探す。1の直後（2）には戻らない
    expect(computeAutoNextPlan(rows, [3, 1])).toEqual([4]);
  });

  it('後ろに終わっていない単元があっても、直後が空いていればそれを優先する', () => {
    const rows = [row(1, 3), row(2, 2), row(3, 0)];
    expect(computeAutoNextPlan(rows, [1])).toEqual([2]);
  });

  it('3回とも埋まっている単元は飛ばす', () => {
    const rows = [row(1, 1), row(2, 3), row(3, 3), row(4, 0)];
    expect(computeAutoNextPlan(rows, [1])).toEqual([4]);
  });

  it('最終単元をやったときは該当なし（空配列）', () => {
    const rows = [row(1, 3), row(2, 3), row(3, 1)];
    expect(computeAutoNextPlan(rows, [3])).toEqual([]);
  });

  it('全部終わっているときは該当なし（空配列）', () => {
    const rows = [row(1, 3), row(2, 3)];
    expect(computeAutoNextPlan(rows, [])).toEqual([]);
    expect(computeAutoNextPlan(rows, [1])).toEqual([]);
  });

  it('単元が1件も無い教材では該当なし', () => {
    expect(computeAutoNextPlan([], [])).toEqual([]);
    expect(computeAutoNextPlan([], [7])).toEqual([]);
  });

  it('今日の選択がグリッドに無いID（別教材のID等）でも先頭から探して落ちない', () => {
    const rows = [row(1, 3), row(2, 0)];
    expect(computeAutoNextPlan(rows, [999])).toEqual([2]);
  });
});

describe('toNextPlanRows（グリッド行 → 判定用の行）', () => {
  it('lesson_date が入っている回だけ埋まり扱いにする', () => {
    const rows = toNextPlanRows([
      {
        id: 10,
        progress: {
          lessons: [
            { lesson_number: 1, lesson_date: '2026-08-01' },
            { lesson_number: 2, lesson_date: null },
          ],
        },
      },
      { id: 11, progress: null },
    ]);
    expect(rows[0]).toEqual({ curriculumItemId: 10, lessonFilled: [true, false, false] });
    expect(rows[1]).toEqual({ curriculumItemId: 11, lessonFilled: [false, false, false] });
  });

  it('空文字の指導日は未実施として扱う（進行表の表示と同じ判定）', () => {
    const rows = toNextPlanRows([
      { id: 12, progress: { lessons: [{ lesson_number: 1, lesson_date: '' }] } },
    ]);
    expect(rows[0].lessonFilled).toEqual([false, false, false]);
  });

  it('グリッドの並びをそのまま保つ（カリキュラム順が判定の前提）', () => {
    const rows = toNextPlanRows([{ id: 3 }, { id: 1 }, { id: 2 }]);
    expect(rows.map((r) => r.curriculumItemId)).toEqual([3, 1, 2]);
  });
});

describe('resolveNextPlan（自動と手動の解決）', () => {
  it('手動が null なら自動値を使う', () => {
    expect(resolveNextPlan([3], null)).toEqual([3]);
  });

  it('手動で選び直したらその値を使う（複数可）', () => {
    expect(resolveNextPlan([3], [5, 6])).toEqual([5, 6]);
  });

  it('手動で全部外した「空」は尊重する（自動に戻さない）', () => {
    expect(resolveNextPlan([3], [])).toEqual([]);
  });

  it('戻り値を書き換えても入力配列に影響しない（複製して返す）', () => {
    const auto = [3];
    const resolved = resolveNextPlan(auto, null);
    resolved.push(4);
    expect(auto).toEqual([3]);
  });
});

describe('toggleNextPlanUnit（ピッカーのトグル）', () => {
  it('初回は自動値を土台にして足す（自動値が消えない）', () => {
    expect(toggleNextPlanUnit(null, [3], 5)).toEqual([3, 5]);
  });

  it('初回に自動値そのものを押すと、その1件を外した状態になる', () => {
    expect(toggleNextPlanUnit(null, [3], 3)).toEqual([]);
  });

  it('手動値からの追加・削除ができる', () => {
    expect(toggleNextPlanUnit([3, 5], [3], 7)).toEqual([3, 5, 7]);
    expect(toggleNextPlanUnit([3, 5], [3], 5)).toEqual([3]);
  });

  it('手動で空にした状態からでも足せる（空は null に戻らない）', () => {
    expect(toggleNextPlanUnit([], [3], 9)).toEqual([9]);
  });
});
