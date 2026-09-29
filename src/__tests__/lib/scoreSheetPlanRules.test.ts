import { describe, expect, it } from 'vitest';
import {
  chooseTier,
  draftKoma,
  planCourse,
  planEnglish,
  planMath,
  reasonText,
  type CourseBook,
} from '@/lib/scoreSheet/planRules';
import type { Evidence, PlanUnit } from '@/lib/scoreSheet/types';
// 教材の単元の並び（本番の curriculum_items と、講習一覧の都立対策コースの設定から）。個人の情報は含まない
import tb from '../fixtures/scoreSheet/textbooks.json';

type Raw = { no: string | null; title: string; tk?: number | null; tg?: number };
const units = (list: Raw[]): PlanUnit[] =>
  list.map((u, i) => ({ id: 1000 + i, no: u.no, title: u.title }));
const pcs = (label: string, mark: string): Evidence => ({
  src: 'pcs',
  srcLabel: 'PCS',
  label,
  mark,
});
const mock = (label: string, mark = '×', hard = false): Evidence => ({
  src: 'mock',
  srcLabel: '進研',
  label,
  mark,
  hard,
});
/** 単元番号で根拠を置く */
function evByNo(list: PlanUnit[], rows: [string, Evidence[]][]): Map<number, Evidence[]> {
  const m = new Map<number, Evidence[]>();
  for (const [no, ev] of rows) {
    const i = list.findIndex((u) => u.no === no);
    if (i < 0) throw new Error(no);
    m.set(i, ev);
  }
  return m;
}

// 2026-09-29 教室長と決めたプラン（中2・数学）の根拠。モック第4版と同じ
const M = units(tb.m641 as Raw[]);
const mathEv = evByNo(M, [
  ['1-4', [pcs('除法，乗除混合', '△')]],
  ['1-6', [pcs('除法，乗除混合', '△')]],
  ['1-7', [pcs('四則混合', '△'), mock('1(2) 正負の数の計算')]],
  ['2-4', [pcs('1次式と数の乗法，除法', '×')]],
  ['2-5', [pcs('いろいろな計算', '×')]],
  ['2-6', [pcs('いろいろな計算', '×')]],
  ['3-6', [mock('1(4) 単項式の乗法')]],
  ['3-7', [mock('1(4) 単項式の乗法')]],
  ['4-1', [pcs('方程式の解き方', '△')]],
  ['4-2', [pcs('方程式の解き方', '△')]],
  ['4-3', [pcs('方程式の解き方', '△')]],
  ['5-1', [mock('1(6) 等式の変形')]],
  ['5-4', [mock('連立方程式の領域')]],
  ['5-5', [mock('連立方程式の領域')]],
  ['6-1', [pcs('比例の式', '×'), mock('3(1) 比例の式と比例定数')]],
  ['6-2', [pcs('反比例の式', '×'), mock('3(2) 反比例の式と比例定数')]],
  ['6-3', [pcs('比例のグラフ', '×')]],
  ['6-4', [pcs('比例のグラフ', '×')]],
  ['6-5', [pcs('反比例のグラフ', '×')]],
  ['6-6', [pcs('反比例のグラフ', '×')]],
  ['8-1', [pcs('平面図形の基礎', '×')]],
  ['8-2', [mock('4(1) 作図')]],
  ['8-4', [pcs('円とおうぎ形の計量', '×'), mock('4(3) 円すいの展開図')]],
  ['9-1', [pcs('空間図形の基礎', '△'), mock('4(4)① 線分と平行な面')]],
  ['9-2', [pcs('立体の表面積と体積', '×'), mock('4(4)② 立体の体積')]],
  ['9-3', [pcs('立体の表面積と体積', '×')]],
  ['9-4', [pcs('立体の表面積と体積', '×')]],
]);
const calc = { chapters: ['1', '2', '3', '4'], extra: ['5-1'] };

