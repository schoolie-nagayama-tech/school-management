/**
 * computeDecidedKomaByStudent のテスト。
 *
 * これは講習の「取得（決定）増コマ数」の定義そのもので、講習進捗ダッシュボードと
 * 請求同期（syncCourseExtraToBilling の total）が共有する。金額の元になるため、
 * 2つの算出経路（applied_extra 自動列 / 手入力の number 列）と列特定ロジックを固定する。
 */
import { describe, it, expect } from 'vitest';
import { computeDecidedKomaByStudent } from '@/lib/coursePrepKpis';
import type { CourseProgressItem, StudentCourseProgress } from '@/types/database';
import type { AutoValues } from '@/lib/api/courseProgress';

// 関数が読むフィールドだけを持つ最小オブジェクトを作る（型はキャストで満たす）
const item = (partial: Partial<CourseProgressItem>): CourseProgressItem =>
  partial as unknown as CourseProgressItem;
const progress = (partial: Partial<StudentCourseProgress>): StudentCourseProgress =>
  partial as unknown as StudentCourseProgress;
const auto = (
  v: Record<string, { applied_total?: number; course_sessions?: number }>
): AutoValues => v as unknown as AutoValues;

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
