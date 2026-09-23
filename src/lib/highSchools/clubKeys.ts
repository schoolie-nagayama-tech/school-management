/**
 * 部活名を「統一した部名（club_key）＋男女」に揃える。
 * ------------------------------------------------------------------
 * ★珍しさ（都立に何校あるか）と「その部活がある学校」の検索は、club_key で数える。
 *   学校ごとの表記（「サッカー部」「蹴球部」「男女硬式テニス部」）のまま数えると、
 *   同じ部が別物として数えられ、ありふれた部が「珍しい」と出てしまう。
 *
 * ★男女は club_key に含めず別に返す。男子バスケと女子バスケは別の部だが、
 *   「バスケ部がある学校」を探すときは同じ部として数えたい。
 *
 * ★このファイルは Node の .mjs からも直接 import される。他の .ts を import しない。
 */

export type ClubSex = '' | '男子' | '女子';

export interface NormalizedClub {
  clubKey: string;
  sex: ClubSex;
}

/**
 * 別名 → 統一名。左は「部」「同好会」「男子」「女子」を外したあとの形。
 * ★足すのは、実際の資料で揺れを見つけたときだけ。推測で広げると、別の部を同じ部にまとめてしまう
 *   （例：「ソフトテニス」と「硬式テニス」は別競技。まとめない）。
 */
const ALIASES: Record<string, string> = {
  蹴球: 'サッカー',
  バスケ: 'バスケットボール',
  バレー: 'バレーボール',
  野球: '硬式野球',
  テニス: '硬式テニス',
  庭球: '硬式テニス',
  ブラスバンド: '吹奏楽',
  陸上: '陸上競技',
  漫画研究: 'マンガ研究',
  漫画: 'マンガ研究',
  茶華道: '茶道・華道',
};

// 表記の揺れ（全角英数・空白・中黒のゆれ）を先に揃える
function tidy(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .replace(/[・･]/g, '・')
    .trim();
}

export function normalizeClubName(raw: string): NormalizedClub {
  // tidy の NFKC で全角括弧は半角 ( ) になる
  let s = tidy(raw);

  let sex: ClubSex = '';
  // ★末尾の括弧で男女を書く資料がある（Premiere Club の「ソフトテニス（男女）」、
  //   学校の「バレーボール部（女子）」）。外さないと「ソフトテニス(男女)」という別の部として数えられ、
  //   同じ学校の「男子ソフトテニス部」に指定が載らない（清瀬で実際に起きた）。
  const tail = s.match(/\((男女|男子|女子)\)$/);
  if (tail) {
    if (tail[1] !== '男女') sex = tail[1] as ClubSex;
    s = s.slice(0, -tail[0].length);
  }

  // 末尾の「部」「同好会」「愛好会」「（有志）」を外す
  s = s.replace(/\(有志\)$/, '').replace(/(同好会|愛好会|部)$/, '');

  // 「男女硬式テニス」は男女とも＝区別なし
  if (s.startsWith('男女')) {
    s = s.slice(2);
  } else if (s.startsWith('男子')) {
    sex = '男子';
    s = s.slice(2);
  } else if (s.startsWith('女子')) {
    sex = '女子';
    s = s.slice(2);
  }

  const clubKey = ALIASES[s] ?? s;
  return { clubKey, sex };
}
