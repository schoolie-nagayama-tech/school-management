/**
 * 掲示板の抽出プロンプトに渡す「教室の用語」。
 *
 * 正典: docs/bulletin-ai-assist.html
 *
 * ★src/lib/help/faqData.ts の GLOSSARY_DATA（用語集）とは別に持つ。
 *   あちらは保護者向けの読み替え（AIヘルプが使う）で、目的も対象読者も違う。
 *   混ぜると、片方の都合で足した語がもう片方のプロンプトを膨らませる。
 *
 * ★永山校の試用で「PCSを配布してください」が material_handout_check
 *   （教材配布チェック）に読み取られた。PCSは教材ではなく、講習前に配って
 *   回収するテストで、配布そのものはNESTに記録が残らない。
 *   教室の言葉を知らずに「配布」という動詞だけで種別を決めたのが原因なので、
 *   ここで先に教える。
 */

export interface ExtractGlossaryTerm {
  term: string;
  /** その語の意味と、抽出でどう扱うべきか */
  explanation: string;
}

export const EXTRACT_GLOSSARY: readonly ExtractGlossaryTerm[] = [
  {
    term: 'PCS',
    explanation:
      '成績アップシステムの学力診断テスト（紙）。入会前と、その後4か月に1度受ける。教材ではない' +
      '（費用は基礎教材費に含まれるが、種別としてはテスト）。' +
      '「PCSを配布」は教材配布チェックではない（NESTに配布の記録は無いので取らない）。' +
      '「PCSを回収」も取らない（講習準備の進捗は別の仕組み）。',
  },
  {
    term: 'ETS',
    explanation:
      'やる気度診断テスト（年1回・200問）。学習面と生活面の帳票が出る。教材でもテスト結果の転記でもない。' +
      '「ETSを配布」「ETSを回収」は取らない（NESTに記録が無い）。',
  },
  {
    term: '面談',
    explanation:
      '目標達成ミーティング・生徒コーチング・保護者面談・家庭への定期連絡は、NESTではすべて「面談記録」1つに残る。' +
      '種類で分けない。面談の実施依頼は13種の中に無いので取らない。',
  },
  {
    term: '進行表',
    explanation: '指導内容を入れる画面（progress_entry）。',
  },
  {
    term: '内申',
    explanation: '通知表（report_card_entry）。',
  },
  {
    term: '増コマ',
    explanation: 'テスト対策や追加授業の申込。テスト対策提案（提案書の作成）そのものではない。',
  },
];

/** 一覧を「用語 … 説明」の形で並べる */
export function formatExtractGlossary(): string {
  return EXTRACT_GLOSSARY.map((g) => `- ${g.term} … ${g.explanation}`).join('\n');
}
