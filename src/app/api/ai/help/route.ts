import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { callClaudeJson, isClaudeConfigured, CLAUDE_MODELS } from '@/lib/ai/claude';
import {
  buildFaqIndex,
  filterIndexByRole,
  keywordSearch,
  pickEntriesByIds,
  prioritizeByPath,
  renderGlossary,
  renderHeadings,
  renderItemsForAnswer,
  toRoleTag,
  type FaqIndexEntry,
} from '@/lib/help/faqIndex';
import {
  answerSystem,
  answerUserText,
  ROLE_LABELS_JA,
  shortlistSystem,
} from '@/lib/help/aiHelpPrompts';

export const dynamic = 'force-dynamic';

/**
 * AIヘルプ。質問を受けて、FAQの中から答える。
 *
 * ★この機能は個人情報をAIに渡さない。渡すのは FAQ本文・質問・ロール・いまのパスだけ。
 *   生徒や保護者のデータには一切触れない（AI機能の中でこれだけがそう作られている）。
 *
 * 2段階にしている理由は faqIndex.ts の冒頭に書いた（FAQ全文が大きすぎる）。
 *
 * 正典: docs/ai-help-plan.md
 */

/** 画面に返す形。UIはこれだけを見る */
export interface AiHelpResponse {
  answer: string;
  steps: string[];
  /** 使ったFAQ項目（画面で元のFAQを展開して見せる） */
  used: { id: string; question: string; categoryTitle: string }[];
  page: { href: string; label: string } | null;
  /** 答えられなかった。UIはキーワード検索の結果に切り替える */
  unanswered: boolean;
  /** AIが使えない（鍵未設定・障害）。UIは従来の検索だけを出す */
  degraded: boolean;
  /** unanswered / degraded のときの代替候補 */
  fallback: { id: string; question: string; categoryTitle: string; href?: string }[];
}

const MAX_QUESTION_LENGTH = 200;

interface ShortlistResult {
  ids?: unknown;
}

interface AnswerResult {
  answer?: unknown;
  steps?: unknown;
  used?: unknown;
  page?: unknown;
  unanswered?: unknown;
}

function toEntrySummary(e: FaqIndexEntry) {
  return { id: e.id, question: e.question, categoryTitle: e.categoryTitle };
}

function fallbackFrom(entries: FaqIndexEntry[], question: string) {
  return keywordSearch(entries, question).map((e) => ({
    id: e.id,
    question: e.question,
    categoryTitle: e.categoryTitle,
    href: e.href,
  }));
}

/**
 * 質問を記録する。★答えられなかった質問をFAQに書き足すのが目的（docs/ai-help-plan.md §4）。
 *
 * 記録に失敗しても回答は返す。ヘルプが落ちる方が損なので、ここは握りつぶす。
 * テーブルが未作成の環境（マイグレーション未適用）でも同じ扱いになる。
 */
async function recordQuestion(params: {
  userId: string;
  role: string;
  question: string;
  path: string | null;
  matchedIds: string[];
  unanswered: boolean;
  degraded: boolean;
}): Promise<void> {
  try {
    const supabase = getPortalServiceClient();
    const { error } = await supabase.from('help_questions').insert({
      user_id: params.userId,
      role: params.role,
      question: params.question,
      page_path: params.path,
      matched_ids: params.matchedIds,
      unanswered: params.unanswered,
      degraded: params.degraded,
    });
    if (error) console.error('[ai/help] 質問の記録に失敗', error.message);
  } catch (e) {
    console.error('[ai/help] 質問の記録に失敗', e);
  }
}

