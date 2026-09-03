/**
 * AIヘルプが使うFAQの索引と、プロンプトに載せる文字列の組み立て。
 *
 * ここは純関数だけ。AIの呼び出しは /api/ai/help が行う。
 *
 * ★2段階にしている理由: FAQ本文は全部で約143,000字あり、毎回まるごと渡せない。
 *   1回目は「見出しだけ」を渡してどの項目かを選ばせ、2回目に選ばれた項目の全文だけを渡す。
 *   見出しの一覧は内容が変わらないので、プロンプトキャッシュに載せられる。
 */

import { FAQ_DATA, GLOSSARY_DATA, type FaqItem, type RoleTag } from '@/lib/help/faqData';
import type { UserRole } from '@/types/database';

/** 索引1件。FAQ項目1つに対応する */
export interface FaqIndexEntry {
  /** 安定ID（question 本文から決まる）。AIに選ばせる単位であり、記録にも残す */
  id: string;
  categoryId: string;
  categoryTitle: string;
  question: string;
  keywords: string[];
  /** 未指定なら全ロールに見せる（ページ側の itemMatchesRole と同じ意味論） */
  roles?: RoleTag[];
  /** 遷移先。無い項目もある */
  href?: string;
  linkLabel?: string;
  item: FaqItem;
}

/**
 * question 本文から決まる短い安定ID。
 *
 * ★配列の並び順を使わないのは、FAQを1件差し込むと以降のIDが全部ずれて、
 *   記録（help_questions）に残した過去のIDが別の項目を指してしまうため。
 *   question を書き換えたときだけIDが変わる。それは実質「別の項目」なので許容する。
 *
 * FNV-1a を base36 で7桁に詰める。衝突は buildFaqIndex 側で検出する。
 */
export function faqItemId(question: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < question.length; i++) {
    hash ^= question.charCodeAt(i);
    // FNV prime 16777619 を掛ける。32bit に収めるため Math.imul を使う
    hash = Math.imul(hash, 0x01000193);
  }
  // 符号なし32bitにしてから base36
  return (hash >>> 0).toString(36).padStart(7, '0');
}

/** FAQ全体を1次元の索引にする */
export function buildFaqIndex(): FaqIndexEntry[] {
  const entries: FaqIndexEntry[] = [];
  const seen = new Map<string, string>();

  for (const category of FAQ_DATA) {
    for (const item of category.items) {
      const id = faqItemId(item.question);
      const prev = seen.get(id);
      if (prev && prev !== item.question) {
        // 衝突したら気づけるようにする（実データでは起きていない）
        throw new Error(`FAQのIDが衝突しました: "${prev}" と "${item.question}"`);
      }
      seen.set(id, item.question);

      entries.push({
        id,
        categoryId: category.id,
        categoryTitle: category.title,
        question: item.question,
        keywords: item.keywords ?? [],
        roles: item.roles,
        href: item.link?.href,
        linkLabel: item.link?.label,
        item,
      });
    }
  }
  return entries;
}

/** UserRole を FAQ の RoleTag に寄せる（help/page.tsx の mapUserRoleToTag と同じ対応） */
export function toRoleTag(role: string | null | undefined): RoleTag {
  const r = (role ?? '').toLowerCase() as UserRole;
  if (r === 'admin' || r === 'owner') return 'admin';
  if (r === 'manager') return 'manager';
  if (r === 'teacher') return 'teacher';
  return 'all';
}

/**
 * そのロールに見せてよい項目だけに絞る。
 *
 * ★AIに渡す前に落とすこと。見出しごと渡さないので、講師は上位ロール専用機能の
 *   存在自体を知らない。UI側でのフィルタでは「渡してから隠す」ことになり意味が違う。
 */
export function filterIndexByRole(entries: FaqIndexEntry[], role: RoleTag): FaqIndexEntry[] {
  if (role === 'admin') return entries; // admin は全部見える
  return entries.filter((e) => !e.roles || e.roles.includes(role));
}

/**
 * 1回目（絞り込み）に渡す見出し。
 * 本文は載せない。1行1項目で、ID・カテゴリ・質問・キーワードだけ。
 */
