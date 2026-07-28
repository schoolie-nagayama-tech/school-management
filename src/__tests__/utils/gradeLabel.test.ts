/**
 * 学年ラベルの表記テスト。
 *
 * ★ なぜこのテストが要るか: 以前は `grade <= 6 ? 小N : grade <= 9 ? 中N : 高N-9` という
 *   同じ式が40箇所以上にコピーされており、13（既卒）が全部「高4」と誤表示されていた。
 *   表記の正典は GRADE_LABELS 一箇所だけ、というのをここで固定する。
 */
import { describe, it, expect } from 'vitest';
import { formatGradeLabel, formatGradeLabelOrEmpty } from '@/lib/utils/gradeLabel';
import { gradeLabel as progressGradeLabel } from '@/app/students/[studentId]/progress/newProgress.shared';
import { GRADE_LABELS } from '@/types/database';

describe('formatGradeLabel', () => {
  it('小学生は 小1〜小6', () => {
    expect([1, 2, 3, 4, 5, 6].map(formatGradeLabel)).toEqual([
      '小1',
      '小2',
      '小3',
      '小4',
      '小5',
      '小6',
    ]);
  });

  it('中学生は 中1〜中3', () => {
    expect([7, 8, 9].map(formatGradeLabel)).toEqual(['中1', '中2', '中3']);
  });

  it('高校生は 高1〜高3', () => {
    expect([10, 11, 12].map(formatGradeLabel)).toEqual(['高1', '高2', '高3']);
  });

  it('13 は「既卒」（「高4」ではない）', () => {
    expect(formatGradeLabel(13)).toBe('既卒');
  });

  it('正典 GRADE_LABELS と完全に一致する', () => {
    for (const [num, label] of Object.entries(GRADE_LABELS)) {
      expect(formatGradeLabel(Number(num))).toBe(label);
    }
  });

  it('範囲外は `N年` にフォールバックして画面を壊さない', () => {
    expect(formatGradeLabel(0)).toBe('0年');
    expect(formatGradeLabel(99)).toBe('99年');
  });
});

describe('formatGradeLabelOrEmpty', () => {
  it('未設定は空文字', () => {
    expect(formatGradeLabelOrEmpty(null)).toBe('');
    expect(formatGradeLabelOrEmpty(undefined)).toBe('');
  });

  it('値があれば formatGradeLabel と同じ', () => {
    expect(formatGradeLabelOrEmpty(8)).toBe('中2');
    expect(formatGradeLabelOrEmpty(13)).toBe('既卒');
  });
});

/**
 * 進行表は「小学2年生」という別表記を意図的に持っている（共通ヘルパに寄せない）。
 * 表記は別で良いが、13 が空欄に落ちるのはバグなのでここで固定する。
 */
describe('newProgress.shared の gradeLabel（進行表の長い表記）', () => {
  it('小中高は「小学N年生」形式', () => {
    expect(progressGradeLabel(2)).toBe('小学2年生');
    expect(progressGradeLabel(8)).toBe('中学2年生');
    expect(progressGradeLabel(11)).toBe('高校2年生');
  });

  it('13 は「既卒」（空欄に落とさない）', () => {
    expect(progressGradeLabel(13)).toBe('既卒');
  });

  it('未設定・範囲外は空文字', () => {
    expect(progressGradeLabel(null)).toBe('');
    expect(progressGradeLabel(undefined)).toBe('');
    expect(progressGradeLabel(99)).toBe('');
  });
});
