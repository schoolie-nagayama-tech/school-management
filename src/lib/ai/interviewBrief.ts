/**
 * 面談で話すこと（旧「報告事項」）— AIとの入出力の正典。
 *
 * 正典: docs/interview-script-ai-plan.md §6（前身: docs/interview-brief-ai-plan.md）
 *
 * ★AIに投げる単位は「セクション」（成績・宿題…）のまま。面談の流れ順（①〜⑦シーン）への
 *   割り当ては src/lib/interview/scenes.ts の固定テーブルが決める。AIはどのセクションが
 *   どのシーンに出るか関知しない（並び順をAIに決めさせないという前身からの原則）。
 *
 * ★現状の行はシステムが組む。AIが書くのは「見えること」「つなげて見えること」
 *   「④の課題と⑤のプランのつながり」だけ。数字をAIに触らせない。書き写しの1字違い
 *  （72点が27点になる類）は、その場の誰にも気づけないうえ、保護者に向かって読み上げてしまう。
 *   画面には現状の行を別に出すので、AIの側に数字を持たせる必要がそもそも無い。
 *   （進行表の「これまでの引継ぎをまとめる」＝ src/lib/ai/handoverDigest.ts と同じ構え）
 *
 * ★セクションの並びはシステムが固定する。AIに順番を決めさせない。並びが毎回変わると、
 *   いつも同じ場所を見て話す準備ができなくなる。
 *
 * ★長いと結局読まれない。上限を超えたものはパーサで捨てる（字数は MAX_SEEN_LENGTH ほかの定数を見ること）。
 *   超えたものはパーサで捨てる（切り詰めない。途中で切れた文は誤読の元）。
 *
 * ★シーン作り替え（2026-09）で「話す項目」（talk）は廃止した。シーン順そのものが
 *   話す順になるため、AIに改めて並べさせる意味が無くなったため。代わりに「④の課題と
 *   ⑤のプランのつながり」（bridge）を足した。講習面談の核なので、他の見えることと
 *   混ぜずに独立させる。
 */

import { isOwnerOrAbove } from '@/lib/utils/roles';

/** セクション（固定・この順）。key はAIとの突き合わせキー、label は画面の見出し */
export const BRIEF_SECTIONS = [
  { key: 'score', label: '成績' },
  { key: 'lessons', label: '授業の様子' },
  { key: 'discipline', label: '宿題・遅刻' },
  { key: 'progress', label: '進度' },
  { key: 'koushu', label: '講習' },
  { key: 'parent', label: '保護者と' },
  { key: 'lastInterview', label: '前回の面談から' },
] as const;

export type BriefSectionKey = (typeof BRIEF_SECTIONS)[number]['key'];

/** そのセクションの色線。warn=注意して話す / good=伝えたい良い話 / 空=どちらでもない */
export type BriefSign = 'warn' | 'good' | '';

/** AIに渡す1セクション。current が空のセクションは送らない（＝画面にも出さない） */
export interface BriefSectionInput {
  key: BriefSectionKey;
  /** 現状の行。★システムが組んだ事実で、AIはここに書かれたものだけを読む */
  current: string[];
}

/** AIが返した1セクションぶん */
export interface BriefSectionResult {
  key: BriefSectionKey;
  /** そのセクションから見えること。無ければ空文字（無理に書かせない） */
  seen: string;
  sign: BriefSign;
}

export interface BriefResult {
  /** 渡したセクションぶん必ず並ぶ（読めなかったときは seen が全部空になる） */
  sections: BriefSectionResult[];
  /** 複数のセクションをつなげて初めて見えること。無ければ空文字 */
  thread: string;
  /**
   * ④現状の確認で見えた課題と、⑤プラン提示の中身のつながりを1文。
   * ★講習の提案（koushu セクション）を渡していないときは常に空文字にする
   *  （呼び出し側で強制する。プロンプトの指示だけに頼らない）。
   */
  bridge: string;
}

