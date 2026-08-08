/**
 * isProgrammingOnlyStudent のテスト
 *
 * 「プログラミングコース受講」チェックだけでは除外せず、通常教科を併用している生徒は
 * アラート対象に残す、という判定の境界を固定する。
 * プログラミング(HALLO)は科目マスタに無く、科目「その他」＋自由入力で登録される運用。
 */
import { describe, it, expect, vi } from 'vitest';

// 判定は純関数だが alerts.ts が supabase クライアントを import するため、生成だけ差し替える。
// vi.mock は巻き上げられるので、ファクトリ内で完結させて外側の変数を参照しない。
vi.mock('@/lib/supabase', () => {
  const client = { from: vi.fn() };
  return {
    supabase: client,
    getSupabaseBrowserClient: () => client,
    createSupabaseBrowserClient: () => client,
  };
});

import { isProgrammingOnlyStudent } from '@/lib/api/alerts';

describe('isProgrammingOnlyStudent', () => {
  it('プログラミング受講でなければ、科目が無くても専科ではない', () => {
    expect(isProgrammingOnlyStudent({ is_programming: false, subjects: [] })).toBe(false);
    expect(isProgrammingOnlyStudent({ subjects: [{ name: '英語' }] })).toBe(false);
  });

  it('プログラミング受講で科目が「その他」だけなら専科', () => {
    expect(isProgrammingOnlyStudent({ is_programming: true, subjects: [{ name: 'その他' }] })).toBe(
      true
    );
  });

  it('プログラミング受講で科目が未登録なら専科', () => {
    expect(isProgrammingOnlyStudent({ is_programming: true, subjects: [] })).toBe(true);
    expect(isProgrammingOnlyStudent({ is_programming: true })).toBe(true);
  });

  it('プログラミング受講でも通常教科を併用していれば専科ではない', () => {
    expect(
      isProgrammingOnlyStudent({
        is_programming: true,
        subjects: [{ name: 'その他' }, { name: '英語' }],
      })
    ).toBe(false);
    expect(isProgrammingOnlyStudent({ is_programming: true, subjects: [{ name: '数学' }] })).toBe(
      false
    );
  });
});