describe('planMath（中2・数学は軽く）', () => {
  const drafts = planMath(M, { evidence: mathEv }, calc);
  const byNo = (no: string) =>
    drafts.find((d) => d.curriculum_item_id === M.find((u) => u.no === no)!.id);

  it('合計は21コマ（教室長と決めた第4版と同じ）', () => {
    expect(draftKoma(drafts)).toBe(21);
  });

  it('計算の範囲は隣り合う単元だけを束ね、3単元で1コマ', () => {
    // 1-5 をはさむので 1-4 は単独、1-6・1-7 が束ね
    expect(byNo('1-4')!.group_id).toBe(0);
    expect(byNo('1-6')!.group_id).toBeGreaterThan(0);
    expect(byNo('1-6')!.group_id).toBe(byNo('1-7')!.group_id);
    expect(byNo('2-4')!.koma_count).toBe(1);
    expect(byNo('2-5')!.koma_count).toBe(1); // 束ねた後ろの単元も1を持つ（合計は先頭だけ）
  });

  it('PCSの×と模試の×が両方ある単元は2コマで束ねない', () => {
    expect(byNo('6-1')!.koma_count).toBe(2);
    expect(byNo('6-1')!.group_id).toBe(0);
    expect(byNo('9-2')!.koma_count).toBe(2);
    // △＋模試× は「両方×」ではないので1コマ
    expect(byNo('9-1')!.koma_count).toBe(1);
  });

  it('目的タグ：PCSで× → 苦手克服、△や模試だけ → 苦手補強', () => {
    expect(byNo('6-3')!.intent_tag).toBe('苦手克服');
    expect(byNo('4-1')!.intent_tag).toBe('苦手補強');
    expect(byNo('5-1')!.intent_tag).toBe('苦手補強');
  });

  it('根拠を reason に残す', () => {
    expect(byNo('6-1')!.reason).toBe('PCS 比例の式 ×／進研 3(1) 比例の式と比例定数 ×');
  });

  it('PCSで●なのに模試で×の単元は食い違いを書く', () => {
    const good = new Map([[M.findIndex((u) => u.no === '3-6'), '単項式の乗除，式の値']]);
    const d = planMath(M, { evidence: mathEv, goodPcs: good }, calc);
    const r = d.find((x) => x.curriculum_item_id === M.find((u) => u.no === '3-6')!.id)!;
    expect(r.reason).toContain('食い違い：PCSは「単項式の乗除，式の値」●');
  });
});

describe('planEnglish（中2・英語は重く）', () => {
  const E = units(tb.e637 as Raw[]);
  const ev = evByNo(E, [
    ['3', [mock('3(3) 3人称単数現在の文')]],
    ['5', [pcs('規則動詞', '×')]],
    ['6', [pcs('what＋名詞 / how many', '×'), mock('3(1) 疑問詞で始まる疑問文')]],
    ['11', [pcs('be going to ～ / will', '×')]],
    ['12', [pcs('shall / should', '×'), pcs('must / have to', '△')]],
    ['16', [mock('4(1)「〜に見えました」')]],
    ['18', [mock('2「私はそれを〜見つけました」')]],
  ]);
  const drafts = planEnglish(E, { evidence: ev });
  const byTitle = (t: string) =>
    drafts.find((d) => d.curriculum_item_id === E.find((u) => u.title === t)!.id);

  it('合計は12コマ（第4版と同じ）', () => {
    expect(draftKoma(drafts)).toBe(12);
  });

  it('根拠2つで2コマ、弱い単元のあいだと章のまとめを定着で足す', () => {
    expect(byTitle('疑問詞')!.koma_count).toBe(2);
    expect(byTitle('助動詞')!.koma_count).toBe(2);
    expect(byTitle('be動詞と一般動詞（現在形）')!.intent_tag).toBe('定着');
    expect(byTitle('1～6章のまとめ')!.intent_tag).toBe('定着');
    expect(byTitle('7～12章のまとめ')!.intent_tag).toBe('定着');
    // 13〜17章は弱い単元が1つだけ（16）なので、まとめは足さない
    expect(byTitle('13～17章のまとめ')).toBeUndefined();
  });
});

