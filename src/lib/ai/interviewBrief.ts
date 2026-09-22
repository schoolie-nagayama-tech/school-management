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
 * ★長いと結局読まれない。見えることは40字・つなげて見えること／つながりは80字で、
 *   超えたものはパーサで捨てる（切り詰めない。途中で切れた文は誤読の元）。
 *
 * ★シーン作り替え（2026-09）で「話す項目」（talk）は廃止した。シーン順そのものが
 *   話す順になるため、AIに改めて並べさせる意味が無くなったため。代わりに「④の課題と
 *   ⑤のプランのつながり」（bridge）を足した。講習面談の核なので、他の見えることと
 *   混ぜずに独立させる。
 */

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

/** 「見えること」1文の上限。★超えたら空にする（切り詰めない） */
export const MAX_SEEN_LENGTH = 40;
/** 「つなげて見えること」1文の上限 */
export const MAX_THREAD_LENGTH = 80;
/** 「④の課題と⑤のプランのつながり」1文の上限 */
export const MAX_BRIDGE_LENGTH = 80;
/** 現状の行の上限（1セクションあたり）。これ以上並べても読む側が追えない */
export const MAX_CURRENT_LINES = 12;
/** 現状の1行の上限 */
export const MAX_CURRENT_LINE_LENGTH = 120;

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
    'あなたは学習塾の教室長が保護者面談の直前に読む「報告事項」を用意する係です。',
    '生徒についてシステムに記録されている【現状】を渡すので、そこから読めることだけを短く書きます。',
    '',
    '■ いちばん大事なこと',
    '- ★【現状】に書かれた数字と事実だけから読む。書かれていないことを足さない。',
    '  原因の推測・一般論・指導方針の提案・励ましは書かない。',
    '- ★数字を書き直さない。書き写しもしない。点数・回数・％・日付は画面に別で出ているので、',
    '  あなたが書く文には要りません。「英語が2回続けて下がっている」のように、',
    '  数字そのものではなく、そこから読めることを書きます。',
    '- ★悪い話だけにしない。良い方向のものがあれば、良いと書く。',
    '- 内部メモなので、保護者向けの言い回しにしなくてよい。',
    '',
    '■ sections（セクションごとに見えること）',
    '- 渡されたセクションだけを返す。渡していない key を作らない。',
    `- seen はそのセクションから見えることを1文・${MAX_SEEN_LENGTH}字まで。`,
    '- ★見えることが無いセクションは seen を空文字にする。無理に書かない。',
    '  現状をそのまま言い換えただけの文なら、空文字にしてください。',
    '- sign は "warn"（注意して話す）／"good"（伝えたい良い話）／""（どちらでもない）の3つだけ。',
    '',
    '■ thread（つなげて見えること）',
    `- ★複数のセクションをつなげて初めて見えることだけを1文・${MAX_THREAD_LENGTH}字まで。`,
    '  1つのセクションだけで言えることは書かない（それは seen の仕事）。',
    '- 無ければ空文字。',
    '',
    '■ bridge（④の課題と⑤のプランのつながり）',
    `- 現状の確認（score・progress）で見えた課題と、講習のプラン（koushu）の中身をつなぐ1文だけを`,
    `  ${MAX_BRIDGE_LENGTH}字までで書く。`,
    '- ★つながりが見えなければ空文字にする。無理にこじつけない。',
    '- koushu セクションを渡していないときは、この項目は使われないので考えなくてよい。',
    '',
    '出力はJSONだけ。前置きは書かない:',
    '{"sections":[{"key":"score","seen":"下がったのは英語だけ。数学は続けて上がっている","sign":"warn"}],' +
      '"thread":"英語だけ、成績と宿題が同じ方向を向いている",' +
      '"bridge":"英語の単語不足 → プランの英語8コマ（単語・文法の復習）につながる"}',
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
 * - 40字を超える seen は空にする（勝手に短くしない。途中で切れた文は誤読の元）
 * - sign は3値以外を空に
 * - thread は80字超なら空
 * - bridge は80字超なら空。koushu セクションを渡していなければ、AIの出力に関わらず空にする
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
