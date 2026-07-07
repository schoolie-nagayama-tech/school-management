import { describe, it, expect } from 'vitest';
import { computeMailCandidates } from '@/lib/utils/inquiryMailCandidates';
import type { Inquiry, InquiryMailTemplate, InquiryMailLog } from '@/types/database';

// 基準日時。inquired_at からの経過日数で候補判定するため固定する。
const NOW = new Date('2026-07-15T03:00:00Z');

// 必須フィールドが多いので、テストに関係する項目だけ上書きするファクトリを用意する。
function mkInquiry(partial: Partial<Inquiry>): Inquiry {
  return {
    id: 'inq-1',
    school_id: 'school-1',
    inquired_at: '2026-07-10T00:00:00Z', // NOW から 5 日前
    student_name: '山田 太郎',
    guardian_name: '山田 花子',
    email: 'taro@example.com',
    status: 'in_progress',
    trial_at: null,
    interview_at: null,
    email_opt_out: false,
    ...partial,
  } as unknown as Inquiry;
}

function mkTemplate(partial: Partial<InquiryMailTemplate>): InquiryMailTemplate {
  return {
    id: 'tpl-1',
    school_id: null, // 全教室共通
    name: 'ステップ1',
    subject: '件名',
    body: '本文',
    is_active: true,
    trigger_days: 3,
    sort_order: 0,
    ...partial,
  } as unknown as InquiryMailTemplate;
}

describe('computeMailCandidates（配信停止の除外）', () => {
  const template = mkTemplate({});
  const logs: InquiryMailLog[] = [];

  it('通常の対象は候補に含まれる', () => {
    const inq = mkInquiry({});
    const result = computeMailCandidates([inq], [template], logs, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].inquiry.id).toBe('inq-1');
  });

  it('配信停止(email_opt_out=true)の宛先は候補から除外される', () => {
    const inq = mkInquiry({ email_opt_out: true });
    const result = computeMailCandidates([inq], [template], logs, NOW);
    expect(result).toHaveLength(0);
  });

  it('停止と非停止が混在しても、停止分だけ落ちる', () => {
    const a = mkInquiry({ id: 'a', email: 'a@example.com', email_opt_out: false });
    const b = mkInquiry({ id: 'b', email: 'b@example.com', email_opt_out: true });
    const result = computeMailCandidates([a, b], [template], logs, NOW);
    expect(result.map((c) => c.inquiry.id)).toEqual(['a']);
  });
});
