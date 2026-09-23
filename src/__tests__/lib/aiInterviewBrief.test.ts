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
  sanitizeFollowUpItems,
  sortBriefSections,
  dedupeConsecutiveLessonLines,
  isSelectableModelKey,
  resolveInterviewBriefModelKey,
  MAX_CURRENT_LINES,
  MAX_CURRENT_LINE_LENGTH,
  MAX_SEEN_LENGTH,
  MAX_BRIDGE_LENGTH,
  MAX_THREAD_LENGTH,
  MAX_FOLLOW_UPS,
  MAX_FOLLOW_UP_ITEMS,
  type BriefSectionKey,
} from '@/lib/ai/interviewBrief';
import { SCENE_OF_SECTION, SCENE_KEYS } from '@/lib/interview/scenes';

const sent: BriefSectionKey[] = ['score', 'discipline', 'lastInterview'];
const sentWithKoushu: BriefSectionKey[] = ['score', 'koushu'];

/** 上限をちょうど1字超えた「見えること」 */
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

  it('★断定してよいのは渡した現状だけ、と釘を刺す（見立ては書かせるが推測と分かる形で）', () => {
    const p = briefSystemPrompt();
    expect(p).toContain('断定していいのは');
    expect(p).toContain('推測は推測と分かる書き方');
  });

  it('★見立て・提案・切り出し方を書かせる（2026-09-22に禁止を解いた）', () => {
    // 読み手がプロで、事実と違えば気づける、という前提を明示してあること。
    // ここが消えると、また当たり障りのない1文に戻る
    const p = briefSystemPrompt();
    expect(p).toContain('原因の見立て');
    expect(p).toContain('切り出し方');
    expect(p).toContain('気づきます');
  });

  it('★数字を書かせない縛りだけは残す（1字違いに面談の場で誰も気づけない）', () => {
    const p = briefSystemPrompt();
    expect(p).toContain('数字を書き直さない');
    expect(p).toContain('誰も気づけません');
  });

  it('★悪い話だけにさせない（良い方向のものは良いと書かせる）', () => {
    const p = briefSystemPrompt();
    expect(p).toContain('良い');
    expect(p).toContain('悪い話だけを並べない');
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

  it('★②ヒアリングは「家庭で見えないこと・良い報告」に寄せる（第2段）', () => {
    const p = briefSystemPrompt();
    // 授業の様子は、保護者が家では見られないものを良い報告として書かせる
    expect(p).toContain('できるようになったこと');
    expect(p).toContain('家庭では見えないことを優先する');
    // 前回の面談からは、約束・要望のその後を追わせる
    expect(p).toContain('前回の約束・要望に対して');
  });

  it('見えることが無ければ空にさせる（無理に書かせない）', () => {
    expect(briefSystemPrompt()).toContain('無理に書かず');
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

  it('★上限を超える seen は空にする（勝手に短くしない）', () => {
    const got = parseBriefResult(
      { sections: [{ key: 'score', seen: tooLongSeen, sign: 'warn' }] },
      sent
    );
    expect(got.sections[0].seen).toBe('');
    // 見えることが消えたら色線も付けない
    expect(got.sections[0].sign).toBe('');
  });

  it('上限ちょうどは残す', () => {
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

  it('★thread は上限を超えたら空', () => {
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

  it('★bridge は上限を超えたら空', () => {
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

describe('isSelectableModelKey', () => {
  it('smart / best だけを受け付ける', () => {
    expect(isSelectableModelKey('smart')).toBe(true);
    expect(isSelectableModelKey('best')).toBe(true);
  });

  it('★fast（Haiku）は比較対象ではないので弾く', () => {
    expect(isSelectableModelKey('fast')).toBe(false);
  });

  it('★生のモデルIDは受け付けない（キー名だけを許す）', () => {
    expect(isSelectableModelKey('claude-opus-5')).toBe(false);
    expect(isSelectableModelKey('claude-sonnet-5')).toBe(false);
  });

  it('文字列以外・知らない値は弾く', () => {
    for (const v of [null, undefined, 42, {}, [], '']) {
      expect(isSelectableModelKey(v)).toBe(false);
    }
  });
});

describe('resolveInterviewBriefModelKey（Sonnet 5 / Opus 5 の見比べ用モデル選択）', () => {
  it('admin が smart を指定すれば smart になる', () => {
    expect(resolveInterviewBriefModelKey('smart', 'admin')).toBe('smart');
  });

  it('owner が best を指定すれば best になる', () => {
    expect(resolveInterviewBriefModelKey('best', 'owner')).toBe('best');
  });

  it('指定が無ければ admin / owner でも既定（best）のまま', () => {
    expect(resolveInterviewBriefModelKey(undefined, 'admin')).toBe('best');
    expect(resolveInterviewBriefModelKey(undefined, 'owner')).toBe('best');
  });

  it('★admin/owner 未満（manager 以下）が model を指定しても、エラーにせず既定（best）に倒す', () => {
    expect(resolveInterviewBriefModelKey('smart', 'manager')).toBe('best');
    expect(resolveInterviewBriefModelKey('smart', 'teacher')).toBe('best');
    expect(resolveInterviewBriefModelKey('smart', null)).toBe('best');
    expect(resolveInterviewBriefModelKey('smart', undefined)).toBe('best');
  });

  it('★キー名以外（生のモデルID・知らない文字列）は、admin/owner が送っても弾いて既定にする', () => {
    expect(resolveInterviewBriefModelKey('claude-opus-5', 'admin')).toBe('best');
    expect(resolveInterviewBriefModelKey('fast', 'owner')).toBe('best');
    expect(resolveInterviewBriefModelKey('', 'admin')).toBe('best');
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

describe('dedupeConsecutiveLessonLines（②授業の様子）', () => {
  it('★同じ講師・同じ引継ぎ文が続いたら、いちばん新しい1件だけ残す（入力は古い順）', () => {
    const lines = [
      '2026/09/04 広田: 因数分解の公式を確認',
      '2026/09/11 広田: 計算は安定。文章題は復習が要る',
      '2026/09/15 広田: 計算は安定。文章題は復習が要る',
    ];
    expect(dedupeConsecutiveLessonLines(lines)).toEqual([
      '2026/09/04 広田: 因数分解の公式を確認',
      '2026/09/15 広田: 計算は安定。文章題は復習が要る',
    ]);
  });

  it('講師が違えば同じ文でも残す', () => {
    const lines = ['2026/09/11 広田: 同じ文', '2026/09/15 田中: 同じ文'];
    expect(dedupeConsecutiveLessonLines(lines)).toHaveLength(2);
  });

  it('★連続していなければ残す（時系列が飛ぶと読めなくなる）', () => {
    const lines = ['2026/09/04 広田: 同じ文', '2026/09/11 広田: 別の文', '2026/09/15 広田: 同じ文'];
    expect(dedupeConsecutiveLessonLines(lines)).toHaveLength(3);
  });

  it('★「: 」が無い想定外の形の行は畳まない', () => {
    const lines = ['引継ぎ 3件', '引継ぎ 3件'];
    expect(dedupeConsecutiveLessonLines(lines)).toHaveLength(2);
  });
});

/* ============================================================
 * followUps（前回の約束・要望を「報告する」か「聞く」か）
 * ------------------------------------------------------------
 * ★守りたいのは「渡していない文を画面に出さない」こと。ここで item の突き合わせが
 *   緩むと、AIが言い換えた（あるいは作った）約束が面談の台本に載る。
 * ========================================================== */

const sentItems = ['英語の長文を増やしてほしい', '慶應を含めて最後まで検討'];

describe('briefSystemPrompt（followUps）', () => {
  it('★報告と聞くの意味と、要望は原則「報告」だと書いてある', () => {
    const p = briefSystemPrompt();
    expect(p).toContain('followUps');
    expect(p).toContain('kind="report"');
    expect(p).toContain('kind="ask"');
    expect(p).toContain('保護者からの要望は、ほとんどが report');
    expect(p).toContain('家庭では見えないこと');
  });

  it('★followUps の本文にも「数字は書かない」が効いている', () => {
    expect(briefSystemPrompt()).toContain('★ここでも数字は書かない');
  });

  it('item はそのまま書き写させる（1字でも変えると捨てる、と明示する）', () => {
    expect(briefSystemPrompt()).toContain('item は渡した文を**そのまま**書き写す');
  });
});

describe('briefUserText（前回の約束・要望）', () => {
  it('渡した約束・要望を別枠の見出しで並べる', () => {
    const t = briefUserText([{ key: 'score', current: ['定期テスト: 英語'] }], sentItems);
    expect(t).toContain('■ 前回の約束・要望（followUps の item はこの文をそのまま使う）');
    expect(t).toContain('- 英語の長文を増やしてほしい');
  });

  it('1件も無ければ見出しごと出さない（空の見出しを読ませない）', () => {
    const t = briefUserText([{ key: 'score', current: ['定期テスト: 英語'] }]);
    expect(t).not.toContain('前回の約束・要望');
  });
});

describe('sanitizeFollowUpItems', () => {
  it('空・重複・文字列でないものを落とす', () => {
    expect(sanitizeFollowUpItems(['あ', '  ', 'あ', 42, null, 'い'])).toEqual(['あ', 'い']);
  });

  it('配列でなければ空', () => {
    for (const raw of [null, undefined, 'ちがう', {}])
      expect(sanitizeFollowUpItems(raw)).toEqual([]);
  });

  it(`${MAX_FOLLOW_UP_ITEMS}件でとめる`, () => {
    const many = Array.from({ length: MAX_FOLLOW_UP_ITEMS + 5 }, (_, i) => `約束${i}`);
    expect(sanitizeFollowUpItems(many)).toHaveLength(MAX_FOLLOW_UP_ITEMS);
  });
});

describe('parseBriefResult（followUps）', () => {
  it('報告と聞くをそのまま拾う', () => {
    const got = parseBriefResult(
      {
        followUps: [
          { item: sentItems[0], kind: 'report', text: '長文の教材に切り替えて進めている' },
          { item: sentItems[1], kind: 'ask', text: '' },
        ],
      },
      sent,
      sentItems
    );
    expect(got.followUps).toEqual([
      { item: sentItems[0], kind: 'report', text: '長文の教材に切り替えて進めている' },
      { item: sentItems[1], kind: 'ask', text: '' },
    ]);
  });

  it('★渡していない item は捨てる（AIが言い換えた・作った約束を台本に載せない）', () => {
    const got = parseBriefResult(
      {
        followUps: [
          { item: '英語の長文を増やしてほしいそうです', kind: 'report', text: '対応済み' },
          { item: sentItems[1], kind: 'ask', text: '' },
        ],
      },
      sent,
      sentItems
    );
    expect(got.followUps.map((f) => f.item)).toEqual([sentItems[1]]);
  });

  it('同じ item が2回来たら先に来たほうを採る', () => {
    const got = parseBriefResult(
      {
        followUps: [
          { item: sentItems[0], kind: 'report', text: '先に来たほう' },
          { item: sentItems[0], kind: 'report', text: 'あとから来たほう' },
        ],
      },
      sent,
      sentItems
    );
    expect(got.followUps).toEqual([{ item: sentItems[0], kind: 'report', text: '先に来たほう' }]);
  });

  it('★kind が report / ask 以外なら ask に倒す（していない対応を報告と言わせない）', () => {
    const got = parseBriefResult(
      { followUps: [{ item: sentItems[0], kind: 'tell', text: 'あ' }] },
      sent,
      sentItems
    );
    expect(got.followUps[0].kind).toBe('ask');
  });

  it('★上限を超える text は空にする。report は本文が消えたら行ごと捨てる', () => {
    const got = parseBriefResult(
      {
        followUps: [
          { item: sentItems[0], kind: 'report', text: tooLongSeen },
          { item: sentItems[1], kind: 'ask', text: tooLongSeen },
        ],
      },
      sent,
      sentItems
    );
    // report は中身が無ければ画面に出しても読めない（呼び出し側の受け皿に落とす）
    expect(got.followUps).toEqual([{ item: sentItems[1], kind: 'ask', text: '' }]);
  });

  it(`多くても${MAX_FOLLOW_UPS}件でとめる`, () => {
    const items = Array.from({ length: MAX_FOLLOW_UPS + 3 }, (_, i) => `約束${i}`);
    const got = parseBriefResult(
      { followUps: items.map((item) => ({ item, kind: 'ask', text: '' })) },
      sent,
      items
    );
    expect(got.followUps).toHaveLength(MAX_FOLLOW_UPS);
  });

  it('followUps が無い・読めない出力でも空配列で返る（古い応答でも画面が壊れない）', () => {
    for (const raw of [{}, { followUps: 'ちがう' }, { followUps: [null, 42] }, null]) {
      expect(parseBriefResult(raw, sent, sentItems).followUps).toEqual([]);
    }
  });

  it('約束を1件も渡していなければ、AIが書いてきても空（材料の無い話をさせない）', () => {
    const got = parseBriefResult(
      { followUps: [{ item: sentItems[0], kind: 'report', text: '対応済み' }] },
      sent
    );
    expect(got.followUps).toEqual([]);
  });
});
