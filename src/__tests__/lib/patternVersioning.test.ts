/**
 * 通塾日程の版管理・履歴状態判定のテスト。
 *
 * ★ なぜ要るか: 「変更日を入れたら版が切れる／切れない」を間違えると、過去月の請求が
 *   さかのぼって変わったり、まだ始まっていない行が無駄に分割されて履歴が読めなくなる。
 *   境界日（変更日＝開始日、終了日＝今日）は目視では確認しづらいのでここで固定する。
 */
import { describe, it, expect } from 'vitest';
import {
  resolvePatternSaveMode,
  getPatternPeriodStatus,
  formatDateSlash,
  formatPatternPeriod,
  formatUpcomingBadge,
  formatUpcomingCellBadge,
} from '@/lib/schedule/patternVersioning';

describe('resolvePatternSaveMode', () => {
  it('変更日が現在の開始日より後なら版を切る', () => {
    expect(
      resolvePatternSaveMode({ patternEffectiveFrom: '2026-04-01', applyDate: '2026-10-01' })
    ).toBe('version');
  });

  it('変更日が開始日と同じ日なら上書き（境界日は分割しない）', () => {
    expect(
      resolvePatternSaveMode({ patternEffectiveFrom: '2026-04-01', applyDate: '2026-04-01' })
    ).toBe('overwrite');
  });

  it('変更日が開始日より前なら上書き（まだ始まっていない行を無駄に分割しない）', () => {
    expect(
      resolvePatternSaveMode({ patternEffectiveFrom: '2026-10-01', applyDate: '2026-09-01' })
    ).toBe('overwrite');
  });

  it('講座のパターンは常に上書き（版を切ると講座との紐づきが消えるため）', () => {
    expect(
      resolvePatternSaveMode({
        patternEffectiveFrom: '2026-04-01',
        applyDate: '2026-10-01',
        isCourse: true,
      })
    ).toBe('overwrite');
  });

  it('日付が欠けている壊れたデータは上書きに倒す', () => {
    expect(resolvePatternSaveMode({ patternEffectiveFrom: null, applyDate: '2026-10-01' })).toBe(
      'overwrite'
    );
    expect(resolvePatternSaveMode({ patternEffectiveFrom: '2026-04-01', applyDate: '' })).toBe(
      'overwrite'
    );
  });
});

describe('getPatternPeriodStatus', () => {
  const today = '2026-08-27';

  it('終了日が今日より前なら終了', () => {
    expect(
      getPatternPeriodStatus({ effective_from: '2026-04-01', effective_until: '2026-08-26' }, today)
    ).toBe('ended');
  });

  it('終了日が今日ちょうどならまだ現在（境界日は有効）', () => {
    expect(
      getPatternPeriodStatus({ effective_from: '2026-04-01', effective_until: '2026-08-27' }, today)
    ).toBe('current');
  });

  it('開始日が今日ちょうどなら現在（境界日は有効）', () => {
    expect(
      getPatternPeriodStatus({ effective_from: '2026-08-27', effective_until: null }, today)
    ).toBe('current');
  });

  it('開始日が今日より後なら開始前', () => {
    expect(
      getPatternPeriodStatus({ effective_from: '2026-10-01', effective_until: null }, today)
    ).toBe('upcoming');
  });

  it('終了日が無期限（null）なら開始済みは現在', () => {
    expect(
      getPatternPeriodStatus({ effective_from: '2020-04-01', effective_until: null }, today)
    ).toBe('current');
  });

  it('終了日が開始日より前の壊れた行は「開始前」ではなく「終了」に倒す', () => {
    expect(
      getPatternPeriodStatus({ effective_from: '2026-10-01', effective_until: '2026-07-31' }, today)
    ).toBe('ended');
  });

  it('開始日が欠けていても落ちない（現在扱い）', () => {
    expect(getPatternPeriodStatus({ effective_from: null, effective_until: null }, today)).toBe(
      'current'
    );
  });
});

describe('期間・バッジの表示', () => {
  it('ゼロ埋めを外したスラッシュ表記にする', () => {
    expect(formatDateSlash('2026-04-01')).toBe('2026/4/1');
    expect(formatDateSlash(null)).toBe('');
  });

  it('終了日があれば範囲、無ければ開始日のみ', () => {
    expect(
      formatPatternPeriod({ effective_from: '2026-04-01', effective_until: '2026-09-30' })
    ).toBe('2026/4/1 〜 2026/9/30');
    expect(formatPatternPeriod({ effective_from: '2026-10-01', effective_until: null })).toBe(
      '2026/10/1 〜'
    );
  });

  it('開始前バッジは月日だけ出す', () => {
    expect(formatUpcomingBadge('2026-10-01')).toBe('10/1から');
    expect(formatUpcomingCellBadge('2026-10-01')).toBe('10/1〜');
    expect(formatUpcomingBadge(null)).toBe('開始前');
  });
});
