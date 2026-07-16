/**
 * ユニット: 授業報告書の subject_specific（JSONB）正規化（§7-4・保護者面）。
 *
 * 固定する仕様（lib/mypage/reports.ts の normalizeSubjectSpecific）:
 *   - 講師の入力UI（app/lesson-reports/[scheduleEntryId]/page.tsx）が書く形を信頼しない。
 *     object 以外・kind が未知の値・各フィールドの型違いは黙って捨てる。
 *   - kind='none' でも extra_materials だけは入りうる（プリント自由記述は kind に依らない）。
 *   - 見せられる中身が何も無ければ null（呼び出し側の「セクションごと出さない」判定を単純にする）。
 */
import { describe, it, expect, vi } from 'vitest';

// reports.ts は 'server-only' を import するため、node のテスト環境では空モジュールに差し替える。
vi.mock('server-only', () => ({}));

import { normalizeSubjectSpecific } from '@/lib/mypage/reports';

describe('normalizeSubjectSpecific', () => {
  it('null / undefined は null', () => {
    expect(normalizeSubjectSpecific(null)).toBeNull();
    expect(normalizeSubjectSpecific(undefined)).toBeNull();
  });

  it('object 以外（文字列・数値・配列）は null', () => {
    expect(normalizeSubjectSpecific('vocab')).toBeNull();
    expect(normalizeSubjectSpecific(123)).toBeNull();
    expect(normalizeSubjectSpecific(['vocab'])).toBeNull();
  });

  it('kind が無い、または未知の値なら丸ごと null', () => {
    expect(normalizeSubjectSpecific({})).toBeNull();
    expect(normalizeSubjectSpecific({ kind: 'english' })).toBeNull();
    expect(normalizeSubjectSpecific({ kind: 123 })).toBeNull();
  });

  it('kind=vocab で全フィールドが正しい型なら通す', () => {
    expect(
      normalizeSubjectSpecific({
        kind: 'vocab',
        range: 'Unit 6 単語',
        pages: '46-49',
        times_per_day: 3,
        duration: '1週間',
        extra_materials: '文法プリント2枚',
      })
    ).toEqual({
      kind: 'vocab',
      range: 'Unit 6 単語',
      pages: '46-49',
      timesPerDay: 3,
      duration: '1週間',
      extraMaterials: '文法プリント2枚',
    });
  });

  it('文字列であるべきフィールドが文字列でなければそのフィールドだけ落とす（object 全体は捨てない）', () => {
    expect(
      normalizeSubjectSpecific({
        kind: 'calc',
        range: 123, // 型違い → null に落ちる
        pages: '10-12',
        times_per_day: 'five', // 型違い → null に落ちる
        duration: '3日間',
      })
    ).toEqual({
      kind: 'calc',
      range: null,
      pages: '10-12',
      timesPerDay: null,
      duration: '3日間',
      extraMaterials: null,
    });
  });

  it('空文字はフィールドが無いのと同じ扱い（null）', () => {
    const result = normalizeSubjectSpecific({
      kind: 'kanji',
      range: '',
      pages: '   ',
      duration: '1週間',
    });
    expect(result?.range).toBeNull();
    expect(result?.pages).toBeNull();
    expect(result?.duration).toBe('1週間');
  });

  it('kind=none で extra_materials だけあれば通す（プリント自由記述は kind に依らない）', () => {
    expect(
      normalizeSubjectSpecific({ kind: 'none', extra_materials: '計算プリント（分数係数）を10問' })
    ).toEqual({
      kind: 'none',
      range: null,
      pages: null,
      timesPerDay: null,
      duration: null,
      extraMaterials: '計算プリント（分数係数）を10問',
    });
  });

  it('kind=none で extra_materials も無ければ null（見せるものが無い）', () => {
    expect(normalizeSubjectSpecific({ kind: 'none' })).toBeNull();
    expect(normalizeSubjectSpecific({ kind: 'none', extra_materials: '' })).toBeNull();
  });

  it('kind が vocab/calc/kanji でも全フィールドが空なら null（見せるものが無い）', () => {
    expect(normalizeSubjectSpecific({ kind: 'vocab' })).toBeNull();
    expect(
      normalizeSubjectSpecific({ kind: 'vocab', range: '', pages: '', duration: '' })
    ).toBeNull();
  });

  it('times_per_day=0 は falsy だが有効な数値として通す', () => {
    const result = normalizeSubjectSpecific({ kind: 'calc', times_per_day: 0 });
    expect(result?.timesPerDay).toBe(0);
  });
});
