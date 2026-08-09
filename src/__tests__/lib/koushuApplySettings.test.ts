import { describe, it, expect } from 'vitest';
import {
  isValidDateString,
  publishStatusOf,
  sanitizeEndByGrade,
  sanitizePriceTable,
  validatePublishWindow,
} from '@/lib/utils/koushuApplySettings';
import { isApplyPublished } from '@/lib/utils/koushuApplyPure';

describe('sanitizePriceTable', () => {
  it('null は「単価表なし」として通す', () => {
    const r = sanitizePriceTable(null);
    expect(r).toEqual({ ok: true, value: null });
  });

  it('正しい形はそのまま正規化して返す', () => {
    const r = sanitizePriceTable({ 中2: { '1on2': { '90': 3980 }, '1on1': { '90': 6400 } } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ 中2: { '1on2': { '90': 3980 }, '1on1': { '90': 6400 } } });
    }
  });

  it('空欄（null/空文字）のセルは落として保存する', () => {
    const r = sanitizePriceTable({ 中2: { '1on2': { '90': 3980, '45': null } } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ 中2: { '1on2': { '90': 3980 } } });
  });

  it('全セルが空なら null（＝未設定）にする', () => {
    const r = sanitizePriceTable({ 中2: { '1on2': { '90': '' } } });
    expect(r).toEqual({ ok: true, value: null });
  });

  it('45分を小5以上に置くのは拒否する（決定17をデータ側で保証する）', () => {
    const r = sanitizePriceTable({ 中2: { '1on2': { '45': 3000 } } });
    expect(r.ok).toBe(false);
  });

  it('45分は小4までなら通る', () => {
    const r = sanitizePriceTable({ 小4: { '1on2': { '45': 3000 } } });
    expect(r.ok).toBe(true);
  });

  it('不明な学年ラベルは拒否する', () => {
    expect(sanitizePriceTable({ 高4: { '1on2': { '90': 3000 } } }).ok).toBe(false);
  });

  it('不明な形式キー・時間キーは拒否する', () => {
    expect(sanitizePriceTable({ 中2: { '1on3': { '90': 3000 } } }).ok).toBe(false);
    expect(sanitizePriceTable({ 中2: { '1on2': { '60': 3000 } } }).ok).toBe(false);
  });

  it('負数・小数・NaN・文字列は拒否する', () => {
    expect(sanitizePriceTable({ 中2: { '1on2': { '90': -1 } } }).ok).toBe(false);
    expect(sanitizePriceTable({ 中2: { '1on2': { '90': 39.5 } } }).ok).toBe(false);
    expect(sanitizePriceTable({ 中2: { '1on2': { '90': NaN } } }).ok).toBe(false);
    expect(sanitizePriceTable({ 中2: { '1on2': { '90': '3980' } } }).ok).toBe(false);
  });

  it('配列や文字列など object でない入力は拒否する', () => {
    expect(sanitizePriceTable([]).ok).toBe(false);
    expect(sanitizePriceTable('x').ok).toBe(false);
  });
});

describe('sanitizeEndByGrade', () => {
  it('null は未設定として通す', () => {
    expect(sanitizeEndByGrade(null)).toEqual({ ok: true, value: null });
  });

  it('学年番号キーの日付を正規化する', () => {
    const r = sanitizeEndByGrade({ '9': '2026-08-31', '1': '2026-08-20' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ '9': '2026-08-31', '1': '2026-08-20' });
  });

  it('空欄の学年は落とす（＝共通の終了日にフォールバック）', () => {
    const r = sanitizeEndByGrade({ '9': '', '1': '2026-08-20' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ '1': '2026-08-20' });
  });

  it('存在しない学年番号は拒否する', () => {
    expect(sanitizeEndByGrade({ '14': '2026-08-31' }).ok).toBe(false);
  });

  it('暦にない日付は拒否する', () => {
    expect(sanitizeEndByGrade({ '9': '2026-02-31' }).ok).toBe(false);
    expect(sanitizeEndByGrade({ '9': '2026/08/31' }).ok).toBe(false);
  });

  it('開始日より前の終了日は拒否する（期間が空になるため）', () => {
    expect(sanitizeEndByGrade({ '9': '2026-07-01' }, '2026-07-21').ok).toBe(false);
    expect(sanitizeEndByGrade({ '9': '2026-07-21' }, '2026-07-21').ok).toBe(true);
  });
});

describe('validatePublishWindow', () => {
  it('両方空なら非公開として通す', () => {
    expect(validatePublishWindow(null, null)).toEqual({
      ok: true,
      value: { start: null, end: null },
    });
    expect(validatePublishWindow('', '')).toEqual({ ok: true, value: { start: null, end: null } });
  });

  it('片方だけの入力は拒否する（isApplyPublished が非公開扱いにするため事故になる）', () => {
    expect(validatePublishWindow('2027-02-01T00:00:00Z', null).ok).toBe(false);
    expect(validatePublishWindow(null, '2027-02-28T00:00:00Z').ok).toBe(false);
  });

  it('終了が開始以前なら拒否する', () => {
    expect(validatePublishWindow('2027-02-10T00:00:00Z', '2027-02-01T00:00:00Z').ok).toBe(false);
    expect(validatePublishWindow('2027-02-10T00:00:00Z', '2027-02-10T00:00:00Z').ok).toBe(false);
  });

  it('正しい期間は ISO 文字列に正規化する', () => {
    const r = validatePublishWindow('2027-02-01T00:00:00Z', '2027-02-28T00:00:00Z');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.start).toBe('2027-02-01T00:00:00.000Z');
      expect(r.value.end).toBe('2027-02-28T00:00:00.000Z');
    }
  });
});

describe('publishStatusOf', () => {
  const start = '2027-02-01T00:00:00Z';
  const end = '2027-02-28T00:00:00Z';

  it('未設定・片側だけは unpublished', () => {
    expect(publishStatusOf(null, null)).toBe('unpublished');
    expect(publishStatusOf(start, null)).toBe('unpublished');
    expect(publishStatusOf(null, end)).toBe('unpublished');
  });

  it('開始前は scheduled / 期間内は open / 終了後は closed', () => {
    expect(publishStatusOf(start, end, new Date('2027-01-15T00:00:00Z'))).toBe('scheduled');
    expect(publishStatusOf(start, end, new Date('2027-02-10T00:00:00Z'))).toBe('open');
    expect(publishStatusOf(start, end, new Date('2027-03-10T00:00:00Z'))).toBe('closed');
  });

  // 表示バッジと実際の公開判定がズレると「公開中に見えるのに404」が起きる。
  // open を返す条件は isApplyPublished が true を返す条件と一致していること。
  it('open と isApplyPublished の判定が一致する', () => {
    const cases = [
      '2027-01-15T00:00:00Z',
      '2027-02-01T00:00:00Z',
      '2027-02-10T00:00:00Z',
      '2027-02-28T00:00:00Z',
      '2027-03-10T00:00:00Z',
    ];
    for (const iso of cases) {
      const now = new Date(iso);
      expect(publishStatusOf(start, end, now) === 'open').toBe(isApplyPublished(start, end, now));
    }
  });
});

describe('isValidDateString', () => {
  it('YYYY-MM-DD かつ暦上存在する日だけ true', () => {
    expect(isValidDateString('2026-08-31')).toBe(true);
    expect(isValidDateString('2026-02-29')).toBe(false);
    expect(isValidDateString('2028-02-29')).toBe(true);
    expect(isValidDateString('2026-8-1')).toBe(false);
    expect(isValidDateString(20260831)).toBe(false);
  });
});
