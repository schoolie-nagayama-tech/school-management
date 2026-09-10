/**
 * 保護者向け「お知らせの体裁」下書きのテスト。
 *
 * ★守りたいのは3点:
 *  - 長さを超えた項目・題名・本文は捨てること（compose.ts の「長すぎるブロックは採らない」と同じ考え）
 *  - items の上限が効くこと
 *  - filled（補ったところの申告）の種類が compose.ts の5種類から外れないこと
 *    （parseFilledNotes を import して使っているか＝二重定義していないかの確認でもある）
 */
import { describe, expect, it } from 'vitest';
import { FILLED_KINDS } from '@/lib/ai/compose';
import {
  composeNoticeSystemPrompt,
  MAX_ITEMS,
  MAX_TITLE_LENGTH,
  noticeToBlocks,
  parseNoticeResult,
} from '@/lib/ai/composeNotice';

describe('parseNoticeResult', () => {
  it('title・lead・items・note・closing を読み取る', () => {
    const got = parseNoticeResult({
      title: '9月のお休みのお知らせ',
      lead: '来月の休校日をお知らせします。',
      items: ['9月23日（水・祝）', '9月30日（水）は台風接近のため休校'],
      note: '通常授業は翌週に振替します。',
      closing: 'ご不明な点は教室までご連絡ください。',
      filled: [{ what: '通常授業は翌週に振替します', kind: '段取り' }],
    });
    expect(got.notice).toEqual({
      title: '9月のお休みのお知らせ',
      lead: '来月の休校日をお知らせします。',
      items: ['9月23日（水・祝）', '9月30日（水）は台風接近のため休校'],
      note: '通常授業は翌週に振替します。',
      closing: 'ご不明な点は教室までご連絡ください。',
    });
    expect(got.filled).toEqual([{ what: '通常授業は翌週に振替します', kind: '段取り' }]);
  });

  it('note・closing・items が無くても title と lead があれば成立する', () => {
    const got = parseNoticeResult({ title: 'お知らせ', lead: '用件です。' });
    expect(got.notice).toEqual({
      title: 'お知らせ',
      lead: '用件です。',
      items: [],
      note: '',
      closing: '',
    });
  });

  it('★読めない出力・title か lead が無い出力は空を返す（本文を書き換えさせない）', () => {
    for (const raw of [null, 'こんにちは', {}, { title: 'お知らせだけ' }, { lead: '本文だけ' }]) {
      const got = parseNoticeResult(raw);
      expect(got.notice).toEqual({ title: '', lead: '', items: [], note: '', closing: '' });
      expect(got.filled).toEqual([]);
    }
  });

  it('★長すぎる title は捨てる（成立しなくなる）', () => {
    const got = parseNoticeResult({ title: 'あ'.repeat(MAX_TITLE_LENGTH + 1), lead: '用件です。' });
    expect(got.notice.title).toBe('');
  });

  it('★長すぎる item は、その項目だけ捨てる（他は残る）', () => {
    const got = parseNoticeResult({
      title: 'お知らせ',
      lead: '用件です。',
      items: ['短い項目', 'あ'.repeat(200)],
    });
    expect(got.notice.items).toEqual(['短い項目']);
  });

  it('items の数に上限がある', () => {
    const many = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => `項目${i}`);
    const got = parseNoticeResult({ title: 'お知らせ', lead: '用件です。', items: many });
    expect(got.notice.items).toHaveLength(MAX_ITEMS);
  });

  it('★filled は決めた5種類から外れたら捨てる（compose.ts の規則を使い回している）', () => {
    const got = parseNoticeResult({
      title: 'お知らせ',
      lead: '用件です。',
      filled: [
        { what: '9月末まで', kind: '期限' },
        { what: 'なにか', kind: '雰囲気' },
      ],
    });
    expect(got.filled).toEqual([{ what: '9月末まで', kind: '期限' }]);
  });
});

describe('noticeToBlocks', () => {
  it('title→見出し、lead→段落、items→「・」付き段落、note→段落、closing→段落の順で並べる', () => {
    const blocks = noticeToBlocks({
      title: 'お知らせ',
      lead: '用件です。',
      items: ['持ち物A', '持ち物B'],
      note: '補足です。',
      closing: '結びです。',
    });
    expect(blocks).toEqual([
      { heading: true, text: 'お知らせ' },
      { heading: false, text: '用件です。' },
      { heading: false, text: '・持ち物A' },
      { heading: false, text: '・持ち物B' },
      { heading: false, text: '補足です。' },
      { heading: false, text: '結びです。' },
    ]);
  });

  it('items・note・closing が空なら、その分のブロックを作らない', () => {
    const blocks = noticeToBlocks({
      title: 'お知らせ',
      lead: '用件です。',
      items: [],
      note: '',
      closing: '',
    });
    expect(blocks).toEqual([
      { heading: true, text: 'お知らせ' },
      { heading: false, text: '用件です。' },
    ]);
  });
});

describe('composeNoticeSystemPrompt', () => {
  it('★宛名と日付を書かせないという約束を含む', () => {
    const p = composeNoticeSystemPrompt();
    expect(p).toContain('宛名');
    expect(p).toContain('日付');
  });

  it('★空欄で逃げないという約束を含む（compose.ts と同じ考え方）', () => {
    const p = composeNoticeSystemPrompt();
    expect(p).toContain('空欄');
    expect(p).toContain('書き切');
  });

  it('★教室の中でしか通じない固有の情報は書かせない', () => {
    const p = composeNoticeSystemPrompt();
    expect(p).toContain('棚番号');
  });

  it('★補ったものを申告させる。決めた5種類がすべて含まれる', () => {
    const p = composeNoticeSystemPrompt();
    expect(p).toContain('filled');
    for (const kind of FILLED_KINDS) expect(p).toContain(kind);
  });
});
