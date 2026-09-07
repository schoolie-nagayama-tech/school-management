/**
 * 「今日の段取り」のテスト。
 *
 * ★守りたいのは3点:
 *  - 渡していないコマ・渡していない日付に用事が置かれないこと
 *    （置かれると、その項目は画面のどの見出しにも属さず消えて見える）
 *  - 読めない出力で段取りが壊れないこと（空を返して呼び出し側が「組めなかった」に倒せる）
 *  - 差し込みが1件ぶんの入れ場所しか返さないこと
 *    （ここで段取り全体を返せるようにすると、手で直した並びが吹き飛ぶ）
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ITEMS_PER_BLOCK,
  MAX_TEXT_LENGTH,
  MAX_WHY_LENGTH,
  WORK_END,
  parsePlaceResult,
  parsePlanResult,
  placeSystemPrompt,
  planBlocksForSchool,
  planSystemPrompt,
  planUserText,
  validatePlanForSave,
  type PlanBlock,
  type PlanMaterials,
} from '@/lib/ai/todayPlan';

const SLOT_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const SLOT_B = 'bbbbbbbb-2222-4222-8222-222222222222';

const ALLOWED_BLOCKS: PlanBlock[] = planBlocksForSchool([{ id: SLOT_A }, { id: SLOT_B }]);
const ALLOWED_TODOS = ['material:s1', 'task:t1'];
const ALLOWED_DAYS = ['2026-09-09', '2026-09-10'];

const parse = (raw: unknown) =>
  parsePlanResult(raw, {
    allowedBlocks: ALLOWED_BLOCKS,
    allowedTodoIds: ALLOWED_TODOS,
    allowedDays: ALLOWED_DAYS,
  });

const materials: PlanMaterials = {
  date: '2026-09-07',
  workHours: { start: '13:00', end: '21:30' },
  slots: [
    { id: SLOT_A, label: '3限', start: '16:20', end: '17:50' },
    { id: SLOT_B, label: '4限', start: '17:55', end: '19:25' },
  ],
  lessons: [{ slotId: SLOT_A, studentSurname: '山田', teacherSurname: '佐藤' }],
  todos: [{ id: 'material:s1', text: '届いた教材を渡す', studentSurname: '山田' }],
  upcomingLessonDays: ALLOWED_DAYS,
};

describe('planBlocksForSchool', () => {
  it('授業前 → コマ（時間順） → 片付け → 明日以降 の順に並ぶ', () => {
    expect(planBlocksForSchool([{ id: SLOT_A }, { id: SLOT_B }])).toEqual([
      'before',
      `slot:${SLOT_A}`,
      `slot:${SLOT_B}`,
      'after',
      'later',
    ]);
  });

  it('コマが1つも無くても、授業前・片付け・明日以降は残る', () => {
    expect(planBlocksForSchool([])).toEqual(['before', 'after', 'later']);
  });
});

describe('planSystemPrompt', () => {
  it('★組み直さないことを伝える（作り直すと手で直した並びが消える）', () => {
    expect(planSystemPrompt()).toContain('作り直さない');
  });

  it('★データにない予定を作らせない', () => {
    expect(planSystemPrompt()).toContain('データにない予定を作らない');
  });

  it('生徒・講師は姓だけだと伝える', () => {
    expect(planSystemPrompt()).toContain('姓');
  });

  it(`1日は ${WORK_END} で終わると伝える`, () => {
    expect(planSystemPrompt()).toContain(WORK_END);
  });

  it('時間帯ごとの件数の上限を伝える', () => {
    expect(planSystemPrompt()).toContain(`${MAX_ITEMS_PER_BLOCK}件`);
  });
});

describe('planUserText', () => {
  it('コマIDと生徒の姓を渡す（フルネームは渡さない）', () => {
    const text = planUserText(materials);
    expect(text).toContain(SLOT_A);
    expect(text).toContain('山田');
    expect(text).toContain('材');
  });

  it('この先で授業がある日を渡す（later の行き先になる）', () => {
    expect(planUserText(materials)).toContain('2026-09-09');
  });

  it('授業がある日が無ければ later を使えないと伝える', () => {
    const text = planUserText({ ...materials, upcomingLessonDays: [] });
    expect(text).toContain('later は使えません');
  });
});

describe('parsePlanResult', () => {
  it('渡したコマに置かれた項目はそのまま通る', () => {
    const out = parse({
      items: [{ block: `slot:${SLOT_A}`, text: '山田さんに教材を渡す', why: '3限に来るため' }],
    });
    expect(out).toEqual([
      { block: `slot:${SLOT_A}`, text: '山田さんに教材を渡す', why: '3限に来るため' },
    ]);
  });

  it('★許されていない時間帯は捨てる（作り話のコマIDに気づけないため）', () => {
    const out = parse({
      items: [
        { block: 'slot:cccccccc-3333-4333-8333-333333333333', text: 'あ', why: 'い' },
        { block: 'evening', text: 'う', why: 'え' },
        { block: 'before', text: '報告書を確認する', why: '未提出があるため' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].block).toBe('before');
  });

  it(`★1つの時間帯につき${MAX_ITEMS_PER_BLOCK}件で切る`, () => {
    const out = parse({
      items: Array.from({ length: 7 }, (_, i) => ({
        block: 'before',
        text: `用事${i}`,
        why: '理由',
      })),
    });
    expect(out).toHaveLength(MAX_ITEMS_PER_BLOCK);
  });

  it('時間帯ごとに数えるので、別の時間帯なら4件を超えて残る', () => {
    const out = parse({
      items: [
        ...Array.from({ length: 4 }, (_, i) => ({ block: 'before', text: `前${i}`, why: 'り' })),
        ...Array.from({ length: 3 }, (_, i) => ({ block: 'after', text: `後${i}`, why: 'り' })),
      ],
    });
    expect(out).toHaveLength(7);
  });

  it('★later の when が「授業がある日」に無ければ捨てる（誰もいない日に回されるため）', () => {
    const out = parse({
      items: [
        { block: 'later', text: '面談の日程を聞く', why: '今日は来ないため', when: '2026-09-08' },
        { block: 'later', text: '模試の案内を渡す', why: '今日は来ないため', when: '2026-09-10' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].when).toBe('2026-09-10');
  });

  it('later なのに when が無ければ捨てる（いつやるか決まっていない）', () => {
    expect(parse({ items: [{ block: 'later', text: 'あ', why: 'い' }] })).toEqual([]);
  });

  it('later 以外に付いてきた when は落とす', () => {
    const out = parse({
      items: [{ block: 'before', text: 'あ', why: 'い', when: '2026-09-10' }],
    });
    expect(out[0].when).toBeUndefined();
  });

  it('★長すぎる本文・理由の行は捨てる（切り詰めると文の途中で切れて意味が変わる）', () => {
    const out = parse({
      items: [
        { block: 'before', text: 'あ'.repeat(MAX_TEXT_LENGTH + 1), why: 'り' },
        { block: 'after', text: 'い', why: 'う'.repeat(MAX_WHY_LENGTH + 1) },
        { block: 'before', text: 'あ'.repeat(MAX_TEXT_LENGTH), why: 'り' },
      ],
    });
    expect(out).toHaveLength(1);
  });

  it('★渡していない todoId は外すが、項目そのものは残す（用事が消えるほうが困る）', () => {
    const out = parse({
      items: [
        { block: 'before', text: 'あ', why: 'い', todoId: 'material:unknown' },
        { block: 'after', text: 'う', why: 'え', todoId: 'task:t1' },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0].todoId).toBeUndefined();
    expect(out[1].todoId).toBe('task:t1');
  });

  it('★読めない出力なら空（呼び出し側が「組めなかった」に倒せる）', () => {
    expect(parse(null)).toEqual([]);
    expect(parse('こんにちは')).toEqual([]);
    expect(parse({})).toEqual([]);
    expect(parse({ items: 'あ' })).toEqual([]);
    expect(parse({ items: [1, 2, null] })).toEqual([]);
    expect(parse({ items: [{ block: 'before' }] })).toEqual([]);
    expect(parse({ items: [{ block: 'before', text: '   ', why: 'り' }] })).toEqual([]);
  });
});

describe('placeSystemPrompt', () => {
  it('★段取り全体を作り直させない（触るのは1件だけ）', () => {
    const p = placeSystemPrompt();
    expect(p).toContain('作り直さない');
    expect(p).toContain('1件');
  });

  it('データにない予定を作らせない・姓だけだと伝える・21:30で終わる', () => {
    const p = placeSystemPrompt();
    expect(p).toContain('データにない予定を作らない');
    expect(p).toContain('姓');
    expect(p).toContain(WORK_END);
  });
});

describe('parsePlaceResult', () => {
  const place = (raw: unknown) =>
    parsePlaceResult(raw, { allowedBlocks: ALLOWED_BLOCKS, allowedDays: ALLOWED_DAYS });

  it('★返るのは1件ぶんの入れ場所だけ（段取りの配列にならない）', () => {
    const out = place({ block: `slot:${SLOT_B}`, why: '山田さんが4限に来るため' });
    expect(out).toEqual({ block: `slot:${SLOT_B}`, why: '山田さんが4限に来るため' });
  });

  it('段取りを丸ごと返してきても採らない', () => {
    expect(place({ items: [{ block: 'before', text: 'あ', why: 'い' }] })).toBeNull();
  });

  it('許されていない時間帯なら null（呼び出し側が既定の置き場所に倒す）', () => {
    expect(place({ block: 'slot:cccccccc-3333-4333-8333-333333333333', why: 'り' })).toBeNull();
    expect(place({ block: 'midnight', why: 'り' })).toBeNull();
  });

  it('later は「授業がある日」でなければ null', () => {
    expect(place({ block: 'later', when: '2026-09-08', why: 'り' })).toBeNull();
    expect(place({ block: 'later', when: '2026-09-09', why: 'り' })?.when).toBe('2026-09-09');
  });

  it('★理由が長すぎるだけで用事を落とさない。理由だけ空にして置き場所は採る', () => {
    const out = place({ block: 'before', why: 'り'.repeat(MAX_WHY_LENGTH + 1) });
    expect(out?.block).toBe('before');
    expect(out?.why).toBe('');
  });

  it('読めない出力なら null', () => {
    expect(place(null)).toBeNull();
    expect(place('before')).toBeNull();
    expect(place({})).toBeNull();
  });
});

describe('validatePlanForSave', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    id: 'id-1',
    block: 'before',
    text: '報告書を確認する',
    why: '未提出があるため',
    done: false,
    source: 'ai',
    ...over,
  });

  it('形が合っていれば通る', () => {
    const out = validatePlanForSave([item()], ALLOWED_BLOCKS);
    expect(out).toHaveLength(1);
    expect(out?.[0].source).toBe('ai');
  });

  it('★IDが重複していたら丸ごと弾く（チェックがどの行に効くか決まらない）', () => {
    expect(validatePlanForSave([item(), item()], ALLOWED_BLOCKS)).toBeNull();
  });

  it('許されていない時間帯があれば丸ごと弾く', () => {
    expect(validatePlanForSave([item({ block: 'evening' })], ALLOWED_BLOCKS)).toBeNull();
  });

  it('配列でなければ弾く', () => {
    expect(validatePlanForSave({ items: [] }, ALLOWED_BLOCKS)).toBeNull();
  });

  it('空の段取り（全部消した状態）は保存してよい', () => {
    expect(validatePlanForSave([], ALLOWED_BLOCKS)).toEqual([]);
  });
});
