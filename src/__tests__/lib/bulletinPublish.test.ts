import { describe, it, expect } from 'vitest';
import { isPostPublished, getPublishStatus } from '@/types/bulletin';

// 判定は nowMs を引数で受けられるので固定時刻で決定的にテストする
const NOW = new Date('2026-07-10T12:00:00Z').getTime();
const past = '2026-07-01T00:00:00Z';
const future = '2026-07-20T00:00:00Z';

describe('isPostPublished', () => {
  it('開始・終了とも未設定なら常に公開中', () => {
    expect(isPostPublished({ publish_start_at: null, publish_end_at: null }, NOW)).toBe(true);
  });

  it('開始日が未来なら未公開', () => {
    expect(isPostPublished({ publish_start_at: future, publish_end_at: null }, NOW)).toBe(false);
  });

  it('終了日が過去なら未公開', () => {
    expect(isPostPublished({ publish_start_at: null, publish_end_at: past }, NOW)).toBe(false);
  });

  it('開始 <= now <= 終了 なら公開中', () => {
    expect(isPostPublished({ publish_start_at: past, publish_end_at: future }, NOW)).toBe(true);
  });

  it('開始のみ設定・過去なら公開中', () => {
    expect(isPostPublished({ publish_start_at: past, publish_end_at: null }, NOW)).toBe(true);
  });
});

describe('getPublishStatus', () => {
  it('開始日が未来なら scheduled', () => {
    expect(getPublishStatus({ publish_start_at: future, publish_end_at: null }, NOW)).toBe(
      'scheduled'
    );
  });

  it('終了日が過去なら expired', () => {
    expect(getPublishStatus({ publish_start_at: null, publish_end_at: past }, NOW)).toBe('expired');
  });

  it('期間内 / 未設定なら active', () => {
    expect(getPublishStatus({ publish_start_at: past, publish_end_at: future }, NOW)).toBe(
      'active'
    );
    expect(getPublishStatus({ publish_start_at: null, publish_end_at: null }, NOW)).toBe('active');
  });
});
