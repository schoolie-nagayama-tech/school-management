/**
 * 通塾日程の一覧表（期間バー）の純ロジックのテスト。
 *
 * ★ なぜ要るか:
 *  - 年度が **3月始まり**（塾の年度。4月始まりではない）であることは目視では確かめられない。
 *    2月と3月の境界を取り違えると、全部の行が1年ズレた列に描かれる。
 *  - 期間バーは年度をまたぐとクランプされる。左右どちらで切れたかは ◀▶ の示唆に使うので、
 *    「切れたのに切れていないことにする」と前後の年度に続きがあることが読めなくなる。
 *  - 終了した授業は直近1年ぶんだけ出す運用上の決定。境界日（ちょうど1年前）は目視で確認しづらい。
 */
import { describe, it, expect } from 'vitest';
import {
  getAcademicYear,
  academicYearRange,
  academicYearMonths,
  barGeometry,
  filterPlanRows,
  groupIntoChains,
  oneYearBefore,
} from '@/lib/schedule/lessonPlanTable';

describe('getAcademicYear', () => {
  it('3月1日はその年の年度の始まり', () => {
    expect(getAcademicYear('2026-03-01')).toBe(2026);
  });

  it('2月28日は前の年度（3月始まりなので年度末は2月）', () => {
    expect(getAcademicYear('2026-02-28')).toBe(2025);
  });

  it('閏年の2月29日も前の年度', () => {
    expect(getAcademicYear('2028-02-29')).toBe(2027);
  });

  it('4月始まりではない（3月は当年度であって前年度ではない）', () => {
    expect(getAcademicYear('2026-03-31')).toBe(2026);
    expect(getAcademicYear('2026-04-01')).toBe(2026);
  });

  it('12月は年をまたぐ前なので同じ年度', () => {
    expect(getAcademicYear('2026-12-31')).toBe(2026);
    expect(getAcademicYear('2027-01-01')).toBe(2026);
  });
});

describe('academicYearRange', () => {
  it('2026年度は 2026-03-01 〜 2027-02-28', () => {
    expect(academicYearRange(2026)).toEqual({ start: '2026-03-01', end: '2027-02-28' });
  });

  it('年度末が閏年の2月なら2/29まで', () => {
    expect(academicYearRange(2027)).toEqual({ start: '2027-03-01', end: '2028-02-29' });
  });
});

