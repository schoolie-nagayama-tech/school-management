import { isPeriodActive, getPeriodStatus } from '@/lib/utils/period';
import type { FormPeriod } from '@/types/database';

function createPeriod(overrides: Partial<FormPeriod> = {}): FormPeriod {
  return {
    id: 'test-id',
    school_id: 'school-1',
    form_type: 'moshi' as FormPeriod['form_type'],
    period_key: '2026-04',
    title: 'テスト期間',
    settings: {},
    publish_start: null,
    publish_end: null,
    is_active: true,
    linked_application_item_id: null,
    is_archived: false,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('isPeriodActive', () => {
  it('アーカイブ済みは非公開', () => {
    const period = createPeriod({ is_archived: true, publish_start: '2020-01-01' });
    expect(isPeriodActive(period)).toBe(false);
  });

  it('開始日未設定は非公開', () => {
    const period = createPeriod({ publish_start: null });
    expect(isPeriodActive(period)).toBe(false);
  });

  it('開始前は非公開', () => {
    const period = createPeriod({ publish_start: '2099-01-01T00:00:00Z' });
    expect(isPeriodActive(period)).toBe(false);
  });

  it('終了日なしで開始後は公開', () => {
    const period = createPeriod({ publish_start: '2020-01-01T00:00:00Z', publish_end: null });
    expect(isPeriodActive(period)).toBe(true);
  });

  it('期間内は公開', () => {
    const period = createPeriod({
      publish_start: '2020-01-01T00:00:00Z',
      publish_end: '2099-12-31T23:59:59Z',
    });
    expect(isPeriodActive(period)).toBe(true);
  });

  it('終了後は非公開', () => {
    const period = createPeriod({
      publish_start: '2020-01-01T00:00:00Z',
      publish_end: '2020-12-31T23:59:59Z',
    });
    expect(isPeriodActive(period)).toBe(false);
  });
});

describe('getPeriodStatus', () => {
  it('アーカイブ済みのラベル', () => {
    const result = getPeriodStatus(createPeriod({ is_archived: true }));
    expect(result.label).toBe('アーカイブ');
  });

  it('未設定のラベル', () => {
    const result = getPeriodStatus(createPeriod({ publish_start: null }));
    expect(result.label).toBe('未設定');
  });

  it('公開前のラベル', () => {
    const result = getPeriodStatus(createPeriod({ publish_start: '2099-01-01T00:00:00Z' }));
    expect(result.label).toBe('公開前');
  });

  it('常時公開のラベル', () => {
    const result = getPeriodStatus(
      createPeriod({
        publish_start: '2020-01-01T00:00:00Z',
        publish_end: null,
      })
    );
    expect(result.label).toBe('公開中（常時）');
  });

  it('公開中のラベル', () => {
    const result = getPeriodStatus(
      createPeriod({
        publish_start: '2020-01-01T00:00:00Z',
        publish_end: '2099-12-31T23:59:59Z',
      })
    );
    expect(result.label).toBe('公開中');
  });

  it('公開終了のラベル', () => {
    const result = getPeriodStatus(
      createPeriod({
        publish_start: '2020-01-01T00:00:00Z',
        publish_end: '2020-12-31T23:59:59Z',
      })
    );
    expect(result.label).toBe('公開終了');
  });
});
