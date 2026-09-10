/**
 * 「おまかせ下書き」— 保護者向けの投稿は「お知らせの体裁」で書く。
 *
 * 正典: docs/ai-features-integration-plan.md §2-2
 *
 * ★compose.ts（社内向け）とプロンプト・パーサを分ける理由:
 *   社内向けは「①〜してください」の箇条書き連絡だが、保護者が読む投稿は
 *   題名・本文・箇条書き・結びのある「お知らせ」の形になる。書式が違うので
 *   同じプロンプトで出し分けようとすると、どちらつかずの中途半端な文になる。
 *
 * ★宛名（「保護者の皆さまへ」）と日付は書かせない。ポータルの画面が
 *   投稿日と配信先をすでに表示するので、本文にも書くと二重になる。
 *
 * ★空欄で逃げない・教室内でしか通じない情報を書かない・filled に申告する、という
 *   歯止めは compose.ts と同じ考え方。「補ったところ」の検証ロジックは
 *   compose.ts の parseFilledNotes をそのまま使う（二重定義しない）。
 *
 * 出力は blocksToHtml（htmlLines.ts）にそのまま渡せる ComposeBlock[] に変換する
 * （noticeToBlocks）。画面側（AiWriteBar・blocksToHtml）を変えずに済ませるため。
 */

import { FILLED_KINDS, parseFilledNotes, type ComposeBlock, type FilledNote } from './compose';

/** お知らせの中身。まだ検証していない生の入力からここまで整えたもの */
export interface Notice {
  title: string;
  lead: string;
  items: string[];
  note: string;
  closing: string;
}

export interface NoticeResult {
  notice: Notice;
  filled: FilledNote[];
}

/** 空のお知らせ。★「作れなかった」の印として使う（compose.ts の blocks:[] と同じ扱い） */
const EMPTY_NOTICE: Notice = { title: '', lead: '', items: [], note: '', closing: '' };

export const MAX_TITLE_LENGTH = 60;
export const MAX_LEAD_LENGTH = 200;
export const MAX_ITEM_LENGTH = 120;
export const MAX_ITEMS = 10;
export const MAX_NOTE_LENGTH = 200;
export const MAX_CLOSING_LENGTH = 100;

export function composeNoticeSystemPrompt(): string {
  return [
    'あなたは学習塾の教室長です。教室から保護者に向けたお知らせを、最後まで書き切ります。',
    '',
    '■ 読む相手',
    '- 保護者です。教室の内部事情ではなく、保護者が知りたいことを書きます。',
    '',
    '■ 出す形（お知らせの体裁）',
    '- title: 何のお知らせかを1行で。「【】」のような装飾記号は使いません。',
    '- lead: 用件を先に言う1〜2文。',
    '- items: 日時・場所・持ち物・やることなど、箇条書きにしたほうが伝わるもの。無ければ空の配列にします。',
    '- note: 補足があれば1〜2文。無ければ空文字にします。',
    '- closing: 結びの1文（「ご不明な点は教室までご連絡ください」程度）。作り話をしない。',
    '',
    '■ 書かないもの',
    '- ★宛名（「保護者の皆さまへ」など）は書きません。★日付も書きません。',
    '  どちらもポータルの画面が投稿日・配信先としてすでに表示するので、本文に書くと二重になります。',
    '- ★その教室の中でしか通じない情報（教材の棚番号・内線番号・人名・金額）。',
    '  これは推測しようがなく、外すと保護者が困ります。触れずに書きます（空欄にもしません）。',
    '',
    '■ 挨拶',
    '- 「いつもお世話になっております。」のような定型の1文までは書いてよい。',
    '  「お疲れさまです」は社内向けの言い方なので、保護者向けには使いません。',
    '',
    '■ 空欄を作らない',
    '- ★空欄で逃げない。角括弧・「未定」・「〜については追って」で終わらせない。',
    '  塾のお知らせとしてふつうに入る内容は、自分で決めて書き切ります。',
    '- 決めた内容は、投稿する前に教室長が直します。書かないより、書いて直させるほうがよい。',
    '',
    '■ 補ったものを申告する',
    '- 指示に書かれていないのに自分で決めたことを filled に並べます。',
    '  what=本文に書いた内容の短い抜き出し / kind=次のどれか: ' + FILLED_KINDS.join('・'),
    '- ★言い回しを整えただけのものは入れません。中身を足したものだけを入れます。',
    '- 指示にそのまま書かれていたことは入れません。',
    '',
    '■ 直しの指示が来たとき',
    '- いまの本文が一緒に渡されます。指示された箇所だけを変え、ほかはそのまま残します。',
    '- このときの filled は、その直しで新しく決めたぶんだけにします。',
    '',
    '出力はJSONだけ。前置きは書かない:',
    '{"title":"◯月のお休みのお知らせ","lead":"来月の休校日をお知らせします。",' +
      '"items":["9月23日（水・祝）","9月30日（水）は台風接近のため休校"],' +
      '"note":"通常授業は翌週に振替します。","closing":"ご不明な点は教室までご連絡ください。",' +
      '"filled":[{"what":"通常授業は翌週に振替します","kind":"段取り"}]}',
  ].join('\n');
}

/** 1つの値を、長さの上限つきで検証する。空・上限超えは捨てる（空文字を返す） */
function str(raw: unknown, maxLength: number): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length > maxLength) return '';
  return trimmed;
}

/**
 * AIの生の出力を、使ってよい形にする。
 * ★title と lead が無ければ「作れなかった」扱いにする（compose.ts の blocks.length===0 と同じ）。
 *   items・note・closing は無くてもお知らせとして成立するため必須にしない。
 */
export function parseNoticeResult(raw: unknown): NoticeResult {
  const obj =
    raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const title = str(obj.title, MAX_TITLE_LENGTH);
  const lead = str(obj.lead, MAX_LEAD_LENGTH);
  const note = str(obj.note, MAX_NOTE_LENGTH);
  const closing = str(obj.closing, MAX_CLOSING_LENGTH);

  const items: string[] = [];
  const rawItems = Array.isArray(obj.items) ? (obj.items as unknown[]) : [];
  for (const it of rawItems) {
    if (items.length >= MAX_ITEMS) break;
    const text = str(it, MAX_ITEM_LENGTH);
    if (text) items.push(text);
  }

  const hasBody = title.length > 0 && lead.length > 0;
  const notice: Notice = hasBody ? { title, lead, items, note, closing } : EMPTY_NOTICE;

  const filled = parseFilledNotes(obj.filled, hasBody);

  return { notice, filled };
}

/**
 * お知らせを、画面が扱える ComposeBlock[] に組み立てる。
 * ★blocksToHtml（htmlLines.ts）はそのまま流用する。画面側を変えないための落とし込み。
 */
export function noticeToBlocks(notice: Notice): ComposeBlock[] {
  const blocks: ComposeBlock[] = [];
  if (notice.title) blocks.push({ heading: true, text: notice.title });
  if (notice.lead) blocks.push({ heading: false, text: notice.lead });
  for (const item of notice.items) {
    blocks.push({ heading: false, text: `・${item}` });
  }
  if (notice.note) blocks.push({ heading: false, text: notice.note });
  if (notice.closing) blocks.push({ heading: false, text: notice.closing });
  return blocks;
}