/**
 * 「話すこと」の上限。★超えたら空にする（途中で切らない。切れた文は誤読の元）。
 *
 * ★2026-09-22 に 40→180 へ広げた。読むのは生徒を直接見ている講師で、
 *   書いてあることが事実と違えば気づける。遠慮して当たり障りのない1文を書かせるより、
 *   見立てと切り出し方まで踏み込ませたほうが面談で使える、という判断（ユーザー指示）。
 *   数字を書かせない縛りだけは残してある（1字違いに面談の場で誰も気づけないため）。
 */
export const MAX_SEEN_LENGTH = 180;
/** 「つなげて見えること」の上限。ここがこの下書きで一番価値が出るので厚めに取る */
export const MAX_THREAD_LENGTH = 220;
/** 「④の課題と⑤のプランのつながり」の上限。コマ数の根拠を言い切らせる */
export const MAX_BRIDGE_LENGTH = 220;
/** 現状の行の上限（1セクションあたり）。これ以上並べても読む側が追えない */
export const MAX_CURRENT_LINES = 12;
/** 現状の1行の上限 */
export const MAX_CURRENT_LINE_LENGTH = 120;

/**
 * Sonnet 5 / Opus 5 の見比べで、クライアントから選ばせてよいモデルのキー名。
 * ★fast（Haiku）は面談の下書きの比較対象にしない（難所向けの smart / best 同士を
 *   見比べたいだけで、量産向けの fast は別の用途）。
 *
 * ★生のモデルID（"claude-opus-5" 等）は受け取らない。API・画面ともキー名だけを扱い、
 *   サーバー側（route.ts）で CLAUDE_MODELS を引いて実IDに変換する。
 *   クライアントが任意の文字列をAnthropicへの呼び出しパラメータへ渡せる口を作らないため。
 *
 * ★client（このファイル）と server（route.ts）の両方から使うので、
 *   'server-only' を付けている src/lib/ai/claude.ts には置かない
 *   （クライアントコンポーネントからimportできなくなる）。
 */
export const SELECTABLE_MODEL_KEYS = ['smart', 'best'] as const;
export type SelectableModelKey = (typeof SELECTABLE_MODEL_KEYS)[number];

export function isSelectableModelKey(value: unknown): value is SelectableModelKey {
  return typeof value === 'string' && (SELECTABLE_MODEL_KEYS as readonly string[]).includes(value);
}

/**
 * 画面に出す短い名前。★モデルIDそのものは出さない（比較する側が読み取りやすい名前を出す）。
 * 面談のカード（切り替え・作成者の表示）と、答え合わせの集計画面（/admin/ai-feedback）の
 * 両方から参照する。表示名を1か所にまとめないと、片方だけ直したときに名前がずれる。
 */
export const SELECTABLE_MODEL_KEY_LABELS: Record<SelectableModelKey, string> = {
  smart: 'Sonnet 5',
  best: 'Opus 5',
};

/**
 * リクエストで指定されたモデルを、実際に使ってよいキーへ倒す。
 * ★route.ts から切り出してあるのは、Supabase を絡めずに単体でテストするため
 *   （権限外は黙って既定に倒す・キー名以外は弾く、の2点はここが唯一の関所）。
 *
 * - 生のモデルID・意味の分からない文字列（isSelectableModelKey で弾く）→ 既定（best）
 * - admin / owner 以外からの指定（isOwnerOrAbove(role) で弾く）→ 既定（best）。
 *   ★エラーにしない。古いクライアント（切り替えUIが無い版）が偶然 model を送ることもあり、
 *   それは攻撃ではなく単なる古さなので、無かったことにして既定へ倒すだけでよい。
 */
export function resolveInterviewBriefModelKey(
  requestedModel: unknown,
  role: string | null | undefined
): SelectableModelKey {
  return isSelectableModelKey(requestedModel) && isOwnerOrAbove(role) ? requestedModel : 'best';
}

