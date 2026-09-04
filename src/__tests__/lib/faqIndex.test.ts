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
import { exampleQuestions } from '@/lib/help/exampleQuestions';

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

  it('空白区切りで打った全語が含まれるものを返す', () => {
    const hits = keywordSearch(index, '振替 操作');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      const target = `${h.question} ${h.item.answer} ${h.keywords.join(' ')}`;
      expect(target).toContain('振替');
      expect(target).toContain('操作');
    }
  });

  /**
   * ★受け皿としての本命。日本語は分かち書きしないので、話し言葉の質問は1語になる。
   * 全語一致だけだと必ず0件になり、「答えられないときに出す候補」が常に空になってしまう。
   */
  it('話し言葉の質問でも候補を返す（分かち書きしない日本語）', () => {
    const hits = keywordSearch(index, '振替のやり方が分からない');
    expect(hits.length).toBeGreaterThan(0);
    // 「振替」を含む項目が上位に来る
    const top = hits.slice(0, 3).map((h) => `${h.question} ${h.keywords.join(' ')}`);
    expect(top.some((t) => t.includes('振替'))).toBe(true);
  });

  it('どのFAQにも掠らない質問では空を返す（無理に出さない）', () => {
    expect(keywordSearch(index, 'ｘｙｚｑｑ')).toEqual([]);
  });
});

/**
 * 公開状態（status）の扱い。
 *
 * ★ここを固定する理由: 未公開機能を roles で隠していた時期があり、教室長がAIヘルプに
 *   聞いても見出しごと落ちて「載っていません」としか返らなかった。status は
 *   「隠す」ためではなく「使えないと伝える」ための情報なので、絞り込みでは落とさず、
 *   回答用の本文には必ず載ることを保証する。
 */
describe('公開状態（status）', () => {
  const index = buildFaqIndex();

  it('status 未指定の項目は live として索引に載る', () => {
    const live = index.find((e) => e.question === '生徒の新規登録方法');
    expect(live?.status).toBe('live');
  });

  it('未公開の項目もロール絞り込みで落とさない（使えないと答えるため）', () => {
    const planned = index.filter((e) => e.status === 'planned');
    expect(planned.length).toBeGreaterThan(0);
    // 教室長から見える範囲に、公開前の項目が少なくとも1件は残っている
    const forManager = filterIndexByRole(index, 'manager');
    expect(forManager.some((e) => e.status === 'planned')).toBe(true);
  });

  it('1回目の見出しに公開状態の印が付く', () => {
    const planned = index.filter((e) => e.status === 'planned').slice(0, 1);
    expect(renderHeadings(planned)).toContain('<planned>');
  });

  it('公開済みの項目の見出しには印を付けない（毎回同じ文字列＝キャッシュを壊さない）', () => {
    const live = index.filter((e) => e.status === 'live').slice(0, 1);
    const heading = renderHeadings(live);
    expect(heading).not.toContain('<planned>');
    expect(heading).not.toContain('<preview>');
  });

  it('2回目の本文では公開状態が answer より前に出る', () => {
    const entry = index.find((e) => e.status === 'planned' && e.statusNote);
    expect(entry).toBeDefined();
    const text = renderItemsForAnswer([entry!]);
    expect(text).toContain('公開状態:');
    expect(text.indexOf('公開状態:')).toBeLessThan(text.indexOf(entry!.item.answer));
    expect(text).toContain(entry!.statusNote!);
  });

  it('公開済みの項目の本文には公開状態の行を入れない', () => {
    const live = index.filter((e) => e.status === 'live').slice(0, 1);
    expect(renderItemsForAnswer(live)).not.toContain('公開状態:');
  });

  it('status が live でない項目には必ず statusNote がある（何が使えないか説明できるように）', () => {
    const missing = index
      .filter((e) => e.status !== 'live' && !e.statusNote)
      .map((e) => e.question);
    expect(missing).toEqual([]);
  });
});

