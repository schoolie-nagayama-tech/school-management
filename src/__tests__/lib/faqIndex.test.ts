/**
 * AIヘルプが使うFAQ索引の純関数テスト。
 *
 * ここで固定したいのは3点:
 *  - IDが質問文から決まり、並び順に依存しないこと（記録に残したIDが後からずれない）
 *  - ロールで落とすのがAIに渡す前であること（講師に上位ロール専用項目を見せない）
 *  - 1回目のプロンプトに本文が混ざらないこと（2段階にした意味が消えるため）
 */
import { describe, expect, it } from 'vitest';
import {
  buildFaqIndex,
  faqItemId,
  filterIndexByRole,
  keywordSearch,
  pickEntriesByIds,
  prioritizeByPath,
  renderHeadings,
  renderItemsForAnswer,
  toRoleTag,
} from '@/lib/help/faqIndex';
import { FAQ_DATA } from '@/lib/help/faqData';

describe('faqItemId', () => {
  it('同じ質問文からは同じIDになる', () => {
    expect(faqItemId('生徒の新規登録方法')).toBe(faqItemId('生徒の新規登録方法'));
  });

  it('質問文が違えばIDも違う', () => {
    expect(faqItemId('生徒の新規登録方法')).not.toBe(faqItemId('生徒の削除方法'));
  });

  it('7文字に揃う', () => {
    expect(faqItemId('あ')).toHaveLength(7);
    expect(faqItemId('とても長い質問文'.repeat(20))).toHaveLength(7);
  });
});

describe('buildFaqIndex', () => {
  const index = buildFaqIndex();

  it('FAQ_DATA の全項目が索引に入る（ID衝突があれば build 時に落ちる）', () => {
    const total = FAQ_DATA.reduce((sum, c) => sum + c.items.length, 0);
    expect(index).toHaveLength(total);
    expect(total).toBeGreaterThan(100);
  });

  it('IDが全件ユニーク', () => {
    const ids = new Set(index.map((e) => e.id));
    expect(ids.size).toBe(index.length);
  });

  it('カテゴリ情報とリンクを引き継ぐ', () => {
    const withLink = index.find((e) => e.href);
    expect(withLink).toBeDefined();
    expect(withLink!.categoryTitle).toBeTruthy();
    expect(withLink!.categoryId).toBeTruthy();
  });
});

describe('filterIndexByRole', () => {
  const index = buildFaqIndex();

  it('admin は全部見える', () => {
    expect(filterIndexByRole(index, 'admin')).toHaveLength(index.length);
  });

  it('講師には admin 専用の項目を渡さない', () => {
    const forTeacher = filterIndexByRole(index, 'teacher');
    const leaked = forTeacher.filter((e) => e.roles && !e.roles.includes('teacher'));
    expect(leaked).toHaveLength(0);
    expect(forTeacher.length).toBeLessThan(index.length);
  });

  it('roles 未指定の項目は誰にでも見せる', () => {
    const noRoles = index.filter((e) => !e.roles);
    const forTeacher = filterIndexByRole(index, 'teacher');
    for (const e of noRoles) {
      expect(forTeacher).toContain(e);
    }
  });
});

describe('toRoleTag', () => {
  it.each([
    ['admin', 'admin'],
    ['owner', 'admin'],
    ['manager', 'manager'],
    ['teacher', 'teacher'],
    ['parent', 'all'],
    [null, 'all'],
    [undefined, 'all'],
  ])('%s → %s', (input, expected) => {
    expect(toRoleTag(input as string | null | undefined)).toBe(expected);
  });
});

describe('pickEntriesByIds', () => {
  const index = buildFaqIndex();

  it('知らないIDは捨てる', () => {
    const real = index[0].id;
    expect(pickEntriesByIds(index, ['zzzzzzz', real])).toEqual([index[0]]);
  });

  it('最大3件までしか返さない', () => {
    const ids = index.slice(0, 10).map((e) => e.id);
    expect(pickEntriesByIds(index, ids)).toHaveLength(3);
  });

  it('同じIDが並んでも重複しない', () => {
    const id = index[0].id;
    expect(pickEntriesByIds(index, [id, id, id])).toHaveLength(1);
  });
});

describe('prioritizeByPath', () => {
  const index = buildFaqIndex();

  it('いまいるページに対応する項目を先頭へ寄せる', () => {
    const target = index.find((e) => e.href)!;
    const sorted = prioritizeByPath(index, target.href!);
    expect(sorted[0].href).toBe(target.href);
    expect(sorted).toHaveLength(index.length);
  });

  it('パスが無ければ並びを変えない', () => {
    expect(prioritizeByPath(index, null)).toEqual(index);
  });
});

describe('renderHeadings', () => {
  it('本文を載せない（見出しだけ）', () => {
    const index = buildFaqIndex();
    const headings = renderHeadings(index.slice(0, 3));
    for (const e of index.slice(0, 3)) {
      expect(headings).toContain(e.id);
      expect(headings).toContain(e.question);
      // 本文が混ざっていたら 2段階にした意味が無くなる
      expect(headings).not.toContain(e.item.answer);
    }
  });
});

describe('renderItemsForAnswer', () => {
  it('手順をそのまま載せる', () => {
    const entry = buildFaqIndex().find((e) => e.item.steps && e.item.steps.length > 0)!;
    const text = renderItemsForAnswer([entry]);
    expect(text).toContain(entry.item.answer);
    for (const step of entry.item.steps!) {
      expect(text).toContain(step);
    }
  });
});

describe('keywordSearch', () => {
  const index = buildFaqIndex();

  it('空の質問では何も返さない', () => {
    expect(keywordSearch(index, '   ')).toEqual([]);
  });

  it('キーワードで引ける', () => {
    const hits = keywordSearch(index, '生徒');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(5);
  });
});
