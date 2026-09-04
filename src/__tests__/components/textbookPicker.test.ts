/**
 * テキスト選択ピッカーの絞り込み・並び順のテスト。
 * 提案書エディタと講習テンプレート編集で同じ挙動にするため、ロジックをここで固定する。
 */
import { describe, it, expect } from 'vitest';
import {
  filterAndSortTextbooks,
  textbookFilterOptions,
  type PickableTextbook,
} from '@/components/koushu-plan/textbookPicker';

const tb = (id: number, over: Partial<PickableTextbook> = {}): PickableTextbook => ({
  id,
  name: `教材${id}`,
  subject: null,
  publisher: null,
  grade: null,
  school_type: null,
  ...over,
});

const none = new Set<number>();

describe('filterAndSortTextbooks の絞り込み', () => {
  it('学校種別・教科・学年で絞り込む', () => {
    const list = [
      tb(1, { school_type: '中学', subject: '数学', grade: '1年' }),
      tb(2, { school_type: '高校', subject: '数学', grade: '1年' }),
      tb(3, { school_type: '中学', subject: '国語', grade: '1年' }),
      tb(4, { school_type: '中学', subject: '数学', grade: '2年' }),
    ];
    const out = filterAndSortTextbooks(
      list,
      { schoolType: '中学', subject: '数学', grade: '1年' },
      none
    );
    expect(out.map((t) => t.id)).toEqual([1]);
  });

  it('検索は名前・教科・出版社に効く', () => {
    const list = [
      tb(1, { name: '標準新演習' }),
      tb(2, { name: 'ワーク', subject: '理科' }),
      tb(3, { name: 'ドリル', publisher: '育伸社' }),
      tb(4, { name: '無関係' }),
    ];
    expect(filterAndSortTextbooks(list, { search: '新演習' }, none).map((t) => t.id)).toEqual([1]);
    expect(filterAndSortTextbooks(list, { search: '理科' }, none).map((t) => t.id)).toEqual([2]);
    expect(filterAndSortTextbooks(list, { search: '育伸' }, none).map((t) => t.id)).toEqual([3]);
  });

  it('検索は大文字小文字を無視する', () => {
    const list = [tb(1, { name: 'New Treasure' })];
    expect(filterAndSortTextbooks(list, { search: 'new treasure' }, none)).toHaveLength(1);
    expect(filterAndSortTextbooks(list, { search: 'NEW' }, none)).toHaveLength(1);
  });

  it('絞り込み条件が空なら全件返す', () => {
    const list = [tb(1), tb(2)];
    expect(filterAndSortTextbooks(list, {}, none)).toHaveLength(2);
  });

  it('元の配列を破壊しない', () => {
    const list = [tb(2, { name: 'B' }), tb(1, { name: 'A' })];
    filterAndSortTextbooks(list, {}, none);
    expect(list.map((t) => t.id)).toEqual([2, 1]);
  });
});

describe('filterAndSortTextbooks の並び順', () => {
  it('お気に入りを最優先で上に出す', () => {
    const list = [tb(1, { subject: '英語', name: 'あ' }), tb(2, { subject: '社会', name: 'い' })];
    // 社会は本来あとに来るが、お気に入りなので先頭
    const out = filterAndSortTextbooks(list, {}, new Set([2]));
    expect(out.map((t) => t.id)).toEqual([2, 1]);
  });

  it('教科は英数算国理社の順にする', () => {
    const list = [
      tb(1, { subject: '社会' }),
      tb(2, { subject: '英語' }),
      tb(3, { subject: '国語' }),
      tb(4, { subject: '数学' }),
    ];
    expect(filterAndSortTextbooks(list, {}, none).map((t) => t.subject)).toEqual([
      '英語',
      '数学',
      '国語',
      '社会',
    ]);
  });

  it('並び順表に無い教科は末尾に回す', () => {
    const list = [tb(1, { subject: 'プログラミング' }), tb(2, { subject: '英語' })];
    expect(filterAndSortTextbooks(list, {}, none).map((t) => t.id)).toEqual([2, 1]);
  });

  it('同じ教科なら学年順、同じ学年なら名前順', () => {
    const list = [
      tb(1, { subject: '数学', grade: '2年', name: 'あ' }),
      tb(2, { subject: '数学', grade: '1年', name: 'う' }),
      tb(3, { subject: '数学', grade: '1年', name: 'い' }),
    ];
    expect(filterAndSortTextbooks(list, {}, none).map((t) => t.id)).toEqual([3, 2, 1]);
  });
});

describe('textbookFilterOptions', () => {
  it('重複を除いて昇順で返す', () => {
    const list = [
      tb(1, { school_type: '中学', subject: '数学' }),
      tb(2, { school_type: '中学', subject: '国語' }),
      tb(3, { school_type: '高校', subject: '数学' }),
    ];
    const opts = textbookFilterOptions(list);
    expect(opts.schoolTypes).toEqual(['中学', '高校']);
    expect(opts.subjects).toEqual(['国語', '数学']);
  });

  it('学年は選択中の学校種別に連動する', () => {
    const list = [
      tb(1, { school_type: '中学', grade: '1年' }),
      tb(2, { school_type: '高校', grade: '3年' }),
    ];
    expect(textbookFilterOptions(list, '中学').grades).toEqual(['1年']);
    // 未選択なら全部
    expect(textbookFilterOptions(list).grades).toEqual(['1年', '3年']);
  });

  it('null や空文字は選択肢に出さない', () => {
    const list = [tb(1, { subject: null }), tb(2, { subject: '' }), tb(3, { subject: '英語' })];
    expect(textbookFilterOptions(list).subjects).toEqual(['英語']);
  });
});
