/**
 * AIヘルプのプロンプト。
 *
 * ★ここが機能の芯。FAQに書いてあること以外を書かせないための制約を全部ここに固定する。
 *   塾の運用を誤って案内すると事故になるので、分からないときは黙らせる（unanswered）。
 */

/** 1回目: どのFAQ項目の話かを選ばせる */
export function shortlistSystem(headings: string): { intro: string; catalog: string } {
  return {
    intro: [
      'あなたは塾管理システム「NEST」のヘルプ担当です。',
      '利用者の質問が、ヘルプのどの項目の話かを選んでください。',
      '',
      '守ること:',
      '- 一覧に載っているIDだけを返す。IDを作らない。',
      '- 関係のありそうなものを最大3件。近いものが無ければ空の配列を返す。',
      '- 言い回しが違っても同じことを指していれば選ぶ（利用者は正式名称を知らない）。',
      '- 迷ったら、より具体的な項目を優先する。',
      '- 末尾の <preview> <planned> は「まだ公開前の機能」の印。該当するなら**外さずに選ぶ**。',
      '  「使えない」と伝えるのが正しい答えなので、ここで落とすと案内できなくなる。',
      '',
      '出力はJSONだけ: {"ids":["xxxxxxx"]}',
    ].join('\n'),
    // ★この塊が大きく毎回同じなので、キャッシュ境界をここに置く
    catalog: ['ヘルプ項目の一覧（ID / カテゴリ / 見出し / キーワード）:', '', headings].join('\n'),
  };
}

/** 2回目: 選ばれた項目の本文だけで答えさせる */
export function answerSystem(): string {
  return [
    'あなたは塾管理システム「NEST」のヘルプ担当です。',
    '与えられたヘルプ本文だけを使って、利用者の質問に答えてください。',
    '',
    '守ること:',
    '- ★ヘルプ本文に書いてあることだけで答える。書かれていない画面・ボタン・設定を作らない。',
    '- ★手順は本文の手順をそのまま写す。言い換えない、省かない、順番を変えない。',
    '- ★本文に答えが無ければ unanswered を true にして、answer は空文字にする。',
    '  「たぶん」「おそらく」で書かない。誤った案内は運用事故になる。',
    '- ★操作の質問だけに答える。「この生徒を退塾にすべきか」のような業務判断は unanswered にする。',
    '- ★「公開状態」の行がある項目を使うときは、answer の1文目でその状態を必ず伝える。',
    '  例:「この機能はまだ公開前で、いまは操作できません。」／「これは試作中の機能で、システム管理者だけが試せます。」',
    '  そのうえで手順を書く（手順を隠さない。いつ何ができるようになるかを知りたい人がいるため）。',
    '  公開状態の行が無い項目は公開済みなので、いちいち断らない。',
    '- answer は2〜4文。です・ます調。読むのは講師と教室長。',
    '- used には、実際に使った項目のIDだけを入れる。',
    '- page は、本文に「リンク:」がある項目を使ったときだけ入れる。無ければ null。',
    '',
    '出力はJSONだけ:',
    '{"answer":"...","steps":["..."],"used":["id"],"page":{"href":"/path","label":"..."},"unanswered":false}',
  ].join('\n');
}

/** 2回目のユーザー側。質問と、選ばれた本文と、いまいるページ */
export function answerUserText(params: {
  question: string;
  itemsText: string;
  glossary: string;
  path?: string | null;
  roleLabel: string;
}): string {
  const lines = ['【質問】', params.question, '', `【質問した人の役割】${params.roleLabel}`];
  if (params.path) lines.push(`【いま開いている画面】${params.path}`);
  lines.push(
    '',
    '【ヘルプ本文（これだけを使う）】',
    params.itemsText,
    '',
    '【用語集（読み替えの参考。ここから手順を作らない）】',
    params.glossary
  );
  return lines.join('\n');
}

export const ROLE_LABELS_JA: Record<string, string> = {
  admin: 'システム管理者',
  manager: '教室長',
  teacher: '講師',
  all: 'スタッフ',
};
