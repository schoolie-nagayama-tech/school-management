import { describe, it, expect } from 'vitest';
import { computeInquiryReminders } from '@/lib/utils/inquiryReminders';
import type { Inquiry } from '@/types/database';

const NOW = new Date('2026-07-15T03:00:00Z');

// 体験フォロー判定に関係する項目だけ上書きするファクトリ。
function mkInquiry(partial: Partial<Inquiry>): Inquiry {
  return {
    id: 'inq-1',
    school_id: 'school-1',
    inquired_at: '2026-07-01T00:00:00Z',
    student_name: '澤口 ここね',
    guardian_name: null,
    status: 'trial_done', // 返事待ち
    trial_at: '2026-07-08T00:00:00Z', // 7日前に体験
    interview_at: null,
    material_sent_at: null,
    request_type: null,
    ...partial,
  } as unknown as Inquiry;
}

describe('computeInquiryReminders — 体験後フォロー', () => {
  it('返事待ちで体験後フォロー未記録なら trial_followup が出る', () => {
    const inq = mkInquiry({});
    const result = computeInquiryReminders([inq], new Set(), NOW, new Map());
    expect(result.some((r) => r.kind === 'trial_followup')).toBe(true);
  });

  it('体験後フォローが最近（7日未満）なら trial_followup は出ない', () => {
    const inq = mkInquiry({});
    // 体験(7/8)より後の 7/13 にフォロー。NOW(7/15)から2日前 → 最近なので静かにする
    const last = new Map([[inq.id, '2026-07-13T06:00:00Z']]);
    const result = computeInquiryReminders([inq], new Set([inq.id]), NOW, last);
    expect(result.some((r) => r.kind === 'trial_followup')).toBe(false);
  });

  it('体験後フォローがあっても7日以上音沙汰なしなら再度出る（停滞の再検知）', () => {
    const inq = mkInquiry({ trial_at: '2026-06-22T00:00:00Z' });
    // 体験(6/22)より後の 6/25 にフォロー。NOW(7/15)から20日前 → 停滞とみなす
    const last = new Map([[inq.id, '2026-06-25T06:00:00Z']]);
    const result = computeInquiryReminders([inq], new Set([inq.id]), NOW, last);
    const r = result.find((x) => x.kind === 'trial_followup');
    expect(r).toBeTruthy();
    expect(r?.message).toContain('返事待ちのまま');
  });

  it('フォロー記録が体験日より前だけなら trial_followup は出る', () => {
    const inq = mkInquiry({});
    // 体験(7/8)より前の 7/05（体験の打診など）。これは「体験後フォロー」ではない
    const last = new Map([[inq.id, '2026-07-05T06:00:00Z']]);
    const result = computeInquiryReminders([inq], new Set([inq.id]), NOW, last);
    expect(result.some((r) => r.kind === 'trial_followup')).toBe(true);
  });

  it('in_progress でも体験後フォローがあれば出ない', () => {
    const inq = mkInquiry({ status: 'in_progress' });
    const last = new Map([[inq.id, '2026-07-13T06:00:00Z']]);
    const result = computeInquiryReminders([inq], new Set([inq.id]), NOW, last);
    expect(result.some((r) => r.kind === 'trial_followup')).toBe(false);
  });
});
