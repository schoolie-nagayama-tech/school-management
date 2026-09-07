/**
 * 面談の「報告事項」のテスト。
 *
 * ★守りたいのは2点:
 *  - AIに数字を触らせないという建て付けが崩れないこと（プロンプトの禁止事項が消えると、
 *    AIが点数を書き写しはじめ、面談の場で1字違いに誰も気づけなくなる）
 *  - 読めない出力で画面が壊れないこと（現状の行は残したまま、呼び出し側が
 *    「作れなかった」に倒せる）
 */
import { describe, expect, it } from 'vitest';
import {
  BRIEF_SECTIONS,
  briefSystemPrompt,
  briefUserText,
  parseBriefResult,
  sanitizeBriefSections,
  sortBriefSections,
  MAX_CURRENT_LINES,
  MAX_CURRENT_LINE_LENGTH,
  MAX_SEEN_LENGTH,
  MAX_TALK,
  MAX_TALK_LENGTH,
  MAX_THREAD_LENGTH,
  type BriefSectionKey,
} from '@/lib/ai/interviewBrief';

const sent: BriefSectionKey[] = ['score', 'discipline', 'lastInterview'];

/** 41字（上限ちょうど超え）の見えること */
const tooLongSeen = 'あ'.repeat(MAX_SEEN_LENGTH + 1);

describe('BRIEF_SECTIONS', () => {
  it('★セクションは7つ・この順で固定（AIに順番を決めさせない）', () => {
    expect(BRIEF_SECTIONS.map((s) => s.key)).toEqual([
      'score',
      'lessons',
      'discipline',
      'progress',
      'koushu',
      'parent',
      'lastInterview',
    ]);
  });
});

describe('briefSystemPrompt', () => {
  it('★数字を書き直させない・書き写させない', () => {
    const p = briefSystemPrompt();
    expect(p).toContain('数字を書き直さない');
    expect(p).toContain('書き写しもしない');
  });

  it('★書かれていないことを足させない', () => {
    expect(briefSystemPrompt()).toContain('書かれていないことを足さない');
  });

  it('★悪い話だけにさせない（良い方向のものは良いと書かせる）', () => {
    const p = briefSystemPrompt();
    expect(p).toContain('良い');
    expect(p).toContain('悪い話だけにしない');
  });

  it('話す項目を出させる（件数と「良い話を1つ」の決まり込み）', () => {
    const p = briefSystemPrompt();
    expect(p).toContain('話す項目');
    expect(p).toContain('3〜5個');
    expect(p).toContain('必ず1つ入れる');
  });

  it('字数の上限を伝える', () => {
    const p = briefSystemPrompt();
    expect(p).toContain(`${MAX_SEEN_LENGTH}字`);
    expect(p).toContain(`${MAX_THREAD_LENGTH}字`);
    expect(p).toContain(`${MAX_TALK_LENGTH}字`);
  });

  it('見えることが無ければ空にさせる（無理に書かせない）', () => {
    expect(briefSystemPrompt()).toContain('無理に書かない');
  });
});

describe('briefUserText', () => {
  it('★見出しは key と日本語ラベルの両方を出す', () => {
    const t = briefUserText([{ key: 'score', current: ['定期テスト: 英語 72（前回 65）'] }]);
    expect(t).toContain('【score: 成績】');
    expect(t).toContain('- 定期テスト: 英語 72（前回 65）');
  });

  it('★見出しの順は渡した順のまま（sanitize が固定順に並べている）', () => {
    const t = briefUserText(
      sanitizeBriefSections([
        { key: 'lastInterview', current: ['9/1'] },
        { key: 'score', current: ['英語 72'] },
        { key: 'lessons', current: ['9/1 山田: 分数でつまずく'] },
      ])
    );
    expect(t.indexOf('【score')).toBeLessThan(t.indexOf('【lessons'));
    expect(t.indexOf('【lessons')).toBeLessThan(t.indexOf('【lastInterview'));
  });
});

describe('sortBriefSections', () => {
  it('★BRIEF_SECTIONS の固定順に並べ直す（行数は切らない）', () => {
    const many = Array.from({ length: MAX_CURRENT_LINES + 8 }, (_, i) => `${i}回目`);
    const got = sortBriefSections([
      { key: 'parent', current: ['やりとり 3件'] },
      { key: 'lessons', current: many },
      { key: 'score', current: ['英語 72'] },
    ]);
    expect(got.map((s) => s.key)).toEqual(['score', 'lessons', 'parent']);
    // ★サーバーが足す「授業の様子」は20回ぶん。ここで12行に切ると直近が落ちる
    expect(got[1].current).toHaveLength(many.length);
  });
});

describe('sanitizeBriefSections', () => {
  it('知らない key は捨てる', () => {
    const got = sanitizeBriefSections([
      { key: 'score', current: ['あ'] },
      { key: 'salary', current: ['い'] },
    ]);
    expect(got.map((s) => s.key)).toEqual(['score']);
  });

  it('★行が0本のセクションは持たない（「記録なし」を並べない）', () => {
    expect(sanitizeBriefSections([{ key: 'score', current: ['  ', 42] }])).toEqual([]);
  });

  it('行数・1行の字数の上限で切る', () => {
    const got = sanitizeBriefSections([
      {
        key: 'lessons',
        current: Array.from({ length: MAX_CURRENT_LINES + 5 }, () =>
          'あ'.repeat(MAX_CURRENT_LINE_LENGTH + 10)
        ),
      },
    ]);
    expect(got[0].current).toHaveLength(MAX_CURRENT_LINES);
    expect(got[0].current[0]).toHaveLength(MAX_CURRENT_LINE_LENGTH);
  });

  it('同じ key が2回来たら先に来たほうを採る', () => {
    const got = sanitizeBriefSections([
      { key: 'score', current: ['さき'] },
      { key: 'score', current: ['あと'] },
    ]);
    expect(got).toHaveLength(1);
    expect(got[0].current).toEqual(['さき']);
  });

  it('配列でない入力は空（壊れたリクエストで落ちない）', () => {
    for (const raw of [null, undefined, 'ちがう', {}]) {
      expect(sanitizeBriefSections(raw)).toEqual([]);
    }
  });
});

