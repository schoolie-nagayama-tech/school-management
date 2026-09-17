import { describe, it, expect } from 'vitest';
import {
  courseDetail,
  courseFullLabel,
  courseLabel,
  courseOptionsForGrade,
  isCourseSelectionMissing,
  isHalfLesson,
  resolveDuration,
  type StudentCourse,
} from '@/lib/utils/studentCourse';

const course = (ratio: 1 | 2, durationMinutes: 45 | 90 | null): StudentCourse => ({
  subjectId: 's1',
  ratio,
  durationMinutes,
});

describe('resolveDuration', () => {
  it('コースの時間があればコースが勝つ（科目マスタは既定にすぎない）', () => {
    expect(resolveDuration(45, 90)).toBe(45);
    expect(resolveDuration(90, 45)).toBe(90);
  });

  it('コースに時間が無ければ科目マスタの既定に落ちる', () => {
    expect(resolveDuration(null, 45)).toBe(45);
    expect(resolveDuration(undefined, 90)).toBe(90);
  });

  it('どちらも無ければ null（＝全コマ扱い。既存の挙動と同じ）', () => {
    expect(resolveDuration(null, null)).toBeNull();
    expect(resolveDuration(undefined, undefined)).toBeNull();
  });

  it('45/90 以外の値は既定として採らない', () => {
    expect(resolveDuration(null, 60)).toBeNull();
  });
});

describe('isHalfLesson', () => {
  it('45分だけが半コマ', () => {
    expect(isHalfLesson(45)).toBe(true);
    expect(isHalfLesson(90)).toBe(false);
    expect(isHalfLesson(null)).toBe(false);
  });
});

describe('courseLabel / courseDetail', () => {
  it('名前のある3コース', () => {
    expect(courseLabel(1, 90)).toBe('PS1');
    expect(courseLabel(2, 90)).toBe('PS2');
    expect(courseLabel(2, 45)).toBe('キッズ');
  });

  it('時間が未指定（科目マスタ既定＝90分扱い）でも90分コースとして名乗る', () => {
    expect(courseLabel(1, null)).toBe('PS1');
    expect(courseLabel(2, null)).toBe('PS2');
  });

  it('名前の無い組み合わせは内容をそのまま出す', () => {
    expect(courseLabel(1, 45)).toBe('1対1・45分');
  });

  it('内容の表示', () => {
    expect(courseDetail(1, 90)).toBe('1対1・90分');
    expect(courseDetail(2, 45)).toBe('1対2・45分');
    expect(courseDetail(2, null)).toBe('1対2・90分');
  });

  it('名前と内容が同じときは括弧で重複させない', () => {
    expect(courseFullLabel(1, 90)).toBe('PS1（1対1・90分）');
    expect(courseFullLabel(1, 45)).toBe('1対1・45分');
  });
});

describe('courseOptionsForGrade', () => {
  it('45分（キッズ）は小1〜小4だけ出す', () => {
    expect(courseOptionsForGrade(3).map((o) => o.label)).toEqual(['PS1', 'PS2', 'キッズ']);
    expect(courseOptionsForGrade(4).map((o) => o.label)).toEqual(['PS1', 'PS2', 'キッズ']);
  });

  it('小5以上・学年不明では45分を出さない', () => {
    expect(courseOptionsForGrade(5).map((o) => o.label)).toEqual(['PS1', 'PS2']);
    expect(courseOptionsForGrade(null).map((o) => o.label)).toEqual(['PS1', 'PS2']);
    expect(courseOptionsForGrade(undefined).map((o) => o.label)).toEqual(['PS1', 'PS2']);
  });

  it('名前の無い 1対1×45分 は、明示したときだけ出す（既存データの編集用）', () => {
    expect(courseOptionsForGrade(3, true).map((o) => o.label)).toEqual([
      'PS1',
      'PS2',
      'キッズ',
      '1対1・45分',
    ]);
    // 小5以上では 45分 自体が無いので、明示しても増えない
    expect(courseOptionsForGrade(5, true).map((o) => o.label)).toEqual(['PS1', 'PS2']);
  });
});

describe('isCourseSelectionMissing', () => {
  it('コースが設定済みなら選ばせる必要はない', () => {
    expect(isCourseSelectionMissing(course(1, 90), false, null)).toBe(false);
  });

  it('コースが無く未選択なら止める（★既定1対2で素通りさせない）', () => {
    expect(isCourseSelectionMissing(null, false, null)).toBe(true);
  });

  it('コースが無くても選ばれていれば通す', () => {
    expect(isCourseSelectionMissing(null, false, 2)).toBe(false);
  });

  it('★読み込みに失敗しているあいだは、コースがあっても選択済みでも止める', () => {
    // 失敗を「未設定」と同じ扱いにして既定へ落とすと、
    // 本当は1対1の生徒を1対2で登録してしまう。
    expect(isCourseSelectionMissing(null, true, 2)).toBe(true);
    expect(isCourseSelectionMissing(course(1, 90), true, 1)).toBe(true);
  });
});
