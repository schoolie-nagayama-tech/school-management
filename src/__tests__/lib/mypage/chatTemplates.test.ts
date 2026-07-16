import { describe, it, expect } from 'vitest';
import {
  buildTemplateBody,
  buildAckBody,
  buildTransferConfirmedBody,
  formatCandidates,
  formatJpDate,
} from '@/lib/mypage/chatTemplates';

describe('chatTemplates: formatJpDate / formatCandidates', () => {
  it('YYYY-MM-DD を M月D日 に整形する', () => {
    expect(formatJpDate('2026-07-20')).toBe('7月20日');
    expect(formatJpDate('2026-01-05')).toBe('1月5日');
    expect(formatJpDate('')).toBe('');
    expect(formatJpDate('bad')).toBe('bad');
  });

  it('candidates を第1〜第3希望の行に整形する', () => {
    const lines = formatCandidates([
      { date: '2026-07-21', slot: '17:00〜' },
      { date: '2026-07-22', slot: '' },
    ]);
    expect(lines).toEqual(['第1希望: 7月21日 17:00〜', '第2希望: 7月22日']);
  });

  it('candidates 空は空配列', () => {
    expect(formatCandidates(undefined)).toEqual([]);
    expect(formatCandidates([])).toEqual([]);
  });
});

describe('chatTemplates: buildTemplateBody', () => {
  it('欠席＋振替希望ありは候補も本文に入る', () => {
    const body = buildTemplateBody('absence', {
      lessonDate: '2026-07-20',
      reason: '発熱',
      wantsTransfer: true,
      candidates: [{ date: '2026-07-27', slot: '17:00〜' }],
    });
    expect(body).toContain('【欠席・遅刻のご連絡】');
    expect(body).toContain('対象授業: 7月20日');
    expect(body).toContain('理由: 発熱');
    expect(body).toContain('振替希望: あり');
    expect(body).toContain('第1希望: 7月27日 17:00〜');
  });

  it('欠席・振替希望なしは「振替希望: なし」', () => {
    const body = buildTemplateBody('absence', { lessonDate: '2026-07-20', wantsTransfer: false });
    expect(body).toContain('振替希望: なし');
  });

  it('面談希望は希望時間帯と相談内容', () => {
    const body = buildTemplateBody('meeting_request', {
      preferredNote: '平日夕方',
      reason: '進路相談',
    });
    expect(body).toContain('【面談のご希望】');
    expect(body).toContain('希望時間帯: 平日夕方');
    expect(body).toContain('ご相談内容: 進路相談');
  });
});

describe('chatTemplates: buildAckBody（締切分岐）', () => {
  it('締切内の振替希望は「振替日が決まり次第ご案内」', () => {
    const body = buildAckBody('transfer_request', { lessonDate: '2026-07-20' }, false);
    expect(body).toContain('振替のご希望を受け付けました');
    expect(body).toContain('決まり次第');
  });

  it('締切超過（ダウングレード）は欠席として承る旨', () => {
    const body = buildAckBody(
      'absence',
      { lessonDate: '2026-07-20', transferDowngraded: true },
      true
    );
    expect(body).toContain('前日21時を過ぎているため振替はできません');
    expect(body).toContain('欠席として承りました');
  });

  it('当日連絡（ダウングレードなし）は当日ゆえ欠席の旨', () => {
    const body = buildAckBody('absence', { lessonDate: '2026-07-20' }, true);
    expect(body).toContain('欠席として承りました');
    expect(body).toContain('振替対象外');
  });

  it('締切内・振替希望なしの欠席は欠席受付の文面', () => {
    const body = buildAckBody('absence', { lessonDate: '2026-07-20', wantsTransfer: false }, false);
    expect(body).toContain('欠席のご連絡を受け付けました');
  });

  it('面談は日程調整の受付文面', () => {
    const body = buildAckBody('meeting_request', {}, false);
    expect(body).toContain('日程を調整');
  });
});

describe('chatTemplates: buildTransferConfirmedBody', () => {
  it('振替日・時限・科目を当てはめる', () => {
    const body = buildTransferConfirmedBody({
      toDate: '2026-07-27',
      toSlotLabel: '17:00〜18:30',
      subjectNames: ['英語', '数学'],
    });
    expect(body).toContain('【振替日が決まりました】');
    expect(body).toContain('振替日: 7月27日 17:00〜18:30');
    expect(body).toContain('科目: 英語・数学');
  });

  it('科目なしでも成立する', () => {
    const body = buildTransferConfirmedBody({ toDate: '2026-07-27' });
    expect(body).toContain('振替日: 7月27日');
    expect(body).not.toContain('科目:');
  });
});
