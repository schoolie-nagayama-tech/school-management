/**
 * 「保護者との連絡」— 教室長の箇条書きを、そのスレッドのやりとりの流れに合わせて文章にする。
 *
 * 正典: docs/parent-message-ai-plan.md §5・§5.2・§5.3・§5.4
 *
 * ★AIは内容を決めない。何を答えるかは教室長が箇条書きで決め、AIはそれを
 *   これまでのやりとりに合う文章にするだけ。振替・欠席・模試は別の仕組み（機能と定型）で
 *   返すので、ここには来ない（§5.4・呼び出し側の route で絞り込む）。
 *
 * ★実データ（返信95件）を読んだ結果の型: 挨拶 → 承知／お礼の一言 → 具体的な回答 → 結び。
 *   宛名（〇〇 様）はメールの癖であってチャットでは書かない、約束できないことは
 *   約束しない（「確認のうえご連絡します」）が、いちばん事故りやすいところ。
 */

/** AIに渡す1件ぶんのメッセージ。古い順に並べて渡す */
export interface ParentMessageEntry {
  /** chat_messages.id。引用（quoteMessageId）の突き合わせキーになる */
  id: string;
  senderKind: 'staff' | 'portal' | 'system';
  body: string;
  /** ISO文字列（UTC想定）。JSTに直して渡す */
  createdAt: string;
}

export interface ParentMessageResult {
  body: string;
  /** 返信先メッセージのID。教室から始める連絡（返信ではない）なら null */
  quoteMessageId: string | null;
}

/**
 * body の文字数の範囲。外れたら読めなかった扱いにして空にする（切り詰めない）。
 * ★下限は低めにしてある。長さを箇条書きの量に合わせるようにしたので（§5.2）、
 *   1行の箇条書きなら「承知しました。9月15日の授業で対策します。」（23字）で正しい。
 */
export const MIN_BODY_LENGTH = 15;
export const MAX_BODY_LENGTH = 600;

/** 材料にするメッセージの上限。スレッドの中央値は1通・最長6通なので、40件あれば十分すぎる */
export const MAX_MESSAGES = 40;

const SENDER_LABELS: Record<ParentMessageEntry['senderKind'], string> = {
  portal: '保護者',
  staff: '教室',
  system: 'システム',
};

export function parentMessageSystemPrompt(): string {
  return [
    'あなたは学習塾で保護者への連絡文を書く係です。',
    '教室長が箇条書きで用意した「答えること」を、そのスレッドのやりとりの流れに合わせて',
    '自然な文章にします。内容を決めるのは教室長で、あなたは文章にするだけです。',
    '',
    '■ いちばん大事なこと',
    '- ★箇条書きに書かれていないことは書かない。日付・時間・金額・人名・約束をこちらで作らない',
    '  （約束を作らない。決まっていないことは「確認のうえご連絡します」と書き、断定しない）。',
    '- 箇条書きに複数の質問への回答が含まれるときは、保護者が聞いた順に漏れなく答える。',
    '- すでに答えたことは繰り返さない。やりとりの中で謝罪済みのことを、もう一度謝らない。',
    '- ★やりとりが無い場合（【やりとり】が空）は、教室から始める連絡として書く。',
    '  返事をする書き方にせず、最初の1文で何の件かを示す（相手はまだ話題を知らない）。',
    '- ★宛名（〇〇 様）は書かない。チャットなので、宛名を置かずに挨拶から始める。',
    '- 書き出しと結びの言い回しは、そのスレッドで教室（staff）が使っている形に合わせる。',
    '  やりとりが無いときは「いつもお世話になっております。」のような一般的な書き出しでよい。',
    // ★長さを固定しない。固定すると箇条書きが1行でも決まり文句で水増しすることになり、
    //   「気持ちがこもっていない」と受け取られる（Gmail の AI 作文で最も多い不満）。
    //   教室側の実際の返信は中央値84字。
    '- 長さは箇条書きの量に見合うだけにする（1項目なら2〜3文で足りる）。',
    '  足りない分を挨拶や決まり文句で埋めない。長くても250字まで。です・ます調。',
    '- 返信のときは、相手の状況をひとこと受け止めてから本題に入る（受け止めは1文まで）。',
    '- 前置きや見出しは書かず、返信の本文だけを返す。',
    '',
    '■ 【いまの文】があるとき（作り直し）',
    '- 箇条書きから作り直さず、【いまの文】を【直し方】に従って直す。',
    '- ★【いまの文】は教室長が手で直していることがある。直し方に関係しない言い回し・',
    '  日付・時刻・数字は変えずにそのまま残す（足しもしない）。',
    '',
    '■ quoteMessageId（何に返信しているか）',
    '- 直前の保護者（portal）のメッセージに答えているときは、そのメッセージのIDを入れる。',
    '- 教室から始める連絡（やりとりが無い、または保護者への返信ではない）のときは null にする。',
    '- 渡されていないIDを作らない。',
    '',
    '出力はJSONだけ。前置きは書かない:',
    '{"body":"いつもお世話になっております。ご連絡いただいた件、承知しました。…",' +
      '"quoteMessageId":"<渡されたメッセージのID or null>"}',
  ].join('\n');
}

