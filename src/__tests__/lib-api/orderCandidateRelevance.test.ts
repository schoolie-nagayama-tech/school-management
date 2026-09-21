/**
 * 発注ダイアログを出すかどうかの判定（isRelevantOrderCandidate）のテスト。
 *
 * ★ここを固定しておく理由: 判定式は以前、提案書の公開経路3箇所に同じものが書かれていた。
 *   条件を足したときに片方だけ直すと「器のテキストなのに発注ダイアログが出る」のような
 *   画面ごとの食い違いが静かに生まれる。
 */
import { describe, it, expect } from 'vitest';
import { isRelevantOrderCandidate, type OrderCandidate } from '@/lib/api/ordering';

const candidate = (over: Partial<OrderCandidate> = {}): OrderCandidate => ({
  proposalId: 'p1',
  studentId: 's1',
  studentName: '生徒A',
  schoolId: null,
  textbookId: 1,
  textbookName: 'テキスト',
  materialId: 'm1',
  materialName: 'テキスト | 3年 | 英語',
  alreadyOwned: false,
  hasOrder: false,
  isOrderable: true,
  needsOrder: true,
  ...over,
});

describe('isRelevantOrderCandidate', () => {
  it('発注対象ならダイアログに出す', () => {
    expect(isRelevantOrderCandidate(candidate())).toBe(true);
  });

  it('未所持で発注教材が紐付いていないものは、手で発注してもらうために出す', () => {
    expect(isRelevantOrderCandidate(candidate({ needsOrder: false, materialId: null }))).toBe(true);
  });

  it('所持済みで発注済みなら出さない', () => {
    expect(
      isRelevantOrderCandidate(candidate({ needsOrder: false, alreadyOwned: true, hasOrder: true }))
    ).toBe(false);
  });

  // ★器のテキスト（志望校過去問・大学受験の回数だけの器）は material_id が未設定なので、
  //   needsOrder を false にするだけでは「未所持 & 未紐付け」の条件で拾われてしまう。
  it('発注できないテキストは、未所持で未紐付けでも出さない', () => {
    expect(
      isRelevantOrderCandidate(
        candidate({ isOrderable: false, needsOrder: false, materialId: null })
      )
    ).toBe(false);
  });
});