describe('parseBriefResult', () => {
  it('渡した key のぶんだけ返る（渡した順のまま）', () => {
    const got = parseBriefResult(
      { sections: [{ key: 'score', seen: '英語だけ下がっている', sign: 'warn' }] },
      sent
    );
    expect(got.sections.map((s) => s.key)).toEqual(sent);
    expect(got.sections[0]).toEqual({ key: 'score', seen: '英語だけ下がっている', sign: 'warn' });
    expect(got.sections[1].seen).toBe('');
  });

  it('★渡していない key は捨てる', () => {
    const got = parseBriefResult(
      {
        sections: [
          { key: 'koushu', seen: '渡していないセクション', sign: 'good' },
          { key: 'score', seen: 'あ', sign: '' },
        ],
      },
      sent
    );
    expect(got.sections.map((s) => s.key)).toEqual(sent);
    expect(got.sections.every((s) => s.seen !== '渡していないセクション')).toBe(true);
  });

  it('★40字を超える seen は空にする（勝手に短くしない）', () => {
    const got = parseBriefResult(
      { sections: [{ key: 'score', seen: tooLongSeen, sign: 'warn' }] },
      sent
    );
    expect(got.sections[0].seen).toBe('');
    // 見えることが消えたら色線も付けない
    expect(got.sections[0].sign).toBe('');
  });

  it('40字ちょうどは残す', () => {
    const just = 'あ'.repeat(MAX_SEEN_LENGTH);
    const got = parseBriefResult({ sections: [{ key: 'score', seen: just, sign: 'good' }] }, sent);
    expect(got.sections[0].seen).toBe(just);
    expect(got.sections[0].sign).toBe('good');
  });

  it('★sign は warn / good 以外を空にする', () => {
    const got = parseBriefResult(
      {
        sections: [
          { key: 'score', seen: 'あ', sign: 'danger' },
          { key: 'discipline', seen: 'い', sign: 'good' },
          { key: 'lastInterview', seen: 'う', sign: 'warn' },
        ],
      },
      sent
    );
    expect(got.sections.map((s) => s.sign)).toEqual(['', 'good', 'warn']);
  });

  it('★thread は80字超なら空', () => {
    const long = 'あ'.repeat(MAX_THREAD_LENGTH + 1);
    expect(parseBriefResult({ thread: long }, sent).thread).toBe('');
    const just = 'あ'.repeat(MAX_THREAD_LENGTH);
    expect(parseBriefResult({ thread: just }, sent).thread).toBe(just);
  });

  it('★talk は先頭5つで切る', () => {
    const got = parseBriefResult(
      {
        talk: Array.from({ length: 8 }, (_, i) => ({ text: `項目${i}`, basis: 'score' })),
      },
      sent
    );
    expect(got.talk).toHaveLength(MAX_TALK);
    expect(got.talk[0].text).toBe('項目0');
  });

  it('★talk の basis が渡していない key なら空文字にする', () => {
    const got = parseBriefResult(
      {
        talk: [
          { text: 'あ', basis: 'koushu' },
          { text: 'い', basis: 'score' },
          { text: 'う', basis: 42 },
        ],
      },
      sent
    );
    expect(got.talk.map((t) => t.basis)).toEqual(['', 'score', '']);
  });

  it('60字を超える talk は捨てる', () => {
    const got = parseBriefResult(
      {
        talk: [
          { text: 'あ'.repeat(MAX_TALK_LENGTH + 1), basis: 'score' },
          { text: '残るほう', basis: 'score' },
        ],
      },
      sent
    );
    expect(got.talk.map((t) => t.text)).toEqual(['残るほう']);
  });

  it('★読めない出力なら sections は全部 seen 空・talk 空（現状の行は画面に残る）', () => {
    for (const raw of [null, undefined, 'これはJSONではありません', {}, { sections: 'ちがう' }]) {
      const got = parseBriefResult(raw, sent);
      expect(got.sections).toEqual([
        { key: 'score', seen: '', sign: '' },
        { key: 'discipline', seen: '', sign: '' },
        { key: 'lastInterview', seen: '', sign: '' },
      ]);
      expect(got.thread).toBe('');
      expect(got.talk).toEqual([]);
    }
  });

  it('形が違う行は飛ばす（数値・null・欠けた項目）', () => {
    const got = parseBriefResult(
      {
        sections: [null, 42, { seen: 'キーが無い' }, { key: 'score', seen: 'あ', sign: 'warn' }],
        talk: [null, 7, { basis: 'score' }, { text: '  ', basis: 'score' }],
      },
      sent
    );
    expect(got.sections[0].seen).toBe('あ');
    expect(got.talk).toEqual([]);
  });
});