const SECTION_KEYS: readonly BriefSectionKey[] = BRIEF_SECTIONS.map((s) => s.key);

/** セクションの並び順（BRIEF_SECTIONS の位置）。並べ替えに使う */
function sectionOrder(key: BriefSectionKey): number {
  return SECTION_KEYS.indexOf(key);
}

/**
 * BRIEF_SECTIONS の固定順に並べ直す（元の配列は変えない）。
 *
 * ★sanitizeBriefSections に通し直すのではなく、並べ替えだけを別に用意している。
 *   サーバーが足す「授業の様子」は直近20回ぶんで、クライアント入力の行数上限（12行）に
 *   掛けてしまうと直近の8回が黙って落ちるため。
 */
export function sortBriefSections(sections: readonly BriefSectionInput[]): BriefSectionInput[] {
  return sections.slice().sort((a, b) => sectionOrder(a.key) - sectionOrder(b.key));
}

export function isBriefSectionKey(value: unknown): value is BriefSectionKey {
  return typeof value === 'string' && (SECTION_KEYS as readonly string[]).includes(value);
}

/** セクションの画面ラベル */
export function briefSectionLabel(key: BriefSectionKey): string {
  return BRIEF_SECTIONS.find((s) => s.key === key)?.label ?? key;
}

/**
 * クライアントから来た現状の行を検める。
 *
 * ★現状の行はクライアントが組んで送る（面談画面がすでに読んでいるデータから作れるので、
 *   サーバーで同じものを読み直さない）。そのぶん、ここで形と量を必ず絞る。
 * ★知らない key は捨てる（画面に出す見出しはこちらが決めるものなので、増やさせない）。
 * ★同じ key が2回来たら先に来たほうを採る（後勝ちにすると、空の行で上書きできてしまう）。
 * ★長すぎる行はここだけ切り詰める（AIの出力と違い、これはシステムが組んだ事実なので、
 *   途中で切れても嘘にはならない）。
 */
export function sanitizeBriefSections(raw: unknown): BriefSectionInput[] {
  const rows = Array.isArray(raw) ? (raw as unknown[]) : [];
  const picked = new Map<BriefSectionKey, string[]>();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as { key?: unknown; current?: unknown };
    if (!isBriefSectionKey(r.key)) continue;
    if (picked.has(r.key)) continue;

    const lines: string[] = [];
    const src = Array.isArray(r.current) ? (r.current as unknown[]) : [];
    for (const line of src) {
      if (lines.length >= MAX_CURRENT_LINES) break;
      if (typeof line !== 'string') continue;
      const text = line.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      lines.push(text.slice(0, MAX_CURRENT_LINE_LENGTH));
    }
    // 行が1つも無いセクションは持たない（「記録なし」を並べないため）
    if (lines.length === 0) continue;
    picked.set(r.key, lines);
  }

  return Array.from(picked.entries())
    .map(([key, current]) => ({ key, current }))
    .sort((a, b) => sectionOrder(a.key) - sectionOrder(b.key));
}

