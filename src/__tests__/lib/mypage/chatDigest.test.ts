import { describe, it, expect } from 'vitest';
import { buildStudentChatDigest, firstLine } from '@/lib/mypage/chatDigest';
import type { ChatSenderKind } from '@/types/chat';

function msg(id: string, kind: ChatSenderKind, at: string, body = `本文${id}`) {
  return { id, sender_kind: kind, body, created_at: at };
}

describe('chatDigest: buildStudentChatDigest', () => {
  it('新しい順に並べ、件数を limit で切る', () => {
    const d = buildStudentChatDigest(
      't1',
      [
        msg('a', 'portal', '2026-09-01T10:00:00Z'),
        msg('c', 'staff', '2026-09-03T10:00:00Z'),
        msg('b', 'portal', '2026-09-02T10:00:00Z'),
      ],
      2
    );
    expect(d.items.map((i) => i.id)).toEqual(['c', 'b']);
    expect(d.items[0].direction).toBe('to_parent');
    expect(d.items[1].direction).toBe('from_parent');
  });

  it('スタッフの返信より後の保護者メッセージだけが返信待ち', () => {
    const d = buildStudentChatDigest(
      't1',
      [
        msg('p2', 'portal', '2026-09-05T10:00:00Z'),
        msg('p1', 'portal', '2026-09-04T10:00:00Z'),
        msg('s1', 'staff', '2026-09-03T10:00:00Z'),
        msg('p0', 'portal', '2026-09-02T10:00:00Z'),
      ],
      5
    );
    expect(d.items.map((i) => [i.id, i.awaiting_reply])).toEqual([
      ['p2', true],
      ['p1', true],
      ['s1', false],
      ['p0', false],
    ]);
    expect(d.awaiting_reply).toBe(true);
  });

  it('自動返信（system）は返信に数えない', () => {
    const d = buildStudentChatDigest(
      't1',
      [msg('ack', 'system', '2026-09-05T10:00:01Z'), msg('p1', 'portal', '2026-09-05T10:00:00Z')],
      5
    );
    expect(d.items[0]).toMatchObject({ direction: 'to_parent', is_auto: true });
    expect(d.items[1].awaiting_reply).toBe(true);
    expect(d.awaiting_reply).toBe(true);
  });

  it('スタッフが最後に返していれば返信待ちなし／スレッドが無ければ空', () => {
    const d = buildStudentChatDigest(
      't1',
      [msg('p1', 'portal', '2026-09-05T10:00:00Z'), msg('s1', 'staff', '2026-09-06T10:00:00Z')],
      5
    );
    expect(d.awaiting_reply).toBe(false);
    expect(buildStudentChatDigest(null, [], 5)).toEqual({
      thread_id: null,
      items: [],
      awaiting_reply: false,
    });
  });
});

describe('chatDigest: firstLine', () => {
  it('空行を飛ばした最初の行を返し、長ければ切る', () => {
    expect(firstLine('\n\n  欠席の連絡です  \n2行目')).toBe('欠席の連絡です');
    expect(firstLine('あ'.repeat(70), 60)).toBe(`${'あ'.repeat(60)}…`);
    expect(firstLine('')).toBe('');
  });
});