export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  let body: { question?: unknown; path?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) {
    return NextResponse.json({ error: '質問を入力してください' }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { error: `質問は${MAX_QUESTION_LENGTH}字以内で入力してください` },
      { status: 400 }
    );
  }
  // パスだけを受ける。クエリ文字列は個人情報が載りうるので落とす
  const rawPath = typeof body.path === 'string' ? body.path : null;
  const path = rawPath && rawPath.startsWith('/') ? rawPath.split('?')[0].slice(0, 200) : null;

  // ★ロールで先に落とす。AIには見せてよい項目の見出しだけを渡す
  const roleTag = toRoleTag(auth.role);
  const visible = prioritizeByPath(filterIndexByRole(buildFaqIndex(), roleTag), path);

  const empty: AiHelpResponse = {
    answer: '',
    steps: [],
    used: [],
    page: null,
    unanswered: true,
    degraded: false,
    fallback: fallbackFrom(visible, question),
  };

  // 鍵が無いときは機能を畳んで、従来の検索結果だけ返す（エラーにしない）
  if (!isClaudeConfigured()) {
    await recordQuestion({
      userId: auth.userId,
      role: roleTag,
      question,
      path,
      matchedIds: [],
      unanswered: true,
      degraded: true,
    });
    return NextResponse.json({ ...empty, degraded: true } satisfies AiHelpResponse);
  }

  try {
    // ---- 1回目: どの項目か（見出しだけ。カタログはキャッシュに載せる） ----
    const { intro, catalog } = shortlistSystem(renderHeadings(visible));
    const shortlist = await callClaudeJson<ShortlistResult>({
      model: CLAUDE_MODELS.fast,
      system: [{ text: intro }, { text: catalog, cache: true }],
      userText: `【質問】\n${question}${path ? `\n【いま開いている画面】${path}` : ''}`,
      maxTokens: 200,
      prefill: '{"ids":',
    });

    const ids = Array.isArray(shortlist?.ids)
      ? shortlist.ids.filter((x): x is string => typeof x === 'string')
      : [];
    const picked = pickEntriesByIds(visible, ids);
    if (picked.length === 0) {
      await recordQuestion({
        userId: auth.userId,
        role: roleTag,
        question,
        path,
        matchedIds: [],
        unanswered: true,
        degraded: false,
      });
      return NextResponse.json(empty satisfies AiHelpResponse);
    }

    // ---- 2回目: 選ばれた項目の全文だけで答える ----
    const answer = await callClaudeJson<AnswerResult>({
      model: CLAUDE_MODELS.fast,
      system: [{ text: answerSystem() }],
      userText: answerUserText({
        question,
        itemsText: renderItemsForAnswer(picked),
        glossary: renderGlossary(),
        path,
        roleLabel: ROLE_LABELS_JA[roleTag] ?? 'スタッフ',
      }),
      maxTokens: 900,
      prefill: '{"answer":',
    });

    const answerText = typeof answer?.answer === 'string' ? answer.answer.trim() : '';
    const unanswered = answer?.unanswered === true || answerText === '';
    if (unanswered) {
      await recordQuestion({
        userId: auth.userId,
        role: roleTag,
        question,
        path,
        matchedIds: picked.map((e) => e.id),
        unanswered: true,
        degraded: false,
      });
      return NextResponse.json({
        ...empty,
        used: picked.map(toEntrySummary),
      } satisfies AiHelpResponse);
    }

    const usedIds = Array.isArray(answer?.used)
      ? answer.used.filter((x): x is string => typeof x === 'string')
      : [];
    // AIが挙げたIDのうち、実際に渡した項目だけを採る（勝手なIDは捨てる）
    const used = usedIds.length > 0 ? pickEntriesByIds(picked, usedIds) : picked;

    const steps = Array.isArray(answer?.steps)
      ? answer.steps.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      : [];

    // ★遷移先は、実際に渡した項目の href とだけ突き合わせる。AIが作ったURLには飛ばさない
    const rawPage = answer?.page as { href?: unknown; label?: unknown } | null | undefined;
    const wantedHref = rawPage && typeof rawPage.href === 'string' ? rawPage.href : null;
    const pageEntry = wantedHref ? picked.find((e) => e.href === wantedHref) : undefined;
    const page = pageEntry?.href
      ? { href: pageEntry.href, label: pageEntry.linkLabel ?? 'このページを開く' }
      : null;

    await recordQuestion({
      userId: auth.userId,
      role: roleTag,
      question,
      path,
      matchedIds: used.map((e) => e.id),
      unanswered: false,
      degraded: false,
    });

    return NextResponse.json({
      answer: answerText,
      steps,
      used: used.map(toEntrySummary),
      page,
      unanswered: false,
      degraded: false,
      fallback: [],
    } satisfies AiHelpResponse);
  } catch (e) {
    console.error('[ai/help] failed', e);
    await recordQuestion({
      userId: auth.userId,
      role: roleTag,
      question,
      path,
      matchedIds: [],
      unanswered: true,
      degraded: true,
    });
    // 落ちたときも従来の検索は返す
    return NextResponse.json({ ...empty, degraded: true } satisfies AiHelpResponse);
  }
}