export function renderHeadings(entries: FaqIndexEntry[]): string {
  return entries
    .map((e) => {
      const kw = e.keywords.length > 0 ? ` [${e.keywords.join('/')}]` : '';
      return `${e.id}\t${e.categoryTitle}\t${e.question}${kw}`;
    })
    .join('\n');
}

/** AIが返したIDを索引に突き合わせる。知らないIDは黙って捨てる */
export function pickEntriesByIds(
  entries: FaqIndexEntry[],
  ids: string[],
  limit = 3
): FaqIndexEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const picked: FaqIndexEntry[] = [];
  for (const id of ids) {
    const hit = byId.get(id);
    if (hit && !picked.includes(hit)) picked.push(hit);
    if (picked.length >= limit) break;
  }
  return picked;
}

/**
 * いまいるページに対応する項目を先頭に寄せる。
 * ContextHelp から呼ばれたときに、そのページの話だと分かるようにする。
 */
export function prioritizeByPath(entries: FaqIndexEntry[], path?: string | null): FaqIndexEntry[] {
  if (!path) return entries;
  const onPath: FaqIndexEntry[] = [];
  const rest: FaqIndexEntry[] = [];
  for (const e of entries) {
    if (e.href && (path === e.href || path.startsWith(e.href + '/'))) onPath.push(e);
    else rest.push(e);
  }
  return [...onPath, ...rest];
}

/** 2回目（回答）に渡す本文。選ばれた項目だけを全文で載せる */
export function renderItemsForAnswer(entries: FaqIndexEntry[]): string {
  return entries
    .map((e) => {
      const parts = [`## ${e.id} ${e.question}`, `カテゴリ: ${e.categoryTitle}`, e.item.answer];
      if (e.item.path) parts.push(`画面までの道順: ${e.item.path}`);
      if (e.item.steps?.length) {
        parts.push('手順:\n' + e.item.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'));
      }
      if (e.item.tips?.length) {
        parts.push('注意:\n' + e.item.tips.map((t) => `- ${t}`).join('\n'));
      }
      if (e.href) parts.push(`リンク: ${e.href}（${e.linkLabel ?? 'このページを開く'}）`);
      return parts.join('\n');
    })
    .join('\n\n---\n\n');
}

/** 用語集。2,300字ほどなので回答側にまるごと載せてよい */
export function renderGlossary(): string {
  return GLOSSARY_DATA.map((g) => `${g.term}: ${g.definition}`).join('\n');
}

/**
 * AIが使えないとき（キー未設定・障害・答えられない）に出す受け皿の検索。
 *
 * 2段構えにしている。
 *
 * 1. 空白区切りの全語がFAQ本文に含まれるもの（既存の検索欄と同じ条件）。
 *    「振替 操作」のようにキーワードを打った場合はこれで当たる。
 *
 * 2. ★1で0件なら、逆向きに探す。**FAQ側のキーワードが質問文に含まれるか**で数える。
 *    日本語は分かち書きしないので、「振替のやり方が分からない」は1語として扱われ、
 *    1の条件では絶対に当たらない。ここが受け皿なのに空になるのは致命的なので、
 *    質問文の中にFAQのキーワードや見出しの語が出てくるかを見て、多く当たった順に返す。
 */
export function keywordSearch(entries: FaqIndexEntry[], query: string, limit = 5): FaqIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];

  const terms = q.split(/\s+/).filter(Boolean);
  const exact = entries.filter((e) => {
    const target = `${e.question} ${e.item.answer} ${e.keywords.join(' ')}`.toLowerCase();
    return terms.every((t) => target.includes(t));
  });
  if (exact.length > 0) return exact.slice(0, limit);

  // ★逆向き。FAQのキーワード・見出しの語が質問文に出てくるかを数える
  const scored: { entry: FaqIndexEntry; score: number }[] = [];
  for (const e of entries) {
    let score = 0;
    for (const kw of e.keywords) {
      const k = kw.trim().toLowerCase();
      // 1文字のキーワードはどこにでも当たるので数えない
      if (k.length >= 2 && q.includes(k)) score += 2;
    }
    // 見出しは「〜の操作方法」のような語で切って、実のある部分だけを見る
    for (const part of e.question.toLowerCase().split(/[の・（）()、。/\s]+/)) {
      if (part.length >= 2 && q.includes(part)) score += 1;
    }
    if (score > 0) scored.push({ entry: e, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}