export function briefSystemPrompt(): string {
  return [
    'あなたは学習塾の教室長が保護者面談の直前に読む下書きを用意する係です。',
    '生徒についてシステムに記録されている【現状】を渡すので、面談で何をどう話すかを書きます。',
    '',
    '■ 読むのは塾のプロです',
    '- 読むのは教室長・講師で、その生徒を直接見ています。**書いたことが事実と違えば気づきます。**',
    '  だから遠慮して当たり障りのないことを書く必要はありません。踏み込んで書いてください。',
    '- 原因の見立て・次の一手の提案・面談での切り出し方を書いてよい。むしろそれが要ります。',
    '- ★ただし推測は推測と分かる書き方にする。「〜と思われる」「〜なら確かめたい」のように、',
    '  記録から読めることと、あなたの見立てを、読む側が切り分けられるようにしてください。',
    '  断定していいのは【現状】に書いてあることだけです。',
    '- 内部の下書きです。保護者向けの言い回しにしなくてよい。',
    '',
    '■ ★数字は書かない（これだけは変わりません）',
    '- 点数・回数・％・日付は画面に別で出ているので、あなたが書く文には要りません。',
    '- ★数字を書き直さない。書き写しもしない。',
    '  文章が事実と違えば読む側が気づきますが、**数字の1字違いは面談の場で誰も気づけません。**',
    '  「英語が2回続けて下がっている」のように、数字そのものではなく、そこから読めることを書きます。',
    '',
    '■ sections（セクションごとに話すこと）',
    '- 渡されたセクションだけを返す。渡していない key を作らない。',
    `- seen は ${MAX_SEEN_LENGTH}字まで。1文に収める必要はありません。2〜3文で、`,
    '  「何が起きているか」→「なぜそうなっていそうか」→「面談でどう切り出すか」の順に書けると理想です。',
    '- ★材料が薄いセクションは無理に書かず空文字にする。現状をそのまま言い換えただけの文も空にする。',
    '  書く価値があるときにしっかり書く、というのがここの方針です。',
    '- ★悪い話だけを並べない。良い方向のものは、良いとはっきり書く。',
    '  保護者面談は詰める場ではないので、伝えたい良い話を1つは拾ってください。',
    '- sign は "warn"（注意して話す）／"good"（伝えたい良い話）／""（どちらでもない）の3つだけ。',
    '',
    '■ thread（つなげて見えること）',
    `- ★複数のセクションをつなげて初めて見えることを ${MAX_THREAD_LENGTH}字まで。`,
    '  1つのセクションだけで言えることは書かない（それは seen の仕事）。',
    '- ここがこの下書きで一番価値が出るところです。科目・生活・家庭の記録が同じ方向を向いていないか、',
    '  逆にちぐはぐなところが無いかを探して、面談の筋にしてください。',
    '- 無ければ空文字。こじつけない。',
    '',
    '■ bridge（④の課題と⑤のプランのつながり）',
    '- 現状の確認（score・progress）で見えた課題と、講習のプラン（koushu）の中身をつなぐ。',
    `  ${MAX_BRIDGE_LENGTH}字まで。「この課題があるから、このプランのこの部分が要る」と言い切れる形で。`,
    '- 講習面談で保護者が一番聞きたいのは、なぜこのコマ数・この教科なのかです。そこに答えてください。',
    '- ★つながりが見えなければ空文字にする。無理にこじつけない。',
    '- koushu セクションを渡していないときは、この項目は使われないので考えなくてよい。',
    '',
    '出力はJSONだけ。前置きは書かない:',
    '{"sections":[{"key":"score",' +
      '"seen":"下がったのは英語だけで、数学と国語は上がっている。英語は単語の抜けが引継ぎにも出ているので、' +
      '読解ではなく語彙で落としていると思われる。面談では「英語だけ別の原因がありそう」と切り出したい。",' +
      '"sign":"warn"}],' +
      '"thread":"英語は成績・宿題・引継ぎの3つが同じ方向を向いている。' +
      'ほかの教科は崩れていないので、生活全体の問題ではなく英語の勉強のしかたの問題と見てよい。",' +
      '"bridge":"英語の語彙不足が失点に直結しているので、プランの英語8コマは読解ではなく' +
      '単語・文法の復習に寄せてある。ここを説明すればコマ数の根拠になる。"}',
  ].join('\n');
}

/**
 * 材料の並べ方。★渡す順は BRIEF_SECTIONS の固定順（呼び出し側で並べ替え済みの前提）。
 *
 * 見出しに key と日本語ラベルの両方を出す。key だけだと何のことか読み違え、
 * ラベルだけだと出力の key を書かせられない。
 */
