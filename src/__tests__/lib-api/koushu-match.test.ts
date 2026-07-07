/**
 * koushu-match の純粋ロジックのテスト。
 *
 * - scoreTeacher: 指名NG/性別希望のハード除外（バグると黒リスト講師が割り当たる）と
 *   加重和スコアの構成を固定。重みは暫定値なのでマジックナンバーではなく
 *   MATCH_CONFIG.weights を使って「どの加点が乗るか」を検証する。
 * - enumeratePeriodDates: 講習配置の元になる営業日展開（休講日除外・両端含む）。
 */
import { describe, it, expect } from 'vitest';
import { MATCH_CONFIG, scoreTeacher, enumeratePeriodDates } from '@/lib/api/koushu-match';

const w = MATCH_CONFIG.weights;

// TeacherProfile は構造的型付けでリテラルを渡す
const teacher = (over: Partial<Parameters<typeof scoreTeacher>[0]['teacher']> = {}) => ({
  id: 't1',
  display_name: null,
  email: null,
  gender: null,
  teachable_subject_ids: null,
  ...over,
});

const baseOpts = {
  teacher: teacher(),
  fixedSet: new Set<string>(),
  excludedSet: new Set<string>(),
  preferredGender: null as 'male' | 'female' | null,
  pastSet: new Set<string>(),
  subjectIds: [] as string[],
};

describe('scoreTeacher（ハード除外）', () => {
  it('指名NG（excludedSet に含まれる）は null', () => {
    expect(scoreTeacher({ ...baseOpts, excludedSet: new Set(['t1']) })).toBeNull();
  });

  it('性別希望に不一致な講師は null', () => {
    const r = scoreTeacher({
      ...baseOpts,
      teacher: teacher({ gender: 'male' }),
      preferredGender: 'female',
    });
    expect(r).toBeNull();
  });

  it('性別が未設定の講師は性別希望があっても除外しない（null 扱いで通す）', () => {
    const r = scoreTeacher({
      ...baseOpts,
      teacher: teacher({ gender: null }),
      preferredGender: 'female',
    });
    expect(r).not.toBeNull();
    // 性別一致加点は乗らない
    expect(r!.reasons).not.toContain('希望性別一致');
  });
});

describe('scoreTeacher（加重和スコアの構成）', () => {
  it('ベースライン: 出勤可能のみで available 点', () => {
    const r = scoreTeacher(baseOpts)!;
    expect(r.score).toBe(w.available);
    expect(r.reasons).toEqual(['出勤可能']);
    expect(r.subjectOut).toBe(false);
    expect(r.conflicts).toEqual([]);
  });

  it('担当固定で fixedTeacher 点が乗る', () => {
    const r = scoreTeacher({ ...baseOpts, fixedSet: new Set(['t1']) })!;
    expect(r.score).toBe(w.available + w.fixedTeacher);
    expect(r.reasons).toContain('担当固定');
  });

  it('過去担当で pastHistory 点が乗る', () => {
    const r = scoreTeacher({ ...baseOpts, pastSet: new Set(['t1']) })!;
    expect(r.score).toBe(w.available + w.pastHistory);
    expect(r.reasons).toContain('過去担当');
  });

  it('教科一致で subjectMatch 点が乗り subjectOut=false', () => {
    const r = scoreTeacher({
      ...baseOpts,
      teacher: teacher({ teachable_subject_ids: ['math', 'eng'] }),
      subjectIds: ['math'],
    })!;
    expect(r.score).toBe(w.available + w.subjectMatch);
    expect(r.reasons).toContain('教科対応');
    expect(r.subjectOut).toBe(false);
  });

  it('指導科目が判明していて一致しない場合は subjectOut=true・加点なし・conflicts に教科外', () => {
    const r = scoreTeacher({
      ...baseOpts,
      teacher: teacher({ teachable_subject_ids: ['eng'] }),
      subjectIds: ['math'],
    })!;
    expect(r.subjectOut).toBe(true);
    expect(r.conflicts).toContain('教科外');
    expect(r.score).toBe(w.available); // subjectMatch は乗らない
    expect(r.reasons).not.toContain('教科対応');
  });

  it('指導科目が不明（teachable 空）なら subjectOut=false・加点なし', () => {
    const r = scoreTeacher({
      ...baseOpts,
      teacher: teacher({ teachable_subject_ids: [] }),
      subjectIds: ['math'],
    })!;
    expect(r.subjectOut).toBe(false);
    expect(r.score).toBe(w.available);
  });

  it('性別希望に一致で genderPref 点が乗る', () => {
    const r = scoreTeacher({
      ...baseOpts,
      teacher: teacher({ gender: 'female' }),
      preferredGender: 'female',
    })!;
    expect(r.score).toBe(w.available + w.genderPref);
    expect(r.reasons).toContain('希望性別一致');
  });

  it('全条件一致で全加点の合計になる', () => {
    const r = scoreTeacher({
      teacher: teacher({ gender: 'female', teachable_subject_ids: ['math'] }),
      fixedSet: new Set(['t1']),
      excludedSet: new Set<string>(),
      preferredGender: 'female',
      pastSet: new Set(['t1']),
      subjectIds: ['math'],
    })!;
    expect(r.score).toBe(
      w.available + w.fixedTeacher + w.pastHistory + w.subjectMatch + w.genderPref
    );
  });

  it('担当固定の講師はベースライン講師より高スコア（優先される）', () => {
    const fixed = scoreTeacher({ ...baseOpts, fixedSet: new Set(['t1']) })!;
    const plain = scoreTeacher(baseOpts)!;
    expect(fixed.score).toBeGreaterThan(plain.score);
  });
});

describe('enumeratePeriodDates（営業日展開）', () => {
  it('両端を含む連続した日付を返す', () => {
    expect(enumeratePeriodDates('2026-08-01', '2026-08-03', new Set())).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('休講日(closed)を除外する', () => {
    expect(
      enumeratePeriodDates('2026-08-01', '2026-08-04', new Set(['2026-08-02', '2026-08-03']))
    ).toEqual(['2026-08-01', '2026-08-04']);
  });

  it('開始=終了なら1日だけ返す', () => {
    expect(enumeratePeriodDates('2026-08-01', '2026-08-01', new Set())).toEqual(['2026-08-01']);
  });

  it('月をまたいで正しく展開する', () => {
    expect(enumeratePeriodDates('2026-07-31', '2026-08-02', new Set())).toEqual([
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });
});
