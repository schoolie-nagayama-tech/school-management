import { describe, it, expect } from 'vitest';
import {
  enrolledDuringPeriodFilter,
  patternOverlapsPeriodFilter,
} from '@/lib/server/coursePrepBatch';

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

/**
 * 通塾パターンを「その期に有効だったか」で絞る条件。
 *
 * ここが崩れると、通塾パターンをいじるたびに過去の期の通常回数が動き、
 * 増コマ（＝提案コマ−通常回数）が水増し／過少になる元の不具合に戻る。
 */
describe('patternOverlapsPeriodFilter', () => {
  it('期間が揃っていれば、重なり判定の条件を返す', () => {
    expect(patternOverlapsPeriodFilter('2026-12-22', '2027-01-07')).toEqual({
      from: '2027-01-07',
      orUntil: 'effective_until.is.null,effective_until.gte.2026-12-22',
    });
  });

  it('期間日付が無い期は判定できないので null（呼び出し側が is_active に倒す）', () => {
    expect(patternOverlapsPeriodFilter(null, '2027-01-07')).toBeNull();
    expect(patternOverlapsPeriodFilter('2026-12-22', null)).toBeNull();
    expect(patternOverlapsPeriodFilter(null, null)).toBeNull();
  });

  it('書式が壊れた日付は or 句を組み立てず null に倒す', () => {
    // カンマや括弧が混じると PostgREST の or 句の構文ごと崩れる
    for (const bad of ['2026/12/22', '2026-12-22,x', 'yesterday']) {
      expect(patternOverlapsPeriodFilter(bad, '2027-01-07')).toBeNull();
      expect(patternOverlapsPeriodFilter('2026-12-22', bad)).toBeNull();
    }
  });
});
