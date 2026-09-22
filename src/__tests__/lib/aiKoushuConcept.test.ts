/**
 * 講習テーマの書き足しのテスト。
 *
 * ★守りたいのは3点:
 *  - 持っていない成績に触れさせないこと（263名中102名に内申が無い）
 *  - 渡していない提案書のテーマを作らせないこと
 *  - テーマが1行のままであること（複数行になると一覧の見出しが崩れる）
 */
import { describe, expect, it } from 'vitest';
import {
  conceptSystemPrompt,
  conceptUserText,
  formatUnitsLine,
  MAX_THEME_LENGTH,
  MAX_UNITS_SHOWN,
  parseConceptResult,
  type ConceptInput,
} from '@/lib/ai/koushuConcept';

const base: ConceptInput = {
  proposalId: '11111111-1111-4111-8111-111111111111',
  theme: '予習',
  gradeLabel: '中1',
  subject: 'english',
  units: [{ title: '助動詞', koma: 3 }],
  testScore: null,
  reportCard: null,
};

describe('conceptUserText', () => {
  it('★成績が無いときは「触れないこと」と伝える', () => {
    const t = conceptUserText([base]);
    expect(t).toContain('記録なし');
    expect(t).toContain('成績には触れないこと');
  });

  it('成績があるときだけ数値を渡す', () => {
    const t = conceptUserText([
      { ...base, testScore: { label: '1学期期末', value: 52 }, reportCard: null },
    ]);
    expect(t).toContain('1学期期末 52点');
    expect(t).not.toContain('内申');
  });

  it('教室長が書いた一言をそのまま渡す（言い換えない）', () => {
    expect(conceptUserText([base])).toContain('教室長が書いた一言: 予習');
  });

  it('一言が空でもそう伝える', () => {
    expect(conceptUserText([{ ...base, theme: '  ' }])).toContain('（空）');
  });

  it('単元が無ければ「未選択」と伝える（勝手に埋めさせない）', () => {
    expect(conceptUserText([{ ...base, units: [] }])).toContain('（未選択）');
  });
});

/**
 * 単元の並べ方。
 *
 * ★本番の単元は多く、21件以上が286件（37%）、最大116件ある。
 *   全部並べるとAIは1件だけ選んで書き、計画のごく一部を指す文になってしまう。
 */
describe('formatUnitsLine', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ title: `単元${i + 1}`, koma: 1 }));

  it('件数と合計コマ数を先に伝える（AIに足し算させない）', () => {
    const line = formatUnitsLine([
      { title: '助動詞', koma: 3 },
      { title: '受動態', koma: 2 },
    ]);
    expect(line).toContain('単元（2件・計5コマ）');
  });

  it('少ないうちは全部そのまま並べる', () => {
    const line = formatUnitsLine(many(MAX_UNITS_SHOWN));
    expect(line).toContain('単元1 1コマ');
    expect(line).toContain(`単元${MAX_UNITS_SHOWN} 1コマ`);
    expect(line).not.toContain('省略');
  });

  it('多いときは頭と尻を残して間を省く（範囲が分かればよい）', () => {
    const line = formatUnitsLine(many(42));
    expect(line).toContain('単元（42件・計42コマ）');
    expect(line).toContain('単元1 1コマ'); // 最初
    expect(line).toContain('単元42 1コマ'); // 最後＝ここまでが範囲
    expect(line).not.toContain('単元20 1コマ'); // 間は省く
  });

  it('★省いた件数を明示する（黙って切ると「やらない」と読まれる）', () => {
    const line = formatUnitsLine(many(42));
    expect(line).toContain('間の30件は省略');
    expect(line).toContain('やらないという意味ではない');
  });

  it('本番の最大（116件）でも1行のまま短く収まる', () => {
    const line = formatUnitsLine(many(116));
    expect(line).toContain('単元（116件・計116コマ）');
    expect(line).not.toContain(String.fromCharCode(10)); // 1行のまま
    expect(line.length).toBeLessThan(400);
  });

  it('単元が無ければ「未選択」', () => {
    expect(formatUnitsLine([])).toBe('単元: （未選択）');
  });
});

describe('parseConceptResult', () => {
  it('渡したidのテーマだけを採る', () => {
    const got = parseConceptResult(
      { themes: [{ id: base.proposalId, theme: '2学期の助動詞に入ります' }] },
      [base]
    );
    expect(got).toEqual([{ proposalId: base.proposalId, theme: '2学期の助動詞に入ります' }]);
  });

  it('★渡していないidは捨てる（別の提案書を書き換えさせない）', () => {
    const got = parseConceptResult(
      { themes: [{ id: '99999999-9999-4999-8999-999999999999', theme: 'よそのテーマ' }] },
      [base]
    );
    expect(got).toEqual([]);
  });

  it('★改行は潰して1行にする（一覧の見出しが崩れる）', () => {
    const got = parseConceptResult({ themes: [{ id: base.proposalId, theme: '1行目\n2行目' }] }, [
      base,
    ]);
    expect(got[0].theme).toBe('1行目 2行目');
  });

  it('同じidを2回返されても1つだけ採る', () => {
    const got = parseConceptResult(
      {
        themes: [
          { id: base.proposalId, theme: '先のもの' },
          { id: base.proposalId, theme: '後のもの' },
        ],
      },
      [base]
    );
    expect(got).toHaveLength(1);
    expect(got[0].theme).toBe('先のもの');
  });

  it('長すぎるテーマは切る', () => {
    const got = parseConceptResult({ themes: [{ id: base.proposalId, theme: 'あ'.repeat(300) }] }, [
      base,
    ]);
    expect(got[0].theme).toHaveLength(MAX_THEME_LENGTH);
  });

  it('空のテーマは採らない（元のテーマを消させない）', () => {
    expect(parseConceptResult({ themes: [{ id: base.proposalId, theme: '  ' }] }, [base])).toEqual(
      []
    );
  });

  it('読めない出力は空を返す', () => {
    for (const raw of [null, 'こんにちは', {}, { themes: 'だめ' }, { themes: [1] }]) {
      expect(parseConceptResult(raw, [base])).toEqual([]);
    }
  });
});

describe('conceptSystemPrompt', () => {
  it('★成績が無ければ触れないという約束を含む', () => {
    const p = conceptSystemPrompt();
    expect(p).toContain('成績には一切触れない');
    expect(p).toContain('決めつけない');
  });

  it('★点数そのものを書かせない（保護者が読む）', () => {
    expect(conceptSystemPrompt()).toContain('数値そのものは書かない');
  });

  it('★型に嵌めない・推薦文にしないという約束を含む', () => {
    const p = conceptSystemPrompt();
    expect(p).toContain('型に嵌めない');
    expect(p).toContain('推薦文');
  });

  it('★志望校を書かせない', () => {
    expect(conceptSystemPrompt()).toContain('志望校');
  });
});
