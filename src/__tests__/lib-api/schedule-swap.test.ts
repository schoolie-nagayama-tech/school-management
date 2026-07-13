/**
 * §2.12 生徒の入れ替え（同コマ内・別講師）検証ロジックのテスト。
 *
 * DBアクセスを伴う swapScheduleEntries 本体ではなく、切り出した純関数
 * validateSwapEntries を対象にする（検証順序と teachable 双方向判定を固定）。
 * ここが緩むと、別コマ・別講師でない相手や指導科目外の講師に入れ替わってしまう。
 */
import { describe, it, expect } from 'vitest';
import { validateSwapEntries, type SwapEntryData, type SwapTeacherData } from '@/lib/api/schedule';

const entry = (over: Partial<SwapEntryData> = {}): SwapEntryData => ({
  id: 'a',
  school_id: 'sch1',
  entry_date: '2026-07-20',
  time_slot_id: 'slot1',
  teacher_id: 'tA',
  student_id: 'stuA',
  subject_ids: ['math'],
  status: 'scheduled',
  ...over,
});

const teacher = (over: Partial<SwapTeacherData> = {}): SwapTeacherData => ({
  id: 'tA',
  name: '田中',
  teachable_subject_ids: null, // 既定=全科目可
  ...over,
});

// 科目名解決（メッセージ用）
const subjectNames = new Map<string, string>([
  ['math', '数学'],
  ['eng', '英語'],
]);

describe('validateSwapEntries', () => {
  it('同じ日・同じコマ・別講師で teachable が空なら許可（throw しない）', () => {
    const a = entry({ id: 'a', teacher_id: 'tA', student_id: 'stuA', subject_ids: ['math'] });
    const b = entry({ id: 'b', teacher_id: 'tB', student_id: 'stuB', subject_ids: ['eng'] });
    expect(() =>
      validateSwapEntries(
        a,
        b,
        teacher({ id: 'tA', teachable_subject_ids: [] }),
        teacher({ id: 'tB', name: '鈴木', teachable_subject_ids: [] }),
        subjectNames
      )
    ).not.toThrow();
  });

  it('teachable が双方向で満たされていれば許可', () => {
    const a = entry({ id: 'a', teacher_id: 'tA', student_id: 'stuA', subject_ids: ['math'] });
    const b = entry({ id: 'b', teacher_id: 'tB', student_id: 'stuB', subject_ids: ['eng'] });
    expect(() =>
      validateSwapEntries(
        a,
        b,
        // T_A は入れ替え後 B の科目(英語)を持つので英語が指導可能である必要
        teacher({ id: 'tA', teachable_subject_ids: ['math', 'eng'] }),
        // T_B は入れ替え後 A の科目(数学)を持つので数学が指導可能である必要
        teacher({ id: 'tB', name: '鈴木', teachable_subject_ids: ['math', 'eng'] }),
        subjectNames
      )
    ).not.toThrow();
  });

  it('別コマ（time_slot_id 違い）は拒否', () => {
    const a = entry({ id: 'a', teacher_id: 'tA', time_slot_id: 'slot1' });
    const b = entry({ id: 'b', teacher_id: 'tB', time_slot_id: 'slot2', student_id: 'stuB' });
    expect(() =>
      validateSwapEntries(a, b, teacher({ id: 'tA' }), teacher({ id: 'tB' }), subjectNames)
    ).toThrow(/同じ日・同じコマ/);
  });

  it('別の日は拒否', () => {
    const a = entry({ id: 'a', teacher_id: 'tA', entry_date: '2026-07-20' });
    const b = entry({ id: 'b', teacher_id: 'tB', entry_date: '2026-07-21', student_id: 'stuB' });
    expect(() =>
      validateSwapEntries(a, b, teacher({ id: 'tA' }), teacher({ id: 'tB' }), subjectNames)
    ).toThrow(/同じ日・同じコマ/);
  });

  it('同じ講師同士は拒否', () => {
    const a = entry({ id: 'a', teacher_id: 'tA', student_id: 'stuA' });
    const b = entry({ id: 'b', teacher_id: 'tA', student_id: 'stuB' });
    expect(() =>
      validateSwapEntries(a, b, teacher({ id: 'tA' }), teacher({ id: 'tA' }), subjectNames)
    ).toThrow(/同じ講師/);
  });

  it('担当講師が未決定（teacher_id が NULL）なら拒否', () => {
    const a = entry({ id: 'a', teacher_id: null, student_id: 'stuA' });
    const b = entry({ id: 'b', teacher_id: 'tB', student_id: 'stuB' });
    expect(() =>
      validateSwapEntries(a, b, teacher({ id: 'tA' }), teacher({ id: 'tB' }), subjectNames)
    ).toThrow(/担当講師が未決定/);
  });

  it('振替元（transferred_out）や取消（cancelled）は拒否', () => {
    const a = entry({ id: 'a', teacher_id: 'tA', student_id: 'stuA', status: 'transferred_out' });
    const b = entry({ id: 'b', teacher_id: 'tB', student_id: 'stuB' });
    expect(() =>
      validateSwapEntries(a, b, teacher({ id: 'tA' }), teacher({ id: 'tB' }), subjectNames)
    ).toThrow(/取消・振替元/);

    const a2 = entry({ id: 'a', teacher_id: 'tA', student_id: 'stuA' });
    const b2 = entry({ id: 'b', teacher_id: 'tB', student_id: 'stuB', status: 'cancelled' });
    expect(() =>
      validateSwapEntries(a2, b2, teacher({ id: 'tA' }), teacher({ id: 'tB' }), subjectNames)
    ).toThrow(/取消・振替元/);
  });

  it('受け入れ側 T_B が A の科目を指導できない場合は拒否（科目名入りメッセージ）', () => {
    const a = entry({ id: 'a', teacher_id: 'tA', student_id: 'stuA', subject_ids: ['math'] });
    const b = entry({ id: 'b', teacher_id: 'tB', student_id: 'stuB', subject_ids: ['eng'] });
    expect(() =>
      validateSwapEntries(
        a,
        b,
        teacher({ id: 'tA', teachable_subject_ids: ['math', 'eng'] }),
        // T_B は英語のみ → 入れ替えで数学(A)を受け持てない
        teacher({ id: 'tB', name: '鈴木', teachable_subject_ids: ['eng'] }),
        subjectNames
      )
    ).toThrow(/鈴木は数学を指導できないため/);
  });

  it('逆方向 T_A が B の科目を指導できない場合も拒否', () => {
    const a = entry({ id: 'a', teacher_id: 'tA', student_id: 'stuA', subject_ids: ['math'] });
    const b = entry({ id: 'b', teacher_id: 'tB', student_id: 'stuB', subject_ids: ['eng'] });
    expect(() =>
      validateSwapEntries(
        a,
        b,
        // T_A は数学のみ → 入れ替えで英語(B)を受け持てない
        teacher({ id: 'tA', name: '田中', teachable_subject_ids: ['math'] }),
        teacher({ id: 'tB', name: '鈴木', teachable_subject_ids: ['math', 'eng'] }),
        subjectNames
      )
    ).toThrow(/田中は英語を指導できないため/);
  });
});
