import { describe, it, expect } from 'vitest';
import { enrolledDuringPeriodFilter } from '@/lib/server/coursePrepBatch';

/**
 * 「この講習期間中に在籍していた生徒」の絞り込み条件。
 *
 * ここが崩れると、8月末退塾の生徒が9月に入った瞬間に夏期の実績から消える
 * （＝退塾cronが status を withdrawn に変えた翌日に、コマ数が実績から抜ける）という
 * 元の不具合に戻る。文字列がそのまま PostgREST の or 句になるため、書式ごと固定しておく。
 */
describe('enrolledDuringPeriodFilter', () => {
  it('期間開始日があれば、未退塾 または 退塾日が開始日以降 を残す', () => {
    expect(enrolledDuringPeriodFilter('2026-07-21')).toBe(
      'status.neq.withdrawn,withdrawal_date.gte.2026-07-21'
    );
  });

  it('期間未設定なら在籍の根拠が無いので、従来どおり退塾者を除外する', () => {
    expect(enrolledDuringPeriodFilter(null)).toBe('status.neq.withdrawn');
    expect(enrolledDuringPeriodFilter(undefined)).toBe('status.neq.withdrawn');
    expect(enrolledDuringPeriodFilter('')).toBe('status.neq.withdrawn');
  });

  it('日付書式が壊れていたら or 句を組み立てず、期間未設定として扱う', () => {
    // カンマや括弧が混じると or 句の構文ごと崩れるため、YYYY-MM-DD 以外は採用しない
    for (const bad of ['2026/07/21', '2026-7-21', 'yesterday', '2026-07-21,x', '2026-07-21)']) {
      expect(enrolledDuringPeriodFilter(bad)).toBe('status.neq.withdrawn');
    }
  });
});
