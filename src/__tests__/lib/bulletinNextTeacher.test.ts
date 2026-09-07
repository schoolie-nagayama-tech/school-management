/**
 * 「次にその生徒の授業をする講師」の選び方のテスト。
 *
 * ★ここで守りたいのは3点:
 *  - いちばん近いコマではなく、いちばん近い「講師が決まっている」コマを採ること
 *    （本番では直近のコマほど teacher_id が未定で、先のコマには入っている）
 *  - 同じ日に複数コマあるとき、早い時限を採ること
 *    （日付だけで比べると、その日の最後のコマの講師を「次に会う人」と誤って出す）
 *  - 決まらない生徒を勝手に埋めないこと（コマが無ければ誰にも頼めない）
 */
import { describe, expect, it } from 'vitest';
import { pickNextTeacherByStudent, type LessonSlot } from '@/lib/bulletin/nextTeacher';

const slot = (p: Partial<LessonSlot> & { entryDate: string }): LessonSlot => ({
  studentId: 's1',
  teacherId: 't1',
  slotNumber: 1,
  ...p,
});

describe('pickNextTeacherByStudent', () => {
  it('いちばん早いコマの講師を採る', () => {
    const got = pickNextTeacherByStudent([
      slot({ entryDate: '2026-09-20', teacherId: 'late' }),
      slot({ entryDate: '2026-09-07', teacherId: 'early' }),
    ]);
    expect(got.get('s1')).toBe('early');
  });

  it('講師が未定のコマは飛ばして、決まっている最初のコマを採る', () => {
    const got = pickNextTeacherByStudent([
      slot({ entryDate: '2026-09-07', teacherId: null }),
      slot({ entryDate: '2026-09-14', teacherId: 'decided' }),
    ]);
    expect(got.get('s1')).toBe('decided');
  });

  it('同じ日は早い時限を採る（入力の順番に左右されない）', () => {
    const got = pickNextTeacherByStudent([
      slot({ entryDate: '2026-09-07', slotNumber: 5, teacherId: 'fifth' }),
      slot({ entryDate: '2026-09-07', slotNumber: 2, teacherId: 'second' }),
    ]);
    expect(got.get('s1')).toBe('second');
  });

  it('時限が取れないコマは同じ日の最後に置く', () => {
    const got = pickNextTeacherByStudent([
      slot({ entryDate: '2026-09-07', slotNumber: null, teacherId: 'unknown' }),
      slot({ entryDate: '2026-09-07', slotNumber: 7, teacherId: 'seventh' }),
    ]);
    expect(got.get('s1')).toBe('seventh');
  });

  it('コマが無い生徒は埋めない（推測で担当を作らない）', () => {
    const got = pickNextTeacherByStudent([slot({ studentId: 'other', entryDate: '2026-09-07' })]);
    expect(got.has('s1')).toBe(false);
  });

  it('講師が1人も決まっていなければ何も返さない', () => {
    const got = pickNextTeacherByStudent([
      slot({ entryDate: '2026-09-07', teacherId: null }),
      slot({ entryDate: '2026-09-14', teacherId: null }),
    ]);
    expect(got.size).toBe(0);
  });

  it('生徒ごとに別々に決まる', () => {
    const got = pickNextTeacherByStudent([
      slot({ studentId: 'a', entryDate: '2026-09-07', teacherId: 'ta' }),
      slot({ studentId: 'b', entryDate: '2026-09-08', teacherId: 'tb' }),
    ]);
    expect(got.get('a')).toBe('ta');
    expect(got.get('b')).toBe('tb');
  });
});
