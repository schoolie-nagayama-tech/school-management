/**
 * 未割当のまとめ方（実行パネルに出る集計）のテスト。
 *
 * ここが崩れると室長が「何が足りていないのか」を読み違える（例: 講師不足なのに
 * 可能表未提出だと思って保護者に連絡してしまう）ため、集計規約を固定する。
 */
import { describe, it, expect } from 'vitest';
import { groupUnassignedByReason } from '@/lib/api/koushu-match';
import type { UnassignedReason } from '@/lib/koushu-allocator/types';

const names = new Map([
  ['s1', '山田 太郎'],
  ['s2', '佐藤 花子'],
]);

const task = (studentId: string, subjectId: string, koma: number, reason: UnassignedReason) => ({
  studentId,
  subjectId,
  koma,
  reason,
});

describe('groupUnassignedByReason', () => {
  it('理由ごとにコマ数を合算し、多い理由を先に出す', () => {
    const groups = groupUnassignedByReason(
      [
        task('s1', 'x', 2, 'no_teacher'),
        task('s2', 'y', 5, 'no_availability_submission'),
        task('s1', 'z', 1, 'no_teacher'),
      ],
      names
    );
    expect(groups.map((g) => g.reason)).toEqual(['no_availability_submission', 'no_teacher']);
    expect(groups[0].koma).toBe(5);
    expect(groups[1].koma).toBe(3);
  });

  it('理由の日本語ラベルが付く', () => {
    const groups = groupUnassignedByReason([task('s1', 'x', 1, 'no_seat')], names);
    expect(groups[0].label).toBe('席不足');
  });

  it('同じ生徒の複数科目は1行に合算する', () => {
    const groups = groupUnassignedByReason(
      [task('s1', 'english', 3, 'no_seat'), task('s1', 'math', 2, 'no_seat')],
      names
    );
    expect(groups[0].students).toHaveLength(1);
    expect(groups[0].students[0]).toMatchObject({ studentId: 's1', koma: 5 });
  });

  it('生徒はコマ数の多い順に並ぶ', () => {
    const groups = groupUnassignedByReason(
      [task('s1', 'x', 1, 'daily_limit'), task('s2', 'y', 4, 'daily_limit')],
      names
    );
    expect(groups[0].students.map((s) => s.studentName)).toEqual(['佐藤 花子', '山田 太郎']);
  });

  it('名前が引けない生徒はIDの先頭8文字で代替する（空欄にしない）', () => {
    const groups = groupUnassignedByReason(
      [task('abcdefghijklmnop', 'x', 1, 'not_enough_available_cells')],
      names
    );
    expect(groups[0].students[0].studentName).toBe('abcdefgh');
  });

  it('0コマの行は集計に含めない', () => {
    expect(groupUnassignedByReason([task('s1', 'x', 0, 'no_teacher')], names)).toEqual([]);
  });

  it('空入力なら空配列', () => {
    expect(groupUnassignedByReason([], names)).toEqual([]);
  });

  it('コマ数が同じ理由どうしは順序が安定する（表示がちらつかない）', () => {
    const a = groupUnassignedByReason(
      [task('s1', 'x', 2, 'no_seat'), task('s2', 'y', 2, 'no_teacher')],
      names
    );
    const b = groupUnassignedByReason(
      [task('s2', 'y', 2, 'no_teacher'), task('s1', 'x', 2, 'no_seat')],
      names
    );
    expect(a.map((g) => g.reason)).toEqual(b.map((g) => g.reason));
  });
});
