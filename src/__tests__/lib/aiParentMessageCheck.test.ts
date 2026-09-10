/**
 * 「保護者との連絡」の送る前の事実チェックのテスト。
 *
 * ★守りたいのは3点:
 *  - 曜日の食い違いを、カレンダーで計算して必ず赤にすること（来塾日の行き違いに直結する）
 *  - メモとやりとりにある表記は、書き方が違っても「確かめられた」にすること（誤報が多いと見なくなる）
 *  - メモの行が本文から落ちたら分かること
 */
import { describe, expect, it } from 'vitest';
import {
  checkParentMessageFacts,
  inferYear,
  normalizeForCheck,
  splitPoints,
} from '@/lib/ai/parentMessageCheck';

// 2026-09-10 は木曜日
const TODAY = new Date(2026, 8, 10);

const check = (body: string, points: string, threadTexts: string[] = []) =>
  checkParentMessageFacts({ body, points, threadTexts, today: TODAY });

describe('checkParentMessageFacts: 日付と曜日', () => {
  it('★曜日が違えば、本当の曜日つきで食い違いにする', () => {
    const r = check('9月17日（水）の授業で対策します。', '・9/17の授業で対策');
    expect(r.items).toContainEqual({
      level: 'mismatch',
      label: '9月17日（水）',
      detail: '9月17日は木曜日です',
    });
  });

  it('月を省いた2つ目の日付は、直前の月を引き継いで確かめる', () => {
    const r = check('9月15日（火）と17日（木）の授業で対策します。', '・9/15と9/17で対策');
    expect(r.items.filter((i) => i.level !== 'ok')).toEqual([]);
    expect(r.items.map((i) => i.label)).toEqual(['9月15日（火）', '9月17日（木）']);
  });

  it('メモにもやりとりにも無い日付は「無い」にする', () => {
    const r = check('9月20日に面談をお願いします。', '・面談を提案');
    expect(r.items).toContainEqual({
      level: 'missing',
      label: '9月20日',
      detail: 'メモにもやりとりにもありません',
    });
  });

  it('保護者が書いた日付（やりとり側）にあれば確かめられたにする', () => {
    const r = check('9月12日の件、承知しました。', '・承知した', ['9月12日（土）はお休みします']);
    expect(r.items).toEqual([{ level: 'ok', label: '9月12日' }]);
  });

  it('★カレンダーに無い日付は食い違いにする', () => {
    const r = check('2月30日に振替します。', '・2/30に振替');
    expect(r.items[0].level).toBe('mismatch');
  });

  it('年をまたぐ日付は今日に近い年で曜日を見る（12月に書く1月5日は翌年）', () => {
    // 2027-01-05 は火曜日
    const r = checkParentMessageFacts({
      body: '1月5日（火）から再開します。',
      points: '・1/5から再開',
      threadTexts: [],
      today: new Date(2026, 11, 20),
    });
    expect(r.items).toEqual([{ level: 'ok', label: '1月5日（火）' }]);
  });
});

describe('checkParentMessageFacts: 時刻・金額・数・講師名', () => {
  it('時刻は書き方を揃えて比べる（18:00 と 18時）', () => {
    const r = check('18時からお待ちしております。', '・待っている', [
      '水曜18:00からでお願いします',
    ]);
    expect(r.items).toEqual([{ level: 'ok', label: '18時' }]);
  });

  it('メモに無い時刻・金額は「無い」にする', () => {
    const r = check('17時30分から、費用は4,400円です。', '・時間と費用を伝える');
    expect(r.items.map((i) => [i.label, i.level])).toEqual([
      ['17時30分', 'missing'],
      ['4,400円', 'missing'],
    ]);
  });

  it('金額はカンマの有無をそろえて比べる', () => {
    const r = check('費用は4,400円です。', '・4400円');
    expect(r.items).toEqual([{ level: 'ok', label: '4,400円' }]);
  });

  it('ページの範囲は両端の数字がメモにあれば確かめられたにする', () => {
    const r = check('教科書48〜72ページを対策します。', '・範囲p.48〜72');
    expect(r.items).toEqual([{ level: 'ok', label: '48~72ページ' }]);
  });

  it('★講師名が入っていたら食い違いにする。学校の先生は拾わない', () => {
    const r = check('田中先生から学校の先生にも伝えます。', '・伝える');
    expect(r.items).toEqual([
      { level: 'mismatch', label: '田中先生', detail: '保護者向けの文には講師名を出しません' },
    ]);
  });

  it('全角の数字でも同じに扱う', () => {
    const r = check('９月１５日（火）に対策します。', '・9/15に対策');
    expect(r.items).toEqual([{ level: 'ok', label: '9月15日（火）' }]);
  });
});

describe('checkParentMessageFacts: 箇条書きの行が入ったか', () => {
  it('入った行と、落ちた行を分ける', () => {
    const r = check(
      'テスト範囲は9月15日の授業で対策します。',
      '・9/15に範囲を対策\n・宿題の量を減らす'
    );
    expect(r.coverage).toEqual([
      { line: '9/15に範囲を対策', included: true },
      { line: '宿題の量を減らす', included: false },
    ]);
  });
});

describe('補助関数', () => {
  it('splitPoints は記号を外して空行を捨てる', () => {
    expect(splitPoints('・一つ目\n\n- 二つ目\n  ●三つ目')).toEqual(['一つ目', '二つ目', '三つ目']);
  });

  it('normalizeForCheck は全角数字・括弧・波ダッシュを揃える', () => {
    expect(normalizeForCheck('１２（火）〜')).toBe('12(火)~');
  });

  it('inferYear は今日に近い年を返す', () => {
    expect(inferYear(1, 5, new Date(2026, 11, 20))).toBe(2027);
    expect(inferYear(12, 20, new Date(2027, 0, 5))).toBe(2026);
    expect(inferYear(9, 17, TODAY)).toBe(2026);
  });
});
