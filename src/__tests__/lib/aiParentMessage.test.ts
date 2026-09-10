/**
 * 「保護者との連絡」（箇条書き→そのスレッドの流れに合わせて文章にする）のテスト。
 *
 * ★守りたいのは3点:
 *  - プロンプトが守るべき決まり（宛名を書かない・教室から始める・約束を作らない）を含むこと
 *  - 材料が古い順・JST日付で渡ること
 *  - 読めない出力・短すぎる/長すぎるbody・知らないquoteMessageIdで画面が壊れないこと
 */
import { describe, expect, it } from 'vitest';
import {
  parentMessageSystemPrompt,
  parentMessageUserText,
  parseParentMessageResult,
  MIN_BODY_LENGTH,
  MAX_BODY_LENGTH,
  type ParentMessageEntry,
} from '@/lib/ai/parentMessage';

const entry = (over: Partial<ParentMessageEntry> = {}): ParentMessageEntry => ({
  id: 'msg-1',
  senderKind: 'portal',
  body: '振替をお願いできますか',
  createdAt: '2026-09-01T05:00:00.000Z', // UTC 05:00 = JST 14:00
  ...over,
});

describe('parentMessageSystemPrompt', () => {
  const p = parentMessageSystemPrompt();

  it('★宛名は書かせない', () => {
    expect(p).toContain('宛名');
  });

  it('★やりとりが無いときは教室から始める連絡として書かせる', () => {
    expect(p).toContain('教室から始める');
  });

  it('★箇条書きに無い約束を作らせない', () => {
    expect(p).toContain('約束を作らない');
  });

  it('聞かれた順に漏れなく答えさせ、答えたことは繰り返させない', () => {
    expect(p).toContain('聞いた順');
    expect(p).toContain('繰り返さない');
  });

  it('文字数と文体の決まりを伝える', () => {
    expect(p).toContain('150〜250字');
    expect(p).toContain('です・ます調');
  });
});

describe('parentMessageUserText', () => {
  it('古い順のまま並べる（並べ替えない）', () => {
    const t = parentMessageUserText({
      messages: [
        entry({ id: 'a', createdAt: '2026-08-01T00:00:00.000Z', body: '古いほう' }),
        entry({ id: 'b', createdAt: '2026-09-01T00:00:00.000Z', body: '新しいほう' }),
      ],
      gradeLabel: '',
      points: '承知しましたと伝える',
    });
    expect(t.indexOf('古いほう')).toBeLessThan(t.indexOf('新しいほう'));
    expect(t).toContain('古い順・2件');
  });

  it('★日付はJSTに直して渡す（UTC日をまたぐケース）', () => {
    // UTC 2026-09-01 23:00 = JST 2026-09-02 08:00
    const t = parentMessageUserText({
      messages: [entry({ createdAt: '2026-09-01T23:00:00.000Z' })],
      gradeLabel: '',
      points: 'ダミー',
    });
    expect(t).toContain('2026/09/02');
    expect(t).not.toContain('2026/09/01 ');
  });

  it('[id] 日付 送信者: 本文 の形で渡し、sender_kindを読み替える', () => {
    const t = parentMessageUserText({
      messages: [
        entry({ id: 'm1', senderKind: 'portal', body: '振替できますか' }),
        entry({
          id: 'm2',
          senderKind: 'staff',
          body: '承知しました',
          createdAt: '2026-09-01T06:00:00.000Z',
        }),
      ],
      gradeLabel: '',
      points: 'ダミー',
    });
    expect(t).toContain('[m1] 2026/09/01 保護者: 振替できますか');
    expect(t).toContain('[m2] 2026/09/01 教室: 承知しました');
  });

  it('やりとりが無いときは、その旨を書き教室から始める連絡と分かるようにする', () => {
    const t = parentMessageUserText({ messages: [], gradeLabel: '', points: '時間変更を知らせる' });
    expect(t).toContain('まだメッセージはありません');
    expect(t).toContain('教室から始める連絡');
  });

  it('箇条書き（答えること）を末尾に含める', () => {
    const t = parentMessageUserText({
      messages: [entry()],
      gradeLabel: '中2',
      points: '・振替は火曜17時でOK\n・宿題は次回まで',
    });
    expect(t).toContain('【答えること（箇条書き）】');
    expect(t).toContain('振替は火曜17時でOK');
    expect(t).toContain('【生徒の学年】中2');
  });

  it('作り直しの指示があれば末尾に足す。無ければ出さない', () => {
    const withInstruction = parentMessageUserText({
      messages: [entry()],
      gradeLabel: '',
      points: 'ダミー',
      instruction: 'もう少し短く',
    });
    expect(withInstruction).toContain('【直し方】');
    expect(withInstruction).toContain('もう少し短く');

    const without = parentMessageUserText({
      messages: [entry()],
      gradeLabel: '',
      points: 'ダミー',
    });
    expect(without).not.toContain('【直し方】');
  });
});

describe('parseParentMessageResult', () => {
  const sentIds = ['a', 'b'];
  const okBody =
    'いつもお世話になっております。ご連絡いただいた件、承知しました。よろしくお願いいたします。'; // 40字超

  it('妥当な出力はそのまま返す', () => {
    const got = parseParentMessageResult({ body: okBody, quoteMessageId: 'a' }, sentIds);
    expect(got).toEqual({ body: okBody, quoteMessageId: 'a' });
  });

  it(`★短すぎる本文（${MIN_BODY_LENGTH}字未満）は捨てる`, () => {
    const got = parseParentMessageResult({ body: '承知', quoteMessageId: null }, sentIds);
    expect(got).toEqual({ body: '', quoteMessageId: null });
  });

  it(`★長すぎる本文（${MAX_BODY_LENGTH}字超）は捨てる`, () => {
    const tooLong = 'あ'.repeat(MAX_BODY_LENGTH + 1);
    const got = parseParentMessageResult({ body: tooLong, quoteMessageId: null }, sentIds);
    expect(got).toEqual({ body: '', quoteMessageId: null });
  });

  it('★渡していないquoteMessageIdはnullにする（作られたIDを信じない）', () => {
    const got = parseParentMessageResult({ body: okBody, quoteMessageId: 'z' }, sentIds);
    expect(got.quoteMessageId).toBeNull();
  });

  it('quoteMessageIdがnullなら教室から始める連絡として扱う', () => {
    const got = parseParentMessageResult({ body: okBody, quoteMessageId: null }, sentIds);
    expect(got.quoteMessageId).toBeNull();
  });

  it('★読めない出力なら空（呼び出し側がdegradedに倒せる）', () => {
    for (const raw of [null, undefined, 'これはJSONではありません', {}, { body: 42 }]) {
      const got = parseParentMessageResult(raw, sentIds);
      expect(got).toEqual({ body: '', quoteMessageId: null });
    }
  });
});
