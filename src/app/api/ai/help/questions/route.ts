import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { isSystemAdmin } from '@/lib/utils/roles';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import type { HelpFeedbackSummary, HelpQuestionRow } from '@/lib/help/helpFeedback';

export const dynamic = 'force-dynamic';

/**
 * 答えられなかった質問の一覧（admin 限定）。
 *
 * ★これがAIヘルプの運用の要。ここを見てFAQ本文を書き足せば、次から答えられるようになる。
 *   AIを賢くするのではなく、FAQを育てるための画面（docs/ai-help-plan.md §4）。
 *
 * 同じ質問は文面で畳んで回数を出す。何度も聞かれているものから書けばよい。
 *
 * ★あわせて「役に立った／立たなかった」の件数（summary）も返す。
 *   AIの答え合わせ（/admin/ai-feedback）に、AIヘルプの評価を並べるため。
 *   一覧を読む画面（/help）と件数を読む画面（答え合わせ）で同じ表を見ているので、
 *   ルートを分けると片方だけ条件を変えて数が合わなくなる。
 */

/** 読み取り上限。PostgREST の1000行上限に自分で当てないよう明示する */
const SCAN_LIMIT = 1000;

export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  if (!isSystemAdmin(auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  try {
    const supabase = getPortalServiceClient();
    // 答えられなかった質問と、「立たなかった」と言われた質問の両方を拾う。
    // どちらも「FAQに足りないもの」を指しているので、書き足す材料としては同じ。
    const [listResult, summary] = await Promise.all([
      supabase
        .from('help_questions')
        .select('question, role, page_path, created_at, unanswered, helpful')
        .or('unanswered.eq.true,helpful.eq.false')
        .order('created_at', { ascending: false })
        .limit(SCAN_LIMIT),
      countHelpFeedback(supabase),
    ]);
    const { data, error } = listResult;

    if (error) {
      // テーブル未作成（マイグレーション未適用）でも画面を壊さない
      console.error('[ai/help/questions] 取得に失敗', error.message);
      return NextResponse.json({ rows: [], summary: null, available: false });
    }

    // 同じ文面をまとめて回数にする
    const byQuestion = new Map<string, HelpQuestionRow>();
    for (const r of data ?? []) {
      const question = (r.question as string) ?? '';
      const hit = byQuestion.get(question);
      if (hit) {
        hit.count += 1;
        continue;
      }
      byQuestion.set(question, {
        question,
        role: (r.role as string) ?? '',
        pagePath: (r.page_path as string | null) ?? null,
        count: 1,
        // 新しい順で読んでいるので、最初に見つかったものが最新
        lastAskedAt: r.created_at as string,
      });
    }

    // 回数の多い順 → 新しい順。何度も聞かれているものから書けばよい
    const rows = Array.from(byQuestion.values()).sort(
      (a, b) => b.count - a.count || b.lastAskedAt.localeCompare(a.lastAskedAt)
    );

    return NextResponse.json({ rows, summary, available: true });
  } catch (e) {
    console.error('[ai/help/questions] 取得に失敗', e);
    return NextResponse.json({ rows: [], summary: null, available: false });
  }
}

/**
 * 評価の件数。
 *
 * ★行を読んで数えない。count だけを取る。行を読むと PostgREST の1000行上限で
 *   黙って切られ、質問が増えたある日から件数が頭打ちになる（しかも誰も気づかない）。
 *
 * ★1つでも失敗したら null を返す。一部だけ0で埋めると「立たなかった 0件」のように
 *   正常に見える嘘の数字が出る。数えられないなら数えられないと出す。
 */
async function countHelpFeedback(
  supabase: ReturnType<typeof getPortalServiceClient>
): Promise<HelpFeedbackSummary | null> {
  const count = () => supabase.from('help_questions').select('id', { count: 'exact', head: true });

  const results = await Promise.all([
    count(),
    count().eq('helpful', true),
    count().eq('helpful', false),
    count().eq('unanswered', true),
    count().eq('degraded', true),
  ]);
  if (results.some((r) => r.error || r.count == null)) {
    console.error('[ai/help/questions] 件数の取得に失敗');
    return null;
  }
  const [total, helpful, notHelpful, unanswered, degraded] = results.map((r) => r.count ?? 0);
  return { total, helpful, notHelpful, unanswered, degraded };
}
