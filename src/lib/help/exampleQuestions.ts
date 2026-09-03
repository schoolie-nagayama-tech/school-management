/**
 * 入力欄の下に出す質問の例。
 *
 * ★理由: ヘルプへは歯車メニューから入るので、開いた時点で「何の話か」の手がかりがない。
 *   空の入力欄だけを出すと何を打てばいいか分からず、結局キーワード検索に戻ってしまう。
 *   ★FAQの見出しをそのまま並べない。見出しを写すだけならキーワード検索と同じで、
 *   「普通の言葉で聞いていい」ことが伝わらない。実際に困ったときの言い方で書く。
 *
 * 押すとその文が入って、そのまま質問が飛ぶ。
 */

import type { RoleTag } from '@/lib/help/faqData';

/** 誰にでも出す（役割で分かれない困りごと） */
const COMMON: string[] = ['振替のやり方が分からない', '報告書を書き終わったのに提出できない'];

/** 役割ごとに、その人がよく詰まるところ */
const BY_ROLE: Record<RoleTag, string[]> = {
  teacher: ['シフトはどこから出すの', '生徒が休んだときどうする'],
  manager: ['生徒を間違えて登録しちゃった', '講習の提案書を保護者に見せたい'],
  admin: ['講師のアカウントを作りたい', '教室を追加したい'],
  all: ['生徒を新しく登録したい', '成績を入力したい'],
};

/**
 * その画面・その役割に合わせた例を最大4件返す。
 * ページ内のヘルプ（ContextHelp）から呼ぶときは pageTopics にそのページの話題を渡す。
 */
export function exampleQuestions(role: RoleTag, pageTopics?: string[]): string[] {
  // 画面の中から聞くときは、その画面の話題を優先する（そのページの話だと分かるように）
  const head = (pageTopics ?? []).filter((t) => t.trim() !== '').slice(0, 2);
  const rest = [...(BY_ROLE[role] ?? BY_ROLE.all), ...COMMON];

  const out: string[] = [];
  for (const q of [...head, ...rest]) {
    if (!out.includes(q)) out.push(q);
    if (out.length >= 4) break;
  }
  return out;
}
