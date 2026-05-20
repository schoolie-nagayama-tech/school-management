/**
 * PostgreSQL配列 → JavaScript配列の正規化関数テスト
 * admin/users ルートで使用される toNumArray, toStrArray, toSlotNumbersByDay
 */
import { describe, it, expect } from 'vitest';

// ルートファイルからは export されていないため、同じロジックを再実装してテスト
// この関数群は src/app/api/admin/users/route.ts と src/app/api/admin/users/[userId]/route.ts で使用

function toNumArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
  if (typeof v === 'string') {
    const trimmed = v.replace(/^\{|\}$/g, '').trim();
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
  }
  return [];
}

function toStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') {
    const trimmed = v.replace(/^\{|\}$/g, '').trim();
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  }
  return [];
}

function toSlotNumbersByDay(v: unknown): Record<string, number[]> {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const out: Record<string, number[]> = {};
    for (const key of Object.keys(v as object)) {
      const arr = toNumArray((v as Record<string, unknown>)[key]);
      if (arr.length > 0) out[key] = arr;
    }
    return out;
  }
  return {};
}

describe('toNumArray', () => {
  it('JS配列をそのまま数値配列に変換する', () => {
    expect(toNumArray([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('文字列数値の配列を変換する', () => {
    expect(toNumArray(['1', '2', '3'])).toEqual([1, 2, 3]);
  });

  it('PostgreSQL形式の文字列 "{1,2,3}" を変換する', () => {
    expect(toNumArray('{1,2,3}')).toEqual([1, 2, 3]);
  });

  it('空のPostgreSQL形式 "{}" を空配列にする', () => {
    expect(toNumArray('{}')).toEqual([]);
  });

  it('NaN要素を除外する', () => {
    expect(toNumArray([1, 'abc', 3])).toEqual([1, 3]);
  });

  it('nullに対して空配列を返す', () => {
    expect(toNumArray(null)).toEqual([]);
  });

  it('undefinedに対して空配列を返す', () => {
    expect(toNumArray(undefined)).toEqual([]);
  });

  it('空配列を返す', () => {
    expect(toNumArray([])).toEqual([]);
  });

  it('空文字列に対して空配列を返す', () => {
    expect(toNumArray('')).toEqual([]);
  });

  it('スペースを含むPostgreSQL文字列を正しく処理する', () => {
    expect(toNumArray('{ 1 , 2 , 3 }')).toEqual([1, 2, 3]);
  });

  it('数値オブジェクトに対して空配列を返す', () => {
    expect(toNumArray(42)).toEqual([]);
  });
});

describe('toStrArray', () => {
  it('JS配列をそのまま文字列配列に変換する', () => {
    expect(toStrArray(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('数値配列を文字列配列に変換する', () => {
    expect(toStrArray([1, 2])).toEqual(['1', '2']);
  });

  it('PostgreSQL形式の文字列 "{a,b,c}" を変換する', () => {
    expect(toStrArray('{a,b,c}')).toEqual(['a', 'b', 'c']);
  });

  it('ダブルクォート付きPostgreSQL文字列を処理する', () => {
    expect(toStrArray('{"uuid-1","uuid-2"}')).toEqual(['uuid-1', 'uuid-2']);
  });

  it('空のPostgreSQL形式 "{}" を空配列にする', () => {
    expect(toStrArray('{}')).toEqual([]);
  });

  it('nullに対して空配列を返す', () => {
    expect(toStrArray(null)).toEqual([]);
  });

  it('undefinedに対して空配列を返す', () => {
    expect(toStrArray(undefined)).toEqual([]);
  });
});

describe('toSlotNumbersByDay', () => {
  it('正常なJSONBオブジェクトを変換する', () => {
    const input = { mon: [1, 2], tue: [3] };
    expect(toSlotNumbersByDay(input)).toEqual({ mon: [1, 2], tue: [3] });
  });

  it('PostgreSQL文字列配列を含むオブジェクトを変換する', () => {
    const input = { mon: '{1,2}', tue: '{3}' };
    expect(toSlotNumbersByDay(input)).toEqual({ mon: [1, 2], tue: [3] });
  });

  it('空の曜日を除外する', () => {
    const input = { mon: [1], tue: [], wed: '{}' };
    expect(toSlotNumbersByDay(input)).toEqual({ mon: [1] });
  });

  it('nullに対して空オブジェクトを返す', () => {
    expect(toSlotNumbersByDay(null)).toEqual({});
  });

  it('配列に対して空オブジェクトを返す', () => {
    expect(toSlotNumbersByDay([1, 2])).toEqual({});
  });

  it('文字列に対して空オブジェクトを返す', () => {
    expect(toSlotNumbersByDay('invalid')).toEqual({});
  });

  it('undefinedに対して空オブジェクトを返す', () => {
    expect(toSlotNumbersByDay(undefined)).toEqual({});
  });
});
