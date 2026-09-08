/**
 * 掲示板の抽出プロンプトのテスト。
 *
 * ★永山校の試用で「PCSを配布してください」が教材配布チェックに読み取られた。
 *   PCSは教材ではなく講習前に配って回収するテストなので、教室の用語として
 *   プロンプトに教えておく必要がある。ここでは中身のロジックではなく、
 *   「その説明がプロンプトに実際に含まれているか」だけを固定する。
 */
import { describe, expect, it } from 'vitest';
import { extractSystemPrompt } from '@/lib/bulletin/extractPrompt';
import { EXTRACT_GLOSSARY, formatExtractGlossary } from '@/lib/bulletin/extractGlossary';

describe('抽出システムプロンプトの用語集', () => {
  const prompt = extractSystemPrompt();

  it('【教室の用語】の見出しがある', () => {
    expect(prompt).toContain('【教室の用語】');
  });

  it('PCSの説明が含まれ、教材ではないと明記している', () => {
    expect(prompt).toContain('PCS');
    expect(prompt).toContain('教材ではない');
  });

  it('用語が用語集にあればその意味で読む、という指示が入っている', () => {
    expect(prompt).toContain('似た言葉（配布・回収）だけで種別を決めない');
  });

  it('attending_school（通学校で絞る）の説明が入っている', () => {
    expect(prompt).toContain('attending_school');
    expect(prompt).toContain('通学校で絞る');
  });

  it('specific_students は生徒の名前が挙がった場合だけ、と学校名を除外している', () => {
    expect(prompt).toContain('学校名は specific_students ではなく attending_school');
  });

  it('出力例に target_school_names が入っている', () => {
    expect(prompt).toContain('target_school_names');
  });

  it('glossary を差し替えられる（テスト用の口）', () => {
    const custom = extractSystemPrompt({ glossary: 'ダミーの用語集' });
    expect(custom).toContain('ダミーの用語集');
    expect(custom).not.toContain('PCS');
  });
});

describe('教室の用語集そのもの', () => {
  it('PCSがテストであり教材でないと書かれている', () => {
    const pcs = EXTRACT_GLOSSARY.find((g) => g.term === 'PCS');
    expect(pcs).toBeTruthy();
    expect(pcs?.explanation).toContain('テスト');
    expect(pcs?.explanation).toContain('教材ではない');
  });

  it('formatExtractGlossary は各語を1行ずつ並べる', () => {
    const text = formatExtractGlossary();
    for (const g of EXTRACT_GLOSSARY) {
      expect(text).toContain(g.term);
    }
  });
});