describe('academicYearMonths', () => {
  it('3月始まりの12ヶ月を返す', () => {
    const months = academicYearMonths(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-03');
    expect(months[9]).toBe('2026-12');
    expect(months[10]).toBe('2027-01');
    expect(months[11]).toBe('2027-02');
  });
});

describe('barGeometry', () => {
  it('年度いっぱいの無期限バーは左0%・幅100%で右が切れる', () => {
    const bar = barGeometry({ effectiveFrom: '2026-03-01', effectiveUntil: null, year: 2026 });
    expect(bar).not.toBeNull();
    expect(bar!.leftPct).toBe(0);
    expect(bar!.widthPct).toBe(100);
    expect(bar!.clippedLeft).toBe(false);
    expect(bar!.clippedRight).toBe(true);
  });

  it('月の境目は列の境目に一致する（9月始まりは7列目＝50%）', () => {
    // 3月始まりなので 9月 は index 6。6/12 = 50%
    const bar = barGeometry({ effectiveFrom: '2026-09-01', effectiveUntil: null, year: 2026 });
    expect(bar!.leftPct).toBeCloseTo(50, 6);
  });

  it('終了日はその日も有効なので、翌日から始まる次の版と隙間なくつながる', () => {
    const ended = barGeometry({
      effectiveFrom: '2026-03-01',
      effectiveUntil: '2026-08-31',
      year: 2026,
    });
    const next = barGeometry({ effectiveFrom: '2026-09-01', effectiveUntil: null, year: 2026 });
    expect(ended!.leftPct + ended!.widthPct).toBeCloseTo(next!.leftPct, 6);
  });

  it('前の年度から続く行は左でクランプされ clippedLeft が立つ', () => {
    const bar = barGeometry({
      effectiveFrom: '2025-06-01',
      effectiveUntil: '2026-08-31',
      year: 2026,
    });
    expect(bar!.leftPct).toBe(0);
    expect(bar!.clippedLeft).toBe(true);
    expect(bar!.clippedRight).toBe(false);
  });

  it('次の年度まで続く行は右でクランプされ clippedRight が立つ', () => {
    const bar = barGeometry({
      effectiveFrom: '2026-09-01',
      effectiveUntil: '2027-08-31',
      year: 2026,
    });
    expect(bar!.leftPct + bar!.widthPct).toBeCloseTo(100, 6);
    expect(bar!.clippedRight).toBe(true);
  });

  it('年度の前後に完全に外れる行は null（その年度には出さない）', () => {
    // 2025年度で終わった行を2026年度で見る
    expect(
      barGeometry({ effectiveFrom: '2025-04-01', effectiveUntil: '2026-02-28', year: 2026 })
    ).toBeNull();
    // 2027年度から始まる行を2026年度で見る
    expect(
      barGeometry({ effectiveFrom: '2027-03-01', effectiveUntil: null, year: 2026 })
    ).toBeNull();
  });

  it('年度の境界日はその年度に含める', () => {
    expect(
      barGeometry({ effectiveFrom: '2025-04-01', effectiveUntil: '2026-03-01', year: 2026 })
    ).not.toBeNull();
    expect(
      barGeometry({ effectiveFrom: '2027-02-28', effectiveUntil: null, year: 2026 })
    ).not.toBeNull();
  });

  it('終了日が開始日より前の壊れた行でも幅を負にしない', () => {
    const bar = barGeometry({
      effectiveFrom: '2026-09-01',
      effectiveUntil: '2026-08-01',
      year: 2026,
    });
    expect(bar!.widthPct).toBe(0);
  });
});

describe('oneYearBefore', () => {
  it('1年前の同じ日を返す', () => {
    expect(oneYearBefore('2026-08-28')).toBe('2025-08-28');
  });

  it('閏日の1年前は存在しないので月末に丸める', () => {
    expect(oneYearBefore('2028-02-29')).toBe('2027-02-28');
  });
});

describe('filterPlanRows', () => {
  const today = '2026-08-28';
  const current = { id: 'current', effective_from: '2026-04-01', effective_until: null };
  const upcoming = { id: 'upcoming', effective_from: '2026-10-01', effective_until: null };
  const endedRecent = { id: 'recent', effective_from: '2025-04-01', effective_until: '2026-03-31' };
  const endedBoundary = {
    id: 'boundary',
    effective_from: '2024-04-01',
    effective_until: '2025-08-28',
  };
  const endedOld = { id: 'old', effective_from: '2024-04-01', effective_until: '2025-08-27' };
  const rows = [current, upcoming, endedRecent, endedBoundary, endedOld];

  it('既定（showEnded=false）は終了した行を出さない', () => {
    expect(filterPlanRows(rows, today, { showEnded: false }).map((r) => r.id)).toEqual([
      'current',
      'upcoming',
    ]);
  });

  it('showEnded=true でも直近1年より古い終了行は出さない', () => {
    expect(filterPlanRows(rows, today, { showEnded: true }).map((r) => r.id)).toEqual([
      'current',
      'upcoming',
      'recent',
      'boundary',
    ]);
  });

  it('ちょうど1年前に終了した行は残す（境界日を含む）', () => {
    expect(filterPlanRows([endedBoundary], today, { showEnded: true }).map((r) => r.id)).toEqual([
      'boundary',
    ]);
    expect(filterPlanRows([endedOld], today, { showEnded: true })).toEqual([]);
  });
});

describe('groupIntoChains', () => {
  it('同じキーの行を鎖にまとめ、最初に現れた順で返す', () => {
    const rows = [
      { id: 'a', key: '3-x' },
      { id: 'b', key: '1-y' },
      { id: 'c', key: '3-x' },
    ];
    const chains = groupIntoChains(rows, (r) => r.key);
    expect(chains.map((chain) => chain.map((r) => r.id))).toEqual([['a', 'c'], ['b']]);
  });

  it('鎖の中の並びは渡された順のまま', () => {
    const rows = [
      { id: 'old', key: 'k' },
      { id: 'new', key: 'k' },
    ];
    expect(groupIntoChains(rows, (r) => r.key)[0].map((r) => r.id)).toEqual(['old', 'new']);
  });
});
