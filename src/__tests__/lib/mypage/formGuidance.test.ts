/**
 * 手続きハブの判定ロジック（純関数）テスト。
 * 正典: docs/portal-v2-requirements.md §7-3「申し込みプッシュ」。
 *
 * 固定する仕様:
 *   - 公開期間の境界（開始前/開始ちょうど/終了ちょうど/終了後/無効/アーカイブ）
 *   - 対象学年の判定（指定なし=全員 / 学年不明=安全側で対象外 / 表記ゆれ）
 *   - 未申込判定のキー
 */
import { describe, it, expect, vi } from 'vitest';

// formGuidance.ts は 'server-only' を import するため、node のテスト環境では空モジュールに差し替える。
vi.mock('server-only', () => ({}));

import {
  periodStatus,
  matchesGrade,
  hasApplied,
  appliedKey,
  formatShortDate,
  buildFormHref,
  type PeriodRow,
} from '@/lib/mypage/formGuidance';

/** テスト用の form_periods 行を作る。 */
function mkPeriod(over: Partial<PeriodRow> = {}): PeriodRow {
  return {
    id: 'p1',
    school_id: 'sc1',
    form_type: 'moshi',
    period_key: '2026-08',
    title: '8月度 模試',
    settings: {},
    publish_start: null,
    publish_end: null,
    is_active: true,
    is_archived: false,
    ...over,
  };
}

const NOW = new Date('2026-07-15T00:00:00Z');

describe('periodStatus: 期間の公開状態', () => {
  it('公開期間の指定が無ければ open', () => {
    expect(periodStatus(mkPeriod(), NOW)).toBe('open');
  });

  it('is_active=false は inactive（他の条件に優先）', () => {
    expect(periodStatus(mkPeriod({ is_active: false }), NOW)).toBe('inactive');
  });

  it('is_archived=true は inactive', () => {
    expect(periodStatus(mkPeriod({ is_archived: true }), NOW)).toBe('inactive');
  });

  it('publish_start が未来なら upcoming（保護者にはまだ見せない）', () => {
    expect(periodStatus(mkPeriod({ publish_start: '2026-07-20T00:00:00Z' }), NOW)).toBe('upcoming');
  });

  it('publish_start ちょうどは open', () => {
    expect(periodStatus(mkPeriod({ publish_start: '2026-07-15T00:00:00Z' }), NOW)).toBe('open');
  });

  it('publish_end が過去なら ended', () => {
    expect(periodStatus(mkPeriod({ publish_end: '2026-07-14T23:59:59Z' }), NOW)).toBe('ended');
  });

  it('publish_end ちょうどは open（その時刻まで受付）', () => {
    expect(periodStatus(mkPeriod({ publish_end: '2026-07-15T00:00:00Z' }), NOW)).toBe('open');
  });

  it('公開期間内は open', () => {
    expect(
      periodStatus(
        mkPeriod({ publish_start: '2026-07-01T00:00:00Z', publish_end: '2026-07-31T00:00:00Z' }),
        NOW
      )
    ).toBe('open');
  });
});

describe('matchesGrade: 模試の対象学年', () => {
  it('grades 未指定なら全員対象', () => {
    expect(matchesGrade(undefined, 8)).toBe(true);
    expect(matchesGrade([], 8)).toBe(true);
    expect(matchesGrade(null, 8)).toBe(true);
  });

  it('対象学年に含まれれば true（中2 = 8）', () => {
    expect(matchesGrade(['中2', '中3'], 8)).toBe(true);
  });

  it('対象学年に含まれなければ false（小6 = 6）', () => {
    expect(matchesGrade(['中2', '中3'], 6)).toBe(false);
  });

  it('小学生の学年名も写像できる（小4 = 4）', () => {
    expect(matchesGrade(['小4', '小5'], 4)).toBe(true);
    expect(matchesGrade(['小4', '小5'], 9)).toBe(false);
  });

  it('★ 学年指定があるのに生徒の学年が不明なら false（誤案内しない安全側）', () => {
    expect(matchesGrade(['中3'], null)).toBe(false);
  });

  it('学年未設定でも指定が無ければ対象（全員向け）', () => {
    expect(matchesGrade(undefined, null)).toBe(true);
  });

  it('認識できない学年名しか無い場合は実質フィルタなし＝全員対象', () => {
    expect(matchesGrade(['謎学年'], 8)).toBe(true);
  });

  it('認識できる名前と混在するときは、認識できたものだけで判定する', () => {
    expect(matchesGrade(['謎学年', '中3'], 9)).toBe(true);
    expect(matchesGrade(['謎学年', '中3'], 8)).toBe(false);
  });

  it('配列でない値は指定なし扱い', () => {
    expect(matchesGrade('中3', 9)).toBe(true);
  });
});

describe('hasApplied / appliedKey: 未申込判定', () => {
  it('form_type × period_key で一致を見る', () => {
    const applied = new Set([appliedKey('zoukoma', '2026-07')]);
    expect(hasApplied(applied, 'zoukoma', '2026-07')).toBe(true);
    expect(hasApplied(applied, 'zoukoma', '2026-08')).toBe(false);
    // 種別が違えば別物（period_key が同じでも申込済みにしない）。
    expect(hasApplied(applied, 'moshi', '2026-07')).toBe(false);
  });

  it('空集合なら常に未申込', () => {
    expect(hasApplied(new Set(), 'moshi', '2026-08')).toBe(false);
  });
});

describe('formatShortDate: 理由文の日付', () => {
  it('ISO文字列から M/D を作る', () => {
    expect(formatShortDate('2026-07-10T09:00:00Z')).toBe('7/10');
    expect(formatShortDate('2026-07-01')).toBe('7/1');
  });

  it('null/不正は空文字', () => {
    expect(formatShortDate(null)).toBe('');
    expect(formatShortDate('bad')).toBe('');
  });
});

describe('buildFormHref: v1 フォームURL', () => {
  it('schoolCode と formType から v1 の公開URLを作る', () => {
    expect(buildFormHref('NAGAYAMA', 'zoukoma')).toBe('/portal/NAGAYAMA/zoukoma');
  });

  it('schoolCode はエスケープする', () => {
    expect(buildFormHref('a b', 'moshi')).toBe('/portal/a%20b/moshi');
  });
});