/** related のクロスリンクが実在する question を指しているか（リンク切れ検出） */
describe('related のリンク切れ', () => {
  it('すべての related が実在する項目を指す', () => {
    const questions = new Set(FAQ_DATA.flatMap((c) => c.items.map((i) => i.question)));
    const broken: string[] = [];
    for (const category of FAQ_DATA) {
      for (const item of category.items) {
        for (const r of item.related ?? []) {
          if (!questions.has(r)) broken.push(`${item.question} → ${r}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

/**
 * 規則（rules）の扱い。
 *
 * ★手順(steps)と規則(rules)は扱いが違う。手順は「そのまま写す」もの、規則は
 *   「利用者の具体的な値に当てはめてよい」もの。AIに渡す本文でこの2つが
 *   別枠になっていること、規則が回答用の本文に必ず載ることを固定する。
 */
describe('規則（rules）', () => {
  const index = buildFaqIndex();

  it('規則を持つ項目が存在する', () => {
    expect(index.filter((e) => e.item.rules?.length).length).toBeGreaterThan(0);
  });

  it('回答用の本文に規則が「規則:」として載る', () => {
    const entry = index.find((e) => e.item.rules?.length);
    expect(entry).toBeDefined();
    const text = renderItemsForAnswer([entry!]);
    expect(text).toContain('規則（');
    for (const rule of entry!.item.rules!) {
      expect(text).toContain(rule);
    }
  });

  it('規則は手順より前に置く（読む順序を固定する）', () => {
    const entry = index.find((e) => e.item.rules?.length && e.item.steps?.length);
    expect(entry).toBeDefined();
    const text = renderItemsForAnswer([entry!]);
    expect(text.indexOf('規則（')).toBeLessThan(text.indexOf('手順:'));
  });

  it('規則を持たない項目には規則の見出しを出さない', () => {
    const entry = index.find((e) => !e.item.rules?.length);
    expect(entry).toBeDefined();
    expect(renderItemsForAnswer([entry!])).not.toContain('規則（');
  });

  it('1回目の見出しには規則を載せない（キャッシュ対象を膨らませない）', () => {
    const entry = index.find((e) => e.item.rules?.length);
    const heading = renderHeadings([entry!]);
    expect(heading).not.toContain(entry!.item.rules![0]);
  });

  /** 請求の「何月分」は当てはめの代表例。規則として書かれていることを固定する */
  it('請求の「翌月分」の決まりが規則として書かれている', () => {
    const billing = index.find((e) => e.question === '請求管理の使い方');
    expect(billing?.item.rules?.some((r) => r.includes('翌月分'))).toBe(true);
  });

  it('規則は受け皿の検索でも引ける', () => {
    const hits = keywordSearch(index, '9月請求 何月分');
    expect(hits.some((h) => h.question === '請求管理の使い方')).toBe(true);
  });
});

/**
 * 質問の例（チップ）が、そのロールから見える項目に必ず当たること。
 *
 * ★押した1回目が外れると「このヘルプは使えない」と判断されて二度と使われない。
 *   実際、以前あった「教室を追加したい」は本番ログで unanswered になっていた
 *   （該当するFAQ項目が無い）。チップを足すときはここで落ちるので気づける。
 *
 * 判定にはAIではなく受け皿のキーワード検索を使う。AIはこれより賢く拾えるので、
 * 「受け皿でも当たる」なら実運用で外れることはまず無い、という下限の担保。
 */
describe('質問の例（チップ）', () => {
  const index = buildFaqIndex();

  it.each(['teacher', 'manager', 'admin', 'all'] as const)(
    '%s の例はすべて、そのロールから見える項目に当たる',
    (role) => {
      const visible = filterIndexByRole(index, role);
      const missed = exampleQuestions(role).filter(
        (q) => keywordSearch(visible, q, 3).length === 0
      );
      expect(missed).toEqual([]);
    }
  );

  it('未公開（planned）の機能は例に出さない', () => {
    // 「まだ使えません」で終わる例は最初の一歩にならない
    for (const role of ['teacher', 'manager', 'admin', 'all'] as const) {
      const visible = filterIndexByRole(index, role);
      for (const q of exampleQuestions(role)) {
        const top = keywordSearch(visible, q, 1)[0];
        expect(top?.status).not.toBe('planned');
      }
    }
  });
});
