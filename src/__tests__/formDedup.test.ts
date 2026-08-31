import { describe, expect, it } from 'vitest';
import { normalizeFormEmail, normalizeFormName, stableStringify } from '@/lib/utils/formDedup';

describe('normalizeFormName', () => {
  it('全角・半角スペースの有無を無視する', () => {
    expect(normalizeFormName('上田　瑠南')).toBe(normalizeFormName('上田瑠南'));
    expect(normalizeFormName('上田 瑠南')).toBe(normalizeFormName('上田瑠南'));
  });

  it('別人は別人のまま', () => {
    expect(normalizeFormName('上田瑠南')).not.toBe(normalizeFormName('上田瑠奈'));
  });
});

describe('normalizeFormEmail', () => {
  it('前後空白と大文字小文字を無視する', () => {
    expect(normalizeFormEmail(' Foo@Example.com ')).toBe('foo@example.com');
  });

  it('未入力は空文字に寄せる', () => {
    expect(normalizeFormEmail(null)).toBe('');
    expect(normalizeFormEmail(undefined)).toBe('');
  });
});

describe('stableStringify', () => {
  it('キー順が違っても同じ文字列になる（jsonbはキー順を正規化するため）', () => {
    const sent = { exam_type: 'toritsu_v', date_id: '2026-08-30', venue_id: 'venue_1' };
    const stored = { date_id: '2026-08-30', venue_id: 'venue_1', exam_type: 'toritsu_v' };
    expect(stableStringify(sent)).toBe(stableStringify(stored));
  });

  it('ネストと配列でもキー順を正規化する', () => {
    const a = { selections: [{ b: 2, a: 1 }], count: 1 };
    const b = { count: 1, selections: [{ a: 1, b: 2 }] };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('配列の順序が違えば別物として扱う（選択順は意味を持つため）', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('内容が違えば別物として扱う', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});
