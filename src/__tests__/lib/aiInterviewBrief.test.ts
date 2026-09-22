/**
 * 面談で話すこと（旧「報告事項」）のテスト。
 *
 * ★守りたいのは3点:
 *  - AIに数字を触らせないという建て付けが崩れないこと（プロンプトの禁止事項が消えると、
 *    AIが点数を書き写しはじめ、面談の場で1字違いに誰も気づけなくなる）
 *  - 読めない出力で画面が壊れないこと（現状の行は残したまま、呼び出し側が
 *    「作れなかった」に倒せる）
 *  - bridge（④の課題と⑤のプランのつながり）が、koushu セクションを渡していないときは
 *    AIの出力に関わらず必ず空になること（講習面談ではないのにプランの話を混ぜない）
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
  MAX_BRIDGE_LENGTH,
  MAX_THREAD_LENGTH,
  type BriefSectionKey,
} from '@/lib/ai/interviewBrief';
import { SCENE_OF_SECTION, SCENE_KEYS } from '@/lib/interview/scenes';

const sent: BriefSectionKey[] = ['score', 'discipline', 'lastInterview'];
const sentWithKoushu: BriefSectionKey[] = ['score', 'koushu'];

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

  it('★bridge（④の課題と⑤のプランのつながり）を書かせる。無理にこじつけさせない', () => {
    const p = briefSystemPrompt();
    expect(p).toContain('bridge');
    expect(p).toContain('つながりが見えなければ空文字');
  });

  it('字数の上限を伝える', () => {
    const p = briefSystemPrompt();
    expect(p).toContain(`${MAX_SEEN_LENGTH}字`);
    expect(p).toContain(`${MAX_THREAD_LENGTH}字`);
    expect(p).toContain(`${MAX_BRIDGE_LENGTH}字`);
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

  it('★bridge は koushu を渡していれば残る', () => {
    const got = parseBriefResult({ bridge: '英語の単語不足 → プランの英語8コマ' }, sentWithKoushu);
    expect(got.bridge).toBe('英語の単語不足 → プランの英語8コマ');
  });

  it('★bridge は koushu を渡していなければ、AIが書いてきても空にする', () => {
    const got = parseBriefResult({ bridge: '④の課題と⑤のプランがつながる話' }, sent);
    expect(got.bridge).toBe('');
  });

  it('★bridge は80字超なら空', () => {
    const long = 'あ'.repeat(MAX_BRIDGE_LENGTH + 1);
    expect(parseBriefResult({ bridge: long }, sentWithKoushu).bridge).toBe('');
    const just = 'あ'.repeat(MAX_BRIDGE_LENGTH);
    expect(parseBriefResult({ bridge: just }, sentWithKoushu).bridge).toBe(just);
  });

  it('bridge が空文字・無ければ空のまま（無理にこじつけない）', () => {
    expect(parseBriefResult({ bridge: '' }, sentWithKoushu).bridge).toBe('');
    expect(parseBriefResult({}, sentWithKoushu).bridge).toBe('');
  });

  it('★読めない出力なら sections は全部 seen 空・thread も bridge も空（現状の行は画面に残る）', () => {
    for (const raw of [null, undefined, 'これはJSONではありません', {}, { sections: 'ちがう' }]) {
      const got = parseBriefResult(raw, sent);
      expect(got.sections).toEqual([
        { key: 'score', seen: '', sign: '' },
        { key: 'discipline', seen: '', sign: '' },
        { key: 'lastInterview', seen: '', sign: '' },
      ]);
      expect(got.thread).toBe('');
      expect(got.bridge).toBe('');
    }
  });

  it('形が違う行は飛ばす（数値・null・欠けた項目）', () => {
    const got = parseBriefResult(
      {
        sections: [null, 42, { seen: 'キーが無い' }, { key: 'score', seen: 'あ', sign: 'warn' }],
        bridge: 42,
      },
      sent
    );
    expect(got.sections[0].seen).toBe('あ');
    expect(got.bridge).toBe('');
  });
});

describe('SCENE_OF_SECTION（面談の流れ順シーンへの割り当て）', () => {
  it('★BRIEF_SECTIONS の全セクションが、どれかのシーンに割り当てられている', () => {
    for (const { key } of BRIEF_SECTIONS) {
      expect(SCENE_KEYS).toContain(SCENE_OF_SECTION[key]);
    }
  });

  it('★AIに投げる7セクションは②④⑤の3シーンだけに収まる（①③⑥⑦はAIを使わない）', () => {
    const usedScenes = new Set(BRIEF_SECTIONS.map(({ key }) => SCENE_OF_SECTION[key]));
    expect(usedScenes).toEqual(new Set(['hearing', 'status', 'plan']));
  });

  it('koushu は⑤プラン提示に割り当てる（bridge の前提）', () => {
    expect(SCENE_OF_SECTION.koushu).toBe('plan');
  });
});
