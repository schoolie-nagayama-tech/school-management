/**
 * 生徒カードD&Dのドロップ判定（evaluateStudentDrop）の純関数テスト。
 *
 * 実機フィードバック④「同じコマ内で別講師へ移動できない」への回帰防止。
 * 当たり判定（dnd-kit collisionDetection）は WeeklyScheduleGridView 側で pointerWithin に
 * 修正済み。over が正しく別講師ブロックに解決された後、この判定が 'drop' を返すことで
 * 同コマ内移動（呼び出し側で moveScheduleEntry）が成立する、という部分を固定する。
 */
import { describe, it, expect } from 'vitest';
import { evaluateStudentDrop } from '@/lib/utils/scheduleDrop';

// 最小のドラッグ元エントリ（tA が担当・数学・生徒 stuA）
const baseEntry = {
  entry_date: '2026-07-20',
  time_slot_id: 'slot1',
  teacher_id: 'tA',
  student_id: 'stuA',
  subject_ids: ['math'] as string[],
  student: null,
};

// 同じ日・同じコマ・別講師 tB への移動先（既定）
const sameSlotDifferentTeacher = { date: '2026-07-20', slotId: 'slot1', teacherId: 'tB' };

describe('evaluateStudentDrop', () => {
  it('同じコマ内の別講師（空き有り・制約なし）は drop を返す（④の中核）', () => {
    const d = evaluateStudentDrop({
      entry: baseEntry,
      target: sameSlotDifferentTeacher,
      targetActiveEntries: [], // 移動先は空き
      targetTeacher: { teachable_subject_ids: null, gender: null },
      maxStudentsPerTeacher: 2,
      isClosed: false,
    });
    expect(d).toEqual({ kind: 'drop' });
  });

  it('別コマへの移動（＝振替）も drop を返す（分岐は呼び出し側の責務）', () => {
    const d = evaluateStudentDrop({
      entry: baseEntry,
      target: { date: '2026-07-21', slotId: 'slot2', teacherId: 'tB' },
      targetActiveEntries: [],
      targetTeacher: { teachable_subject_ids: null, gender: null },
      maxStudentsPerTeacher: 2,
      isClosed: false,
    });
    expect(d).toEqual({ kind: 'drop' });
  });

  it('同一ブロック（同じ日・コマ・講師）への自己ドロップは noop', () => {
    const d = evaluateStudentDrop({
      entry: baseEntry,
      target: { date: '2026-07-20', slotId: 'slot1', teacherId: 'tA' },
      targetActiveEntries: [{ student_id: 'stuA' }],
      targetTeacher: { teachable_subject_ids: null, gender: null },
      maxStudentsPerTeacher: 2,
      isClosed: false,
    });
    expect(d).toEqual({ kind: 'noop' });
  });

  it('移動先に同じ生徒が既にいるなら blocked（理由付き）', () => {
    const d = evaluateStudentDrop({
      entry: baseEntry,
      target: sameSlotDifferentTeacher,
      targetActiveEntries: [{ student_id: 'stuA' }],
      targetTeacher: { teachable_subject_ids: null, gender: null },
      maxStudentsPerTeacher: 2,
      isClosed: false,
    });
    expect(d).toEqual({ kind: 'blocked', reason: '同じ生徒が既にこのコマに入っています' });
  });

  it('移動先が満員（有効エントリ数 >= 上限）なら blocked（理由付き）', () => {
    const d = evaluateStudentDrop({
      entry: baseEntry,
      target: sameSlotDifferentTeacher,
      targetActiveEntries: [{ student_id: 'stuB' }, { student_id: 'stuC' }],
      targetTeacher: { teachable_subject_ids: null, gender: null },
      maxStudentsPerTeacher: 2,
      isClosed: false,
    });
    expect(d).toEqual({ kind: 'blocked', reason: 'この講師のコマは満席です' });
  });

  it('1対1（上限1）で移動先に既に生徒がいれば blocked（理由付き）', () => {
    const d = evaluateStudentDrop({
      entry: baseEntry,
      target: sameSlotDifferentTeacher,
      targetActiveEntries: [{ student_id: 'stuB' }],
      targetTeacher: { teachable_subject_ids: null, gender: null },
      maxStudentsPerTeacher: 1,
      isClosed: false,
    });
    expect(d).toEqual({ kind: 'blocked', reason: 'この講師のコマは満席です' });
  });

  it('休講日への移動は blocked（理由付き）', () => {
    const d = evaluateStudentDrop({
      entry: baseEntry,
      target: sameSlotDifferentTeacher,
      targetActiveEntries: [],
      targetTeacher: { teachable_subject_ids: null, gender: null },
      maxStudentsPerTeacher: 2,
      isClosed: true,
    });
    expect(d).toEqual({ kind: 'blocked', reason: '休講日のため配置できません' });
  });

  it('指導科目外の講師は violation（理由付き）', () => {
    const d = evaluateStudentDrop({
      entry: baseEntry, // math
      target: sameSlotDifferentTeacher,
      targetActiveEntries: [],
      targetTeacher: { teachable_subject_ids: ['eng'], gender: null }, // math を教えられない
      maxStudentsPerTeacher: 2,
      isClosed: false,
    });
    expect(d).toEqual({ kind: 'violation', reason: '指導科目外の講師です' });
  });

  it('teachable が空/未設定なら全科目可（drop）', () => {
    const d = evaluateStudentDrop({
      entry: baseEntry,
      target: sameSlotDifferentTeacher,
      targetActiveEntries: [],
      targetTeacher: { teachable_subject_ids: [], gender: null },
      maxStudentsPerTeacher: 2,
      isClosed: false,
    });
    expect(d).toEqual({ kind: 'drop' });
  });

  it('担当除外指定の講師は violation', () => {
    const d = evaluateStudentDrop({
      entry: { ...baseEntry, student: { excluded_teacher_ids: ['tB'] } as never },
      target: sameSlotDifferentTeacher,
      targetActiveEntries: [],
      targetTeacher: { teachable_subject_ids: null, gender: null },
      maxStudentsPerTeacher: 2,
      isClosed: false,
    });
    expect(d).toEqual({ kind: 'violation', reason: '担当除外指定の講師です' });
  });

  // 希望性別は「守りたい希望」であって禁止ではない。止めると当日の調整が回らないので、
  // 警告（warn）にして配置は通す。ブロックに戻すと運用が詰まる。
  it('希望性別と講師の性別が違えば warn（配置は通す）', () => {
    const d = evaluateStudentDrop({
      entry: { ...baseEntry, student: { preferred_teacher_gender: 'female' } as never },
      target: sameSlotDifferentTeacher,
      targetActiveEntries: [],
      targetTeacher: { teachable_subject_ids: null, gender: 'male' },
      maxStudentsPerTeacher: 2,
      isClosed: false,
    });
    expect(d).toEqual({
      kind: 'warn',
      reason: '女性講師希望の生徒です（希望と違う講師に割り当てました）',
    });
  });

  it('希望性別どおりの講師なら警告を出さない（drop）', () => {
    const d = evaluateStudentDrop({
      entry: { ...baseEntry, student: { preferred_teacher_gender: 'female' } as never },
      target: sameSlotDifferentTeacher,
      targetActiveEntries: [],
      targetTeacher: { teachable_subject_ids: null, gender: 'female' },
      maxStudentsPerTeacher: 2,
      isClosed: false,
    });
    expect(d).toEqual({ kind: 'drop' });
  });
});