export function briefUserText(sections: readonly BriefSectionInput[]): string {
  const blocks = sections.map((s) => {
    const lines = s.current.map((c) => `- ${c}`);
    return [`【${s.key}: ${briefSectionLabel(s.key)}】`, ...lines].join('\n');
  });
  return ['【現状】', ...blocks].join('\n');
}

/** 重複を除いた key の並び（渡した順のまま） */
function uniqueKeys(keys: readonly BriefSectionKey[]): BriefSectionKey[] {
  const out: BriefSectionKey[] = [];
  for (const k of keys) {
    if (!isBriefSectionKey(k)) continue;
    if (out.indexOf(k) !== -1) continue;
    out.push(k);
  }
  return out;
}

/** sign は3値だけ。それ以外（AIが勝手に作った語）は色線を付けない */
function takeSign(raw: unknown): BriefSign {
  return raw === 'warn' || raw === 'good' ? raw : '';
}

/**
 * AIの生の出力を、画面に出してよい形にする。★出力を信じない。
 *
 * - 渡していない key は捨てる（見出しを増やさせない）
 * - 上限を超える seen は空にする（勝手に短くしない。途中で切れた文は誤読の元）
 * - sign は3値以外を空に
 * - thread は上限を超えたら空
 * - bridge は上限を超えたら空。koushu セクションを渡していなければ、AIの出力に関わらず空にする
 *  （プロンプトで指示済みだが、パーサ側でも強制する。「渡していない材料の話をさせない」という
 *   原則をAIの言うことを信じずにコードで守るため）
 * - 読めない出力なら seen も thread も bridge も空（呼び出し側が「作れなかった」に倒せる。
 *   ★現状の行だけは画面に残るので、カード自体は成立する）
 */
export function parseBriefResult(raw: unknown, sentKeys: readonly BriefSectionKey[]): BriefResult {
  const keys = uniqueKeys(sentKeys);
  const empty: BriefResult = {
    sections: keys.map((key) => ({ key, seen: '', sign: '' as BriefSign })),
    thread: '',
    bridge: '',
  };
  if (!raw || typeof raw !== 'object') return empty;

  const obj = raw as { sections?: unknown; thread?: unknown; bridge?: unknown };

  // 渡した key ごとに1件だけ拾う（同じ key を2回返してきたら先に来たほうを採る）
  const seenByKey = new Map<BriefSectionKey, { seen: string; sign: BriefSign }>();
  const rows = Array.isArray(obj.sections) ? (obj.sections as unknown[]) : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as { key?: unknown; seen?: unknown; sign?: unknown };
    if (!isBriefSectionKey(r.key)) continue;
    // ★渡していない key。作られたものなので捨てる
    if (keys.indexOf(r.key) === -1) continue;
    if (seenByKey.has(r.key)) continue;

    const text = typeof r.seen === 'string' ? r.seen.trim() : '';
    // ★長すぎる文は空にする（切り詰めると文の途中で切れて意味が変わる）
    const seen = text.length > MAX_SEEN_LENGTH ? '' : text;
    // 見えることが無いのに色線だけ残ると、何を指した色か分からなくなる
    seenByKey.set(r.key, { seen, sign: seen ? takeSign(r.sign) : '' });
  }

  const sections: BriefSectionResult[] = keys.map((key) => {
    const hit = seenByKey.get(key);
    return { key, seen: hit?.seen ?? '', sign: hit?.sign ?? '' };
  });

  const threadRaw = typeof obj.thread === 'string' ? obj.thread.trim() : '';
  const thread = threadRaw.length > MAX_THREAD_LENGTH ? '' : threadRaw;

  const bridgeRaw = typeof obj.bridge === 'string' ? obj.bridge.trim() : '';
  // ★koushu を渡していないのにAIが書いてきたら、ここで無条件に捨てる
  const bridge =
    bridgeRaw.length > 0 && bridgeRaw.length <= MAX_BRIDGE_LENGTH && keys.indexOf('koushu') !== -1
      ? bridgeRaw
      : '';

  return { sections, thread, bridge };
}