describe('中3：講習一覧の都立対策コースに当てる', () => {
  const book = (
    key: keyof typeof tb,
    textbookId: number,
    label: string,
    isKako = false
  ): CourseBook => ({
    textbookId,
    label,
    isKako,
    units: (tb[key] as Raw[]).map((u, i) => ({
      id: textbookId * 1000 + i,
      no: u.no,
      title: u.title,
      tplKoma: u.tk ?? null,
      tplGroup: u.tg ?? 0,
    })),
  });
  const v = (label: string, mark: string, hard = false): Evidence => ({
    src: 'mock',
    srcLabel: 'Vもぎ',
    label,
    mark,
    hard,
  });
  const at = (b: CourseBook, title: string) =>
    b.units.findIndex((u) => u.title === title && u.tplKoma != null);

  it('第1志望の基準偏差値60以上で上位校、それ以外（読めないときも）中堅校', () => {
    expect(chooseTier(60)).toBe('upper');
    expect(chooseTier(47)).toBe('mid');
    expect(chooseTier(null)).toBe('mid');
  });

  it('数学（中堅校）：まとまりごと・根拠2つで＋1・過去問は5年度分 → 9コマ、必勝は外す', () => {
    const goal = book('goal_m', 646, 'フォレスタゴール');
    const hissho = book('hissho_m', 65, '必勝シリーズ（東京）');
    const kako = book('kako_m', 750, '都立入試過去問', true);
    const ev = new Map([
      [
        646,
        new Map<number, Evidence[]>([
          [at(goal, '作図'), [v('1 問9 作図', '0点')]],
          [at(goal, '空間図形①'), [v('5 問1 空間内の角の大きさ', '×→◎')]],
          [at(goal, '空間図形②'), [v('5 問2 立体の体積', '×', true)]],
          [at(goal, '１次関数の応用①'), [v('3 問2② 平行四辺形の面積', '×', true)]],
          [at(goal, '平面の中の比'), [v('4 問3 三角形の面積', '×', true)]],
        ]),
      ],
    ]);
    const r = planCourse([goal, hissho, kako], ev);
    expect(r.droppedBooks).toEqual(['必勝シリーズ（東京）']);
    const koma = r.books.map((b) => draftKoma(b.drafts));
    expect(koma).toEqual([4, 5]);
    // 難問だけが根拠のまとまりは応用発展。難問は自動で2コマにしない
    const g14 = r.books[0].drafts.find(
      (d) => d.curriculum_item_id === goal.units[at(goal, '１次関数の応用①')].id
    )!;
    expect(g14.intent_tag).toBe('応用発展');
    expect(g14.koma_count).toBe(1);
    // 過去問は直前演習で5年度分
    expect(r.books[1].drafts.every((d) => d.intent_tag === '直前演習')).toBe(true);
    expect(r.books[1].drafts.length).toBe(5);
  });

  it('間に対象外の単元をはさむまとまりは、隣り合う範囲で切り直す', () => {
    const goal = book('goal_e', 645, 'フォレスタゴール');
    // 2-3・4-1・4-2 は同じまとまりだが、間に「文法③」（コース外）がある
    const ev = new Map([
      [
        645,
        new Map<number, Evidence[]>([
          [at(goal, '対話文－全体の文脈を読み取る'), [v('3 問2 文脈把握', '×→◎')]],
        ]),
      ],
    ]);
    const r = planCourse([goal], ev);
    const d = r.books[0].drafts;
    const ids = (t: string) => goal.units.find((u) => u.title === t && u.tplKoma != null)!.id;
    const head = d.find((x) => x.curriculum_item_id === ids('対話文－全体の文脈を読み取る'))!;
    expect(head.koma_count).toBe(2); // コースの基本2コマ
    expect(head.group_id).toBe(0); // 後ろ（4-1・4-2）と離れているので単独
    expect(d.some((x) => x.curriculum_item_id === goal.units.find((u) => u.no === '4-1')!.id)).toBe(
      false
    );
  });
});

describe('reasonText', () => {
  it('難問の印を付ける', () => {
    expect(reasonText([mock('5 問2 立体の体積', '×', true)])).toBe(
      '進研 5 問2 立体の体積 ×（難問）'
    );
  });
});