/** ISO文字列をJSTの 'YYYY/MM/DD' にする。読めない値はそのまま返す（表示を壊さない） */
function formatJstDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // en-CA は 'YYYY-MM-DD' 固定の並びを返すので、区切りだけ '/' に直す
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }).replace(/-/g, '/');
}

/**
 * 材料の並べ方。★古い順のまま渡す（並べ替えない）。
 *
 * 各行は `[id] YYYY/MM/DD 送信者: 本文`。id を先頭に置くのは、AIが quoteMessageId として
 * そのまま拾えるようにするため（本文の突き合わせより確実）。
 */
export function parentMessageUserText(params: {
  messages: readonly ParentMessageEntry[];
  /** 生徒の学年ラベル（例: '中2'）。未設定なら空文字 */
  gradeLabel: string;
  /** 教室長が書いた「答えること」の箇条書き */
  points: string;
  /** 作り直しの指示（「もう少し短く」等）。無ければ省く */
  instruction?: string;
  /**
   * いま返信欄にある文（作り直しのときだけ）。
   * ★作り直しは、箇条書きからではなくこの文に効かせる。教室長が手で直した部分を
   *   捨てずに済むように（箇条書きから作り直すと、直した部分が毎回消える）。
   */
  currentDraft?: string;
}): string {
  const { messages, gradeLabel, points, instruction, currentDraft } = params;

  const out: string[] = [];
  if (gradeLabel) out.push(`【生徒の学年】${gradeLabel}`);

  if (messages.length === 0) {
    out.push('【やりとり】まだメッセージはありません（教室から始める連絡です）');
  } else {
    out.push(`【やりとり（古い順・${messages.length}件）】`);
    for (const m of messages) {
      const body = m.body.replace(/\s+/g, ' ').trim();
      out.push(`[${m.id}] ${formatJstDate(m.createdAt)} ${SENDER_LABELS[m.senderKind]}: ${body}`);
    }
  }

  out.push('');
  out.push('【答えること（箇条書き）】');
  out.push(points.trim());

  // ★直し方が無いときは渡さない（初回の「文章にする」は箇条書きから作る）
  if (instruction && instruction.trim() && currentDraft && currentDraft.trim()) {
    out.push('');
    out.push('【いまの文（これを直す）】');
    out.push(currentDraft.trim());
  }

  if (instruction && instruction.trim()) {
    out.push('');
    out.push('【直し方】');
    out.push(instruction.trim());
  }

  return out.join('\n');
}

/**
 * AIの生の出力を、返信欄に入れてよい形にする。★出力を信じない。
 *
 * - body が短すぎる・長すぎるものは捨てる（切り詰めると事実が途中で切れて誤読の元になる）。
 * - quoteMessageId は渡したメッセージのIDに無ければ null にする（作られたIDを信じない）。
 * - 読めない出力は body が空文字になり、呼び出し側が degraded に倒す。
 */
export function parseParentMessageResult(
  raw: unknown,
  sentIds: readonly string[]
): ParentMessageResult {
  const empty: ParentMessageResult = { body: '', quoteMessageId: null };
  if (!raw || typeof raw !== 'object') return empty;

  const obj = raw as { body?: unknown; quoteMessageId?: unknown };
  if (typeof obj.body !== 'string') return empty;

  const body = obj.body.trim();
  if (body.length < MIN_BODY_LENGTH || body.length > MAX_BODY_LENGTH) return empty;

  const idSet = new Set(sentIds);
  const quoteMessageId =
    typeof obj.quoteMessageId === 'string' && idSet.has(obj.quoteMessageId)
      ? obj.quoteMessageId
      : null;

  return { body, quoteMessageId };
}
