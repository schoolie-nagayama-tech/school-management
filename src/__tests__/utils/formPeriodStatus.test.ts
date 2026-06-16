/**
 * getFormPeriodStatus（フォーム受付期間の公開状態判定）のユニットテスト
 *
 * この関数は「現在時刻」と publish_start / publish_end を比較して
 * 公開前 / 公開中 / 公開終了 などを返す純粋関数。
 * テストを時刻に依存させないため、必ず過去になる日付(2000年)と
 * 必ず未来になる日付(2999年)を使って検証する。
 */
import { describe, it, expect } from 'vitest';
import { getFormPeriodStatus } from '@/lib/utils/formPeriodStatus';

const PAST = '2000-01-01T00:00:00';   // 現在より必ず過去
const PAST2 = '2000-01-02T00:00:00';  // PAST より後だが、これも必ず過去
const FUTURE = '2999-01-01T00:00:00'; // 現在より必ず未来

describe('getFormPeriodStatus - フォーム受付期間の状態判定', () => {
  it('アーカイブ済みは日付に関係なく「アーカイブ」', () => {
    // 公開中になりうる日付でも、is_archived が最優先される
    const result = getFormPeriodStatus({
      is_archived: true,
      publish_start: PAST,
      publish_end: FUTURE,
    });
    expect(result.label).toBe('アーカイブ');
    expect(result.color).toBe('gray');
  });

  it('publish_start 未設定は「未設定」', () => {
    const result = getFormPeriodStatus({ publish_start: null });
    expect(result.label).toBe('未設定');
    expect(result.color).toBe('gray');
  });

  it('開始日が未来なら「公開前」', () => {
    const result = getFormPeriodStatus({ publish_start: FUTURE });
    expect(result.label).toBe('公開前');
    expect(result.color).toBe('yellow');
  });

  it('開始済みで終了日なしは「公開中（常時）」', () => {
    const result = getFormPeriodStatus({ publish_start: PAST, publish_end: null });
    expect(result.label).toBe('公開中（常時）');
    expect(result.color).toBe('green');
  });

  it('開始済みで終了日も過去なら「公開終了」', () => {
    const result = getFormPeriodStatus({ publish_start: PAST, publish_end: PAST2 });
    expect(result.label).toBe('公開終了');
    expect(result.color).toBe('gray');
  });

  it('開始済みで終了日が未来なら「公開中」', () => {
    const result = getFormPeriodStatus({ publish_start: PAST, publish_end: FUTURE });
    expect(result.label).toBe('公開中');
    expect(result.color).toBe('green');
  });

  it('is_archived は他の条件より優先される（未設定でもアーカイブが勝つ）', () => {
    const result = getFormPeriodStatus({ is_archived: true, publish_start: null });
    expect(result.label).toBe('アーカイブ');
  });
});
